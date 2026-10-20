# Shared-File Ownership and Git Workflow — Evidence Draft

> **PROPOSED — PENDING TEAM AGREEMENT.** Repository structure, observed code responsibility, recent Git activity, and task assignments are evidence inputs. Git history does not by itself establish a file owner. No branch protection, required check, CI workflow, code owner, or team policy is claimed as active without evidence.

Repository: `https://github.com/vietkhang06/se358-bida-flow`. Verified default/base is `main`; local `origin/HEAD` and GitHub default both resolve to `main` in this audit. The latest inspected base is `origin/main` at `74307d4f27c406b5bfb02183ea57d350d6dd73a6` (2026-10-20). PRs #30–#38 were inspected: all are merged to `main`; none has recorded review submissions. Issues #4–#5 match BF-PLAT-01/02, remain OPEN, are assigned to `vietkhang06`, and have empty descriptions. The Project CLI listing failed with `unknown owner type`; Project status is unverified and was not changed.

## 1. Evidence-based technical area map

The table identifies technical boundaries and conflict hotspots from current paths. Human code owner, business-rule owner, and cross-module approver remain `UNVERIFIED` because neither tracker nor maintainer confirmation is available. Recent commits show contributors, not ownership assignments.

| Paths | Current technical responsibility observed | Why coordination matters | Human/file owner evidence | Task reviewer |
| --- | --- | --- | --- | --- |
| `app/api/action/route.ts` | Authenticated action entrypoint; basic request checks, 18 legacy action cases, shared response/error handling, delegation to operation modules | Shared endpoint and response changes affect all action consumers; legacy cases remain here | Owner `UNVERIFIED`; contributor history is not an owner record | Bùi Vạn Khải for BF-PLAT-01 contract review only |
| `lib/operations.ts`, `lib/operation-validation.ts`, `lib/*-actions.ts` | Permission dispatch, shared field validation, catalog/reservation/session/order domain operations | Permission, payload, state transition, and result changes can affect several UI flows | Owner `UNVERIFIED`; domain boundaries are code-observed only | Bùi Vạn Khải for BF-PLAT-01 contract review only |
| `app/api/app/route.ts`, `components/bidaflow-app.tsx` | Permission-filtered snapshot provider and main UI/action consumer | Response shape, permission filtering, and UI payloads must remain compatible | Owner `UNVERIFIED`; consumer relationship is source-verified | No module owner inferred |
| `app/api/auth/*`, `lib/server.ts` | Authentication routes; session, authorization, database, shared errors and pricing/session helpers | Cross-cutting security and helper behavior affects multiple routes | Owner `UNVERIFIED`; contributor history is not an owner record | No module owner inferred |
| `db/schema.ts`, `drizzle/*` | Persistence schema and migration history | Shared database changes affect multiple actions and deploy compatibility | Owner `UNVERIFIED`; issue #6 covers schema/migration protocol but does not assign a code owner | No module owner inferred |
| `package.json`, `pnpm-lock.yaml`, `scripts/*`, `.github/*` | Runtime/tooling scripts and potential repository automation | Script, runtime, and CI changes affect all contributors and checks | `.github/` is absent from the current tracked tree; maintainer/settings owner `UNVERIFIED` | Repository administrator must verify settings |

### Git activity evidence (not ownership)

Recent `origin/main` history includes `ja-gnahk` commits for BF-A09/BF-A10/BF-A11 pricing, tables, sessions, orders, and catalog work; Khang-authored commits cover the imported baseline and BF-A08 authentication/RBAC work. PRs #36–#38 merged BF-A09–A11 implementation work. This supports identifying areas with recent contributor activity, but does not prove ongoing ownership, approval authority, or module assignment. The BF-PLAT documentation task owner/reviewer assignments below come from the PM authorization, not code-owner evidence.

## 2. BF-PLAT task assignment and dependencies

