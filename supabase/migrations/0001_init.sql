-- Velocity Growth campaign portal — core schema.
-- Organized top to bottom: extensions, tenancy, domain tables, ingestion audit,
-- send/delivery pipeline, public share links, helper functions, RLS policies,
-- indexes, triggers, dashboard RPCs.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- =========================================================================
-- TENANCY
-- =========================================================================

create table brands (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,        -- 'KILELE' | 'KAROO' | 'MARRAKECH'
  name text not null,
  created_at timestamptz not null default now()
);

-- profiles.brand_id is the single source of truth for "which tenant does this
-- user belong to" — every RLS policy in this schema traces back to this table
-- via current_brand_id() below.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  brand_id uuid not null references brands (id),
  role text not null check (role in ('owner', 'analyst')),
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

-- Pre-provisioned allowlist of the six accounts. A row here is what lets
-- someone in at all: handle_new_auth_user() below only creates a profile
-- (i.e. only grants access to any brand_id) for emails present in this table.
-- Anyone else who completes Google OAuth authenticates with Supabase but gets
-- no profile row, so every RLS policy that requires current_brand_id() denies
-- them everywhere — see handle_new_auth_user() and the app-level check in
-- src/lib/auth/require-profile.ts that signs such sessions back out.
create table brand_members (
  email text primary key,
  brand_id uuid not null references brands (id),
  role text not null check (role in ('owner', 'analyst'))
);

alter table brands enable row level security;
alter table profiles enable row level security;
alter table brand_members enable row level security;
-- No policies on brand_members: it is only ever read by the SECURITY DEFINER
-- trigger below, never by PostgREST directly.

-- =========================================================================
-- CONTACTS
-- =========================================================================

create table contacts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id),
  external_id text not null,
  full_name text,
  email text,
  phone text,
  country text,
  city text,
  -- normalized to one of: active | bounced | unsubscribed | pending | unknown
  status text not null default 'unknown',
  consent_marketing boolean not null default false,
  signup_at timestamptz,
  deleted_at timestamptz,
  suppressed_until timestamptz,
  notes text,
  raw jsonb not null default '{}'::jsonb,
  -- sha256 of the normalized field values, computed by the ingestion code.
  -- Lets a re-import classify each row as inserted/updated/unchanged by a
  -- cheap hash comparison instead of a full column-by-column diff, and lets
  -- "unchanged" rows be skipped from the upsert entirely.
  content_hash text,
  source_import_id uuid,
  -- occurred_at of the last live provider event that changed status /
  -- consent_marketing / suppressed_until below. The poller only applies a
  -- new event when its occurred_at is strictly after this — event time, not
  -- arrival time — so an out-of-order redelivery can never regress a
  -- contact from e.g. bounced back to active. See supabase/functions/poll-events.
  provider_status_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, external_id)
);

-- Contactability is a derived, explicit rule — not a stored flag — so the one
-- definition can never drift from what the UI displays. See the comment on
-- rpc_dashboard_totals() for the exact wording shown on screen.
create function is_contactable(c contacts) returns boolean
language sql immutable as $$
  select c.deleted_at is null
     and c.status = 'active'
     and c.consent_marketing = true
     and (c.suppressed_until is null or c.suppressed_until <= now())
     and (c.email is not null or c.phone is not null)
$$;

-- =========================================================================
-- CAMPAIGNS
-- =========================================================================

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id),
  external_id text,                 -- set for seeded historical campaigns (e.g. 'KIL-0016')
  name text not null,
  channel text not null check (channel in ('email', 'sms')),
  target_country text,
  status text not null default 'draft'
    check (status in ('draft', 'queued', 'sending', 'sent', 'failed')),
  parent_campaign_id uuid references campaigns (id),
  source text not null default 'app' check (source in ('seed_historical', 'app')),
  -- as claimed by the CSV / provider's own aggregate — kept verbatim, never
  -- recomputed, so we can show "as reported" next to "as counted" (see
  -- rpc_campaign_performance).
  reported_sent int,
  reported_delivered int,
  reported_bounced int,
  reported_opens int,
  reported_clicks int,
  spend numeric(12, 2),
  sent_at timestamptz,
  send_local_time text,
  content_hash text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index campaigns_brand_external_id_key
  on campaigns (brand_id, external_id) where external_id is not null;

