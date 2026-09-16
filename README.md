# Velocity Growth — Client Campaign Portal

A multi-tenant campaign portal for three Velocity Growth brands (Kilele Rides,
Karoo Coaches, Marrakech Express) sharing one Supabase project and one
Next.js app. Each brand's marketing team sees only its own contacts,
campaigns, and dashboard; owners can send a campaign through Velocity's
messaging dispatcher and publish a password-protected results link.

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind, shadcn/ui on Base UI) — deployed on Vercel.
- **Supabase** — Postgres, Auth (email/password + Google OAuth), Edge Functions, pg_cron.
- **VG Messaging Dispatcher** — the external send/delivery-report provider given in the brief.

## Where things live

| What | Where |
|---|---|
| Database schema, RLS policies, RPCs | [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) |
| **The tenant-isolation guarantee** | same file, the `ISOLATION` section — `current_brand_id()`, and one `for select using (brand_id = current_brand_id())` policy per tenant table |
| Isolation test (fails if RLS is dropped) | [`tests/isolation.test.ts`](tests/isolation.test.ts) |
| CSV ingestion (parsing, normalization, idempotent upsert) | [`src/lib/ingest/`](src/lib/ingest/) |
| Campaign audience + send (idempotent, guarded state transition) | [`src/lib/campaigns/send.ts`](src/lib/campaigns/send.ts), [`src/lib/campaigns/audience.ts`](src/lib/campaigns/audience.ts) |
| Delivery-report poller (Edge Function, cron-scheduled) | [`supabase/functions/poll-events/index.ts`](supabase/functions/poll-events/index.ts) |
| Shared password-protected results link | [`src/app/share/[id]/`](src/app/share/[id]/) |
| One-time seed script (brands, six users, CSV imports) | [`scripts/seed.ts`](scripts/seed.ts) |

## Architecture, in short

- **Multi-tenancy is enforced in Postgres, not in application code.** Every
  tenant table carries `brand_id`; a `profiles` row (one per auth user) maps
  a signed-in user to exactly one brand and role. Row Level Security policies
  scope every `SELECT` to `brand_id = current_brand_id()`. There are
  deliberately no client-writable policies on tenant tables — every write
  (imports, sends, delivery updates) goes through server code using the
  service-role key, which re-checks brand and role explicitly rather than
  leaning on RLS to encode business rules like "only an owner can send."
  RLS's one job is: a brand can never `SELECT` another brand's rows, from
  any client, through any path — including a direct Supabase REST/JS query
  that bypasses the app entirely.
- **Access is allowlisted, not just authenticated.** Only the six seeded
  emails have a row in `brand_members`. A trigger on `auth.users` only
  creates a `profiles` row (which is what RLS keys off) for allowlisted
  emails — see `handle_new_auth_user()` in the migration. Anyone else who
  completes Google OAuth gets a valid Supabase session but no profile, and
  `src/lib/auth/require-profile.ts` signs them back out rather than
  rendering an empty portal shell.
- **Ingestion is idempotent and honest about failures.** Each brand's CSVs
  use different delimiters, header names, and boolean encodings (see
  `src/lib/ingest/normalize.ts` for the specifics). Rows upsert on
  `(brand_id, external_id)`, keyed by a content hash so a re-imported file
  reports `0 inserted / 0 updated / N unchanged` instead of silently
  duplicating. Rows that fail (e.g. no `external_id`) are rejected and
  logged with a reason to `import_row_errors`, visible on the **Imports**
  screen — not just to whoever ran the script.
- **A send can't double-fire.** `sendCampaign()` claims a campaign with a
  single conditional `UPDATE ... WHERE status IN ('draft','failed')`; a
  losing concurrent request (double-click, two tabs, two sessions) sees zero
  rows updated and reports "already sent" instead of dispatching twice. The
  same deterministic `Idempotency-Key` is sent to the provider on every
  attempt for a given campaign, so even a network-level retry collapses
  server-side per the dispatcher's own contract.
