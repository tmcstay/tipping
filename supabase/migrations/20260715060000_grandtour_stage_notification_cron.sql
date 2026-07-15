-- Schedules the recurring send-stage-results processing run via pg_cron +
-- pg_net. No pg_cron/pg_net usage exists anywhere else in this repo yet
-- (confirmed by grep before writing this migration) - both extensions are
-- new here.
--
-- The recurring 15-minute schedule does NOT mean users get emailed every
-- 15 minutes: send-stage-results only ever creates one notification job
-- per (user, stage) - see the unique constraint in
-- 20260715040000_grandtour_stage_notification_jobs.sql - and only sends a
-- job once (status moves pending -> processing -> sent and never back).
-- A run that finds nothing new to do is a normal, expected outcome.
--
-- Environment-neutral by design: the function URL and the scheduler auth
-- secret are stored in Supabase Vault (never hardcoded into this SQL, and
-- never the Resend API key - that stays an Edge Function secret only, per
-- the task's own instruction), and this migration seeds LOCAL-safe
-- placeholder values so `supabase db reset` / local dev works out of the
-- box without ever calling a hosted URL. Production needs its own,
-- separate, uncommitted step to point these secrets at the real deployed
-- function URL and a real scheduler secret - see
-- scripts/grandtour-configure-notification-cron-production.mjs (not this
-- migration, and not committed with any real value).
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'grandtour_notification_function_url'
  ) then
    perform vault.create_secret(
      'http://127.0.0.1:54321/functions/v1/send-stage-results',
      'grandtour_notification_function_url',
      'Base URL of the send-stage-results Edge Function. LOCAL placeholder by default - production must be repointed via scripts/grandtour-configure-notification-cron-production.mjs, never by editing this migration.'
    );
  end if;

  if not exists (
    select 1 from vault.decrypted_secrets where name = 'grandtour_notification_scheduler_secret'
  ) then
    perform vault.create_secret(
      'local-dev-placeholder-secret-not-for-production-use',
      'grandtour_notification_scheduler_secret',
      'Bearer token send-stage-results checks (constant-time) against DAILY_RESULTS_JOB_SECRET. LOCAL placeholder by default - production must set a real random secret via scripts/grandtour-configure-notification-cron-production.mjs, matching the DAILY_RESULTS_JOB_SECRET Edge Function secret.'
    );
  end if;
end;
$$;

-- cron.schedule() upserts by job name, so re-running this migration (or a
-- future migration calling it again with the same name) safely replaces
-- the existing job rather than creating a duplicate - no separate
-- unschedule-then-schedule dance needed.
select cron.schedule(
  'process-grandtour-stage-result-emails',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'grandtour_notification_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'grandtour_notification_scheduler_secret')
    ),
    body := jsonb_build_object('mode', 'process_ready_stages')
  ) as request_id;
  $cron$
);
