-- Run this once, after `supabase functions deploy poll-events`, in the
-- Supabase SQL editor (or `supabase db execute -f supabase/post-deploy.sql`
-- with a direct DB connection). It can't live in migrations/0001_init.sql
-- because it needs the project's own URL and service role key, which don't
-- exist until the project does.
--
-- Replace the two placeholders below before running.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'poll-provider-events',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/poll-events',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR-SERVICE-ROLE-KEY',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To inspect or remove the schedule later:
--   select * from cron.job;
--   select cron.unschedule('poll-provider-events');
