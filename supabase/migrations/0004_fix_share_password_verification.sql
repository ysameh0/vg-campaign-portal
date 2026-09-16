-- verify_campaign_share_password() compared a bcryptjs-generated hash
-- (prefix $2b$) against pgcrypto's crypt(), which in this Postgres version
-- only round-trips its own $2a$-prefixed hashes correctly — real passwords
-- were failing verification even when correct. Fix: split into a
-- rate-limit-checked hash fetch (still SECURITY DEFINER, still the only way
-- anon ever touches this table) and a separate attempt-recorder, so the
-- actual comparison happens in Node with the same bcryptjs that created the
-- hash in the first place — comparing like with like instead of crossing
-- two different bcrypt implementations.
drop function if exists verify_campaign_share_password(uuid, text);

create function get_campaign_share_hash_for_verification(p_share_id uuid)
returns text
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
    return null;
  end if;

  select password_hash into v_hash
  from campaign_shares
  where id = p_share_id and revoked_at is null;

  return v_hash;
end;
$$;

create function record_campaign_share_attempt(p_share_id uuid, p_success boolean)
returns void
language sql security definer set search_path = public as $$
  insert into campaign_share_attempts (share_id, success) values (p_share_id, p_success);
$$;
