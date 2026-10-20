# Release, UAT, and Closure Readiness — Draft

> **DRAFT — NOT A RELEASE APPROVAL, UAT RESULT, OR PROJECT SIGN-OFF.** The authoritative Charter/Schedule/SRS, deployed environment details, backup policy, and acceptance authority were not supplied. No deployment, backup, restore, demo, acceptance, release tag, or closure action was performed.

## BF-A19-01 — Release preparation

### Repository facts checked

- `package.json` requires Node.js `>=22.13.0`; the package manager is pnpm `11.25.0`.
- The manifest provides `dev`, `build`, `start`, `lint`, `test`, and `db:generate`; it has no deploy, backup, restore, migration-apply, or rollback script.
- `README.md` describes Next.js/Vinext on Cloudflare Workers with D1 and documents a local startup flow. `scripts/run-framework.mjs` runs the local Vinext build; `package.json`'s `start` command launches Wrangler in local mode and persists to `.wrangler/state`.
- `vite.config.ts` reads a checkout-local hosting binding file and supplies a placeholder D1 database ID for the local Cloudflare plugin configuration. This does not identify or verify a production account, database, domain, or deployed target.
- The repository contains one initial Drizzle SQL migration. No production migration procedure, backup schedule, restore runbook, or tested rollback procedure was found.
- `.env.example` now uses an obvious replacement placeholder for `SETUP_CODE`; it is not a real secret. Production values must be configured through the verified deployment secret store, which remains unknown.
- No `.github` workflow or release workflow is present in the repository. GitHub repository protection/release settings were not audited.
- No Git tag was found locally or from `git ls-remote --tags origin` at audit time.

### Release checklist — all deployment-specific items pending

- [ ] PM/release owner identifies the actual deployment target, account, production URL, and responsible operator.
- [ ] Verify Node/pnpm versions and lockfile installation in the approved release runner.
- [ ] Confirm D1 binding/database identity and environment separation without placing identifiers or secrets in source.
- [ ] Review the migration against a restorable backup; record the approved production migration and rollback procedure.
- [ ] Rehearse backup restoration in an isolated environment; record timestamp, operator, evidence link, and measured result.
- [ ] Configure `SETUP_CODE` and any other required secrets in the verified secret store; rotate any value used for initial setup according to the approved policy.
- [ ] Run the release build and agreed regression checks in the target-equivalent environment.
- [ ] Run post-deploy health checks and the approved smoke flows; record actual URL, build/commit, logs, and defects.
- [ ] PM/release owner authorizes the release. No release is authorized by this checklist.

**Status:** `IN PROGRESS — DEPLOYMENT, BACKUP/RESTORE, AND ROLLBACK INPUTS UNVERIFIED`.

## BF-A20-01 — UAT evidence pack draft

The scenario rows below are proposed test organization based on existing source areas. UC IDs, requirements, expected business values, test account authorization, and acceptance owners are `UNVERIFIED` until reconciled to the official SRS/tracker. Every result is `NOT RUN` because no approved UAT environment or session was provided.

| Scenario | Requirement / UC | Preconditions and steps to prepare | Expected result | Result / evidence | Defect / approver |
| --- | --- | --- | --- | --- | --- |
| UAT-01 Login and session lifecycle | `UNVERIFIED` | Approved test users for each role; sign in, refresh session, sign out, retry protected page | Pending SRS and auth-owner confirmation | `NOT RUN`; no UAT evidence | `PENDING` |
| UAT-02 Role access and report visibility | `UNVERIFIED` | Approved role-permission matrix; try permitted and forbidden app/report views | Pending approved access matrix | `NOT RUN`; mock tests are not UAT | `PENDING` |
| UAT-03 Reservation and table session flow | `UNVERIFIED` | Approved table/rate and reservation data; reserve, confirm, seat, pause/resume, end | Pending approved workflow and billing expectations | `NOT RUN`; no deployed UAT environment | `PENDING` |
| UAT-04 Order, inventory, invoice, and payment | `UNVERIFIED` | Approved product/stock and payment setup; add/serve order, issue invoice, pay, inspect stock/shift | Pending approved accounting and inventory rules | `NOT RUN`; no production-like data | `PENDING` |
| UAT-05 Reports and date/filter boundaries | `UNVERIFIED` | Approved KPI contract, timezone, date range, user roles, and known expected totals | Pending A16-01 decisions | `NOT RUN`; no approved KPI oracle | `PENDING` |

For each executed scenario, record the environment/build, sanitized test-data identifier, actor, timestamp and timezone, exact steps, expected result source, actual result, evidence link, defect ID, and approver decision. Never paste secrets or personal customer data into the pack.

**Status:** `IN PROGRESS — CHECKLIST STRUCTURE PREPARED; AUTHORITATIVE TRACEABILITY AND RESULTS PENDING`.

## BF-A20-02 — Demo and acceptance record

| Field | Current value |
| --- | --- |
| Demo date / environment / build | `PENDING — NOT SCHEDULED OR RUN` |
| Sponsor / PO decision-maker | `UNVERIFIED` |
| Scenarios demonstrated | `NONE RECORDED` |
| Accepted / rejected criteria | `PENDING — NO APPROVED UAT CRITERIA` |
| Defects and exceptions | `PENDING DEMO` |
| Sign-off evidence | `NONE — DO NOT INFER APPROVAL` |

**Status:** `BLOCKED — requires approved UAT pack, real demo, and authorized human decision-maker`.

## BF-A20-03 — Closure and lessons-learned draft

### Evidence to collect before closure

- A20-02 acceptance decision and disposition of every exception/defect.
- Approved final schedule/baseline and actual-vs-plan variance, with sponsor decision for the unresolved PM-01 dates.
- Final release commit/tag only after it is actually created and verified; production URL/build and rollback/backup evidence from the release owner.
- Links to approved source artifacts, final UAT evidence, reviewed PRs, and owner-confirmed archive location.

### Preliminary observations for team review

- Draft governance and platform documents were merged in PRs #30 and #31, but GitHub records no reviewer approvals for either PR. Their merge is not evidence of sponsor, PM, or reviewer sign-off.
- Current automated tests use an in-memory SQLite/D1 mock; they do not establish production deployment or stakeholder acceptance.
- The repository has no verified production backup/restore or rollback procedure in its tracked docs/scripts.

These are audit observations, not final lessons learned. PM and team members should validate causes, impact, and actions after acceptance. No closure date, final acceptance, tag, or archived-project status is asserted.

**Status:** `BLOCKED — A20-02 ACCEPTANCE AND FINAL PROJECT RECORDS REQUIRED`.