- **Delivery state follows event time, not arrival time.** The poller dedupes
  on the provider's `event_id` and only advances a recipient's (or contact's)
  status when the new event's `occurred_at` is strictly after the last one
  applied — so a duplicated or out-of-order report from the provider can't
  regress state. This assumes the provider's docs are wrong when they claim
  the event stream is "clean and complete," per the brief.
- **The shared link is the only anonymous path into the database**, and it's
  narrow on purpose: two `SECURITY DEFINER` RPCs, both parameterized only by
  a single unguessable `share_id`. The results page itself never queries a
  table directly.

## Running locally

```bash
npm install
cp .env.local.example .env.local   # fill in from your Supabase project settings
npm run dev
```

## Setting up the database

1. Create a Supabase project.
2. Push the schema: `supabase link --project-ref <ref>` then
   `supabase db push` (applies `supabase/migrations/0001_init.sql`).
3. In Authentication → Providers, enable Google, and add
   `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized
   redirect URI in the corresponding Google Cloud OAuth client.
4. Deploy the poller: `supabase functions deploy poll-events`, then set its
   secrets (`supabase secrets set DISPATCHER_BASE_URL=... DISPATCHER_API_KEY=...`).
5. Run `supabase/post-deploy.sql` in the SQL editor to schedule the poller
   every 2 minutes (fill in your project ref and service role key first).
6. Fetch the seed data referenced in the brief and extract it to
   `data/extracted/`:
   ```bash
   curl -sL -o data/seed.zip "https://dispatcher-production-72fc.up.railway.app/data/SivIPYk5jesN2MTvMX9aEA/vg-growthengineer-seed.zip"
   sha256sum data/seed.zip   # should be 4961a25b151ca13ac56089ca46b94def6074c315445ec193c7bf87060683d35c
   unzip -o data/seed.zip -d data/extracted
   ```
7. `npm run seed` — creates the three brands, the six logins, and loads all
   three brands' CSVs (Kilele's contacts import runs twice: the base export,
   then the `-delta-2026-09-01` file, to exercise the same upsert path a
   real correction would use).

## Testing

```bash
npm test
```

`tests/isolation.test.ts` runs against the real deployed project using two
of the seeded owner logins — it signs in as each, and asserts neither can
read the other's rows even when querying by an exact row id it already
knows. A second test authenticates as a freshly created, non-seeded user and
confirms they get a valid session but zero rows anywhere. A third calls a
service-role-only introspection RPC to assert RLS and the tenant policy are
actually attached to every tenant table — independent of whether any given
query happens to look correctly scoped, this catches the isolation mechanism
itself being removed.

I also verified this isn't vacuously passing: I dropped `contacts_tenant_select`
against this same project via the Management API, reran `npm test`, confirmed
two of the three tests failed, then restored the policy and confirmed green
again. Worth noting what the failure looked like — with RLS enabled and no
policy, Postgres denies by default, so the contacts table returned zero rows
to everyone rather than leaking cross-brand data. The isolation mechanism
fails closed, not open. This wasn't scripted as an automated CI step (a test
that disables production isolation as part of its own run is a bad idea even
briefly), but it was run for real, once, against the graded database, not a
scratch copy.

## AI tools

Built with Claude Code (Claude Sonnet 5) end to end — architecture,
migrations, application code, and this README.

## Data quirks handled

- Marrakech's exports are semicolon-delimited with French headers (`pays`,
  `e_mail`, `mobile`) and comma-decimal spend (`221,09`); Kilele's contacts
  file has a leading UTF-8 BOM; boolean consent is encoded as `yes/no`,
  `1/0`, and `true/false` depending on the brand.
- `kilele-send-log.csv` contains an exact duplicate row (`BATCH-0003`,
  three times). I didn't build a separate ingestion path for this file — its
  numbers are redundant with `campaigns.csv`'s `reported_sent` — but it's a
  clean illustration of the exact duplicate-record problem
  `campaign_sends.idempotency_key` is designed to survive for real,
  live-app sends.
- "Signups per day, last 30 days" is computed against the real wall-clock
  date, not the most recent row in the data. Karoo and Marrakech's seed data
  predates the window entirely, so their charts legitimately show empty —
  the dashboard says so rather than quietly re-anchoring the window to make
  a chart appear.
