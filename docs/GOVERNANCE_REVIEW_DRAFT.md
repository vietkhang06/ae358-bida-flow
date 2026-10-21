# Governance Decision and Work Breakdown Draft — BF-PM-01 / 02 / 03

> **PROPOSED — PENDING SOURCE VERIFICATION AND REVIEW.** This document is a review artifact, not an approved baseline, WBS, tracker, sponsor decision, or adopted policy. It records repository evidence and task assignments supplied in the PM authorization. The official Charter, Project Schedule, SRS, WBS, decision log, and tracker are not present in the tracked repository or accessible workspace sources checked for this work.

Repository: `vietkhang06/se358-bida-flow`; base snapshot: `origin/main` at `74307d4f27c406b5bfb02183ea57d350d6dd73a6` (2026-10-20 audit). Live GitHub issues #1–#3 have the matching task titles, are OPEN, are assigned to `vietkhang06` (Đoàn Việt Khang), and have empty descriptions. Issue state is evidence only; no tracker or Project status was changed. The GitHub CLI Project listing returned `unknown owner type`, so Project board fields could not be verified.

## BF-PM-01 — Schedule baseline discrepancy

### Evidence and limits

| Source | What is available | Claim | Verification status |
| --- | --- | --- | --- |
| Project Charter | No authoritative file/version in repository/workspace scan | User-provided lead: acceptance/completion may be 25/12/2026 | `UNVERIFIED` — exact wording, date, and milestone meaning unavailable |
| Project Schedule | No authoritative file/version in repository/workspace scan | User-provided lead: A20 acceptance/closure may be 30/11/2026 | `UNVERIFIED` — exact wording, date, dependencies, and baseline status unavailable |
| WBS/tracker | No authoritative file; issues #1–#3 have no body | No authoritative activity chain or planned dates | `UNVERIFIED` |

These are unverified leads, not source-verified facts. If they refer to the same gate, the dates differ by 25 calendar days; if they refer to distinct gates, their definitions and dependencies must be confirmed from the source documents. No date is adopted, no baseline is changed, and no schedule/tracker value is synchronized by this proposal.

### Decision record proposal

**Decision:** determine whether the cited Charter acceptance date and Schedule A20 date represent the same acceptance/closure gate; approve one governing baseline or document two distinct gates and their evidence/dependencies.

**Authority:** sponsor approval is required for an official baseline decision. Sponsor identity/authority is not evidenced in repository sources. PM Đoàn Việt Khang coordinates the comparison; the assigned independent reviewer is Phạm Ngọc Gia Khang. **Status: `PROPOSED — PENDING SPONSOR APPROVAL`.**

**Options to evaluate after source receipt:** (1) retain the Charter milestone as governing and reconcile A20 and dependent dates; (2) retain A20 and determine whether Charter wording/date must be amended or denotes a separate deadline; (3) document separate gates only if the source wording supports that interpretation. Assess test, release, and UAT impact from the actual WBS dependency chain; do not treat the arithmetic 25-day interval as available float.

**Evidence required to decide:** versioned Charter and Schedule with exact milestone passages; WBS/tracker predecessor and successor links; sponsor decision with approver, date, rationale, and affected artifacts. Until then, dependent planned dates remain `PENDING BASELINE DECISION`.

**After approval:** update only fields expressly covered by the recorded decision; preserve actual dates separately; recalculate affected test/release/UAT dates from verified dependencies; record the decision in the authoritative log and synchronize authorized schedule/tracker artifacts. Those external artifacts are not accessible here and were not edited.

## BF-PM-02 — Use Case list and UC47 ownership

[`docs/USE_CASE_COVERAGE.md`](USE_CASE_COVERAGE.md) contains provisional UC01–UC47 rows expanded from the existing repository coverage summary. The README/summary is not an SRS. No authoritative SRS or task tracker was found, and issues #1–#3 do not contain task details. Accordingly, neither the claimed count of 47 nor official titles, actors, owners, subsystem mapping, acceptance references, completeness, duplicates, or UC46/UC47 assignment can be verified. Existing summary grouping only places UC46 and UC47 together in “Kiểm soát hệ thống” and mentions “Nhật ký; Hồ sơ > Đăng xuất”; this does not establish individual mappings or ownership.

**Required reconciliation:** PM supplies the versioned SRS/Use Case source and tracker; reviewer Bùi Vạn Khải checks each exact ID/title/actor/subsystem against source sections and tracker owner/task/WBS/acceptance references, then records gaps, duplicate IDs/titles, missing owners, and naming differences. UC47 ownership remains `UNVERIFIED — PENDING SRS + TRACKER`; do not infer it from implementation or the task owner.

**Implementation evidence is separate:** source files may demonstrate existing capabilities but cannot establish the intended Use Case inventory. Current implementation observations are labelled as such in the coverage matrix and do not close source verification.

## BF-PM-03 — WBS/activity dictionary and baseline controls

