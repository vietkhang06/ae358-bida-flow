# Draft PR Body — BF-PM Governance

> **Historical PR description snapshot for [PR #30](https://github.com/vietkhang06/se358-bida-flow/pull/30), now merged.** The documents remain drafts; the merge did not approve a baseline or policy, and GitHub records no reviewer approvals.

## 1. Objective

Prepare traceable governance drafts for the schedule baseline discrepancy, Use Case coverage, WBS/owner/dependency mapping, and schedule change controls. Keep source gaps and approval dependencies visible for PM and reviewer review.

## 2. Task IDs

BF-PM-01, BF-PM-02, BF-PM-03.

## 3. Scope included

- Record the supplied 25/12/2026 and 30/11/2026 date claims as unverified leads and prepare sponsor decision options without editing an official baseline.
- Expand the existing grouped coverage summary into provisional UC01–UC47 rows with unknown fields marked.
- Prepare a task owner/reviewer map, pending WBS/activity IDs, proposed DoD, and proposed schedule/scope change rules.

## 4. Scope explicitly excluded

- No code, schema, migration, package, build configuration, tracker, Charter, Schedule, or WBS changes.
- No sponsor/PM/team approval, official baseline change, task status change, merge, or implementation work.

## 5. Source documents/files reviewed

- `README.md`, `package.json`, `docs/USE_CASE_COVERAGE.md`.
- Repository Git state/history and archive `BidaFlow-full-source-v3.zip`; archive core source files match the working repository, but the archive `package.json` lacks the repository's `test` script.
- Source files relevant to implementation observations: `app/api/action/route.ts`, `app/api/app/route.ts`, `lib/server.ts`, `db/schema.ts`.
- SRS, Charter, Project Schedule, WBS, Decision Log, and task tracker: unavailable in the accessible OneDrive/repository search. Dates in BF-PM-01 are user-supplied leads, not verified source citations.

## 6. Files changed and reason

- `docs/USE_CASE_COVERAGE.md` — make 47 provisional IDs and all missing fields reviewable; preserve existing subsystem grouping and code observations.
- `docs/GOVERNANCE_REVIEW_DRAFT.md` — baseline decision entry, ownership/dependency dictionary, DoD, and schedule/scope change rules.
- `docs/PR_DRAFT_BF-PM_GOVERNANCE.md` — historical PR #30 description snapshot; its current GitHub status is recorded at the top of the file.

## 7. Evidence / traceability

- Existing coverage contains grouped ranges UC01–UC47 but no individual title/actor/owner/task/acceptance traceability.
- Repo Git state was clean on `main` before branch creation. No original governance documents were found in the accessible OneDrive search.
- Implementation observations link to the current repository source in the coverage document; they are not asserted as SRS requirements.

## 8. Acceptance criteria checklist

- [ ] Sponsor verifies the source versions and decides the date discrepancy; until then status stays `PROPOSED — PENDING SPONSOR APPROVAL`.
- [ ] PM supplies SRS/tracker; reviewers verify all 47 exact titles, actors, owners/tasks, acceptance references, and UC46/UC47 ownership.
- [ ] PM verifies WBS/activity IDs and dependency links against the authoritative WBS/tracker.
- [x] Unknown fields and non-approval status are explicit; no official date was changed.
- [ ] PM/reviewers approve the proposed DoD and schedule/scope change rules.

## 9. Decisions pending

- Sponsor decision on the Charter/Schedule acceptance date semantics and approved baseline.
- PM source delivery and mapping validation; reviewer resolution of UC46/UC47 ownership.
- PM/reviewer approval of proposed governance controls.

## 10. Dependencies / blockers

- BF-PM-03 depends on BF-PM-01 and BF-PM-02.
- The missing SRS, Charter, Schedule, WBS, and tracker prevent full acceptance.
- PR #30 is merged. Sponsor approval for BF-PM-01, PM/reviewer validation of the SRS/WBS/tracker mapping, and approval of proposed governance controls remain pending.

## 11. Reviewers

- BF-PM-01: Phạm Ngọc Gia Khang.
- BF-PM-02 and BF-PM-03: Bùi Vạn Khải.
- Task owner: Đoàn Việt Khang.

## 12. Merge restrictions

Keep this as a Draft PR. Do not merge until required source verification and review are complete. Sponsor approval is required before any official baseline change; PR review alone does not approve the sponsor decision.
