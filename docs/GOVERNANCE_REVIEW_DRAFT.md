# Governance Review Draft — BF-PM-01 / BF-PM-02 / BF-PM-03

> **DRAFT — FOR PM / REVIEWER REVIEW.** No sponsor or team approval is implied. The SRS, Charter, Project Schedule, WBS, Decision Log, and tracker were not available in the accessible workspace. Fields that depend on those sources remain `UNVERIFIED` or `PENDING`.

Owner: Đoàn Việt Khang (assignment supplied in the task instruction).

| Task | Reviewer from current assignment | Dependency from current assignment | Draft status |
| --- | --- | --- | --- |
| BF-PM-01 | Phạm Ngọc Gia Khang | None stated | `PROPOSED — PENDING SPONSOR APPROVAL` |
| BF-PM-02 | Bùi Vạn Khải | None stated | `PENDING SRS + TRACKER VERIFICATION` |
| BF-PM-03 | Bùi Vạn Khải | BF-PM-01 and BF-PM-02 | `DRAFT — PENDING PM REVIEW` |

## BF-PM-01 — Schedule baseline discrepancy

### Source and milestone inventory

| Source | Version / source status | Date claim | Milestone meaning | Verification |
| --- | --- | --- | --- | --- |
| Project Charter | File/version unavailable | The task instruction supplies a lead that the Charter may state completion/acceptance no later than **25/12/2026** | Exact wording and milestone meaning unavailable | `UNVERIFIED — original Charter not found` |
| Project Schedule | File/version unavailable | The task instruction supplies a lead that **A20 acceptance/closure** may be dated **30/11/2026** | Exact A20 definition, predecessor/successor links, and baseline status unavailable | `UNVERIFIED — original Schedule not found` |
| WBS / tracker | Not found | No date or A20 mapping available | Work packages, duration, dependency, release, test, and UAT links unavailable | `UNVERIFIED` |

These dates are recorded only as leads from the user-provided instruction. They have not been verified against the named source documents and are not adopted here as an official baseline.

### Discrepancy and decision options

If both source documents define the same acceptance/closure milestone, 30/11/2026 and 25/12/2026 differ by 25 calendar days and conflict. If the documents define different gates, their meanings and dependencies need to be stated explicitly. The available evidence does not determine which case applies.

1. **Keep the Charter date (25/12/2026) as the governing target:** after sponsor approval, update A20 and all dependent planned dates in Schedule/WBS/tracker. Recalculate test duration, release readiness, and UAT windows from the actual dependency chain. Impact cannot be quantified without the missing schedule and WBS; a later A20 may move dependent work.
2. **Keep A20 at 30/11/2026 as the governing target:** after sponsor approval, confirm whether the Charter commitment must be amended or whether it represents a distinct outer deadline. Recalculate predecessor work, testing, release, and UAT feasibility; the nominal interval to 25/12/2026 is 25 days, but it is not a verified test/UAT buffer.
3. **Confirm two distinct gates only if the original documents support that interpretation:** document each milestone's acceptance evidence, owner, and dependencies. This option uses only the two dates already cited; it does not introduce another baseline or date.

### Draft recommendation and decision record

**Recommendation:** do not modify either official source or synchronize a tracker date until the Charter and Schedule wording, versions, and A20 dependency chain are available. Then ask the sponsor to choose option 1, 2, or 3. This recommendation preserves existing source values and is not an approval of either date.

> **Decision Log entry (proposed):** `PROPOSED — PENDING SPONSOR APPROVAL`. Decision: resolve whether Charter 25/12/2026 and Schedule A20 30/11/2026 refer to the same acceptance/closure gate, and approve the governing date or distinct gate definitions. Decision authority: project sponsor (name `UNVERIFIED`); PM Đoàn Việt Khang coordinates. Evidence required: exact Charter/Schedule versions and wording, WBS predecessor/successor chain, testing/release/UAT estimates. Next action: obtain those source files, validate milestone semantics and dependencies, then record sponsor decision and approval date before changing official dates.

### Files/fields to update after a sponsor decision

- Update only the source fields explicitly covered by the sponsor decision: Charter milestone wording/date if directed; Schedule A20 date and dependencies; WBS activity dates/durations; tracker planned/baseline fields; Decision Log decision, approver, date, rationale, and affected artifacts.
- Recalculate testing, release, and UAT dates from source dependencies. Preserve actual dates separately from planned dates and the approved baseline.
- Until approval, dependent schedule/tracker values must be labelled `PENDING BASELINE DECISION`. Do not replace 30/11 with 25/12 or create a third date.

## BF-PM-02 — Use Case completeness and UC46/UC47 ownership

