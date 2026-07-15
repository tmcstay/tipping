-- Safe admin/service retry for a single failed stage-result notification
-- job. Deliberately narrow: only ever moves a job from 'failed' back to
-- 'pending' (never touches 'sent', 'processing', 'pending' or 'skipped'
-- jobs), and never inserts a new row - so it cannot create a duplicate
-- send. Same service_role-or-cycling-admin guard pattern already used by
-- mark_grandtour_stage_result_checked/finalize_grandtour_stage_result
-- (see CLAUDE.md) - this is the well-established, justified use of
-- security definer in this codebase, not a "casual" one: the underlying
-- table intentionally has no authenticated write policy at all (see
-- 20260715040000), so an RPC is the only route for an admin to act on it,
-- and this RPC does the minimum necessary (one guarded status transition).
create or replace function public.retry_grandtour_stage_notification_job(
  p_job_id uuid,
  p_retried_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.grandtour_stage_notification_jobs;
begin
  if auth.role() <> 'service_role' and not grandtour_private.is_cycling_admin() then
    raise exception 'Only a cycling admin or the service role may retry a notification job.';
  end if;

  select job.* into v_job
  from public.grandtour_stage_notification_jobs job
  where job.id = p_job_id
  for update;

  if v_job.id is null then
    raise exception 'Notification job % not found.', p_job_id;
  end if;

  if v_job.status <> 'failed' then
    raise exception 'Notification job % is %, not failed - it cannot be retried.', p_job_id, v_job.status;
  end if;

  update public.grandtour_stage_notification_jobs
  set
    status = 'pending',
    attempt_count = 0,
    processing_started_at = null,
    last_error_code = null,
    next_attempt_at = now(),
    updated_at = now()
  where id = p_job_id;

  return jsonb_build_object(
    'status', 'retried',
    'job_id', p_job_id,
    'retried_by', p_retried_by
  );
end;
$$;

comment on function public.retry_grandtour_stage_notification_job(uuid, uuid) is
  'Resets exactly one failed stage-result notification job back to pending. Never touches sent/processing/pending/skipped jobs and never inserts a row, so it cannot duplicate a send. Callable by service_role or an active cycling admin only.';

revoke all on function public.retry_grandtour_stage_notification_job(uuid, uuid) from public;
grant execute on function public.retry_grandtour_stage_notification_job(uuid, uuid) to authenticated;
