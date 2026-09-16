-- get_campaign_share_summary() was declared `language sql stable` but its
-- body opens with an UPDATE (bumping view_count) — Postgres rejects any
-- data-modifying statement inside a stable/immutable function ("UPDATE is
-- not allowed in a non-volatile function"), so every real call to this RPC
-- failed and the share page silently fell back to the password form
-- forever, regardless of whether the password or the session cookie were
-- correct. Rewritten as plpgsql (implicitly volatile, the correct
-- volatility for a function with a side effect) with an explicit `return
-- query` instead of relying on a bare trailing SELECT.
drop function if exists get_campaign_share_summary(uuid);

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
) language plpgsql security definer set search_path = public as $$
begin
  update campaign_shares set view_count = view_count + 1, last_viewed_at = now()
  where id = p_share_id and revoked_at is null;

  return query
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
end;
$$;