-- Historical per-event log seeded from events.csv per brand — this is the
-- "actual, counted from the log" side of campaign performance.
create table seed_events (
  id bigint generated always as identity primary key,
  brand_id uuid not null references brands (id),
  event_id text not null,
  contact_id uuid references contacts (id),
  campaign_id uuid references campaigns (id),
  event_type text not null,         -- bounce | click | complaint | open | unsubscribe
  channel text,
  occurred_at timestamptz not null,
  unique (brand_id, event_id)
);

-- =========================================================================
-- INGESTION AUDIT
-- =========================================================================

create table imports (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id),
  kind text not null check (kind in ('contacts', 'campaigns', 'events')),
  file_name text not null,
  initiated_by uuid references profiles (id),
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  row_count int not null default 0,
  inserted_count int not null default 0,
  updated_count int not null default 0,
  unchanged_count int not null default 0,
  rejected_count int not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text
);

create table import_row_errors (
  id bigint generated always as identity primary key,
  import_id uuid not null references imports (id) on delete cascade,
  row_number int not null,
  severity text not null default 'error' check (severity in ('error', 'warning')),
  reason text not null,
  raw_row jsonb not null
);

alter table contacts add constraint contacts_source_import_fk
  foreign key (source_import_id) references imports (id);

-- =========================================================================
-- SEND / DELIVERY PIPELINE
-- =========================================================================

-- One row per campaign that has ever been sent through the app. campaign_id
-- is UNIQUE: a campaign can be sent at most once, ever. The "Send" flow does
-- a guarded UPDATE campaigns SET status='queued' WHERE status='draft' before
-- inserting here, so two concurrent confirms can't both win — see
-- src/lib/campaigns/send.ts.
create table campaign_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references campaigns (id),
  brand_id uuid not null references brands (id),
  requested_by uuid references profiles (id),
  idempotency_key text not null unique,
  recipient_count int not null,
  provider_batch_id text,
  status text not null default 'queued' check (status in ('queued', 'dispatched', 'failed')),
  provider_response jsonb,
  last_event_cursor text,
  last_polled_at timestamptz,
  requested_at timestamptz not null default now(),
  dispatched_at timestamptz,
  error text
);

create table campaign_send_recipients (
  id bigint generated always as identity primary key,
  campaign_send_id uuid not null references campaign_sends (id) on delete cascade,
  contact_id uuid not null references contacts (id),
  brand_id uuid not null references brands (id),
  provider_recipient_key text not null,
  status text not null default 'sent'
    check (status in ('sent', 'delivered', 'bounced', 'opened', 'unsubscribed')),
  last_event_at timestamptz,
  unique (campaign_send_id, contact_id)
);

-- Raw provider events, deduped on (campaign_send_id, provider_event_id) so a
-- redelivered/duplicated report from the dispatcher is a no-op, and ordered
-- for state derivation by occurred_at (event time), never by arrival order —
-- see the poller in supabase/functions/poll-events.
create table provider_events (
  id bigint generated always as identity primary key,
  campaign_send_id uuid not null references campaign_sends (id) on delete cascade,
  brand_id uuid not null references brands (id),
  provider_event_id text not null,
  event_type text not null,
  occurred_at timestamptz,
  recipient_key text,
  contact_id uuid references contacts (id),
  raw jsonb not null,
  received_at timestamptz not null default now(),
  unique (campaign_send_id, provider_event_id)
);

-- =========================================================================
-- PUBLIC SHARE LINKS
-- =========================================================================

create table campaign_shares (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns (id),
  brand_id uuid not null references brands (id),
  password_hash text not null,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  view_count int not null default 0,
  last_viewed_at timestamptz
);