The IDs, assignments, priorities, estimates, and dependencies below were supplied directly in the task authorization. They are **authorization-supplied**, not reconciled to an authoritative project WBS/tracker. Preserve the given IDs in this proposal and validate them against the source before representing them as the official WBS.

| Task / activity | WBS / Activity ID | Deliverable | Owner | Independent reviewer | Dependency | Priority / estimate | Definition of Done proposal | Evidence / current GitHub issue |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BF-PM-01 / PM-01 | 1.1 / PM-01 | Decision record for baseline date discrepancy | Đoàn Việt Khang | Phạm Ngọc Gia Khang | None stated | Critical / 2 h | Charter and Schedule versions/wording compared; sponsor decision recorded with authority/date/evidence before official baseline alignment | This document; issue #1 OPEN, title matches, no description |
| BF-PM-02 / PM-02 | 1.1 / PM-02 | Reconciled Use Case coverage matrix | Đoàn Việt Khang | Bùi Vạn Khải | None stated | Critical / 2 h | Every source Use Case matched to its tracker owner/task/acceptance reference; discrepancies and UC47 resolved with citations | `docs/USE_CASE_COVERAGE.md`; issue #2 OPEN, title matches, no description |
| BF-PM-03 / PM-03 | 1.1 / PM-03 | Validated WBS/activity dictionary, owner map, and update rules | Đoàn Việt Khang | Bùi Vạn Khải | BF-PM-01 and BF-PM-02 | High / 2 h | IDs/fields/dependencies reconciled to authoritative tracker; acyclic dependency graph; approved update rules documented; unknown owners remain unassigned | This table and rules below; issue #3 OPEN, title matches, no description |
| BF-PLAT-01 / PLAT-01 | 1.2 / PLAT-01 | Source-reconciled API/action contract | Đoàn Việt Khang | Bùi Vạn Khải | BF-PM-02 | Critical / 3 h | Current action/route behavior traced; provider/consumer confirmation recorded before contract is called frozen | `docs/API_ACTION_CONTRACT_DRAFT.md`; issue #4 OPEN, title matches, no description |
| BF-PLAT-02 / PLAT-02 | 1.2 / PLAT-02 | Evidence-based shared-file map and Git workflow | Đoàn Việt Khang | Phạm Ngọc Gia Khang | BF-PM-03 | High / 2 h | Responsibility evidence separated from proposed owners; usable workflow reviewed; settings claims verified or marked unknown | `docs/SHARED_FILE_GIT_WORKFLOW_DRAFT.md`; issue #5 OPEN, title matches, no description |

The five issue mappings above were checked against exact live GitHub issue titles #1–#5; all are OPEN and assigned to the task owner. The issue descriptions are empty. Their GitHub Project status was not available to verify; no status is recommended as a live value here. This table does not close dependencies or imply task acceptance.

### Proposed documentation Definition of Done

Pending PM/reviewer adoption: (1) each factual claim cites its source version and file/section or code path; (2) unknowns remain visibly `UNVERIFIED`/`PENDING`; (3) required independent reviewer records review in the team's confirmed system; (4) task-specific acceptance evidence is attached; (5) Markdown links resolve, `git diff --check` passes, and scope contains only the task documents; (6) any baseline-dependent value remains pending sponsor evidence.

### Proposed dependency and baseline change control

These are proposals, not current controls. Dependencies must match the authoritative tracker; validate the graph for cycles and report contradictions instead of silently changing them. For a baseline/scope request: record requester/date/reason; impacted requirement, UC, WBS/task IDs; predecessor/successor, effort, test/release/UAT and risk impact; options; decision authority; and supporting evidence. Obtain the authorized decision before editing the approved baseline. Then log approver, date, rationale, version, and affected artifacts; update approved schedule/WBS/tracker fields consistently; preserve actual and prior-baseline values; notify affected owners. The precise escalation route and decision-log system remain `UNVERIFIED` pending the governance source and PM confirmation.

## Open decisions and approval gates

- **Sponsor (BF-PM-01):** provide authoritative Charter/Schedule versions and decide milestone semantics and baseline; no official date is selected here.
- **PM/tracker owner (BF-PM-02/03):** provide versioned SRS, WBS, and tracker; confirm all IDs, titles, actors, owner/reviewer, dependencies, DoD, and UC47 owner.
- **Bùi Vạn Khải:** independently reconcile the Use Case matrix and WBS/dependency map when those sources are supplied.
- **Phạm Ngọc Gia Khang:** review BF-PM-01 decision record; no sponsor approval is implied by reviewer assignment.
- **PM/reviewers:** decide whether the proposed DoD/change-control rules should be adopted.

Until those gates are met, BF-PM-01 is `BLOCKED` on source and sponsor authority, BF-PM-02 is `BLOCKED` on SRS/tracker verification, and BF-PM-03 is `IN PROGRESS — PROVISIONAL` and depends on PM-01/02. These are evidence-based recommendations; no GitHub status was changed.
