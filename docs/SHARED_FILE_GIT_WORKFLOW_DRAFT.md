# Shared-File Ownership and Git Workflow — Draft

> **DRAFT — PENDING TEAM AGREEMENT.** This describes the repository observations and proposes a workflow. It does not assert repository settings, grant GitHub permissions, or assign code owners. Task owner/reviewer assignments below are from the current task instruction only.

## 1. Repository observations

- The repository is a Git checkout with `main`, local/remote `feature/*` branches, and remote `origin` at `https://github.com/vietkhang06/ae358-bida-flow.git`.
- The recent history includes merged task-scoped work such as `feature/BF-A08-auth-rbac` and `feature/BF-A12-A14-task-coverage`.
- `origin/HEAD` currently points to `origin/feature/BF-BASE-01-foundation`, while the current instruction explicitly names `main` as the base for both document PRs. Use the task's `main` base for these local draft branches; confirm the repository default/base expectation with PM before opening them remotely.
- No `.github/` directory, workflow file, or PR template is present in this checkout. GitHub branch protection/ruleset/required-check settings are `UNVERIFIED`: the available GitHub CLI token is invalid, so settings could not be read.

## 2. Shared-file and module map

The “technical area” column is based on repository structure. Human module owner, business-rule owner, and shared-file owner remain `UNVERIFIED` until reconciled with the task tracker. Reviewer assignments only apply to BF-PLAT-01/02 documentation tasks as supplied; they do not establish code ownership.

| Shared area / files | Why it is shared or conflict-prone | Technical area | Business-rule owner | File/module owner | Current task reviewer |
| --- | --- | --- | --- | --- | --- |
| `app/api/action/route.ts` | Central dispatcher with handlers across accounts, tables, sessions, orders, billing, inventory, and shifts; parallel edits can overlap heavily. | Action/API provider | UNVERIFIED — tracker unavailable | UNVERIFIED — tracker unavailable | Bùi Vạn Khải for BF-PLAT-01 contract review only |
| `lib/server.ts` | Shared auth, permissions, session, DB helpers, error mapping, pricing, and amount calculation. | Server foundation | UNVERIFIED — tracker unavailable | UNVERIFIED — tracker unavailable | Bùi Vạn Khải for BF-PLAT-01 contract review only |
| `db/schema.ts`, `drizzle/*` | Shared persistence model and migration history; schema/migration changes affect multiple handlers. | Database | UNVERIFIED — tracker unavailable | UNVERIFIED — tracker unavailable | UNVERIFIED by module |
| `app/api/app/route.ts` | Permission-filtered state snapshot consumed by UI and reporting views. | Read API/report aggregation | UNVERIFIED — tracker unavailable | UNVERIFIED — tracker unavailable | Bùi Vạn Khải for BF-PLAT-01 contract review only |
| `components/bidaflow-app.tsx` | Main UI and generic action caller; changes can touch multiple screens and consumer payloads. | Client UI/consumer | UNVERIFIED — tracker unavailable | UNVERIFIED — tracker unavailable | UNVERIFIED by module |
| `.github/*` | No directory currently exists; proposed CI/workflow configuration would affect repository-wide merge checks. | Repository CI/settings | UNVERIFIED | Authorized repository administrator `UNVERIFIED` | UNVERIFIED |

Cross-module approver: `UNVERIFIED`. No GitHub username, team, code owner, or permission is inferred here.

## 3. Task ownership supplied for this documentation batch

| Task | Task owner | Reviewer | Dependency |
| --- | --- | --- | --- |
| BF-PLAT-01 — API/action contract | Đoàn Việt Khang | Bùi Vạn Khải | Governance outputs, especially BF-PM-02 and BF-PM-03 (per supplied task instruction) |
| BF-PLAT-02 — shared-file/Git workflow | Đoàn Việt Khang | Phạm Ngọc Gia Khang | Governance outputs, especially BF-PM-02 and BF-PM-03 (per supplied task instruction) |

These are task assignments only; they do not grant GitHub rights or identify owners of production modules.

## 4. Proposed branch and PR workflow

`PROPOSED — PENDING TEAM AGREEMENT`:

1. Start each task branch from the agreed base (the two requested draft PRs use `main`): `feature/BF-<TaskID>-<short-slug>` for implementation, or `docs/BF-<TaskID>-<short-slug>` for documentation-only work. Keep related task changes together and avoid mixing unrelated modules.
2. Commit with a concise type/task prefix, for example `docs(BF-PLAT): draft action contract`. Do not include secrets, local environment files, generated output, or unrelated edits.
3. Open a PR with objective, Task IDs, scope included/excluded, source files, changed files, dependencies, test evidence, acceptance checklist, decisions/blockers, and reviewer names.
4. A PR author must not count as the independent reviewer for their own PR. Request the assigned reviewer and notify owners of any shared file once the tracker-backed owner list is available.
5. Identify any cross-module or shared-schema impact in the PR. Request review from each affected owner; cross-module approval authority is pending team assignment.
6. Merge only after reviewer approval and all checks required by the adopted repository policy pass. Current required checks and branch protection are `UNVERIFIED`; do not treat this proposal as evidence that a check exists or as permission to bypass a failing check.
7. Record blockers in the PR; do not merge to skip a blocker. Keep documentation proposals labelled draft until the team approves them.

## 5. Proposed review / merge checklist

- [ ] Branch is based on the agreed target and contains only the PR's task scope.
- [ ] PR lists task IDs, changed files, dependencies, acceptance criteria, and relevant tests/checks with results.
- [ ] No credentials, local environment files, or unrelated generated artifacts are present.
- [ ] Source claims link to code/docs; proposed conventions are clearly separated from current behavior.
- [ ] A reviewer other than the author has reviewed the change.
- [ ] Owners of affected shared files/modules have been notified and their approval is recorded according to a team-approved rule.
- [ ] Required CI/status checks (once verified by a repository administrator) have passed; failures and blockers are resolved rather than bypassed.
- [ ] Cross-module/schema/migration compatibility and any rollout need are documented.
- [ ] Any baseline, scope, or business-rule decision has approval from its designated authority before it is represented as effective.

Checklist is proposed, not a current required merge policy. A repository administrator must verify settings and approve any later configuration change. This task does not change branch protection, rulesets, required checks, or GitHub repository settings.

## 6. Pending decisions

- PM: confirm the intended remote default/base branch (`origin/HEAD` currently differs from explicitly requested `main`).
- PM/tracker owner: supply a verified module/file owner map and cross-module approval authority.
- Repository administrator: audit current branch protection, rulesets, and required checks; decide whether the proposed rules should be configured in a separate authorized change.
- Team: approve or revise branch naming, review, shared-file notification, CI, and merge checklist requirements.