`docs/USE_CASE_COVERAGE.md` now exposes provisional UC01–UC47 rows, while retaining the groups from the existing repository summary. The current repository does not include the SRS or task tracker. Therefore the exact 47-Use-Case count, each official title, actor, owner, WBS/task mapping, acceptance criterion, and UC46/UC47 ownership remain unverified. The summary groups UC46 and UC47 together and cannot resolve which person or task owns either one.

**Required review action:** compare each row with the official SRS version and tracker; cite SRS section/requirement and tracker task ID; report missing/duplicate IDs, title differences, unowned rows, and conflicting assignments. Keep owner/reviewer assignment for the five governance/platform tasks as supplied by the current instruction; do not infer individual Use Case owners from those task assignments.

## BF-PM-03 — WBS, owner map, dependencies, DoD, and schedule controls

The source WBS and tracker were not found. The dictionary below is therefore a control draft, not a validated WBS/activity mapping. Do not normalize or invent missing WBS IDs.

| Deliverable / activity | WBS / Activity ID | Task ID | Owner | Reviewer | Dependency | Acceptance evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline discrepancy analysis and decision record | `UNVERIFIED` | BF-PM-01 | Đoàn Việt Khang | Phạm Ngọc Gia Khang | None stated | Source versions/wording recorded; options and effects reviewed; sponsor decision recorded before baseline change |
| Full Use Case reconciliation | `UNVERIFIED` | BF-PM-02 | Đoàn Việt Khang | Bùi Vạn Khải | None stated | 47 SRS rows cross-checked; exact title, actor, requirement, tracker owner/task, and discrepancies cited |
| WBS/activity dictionary and schedule controls | `UNVERIFIED` | BF-PM-03 | Đoàn Việt Khang | Bùi Vạn Khải | BF-PM-01 and BF-PM-02 | WBS IDs reconciled to source; dependencies cited; update rules distinguish proposal from approved baseline |
| API/action contract | `UNVERIFIED` | BF-PLAT-01 | Đoàn Việt Khang | Bùi Vạn Khải | Governance outputs, especially BF-PM-02/03 (per task instruction) | Action/API behavior traced to source and unresolved contracts marked |
| Shared-file ownership and Git workflow | `UNVERIFIED` | BF-PLAT-02 | Đoàn Việt Khang | Phạm Ngọc Gia Khang | Governance outputs, especially BF-PM-02/03 (per task instruction) | Repo hotspots cited; role ownership separated from proposal; draft checklist reviewable |

### Proposed Definition of Done for these documentation tasks

This DoD is a proposal for PM/reviewer approval, not an adopted project policy:

- Each factual claim has a source file/version and, where practical, section/line or code path.
- Unknown values are marked `UNVERIFIED`/`PENDING`; no missing owner, WBS ID, requirement, or approval is inferred.
- Reviewer checks assigned to that Task ID and records requested changes or approval in the team's agreed system (system/location `UNVERIFIED`).
- Required artifact-specific acceptance criteria are checked; document diff passes `git diff --check`; no code or credential changes are included.
- Baseline-dependent fields remain `PENDING BASELINE DECISION` until sponsor approval is evidenced.

### Proposed schedule and scope change rules

Draft rules for team decision:

1. Record each schedule change with date, reason, proposer, affected task/activity IDs, dependency impact, and source/evidence.
2. Keep actual, planned, and approved-baseline dates in distinct fields; never overwrite an actual date with a plan or proposal.
3. A baseline date changes only after sponsor approval. The PM records approver, approval date, rationale, and affected documents before synchronizing schedule/WBS/tracker.
4. If BF-PM-01 is still open, any dependent field reads `PENDING BASELINE DECISION`; no value is synchronized from an unapproved proposal.
5. Scope/deadline change requests list the requested change, reason, affected requirements/Use Cases, WBS/tasks, dependencies, test/release/UAT impact, and decision authority. The sponsor (for baseline/scope decisions) accepts or rejects; PM records the outcome. Exact escalation mechanics are pending the project governance source.

## Decisions and blockers for review

- **Sponsor:** provide the authoritative Charter/Schedule versions and decide whether the two milestone claims conflict or denote separate gates. No baseline edit is proposed as effective.
- **PM Đoàn Việt Khang:** provide the official SRS, WBS, and tracker (including Task ID, owner, reviewer, dependencies, deliverable, acceptance criteria, blocker/risk) so the coverage and activity map can be verified.
- **Reviewer Bùi Vạn Khải:** review provisional coverage rows and identify the authoritative assignment/source for UC46 and UC47 once the tracker/SRS are available.
- **Reviewers:** confirm whether proposed DoD and schedule/scope update rules should be adopted; they remain draft.
