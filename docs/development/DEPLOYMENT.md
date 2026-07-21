# Deployment

This file is the entry point. The detailed, still-accurate operational
references are kept where they already lived rather than duplicated here:

- **[docs/deployment.md](../deployment.md)** — Vercel project settings,
  environment variables, `EXPO_PUBLIC_APP_URL`/auth-redirect configuration,
  Supabase Auth dashboard configuration, local web export, manual QA steps for
  auth email links.
- **[docs/deployment-workflow.md](../deployment-workflow.md)** — the chosen
  overall workflow across repository/Supabase Cloud/Codemagic/EAS/Vercel.
- **[docs/deployment/codemagic-ios.md](../deployment/codemagic-ios.md)** — iOS
  build pipeline via Codemagic, TestFlight.

## Deploy targets at a glance

| Target | Trigger | What it deploys | Secrets scope |
|---|---|---|---|
| Vercel | push to `main` | `apps/mobile` web export + `apps/mobile/api/admin/grandtour/*` server routes | `EXPO_PUBLIC_*` only — **never** a service-role key |
| Supabase Cloud | manual, via CLI (`supabase db push`, `supabase functions deploy`) | migrations, RPCs, Edge Functions, Vault secrets, cron schedules | project-scoped, set via `supabase secrets set` / dashboard |
| Codemagic | manual/configured trigger | iOS build → TestFlight | Apple signing (`AuthKey_*.p8`, gitignored, never committed) |
| GitHub Actions | scheduled (cron) + manual `workflow_dispatch` | GrandTour dry-run and full apply/score pipelines | repo secrets: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ADMIN_EMAIL`/`PASSWORD`, `ADMIN_USER_ID`, `SMTP_*`, `ADMIN_EMAIL` |

## Known open items

- `EXPO_PUBLIC_APP_URL` for the Vercel **Preview** environment could not be
  set via the Vercel CLI in this project's environment (`git_branch_required`
  error on the "all branches" form) — needs a one-time manual dashboard add.
  See `docs/deployment.md` for the exact steps.
- Preview deployments are **deliberately not** supported as Auth redirect
  targets — both Production and Preview point `EXPO_PUBLIC_APP_URL` at the
  same production origin, so every Auth email lands on one stable, allow-listed
  URL.
- SMTP secrets (`SMTP_SERVER`/`PORT`/`USERNAME`/`PASSWORD`) and `ADMIN_EMAIL`
  for the dry-run notification email were documented as needed but not
  confirmed set as of the last review — see
  [ROADMAP.md](../project/ROADMAP.md). The mail step degrades gracefully
  (prints a notice, doesn't fail the job) when they're absent.

## Production safety

Every write-capable script/RPC in this repo defaults to dry-run and requires
explicit multi-flag confirmation before writing to a known production
Supabase URL (`--confirm-production`, plus a decoded-JWT `role` check on any
service-role key). Never bypass these gates to "save time" — see
[DECISIONS.md](../project/DECISIONS.md) #12 and the root `CLAUDE.md`/`AGENTS.md`
"Execution authority" sections.
