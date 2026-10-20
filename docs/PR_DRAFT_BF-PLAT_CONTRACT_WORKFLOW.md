# Draft PR Body — BF-PLAT Contract and Workflow

> **Historical PR description snapshot for [PR #31](https://github.com/vietkhang06/se358-bida-flow/pull/31), now merged.** It does not freeze a binding contract or team policy; GitHub records no reviewer approvals.

## 1. Objective

Record the API/action behavior currently implemented in this repository and prepare a reviewable shared-file ownership and Git workflow draft.

## 2. Task IDs

BF-PLAT-01, BF-PLAT-02.

## 3. Scope included

- Inventory all 41 action names and the `/api/app`, authentication, and generic `/api/action` routes.
- Trace payload handling, permission checks, response envelope, observed errors, schema references, and UI consumer to source.
- Separate current behavior from proposed error normalization and workflow rules.
- Identify shared file hotspots and mark human ownership / GitHub configuration unknown where evidence is unavailable.

## 4. Scope explicitly excluded

- No API handler, schema, migration, UI, package, lockfile, build setting, `.github` workflow, branch protection, ruleset, required check, or repository setting changes.
- No new API/action, business rule, permission, username, code owner, or module owner assignment.
- No assertion that the team accepted the proposed workflow or error convention.

## 5. Source documents/files reviewed

- `app/api/action/route.ts`, `app/api/app/route.ts`, all four `app/api/auth/*/route.ts` handlers, `lib/server.ts`, `db/schema.ts`, `components/bidaflow-app.tsx`, `package.json`, `README.md`.
- Current repository tree, branch list, Git history, `.gitignore`, and archive `BidaFlow-full-source-v3.zip` (core source matches; package manifest differs by the repository's test script).
- Task tracker, official SRS, and module ownership map remain unavailable in the accessible sources. No `.github` workflow or PR template is present. Authenticated repository access was verified, but branch-protection/ruleset/required-check settings were not audited and remain `UNVERIFIED`.

## 6. Files changed and reason

- `docs/API_ACTION_CONTRACT_DRAFT.md` — source-backed route/action inventory, payload/auth/response/error behavior, examples, and open contract issues.
- `docs/SHARED_FILE_GIT_WORKFLOW_DRAFT.md` — repo hotspots, task reviewer assignments, draft workflow/checklist, and GitHub configuration gaps.
- `docs/PR_DRAFT_BF-PLAT_CONTRACT_WORKFLOW.md` — historical PR #31 description snapshot; its current GitHub status is recorded at the top of the file.

## 7. Evidence / traceability

- Action names and server checks come from `app/api/action/route.ts`; response/auth helpers from `lib/server.ts`; DB enum declarations from `db/schema.ts`; app response from `app/api/app/route.ts`; consumer helper from `components/bidaflow-app.tsx`.
- Current branch history shows task-scoped `feature/BF-*` branches and merged PR commits. GitHub reports `main` as the repository default, and PR #31 targeted `main`. The local `origin/HEAD` symbolic ref points to `origin/feature/BF-BASE-01-foundation`, so the local symbolic ref differs from GitHub's verified default.
- No workflow or PR template exists under `.github/`. Authenticated repository access works, but branch-protection/ruleset/required-check settings have not been audited and remain `UNVERIFIED`.

## 8. Acceptance criteria checklist

- [x] Action/API identifiers in the draft have source handlers in the current repository; no code was changed.
- [x] Current error behavior is separated from `PROPOSED` normalization; proposed error envelope is not described as active.
- [ ] Bùi Vạn Khải verifies the action contracts, permissions, and mismatches.
- [ ] PM supplies tracker/SRS to verify human module owners, consumer mapping, and acceptance criteria.
- [ ] Phạm Ngọc Gia Khang reviews ownership workflow and checklist.
- [ ] Reviewer confirms the `main` base and current PR evidence; repository administrator verifies GitHub settings before any policy changes.

## 9. Decisions pending

- Whether to adopt a stable error code/envelope and how to version it.
- Whether to add explicit request/method validation in a later implementation task.
- Shared-file owner and cross-module approval assignments.
- Branch base, review/CI requirements, and whether any branch rules should be configured by an authorized repository administrator.

## 10. Dependencies / blockers

- Depends on BF-PM-02/BF-PM-03 outputs per task instruction. PR #30 is merged, but its dependent source verification and approvals remain open.
- Tracker/SRS and GitHub read permission are unavailable; module ownership and repository settings remain pending.
- PR #31 is merged without recorded reviewer approval; the action contract, ownership map, and workflow proposals remain unapproved.

## 11. Reviewers

- BF-PLAT-01: Bùi Vạn Khải.
- BF-PLAT-02: Phạm Ngọc Gia Khang.
- Task owner: Đoàn Việt Khang.

## 12. Merge restrictions

Keep this as a Draft PR. Do not merge until assigned reviewers complete their checks and dependencies/blockers are resolved according to team policy. This draft does not authorize handler changes or GitHub settings changes.