create table campaign_share_attempts (
  id bigint generated always as identity primary key,
  share_id uuid not null references campaign_shares (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  success boolean not null
);

alter table campaigns enable row level security;
alter table seed_events enable row level security;
alter table imports enable row level security;
alter table import_row_errors enable row level security;
alter table contacts enable row level security;
alter table campaign_sends enable row level security;
alter table campaign_send_recipients enable row level security;
alter table provider_events enable row level security;
alter table campaign_shares enable row level security;
alter table campaign_share_attempts enable row level security;

-- =========================================================================
-- ISOLATION — the guarantee this whole schema exists to make testable.
--
-- current_brand_id() resolves the caller's tenant from profiles (SECURITY
-- DEFINER so it can read profiles despite profiles' own RLS). Every SELECT
-- policy below is `brand_id = current_brand_id()`. There are deliberately NO
-- insert/update/delete policies on tenant tables for the authenticated role:
-- all writes happen server-side through the service-role client, which
-- re-checks brand_id and role explicitly in application code (see
-- src/lib/supabase/service-role.ts and src/lib/campaigns/send.ts) rather than
-- relying on RLS to encode business rules like "only an owner can send".
-- RLS's job here is exactly one thing: a brand can never SELECT another
-- brand's rows, from any client, through any path. That's the property
-- tests/isolation.test.ts asserts, including a run with policies dropped to
-- prove the test actually fails without them.
-- =========================================================================

create function current_brand_id() returns uuid
language sql stable security definer set search_path = public as $$
  select brand_id from profiles where id = auth.uid()
$$;

create function current_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create policy profiles_self_select on profiles
  for select using (id = auth.uid());

create policy brands_own_select on brands
  for select using (id = current_brand_id());

create policy contacts_tenant_select on contacts
  for select using (brand_id = current_brand_id());

create policy campaigns_tenant_select on campaigns
  for select using (brand_id = current_brand_id());

create policy seed_events_tenant_select on seed_events
  for select using (brand_id = current_brand_id());

create policy imports_tenant_select on imports
  for select using (brand_id = current_brand_id());

create policy import_row_errors_tenant_select on import_row_errors
  for select using (
    import_id in (select id from imports where brand_id = current_brand_id())
  );

create policy campaign_sends_tenant_select on campaign_sends
  for select using (brand_id = current_brand_id());

create policy campaign_send_recipients_tenant_select on campaign_send_recipients
  for select using (brand_id = current_brand_id());

create policy provider_events_tenant_select on provider_events
  for select using (brand_id = current_brand_id());

create policy campaign_shares_tenant_select on campaign_shares
  for select using (brand_id = current_brand_id());

-- =========================================================================
-- NEW-USER PROVISIONING
-- =========================================================================

create function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, brand_id, role, email, full_name)
  select new.id, bm.brand_id, bm.role, new.email,
         coalesce(new.raw_user_meta_data ->> 'full_name', new.email)
  from public.brand_members bm
  where lower(bm.email) = lower(new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- =========================================================================
-- INDEXES
-- =========================================================================

create index contacts_brand_status_idx on contacts (brand_id, status);
create index contacts_brand_signup_idx on contacts (brand_id, signup_at);
create index contacts_brand_deleted_idx on contacts (brand_id, deleted_at);
create index contacts_search_trgm_idx on contacts using gin (
  (coalesce(full_name, '') || ' ' || coalesce(email, '')) gin_trgm_ops
);

create index campaigns_brand_status_idx on campaigns (brand_id, status);
create index seed_events_brand_campaign_idx on seed_events (brand_id, campaign_id);
create index seed_events_brand_contact_idx on seed_events (brand_id, contact_id);
create index seed_events_occurred_idx on seed_events (occurred_at);

create index campaign_send_recipients_send_idx on campaign_send_recipients (campaign_send_id);
create index campaign_send_recipients_contact_idx on campaign_send_recipients (contact_id);
create index provider_events_send_idx on provider_events (campaign_send_id, occurred_at);

create index import_row_errors_import_idx on import_row_errors (import_id);

-- =========================================================================
-- updated_at MAINTENANCE
-- =========================================================================

create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger contacts_set_updated_at before update on contacts
  for each row execute function set_updated_at();
create trigger campaigns_set_updated_at before update on campaigns
  for each row execute function set_updated_at();

-- =========================================================================
-- DASHBOARD RPCs
--
-- SECURITY INVOKER (the default) — these run as the calling user, so RLS on
-- the underlying tables still scopes every result to current_brand_id(). No
-- brand_id parameter is ever accepted from the client.
-- =========================================================================

create function rpc_dashboard_totals() returns table (
  total_customers bigint,
  contactable_customers bigint
) language sql stable as $$
  select
    count(*) filter (where deleted_at is null) as total_customers,
    count(*) filter (where is_contactable(contacts.*)) as contactable_customers
  from contacts
  where brand_id = current_brand_id();
$$;

create function rpc_signups_per_day(p_days int default 30) returns table (
  day date,
  signups bigint
) language sql stable as $$
  select d::date as day, count(contacts.id) as signups
  from generate_series(
    (current_date - (p_days - 1)),
    current_date,
    interval '1 day'
  ) d
  left join contacts
    on contacts.brand_id = current_brand_id()
    and contacts.deleted_at is null
    and contacts.signup_at::date = d::date
  group by d
  order by d;
$$;

-- Returns both the seeded "as reported" numbers and the "as counted" numbers
-- derived from seed_events / campaign_send_recipients, so the UI can label
-- which is which rather than silently picking one.
-- Two independent one-to-many relations (seed_events and
-- campaign_send_recipients) must be pre-aggregated in separate CTEs before
-- joining to campaigns — joining both directly would cross-multiply rows
-- (e.g. 500 seed_events x 300 recipients per campaign) and silently inflate
-- every count.
create function rpc_campaign_performance() returns table (
  campaign_id uuid,
  name text,
  channel text,
  status text,
  source text,
  sent_at timestamptz,
  reported_sent int,
  reported_delivered int,
  reported_bounced int,
  reported_opens int,
  reported_clicks int,
  counted_delivered bigint,
  counted_bounced bigint,
  counted_opened bigint,
  counted_clicked bigint,
  counted_unsubscribed bigint,
  live_recipient_count bigint,
  live_delivered bigint,
  live_bounced bigint,
  live_opened bigint,
  live_unsubscribed bigint
) language sql stable as $$
  with seed_agg as (
    select
      campaign_id,
      count(*) filter (where event_type = 'delivered') as counted_delivered,
      count(*) filter (where event_type = 'bounce') as counted_bounced,
      count(*) filter (where event_type = 'open') as counted_opened,
      count(*) filter (where event_type = 'click') as counted_clicked,
      count(*) filter (where event_type = 'unsubscribe') as counted_unsubscribed
    from seed_events
    group by campaign_id
  ),
  live_agg as (
    select
      cs.campaign_id,
      count(csr.id) as live_recipient_count,
      count(csr.id) filter (where csr.status = 'delivered') as live_delivered,
      count(csr.id) filter (where csr.status = 'bounced') as live_bounced,
      count(csr.id) filter (where csr.status = 'opened') as live_opened,
      count(csr.id) filter (where csr.status = 'unsubscribed') as live_unsubscribed
    from campaign_sends cs
    left join campaign_send_recipients csr on csr.campaign_send_id = cs.id
    group by cs.campaign_id
  )
  select
    c.id, c.name, c.channel, c.status, c.source, c.sent_at,
    c.reported_sent, c.reported_delivered, c.reported_bounced, c.reported_opens, c.reported_clicks,
    coalesce(seed_agg.counted_delivered, 0),
    coalesce(seed_agg.counted_bounced, 0),
    coalesce(seed_agg.counted_opened, 0),
    coalesce(seed_agg.counted_clicked, 0),
    coalesce(seed_agg.counted_unsubscribed, 0),
    coalesce(live_agg.live_recipient_count, 0),
    coalesce(live_agg.live_delivered, 0),
    coalesce(live_agg.live_bounced, 0),
    coalesce(live_agg.live_opened, 0),
    coalesce(live_agg.live_unsubscribed, 0)
  from campaigns c
  left join seed_agg on seed_agg.campaign_id = c.id
  left join live_agg on live_agg.campaign_id = c.id
  where c.brand_id = current_brand_id()
  order by c.sent_at desc nulls last, c.created_at desc;
$$;

-- =========================================================================
-- ISOLATION INTROSPECTION — used only by tests/isolation.test.ts to assert
-- the RLS mechanism itself is still in place (relrowsecurity + the tenant
-- policy), independent of whether an app-level query happens to still look
-- correctly scoped. Revoked from anon/authenticated: callable only with the
-- service role key, same as the test uses.
-- =========================================================================

create function debug_isolation_report() returns table (
  table_name text,
  rls_enabled boolean,
  has_tenant_policy boolean
) language sql stable as $$
  select
    c.relname,
    c.relrowsecurity,
    exists (
      select 1 from pg_policies p
      where p.tablename = c.relname and p.qual ilike '%current_brand_id()%'
    )
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in (
      'contacts', 'campaigns', 'seed_events', 'imports', 'import_row_errors',
      'campaign_sends', 'campaign_send_recipients', 'provider_events', 'campaign_shares'
    );
$$;

revoke all on function debug_isolation_report() from public, anon, authenticated;

-- =========================================================================
-- PUBLIC SHARE RPCs — the only two ways anonymous traffic ever touches this
-- database. Both are SECURITY DEFINER (RLS above blocks anon entirely) but
-- each is scoped to a single share_id argument and returns nothing else:
-- no other campaign, no contact-level data, no password hash.
-- =========================================================================

create function verify_campaign_share_password(p_share_id uuid, p_password text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_hash text;
  v_recent_failures int;
begin
  select count(*) into v_recent_failures
  from campaign_share_attempts
  where share_id = p_share_id
    and success = false
    and attempted_at > now() - interval '15 minutes';

  if v_recent_failures >= 10 then
    return false;
  end if;

  select password_hash into v_hash
  from campaign_shares
  where id = p_share_id and revoked_at is null;

  if v_hash is null then
    insert into campaign_share_attempts (share_id, success) values (p_share_id, false);
    return false;
  end if;

  if v_hash = crypt(p_password, v_hash) then
    insert into campaign_share_attempts (share_id, success) values (p_share_id, true);
    return true;
  else
    insert into campaign_share_attempts (share_id, success) values (p_share_id, false);
    return false;
  end if;
end;
$$;

-- Callable only with a share_id already password-verified by the caller (the
-- Next.js server checks a signed, short-lived cookie minted after
-- verify_campaign_share_password succeeds — see src/app/share/[id]/actions.ts
-- — before ever calling this). Returns aggregate campaign performance only.
create function get_campaign_share_summary(p_share_id uuid)
returns table (
  campaign_name text,
  brand_name text,
  channel text,
  sent_at timestamptz,
  reported_sent int,
  reported_delivered int,
  reported_bounced int,
  reported_opens int,
  reported_clicks int,
  counted_delivered bigint,
  counted_bounced bigint,
  counted_opened bigint,
  counted_clicked bigint
) language sql stable security definer set search_path = public as $$
  update campaign_shares set view_count = view_count + 1, last_viewed_at = now()
  where id = p_share_id and revoked_at is null;

  select
    c.name, b.name, c.channel, c.sent_at,
    c.reported_sent, c.reported_delivered, c.reported_bounced, c.reported_opens, c.reported_clicks,
    count(se.id) filter (where se.event_type = 'delivered'),
    count(se.id) filter (where se.event_type = 'bounce'),
    count(se.id) filter (where se.event_type = 'open'),
    count(se.id) filter (where se.event_type = 'click')
  from campaign_shares cs
  join campaigns c on c.id = cs.campaign_id
  join brands b on b.id = c.brand_id
  left join seed_events se on se.campaign_id = c.id
  where cs.id = p_share_id and cs.revoked_at is null
  group by c.id, b.name;
$$;
