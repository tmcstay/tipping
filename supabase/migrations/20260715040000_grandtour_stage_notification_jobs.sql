-- Delivery queue/audit table for GrandTour stage-result emails
-- (supabase/functions/send-stage-results). See CLAUDE.md's "Resend
-- transactional email" section for the full design.
--
-- No existing notification-job schema exists anywhere in this repo
-- (confirmed by a full-repo grep before writing this migration). Deliberately
-- reuses public.grandtour_stage_scores as the immutable per-user-per-stage
-- snapshot the email is rendered from (score_details is written once by
-- recalculate_grandtour_stage_scores and never recomputed) rather than
-- adding a second, redundant snapshot table.
create type public.grandtour_notification_type as enum ('stage_results');
create type public.grandtour_notification_channel as enum ('email');
create type public.grandtour_notification_status as enum (
  'pending',
  'processing',
  'sent',
  'failed',
  'skipped'
);

create table public.grandtour_stage_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  stage_id uuid not null references public.grandtour_stages(id) on delete cascade,
  notification_type public.grandtour_notification_type not null default 'stage_results',
  channel public.grandtour_notification_channel not null default 'email',
  status public.grandtour_notification_status not null default 'pending',
  attempt_count integer not null default 0,
  scheduled_at timestamptz not null default now(),
  processing_started_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error_code text,
  next_attempt_at timestamptz not null default now(),
  -- e.g. 'stage-result:<stage_id>:<user_id>' - see CLAUDE.md. Doubles as
  -- both the DB-level dedupe key and the Resend Idempotency-Key header.
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grandtour_stage_notification_jobs_one_per_user_stage
    unique (user_id, stage_id, notification_type),
  constraint grandtour_stage_notification_jobs_idempotency_key_unique
    unique (idempotency_key)
);

comment on table public.grandtour_stage_notification_jobs is
  'Delivery queue + audit trail for GrandTour stage-result emails. Never store the Resend API key, full auth tokens, or large raw provider responses here - provider_message_id/last_error_code only.';

-- Supports the claim query (pending/failed-ready-for-retry, ordered by
-- schedule) and the stuck-processing recovery sweep.
create index grandtour_stage_notification_jobs_claim_idx
  on public.grandtour_stage_notification_jobs (status, next_attempt_at)
  where status in ('pending', 'processing');

create index grandtour_stage_notification_jobs_stage_idx
  on public.grandtour_stage_notification_jobs (stage_id);

alter table public.grandtour_stage_notification_jobs enable row level security;

-- Ordinary users never see the queue at all - only cycling admins get
-- read-only visibility (for the admin notification-status view), and only
-- via RLS, never a table-level grant to anon. Internal job
-- processing (generation/claiming/updating) always uses the service-role
-- key, which bypasses RLS entirely - the same trust boundary this repo's
-- apply/admin-check/finalize RPCs already rely on - so no
-- authenticated-role write policy is defined here at all.
create policy "Cycling admins can read GrandTour notification jobs"
  on public.grandtour_stage_notification_jobs
  for select
  to authenticated
  using (grandtour_private.is_cycling_admin());

revoke all on public.grandtour_stage_notification_jobs from public, anon;
grant select on public.grandtour_stage_notification_jobs to authenticated;

create trigger grandtour_stage_notification_jobs_set_updated_at
  before update on public.grandtour_stage_notification_jobs
  for each row
  execute function app_private.set_updated_at();
