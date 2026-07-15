-- Fixes a real bug found while locally dry-running send-stage-results:
-- both new notification tables' `revoke all ... from public, anon;`
-- statements (20260715030000, 20260715040000) also stripped service_role's
-- ambient access, since every role implicitly inherits a `PUBLIC` grant
-- unless one was never given - `service_role` bypasses RLS entirely, but
-- RLS bypass has never substituted for the base table GRANT itself. The
-- exact same class of bug as the pre-existing `public.profiles` grant gap
-- documented in CLAUDE.md ("`public.profiles` SELECT grant - fixed for
-- real") - confirmed here the same way that one was: querying
-- has_table_privilege('service_role', ..., 'select') was false on both new
-- tables (true on every pre-existing table, e.g. grandtour_tips/profiles),
-- and the Edge Function's real local run failed with a genuine Postgres
-- `permission denied for table grandtour_notification_preferences`
-- (`42501`), not an RLS-filtered empty result.
grant select, insert, update on public.grandtour_notification_preferences to service_role;
grant select, insert, update on public.grandtour_stage_notification_jobs to service_role;
