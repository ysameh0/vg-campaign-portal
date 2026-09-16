-- The campaign detail page originally pulled every campaign_send_recipients
-- row client-side to tally by status — PostgREST defaults to a 1,000-row
-- cap per request with no explicit range(), so a Kilele-scale send (tens of
-- thousands of recipients) silently undercounted past the first 1,000. This
-- aggregates server-side instead. SECURITY INVOKER (the default): RLS on
-- campaign_sends still scopes this to the caller's brand via the join.
create function rpc_campaign_send_recipient_counts(p_campaign_send_id uuid) returns table (
  status text,
  count bigint
) language sql stable as $$
  select csr.status, count(*)
  from campaign_send_recipients csr
  join campaign_sends cs on cs.id = csr.campaign_send_id
  where csr.campaign_send_id = p_campaign_send_id
    and cs.brand_id = current_brand_id()
  group by csr.status;
$$;