| Task | WBS / Activity (authorization-supplied; tracker-unverified) | Owner | Independent reviewer | Dependency | Current evidence status |
| --- | --- | --- | --- | --- | --- |
| BF-PLAT-01 — API/action contract | 1.2 / PLAT-01 | Đoàn Việt Khang | Bùi Vạn Khải | BF-PM-02 | Code inventory is documented in `docs/API_ACTION_CONTRACT_DRAFT.md`; provider/consumer sign-off and source requirement mapping remain pending |
| BF-PLAT-02 — shared-file workflow | 1.2 / PLAT-02 | Đoàn Việt Khang | Phạm Ngọc Gia Khang | BF-PM-03 | Repository evidence and proposed workflow are documented here; team agreement, tracker-backed owners, and admin settings verification remain pending |

These task assignments do not identify production code owners or grant GitHub permissions. The BF-PLAT-01 action inventory is explicitly `CODE-OBSERVED`, not frozen. A merged PR or PM authorization is not provider/consumer approval.

## 3. Proposed branch, coordination, and PR workflow

`PROPOSED — PENDING TEAM AGREEMENT`:

1. Start a focused branch from the approved base, currently verified as `main`; use `docs/BF-<TaskID>-<slug>` for documentation and `feature/BF-<TaskID>-<slug>` for implementation. Do not work directly on `main`.
2. Before editing a shared path, notify its confirmed owner and affected consumers. Until owners are confirmed, identify the touched paths and ask PM to route coordination; do not silently invent an owner.
3. Keep commits and PR scope focused. Link the verified task issue; describe objective, scope, exact files, dependencies, behavior/evidence, acceptance checklist, checks run, risks, rollback where relevant, and unresolved decisions.
4. The PR author does not count as the independent reviewer. Request the assigned reviewer and any verified owner/consumer review; record approval in the team-agreed system.
5. Resolve review threads and provide relevant test/build/lint evidence before merge. Merge only after required independent review and actual repository-required checks pass; never bypass failures. Update the tracker only through its authorized workflow, with evidence.
6. For schema, migration, shared API, or cross-module changes, notify affected consumers and describe compatibility/rollout risk. Escalation owner is `UNVERIFIED` until the PM/tracker supplies it.

## 4. Existing validation and repository controls

`package.json` declares Node `>=22.13.0`, `pnpm@11.25.0`, and scripts `test`, `lint`, `build`, and `db:generate`. These commands exist in the manifest; this documentation task did not run application tests/build/lint. The tracked tree has no `.github/` workflows or PR template, so this checkout provides no repository CI configuration evidence. A locally available script is not evidence that GitHub executes it as a required check.

Read-only GitHub API checks on 2026-10-20 found that `GET /repos/vietkhang06/se358-bida-flow/branches/main/protection` returned HTTP 404 `Branch not protected`, and `GET /repos/vietkhang06/se358-bida-flow/rulesets` returned an empty list. Thus no branch protection or repository ruleset is configured through those endpoints at audit time. No GitHub Actions workflow or PR template exists in the tracked tree. No required check is evidenced as enforced. Repository permissions were not audited. A repository administrator must decide whether to configure controls in a separately authorized change; this document changes no setting.

## 5. Proposed PR checklist

- [ ] Base is the approved `main` branch; branch contains only its task scope.
- [ ] Task issue mapping was verified; dependency and acceptance evidence are listed.
- [ ] Shared paths and affected consumers are identified; confirmed owners were notified.
- [ ] Source behavior is labelled `CODE-OBSERVED`; proposed contracts/policies are visibly `PROPOSED`.
- [ ] No credentials, local environment files, generated output, or unrelated changes are included.
- [ ] Relevant test/build/lint commands and actual results are recorded; unrun checks are not claimed as passing.
- [ ] An independent reviewer other than the author reviewed the change; threads are resolved.
- [ ] Actual repository-required checks and approvals are satisfied; no protection/check is assumed from this proposal.
- [ ] Tracker evidence/status is updated only by an authorized person/workflow after review; a PR or merge alone does not mark the task Done.

## 6. Decisions still required

- **PM/tracker owner:** provide module/file owners, affected consumers, and cross-module escalation authority; confirm whether task-supplied WBS/activity data matches the source tracker.
- **Team and provider/consumer owners:** approve or revise action names, payloads, responses, permission behavior, and error conventions. Until confirmation, BF-PLAT-01 is not frozen.
- **Team:** agree on branch naming, shared-file notification, reviewer routing, required evidence, and merge workflow.
- **Repository administrator:** verify branch protection/rulesets/required checks directly and decide separately whether any settings change is wanted.
