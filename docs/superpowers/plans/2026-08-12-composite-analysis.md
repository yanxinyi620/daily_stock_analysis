# Web Composite Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable Web-triggered parent task that analyzes every submitted watchlist stock, runs market review, saves one composite report, and optionally sends exactly one notification.

**Architecture:** Extend the existing in-memory task queue with parent-task metadata and atomic stock reservations, while keeping analysis in a focused `CompositeAnalysisService`. The service reuses `StockAnalysisPipeline`, market-review runtime, `NotificationService`, and `DatabaseManager`; the API and Web consume the existing task list/SSE surface with additive composite fields.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, pytest, React, TypeScript, Zustand hooks, Vitest, Testing Library, Tailwind CSS.

---

## File structure

- Create `src/services/composite_analysis_service.py`: orchestration, report composition, persistence and notification.
- Modify `src/services/task_queue.py`: additive parent-task fields, atomic reservation, lifecycle updates and cancellation.
- Modify `src/core/pipeline.py`: report per-stock batch completion through a small optional callback.
- Modify `api/v1/schemas/analysis.py`: composite request/response and additive task-state schemas.
- Modify `api/v1/endpoints/analysis.py`: submit composite task and reuse existing status/cancel/SSE endpoints.
- Create `tests/test_composite_analysis_service.py`: orchestration and report behavior.
- Modify `tests/test_task_queue.py`: conflict, reservation, state and cancellation behavior.
- Modify `tests/test_api.py` or the repository's focused analysis endpoint test file: API contracts.
- Modify `apps/dsa-web/src/types/analysis.ts` and `apps/dsa-web/src/api/analysis.ts`: typed client contract.
- Create `apps/dsa-web/src/components/composite-analysis/CompositeTaskCard.tsx`: four-stage progress and result action.
- Create `apps/dsa-web/src/components/composite-analysis/__tests__/CompositeTaskCard.test.tsx`: state rendering.
- Modify `apps/dsa-web/src/pages/HomePage.tsx`: submit/recover task, responsive toolbar and conflict feedback.
- Modify `apps/dsa-web/src/pages/__tests__/HomePage.test.tsx`: interaction and responsive behavior.
- Modify `apps/dsa-web/src/i18n/uiText.ts`: Chinese/English labels.
- Modify `docs/full-guide.md`, `docs/README_EN.md` when applicable, and `docs/CHANGELOG.md`: user-visible behavior.

### Task 1: Add composite task state and atomic reservations

**Files:**
- Modify: `src/services/task_queue.py`
- Test: `tests/test_task_queue.py`

- [ ] Write failing tests that submit a composite parent with `stock_codes=["600410", "600519"]`, assert both dedupe keys are reserved before executor submission, assert any existing single-stock reservation causes a `CompositeTaskConflictError` with zero new tasks, and assert a single-stock submission is rejected while the composite parent owns the code.
- [ ] Run `pytest -s tests/test_task_queue.py -k 'composite or reservation' -q`; expect failures because composite submission and fields do not exist.
- [ ] Add `TaskStatus.PARTIAL`, `TaskInfo.task_type`, `parent_task_id`, `composite`, and serialization/copy support. Add `CompositeTaskConflictError` carrying `stock_conflicts`, `market_review_conflict`, and `composite_task_id` without secret-bearing exception text.
- [ ] Add `submit_composite_task(run_task, stock_codes, ...)` that normalizes every code, checks `_active_composite_task_id` and `_analyzing_stocks` under `_data_lock`, reserves all codes, registers one parent task, submits one callable, and rolls every reservation back if executor submission fails.
- [ ] Add `update_composite_state(task_id, phase, progress, patch, message)` and ensure terminal cleanup releases all reserved stock keys and the active composite ID exactly once.
- [ ] Run the focused tests; expect all composite queue tests to pass.
- [ ] Commit with `feat: add composite task reservations`.

### Task 2: Expose per-stock batch progress without changing pipeline results

**Files:**
- Modify: `src/core/pipeline.py`
- Test: `tests/test_pipeline.py` or the existing focused pipeline test module.

- [ ] Write a failing test passing `batch_item_callback(code, status, result_or_error, completed, total)` to `StockAnalysisPipeline.run`, with one successful and one failed future, and assert two callbacks while the returned successful-results list remains unchanged.
- [ ] Run the focused test; expect `run()` to reject the new argument.
- [ ] Add an optional keyword-only callback to `run()` and invoke it after each future settles. Catch callback exceptions, log them, and preserve the analysis result contract.
- [ ] Run the focused test and existing pipeline batch tests; expect pass.
- [ ] Commit with `feat: expose batch analysis progress`.

### Task 3: Implement the composite orchestration service

**Files:**
- Create: `src/services/composite_analysis_service.py`
- Create: `tests/test_composite_analysis_service.py`

- [ ] Write failing tests with fake pipeline, market-review runner, notifier and database for: all success; one stock failure; market review failure; report persistence failure; notify false; send false/exception; and cancellation before market review.
- [ ] Assert the success report contains execution summary, market review and stock dashboard; partial reports contain sanitized failures; notification happens once only after persistence.
- [ ] Run `pytest -s tests/test_composite_analysis_service.py -q`; expect import failure.
- [ ] Implement `CompositeAnalysisRequestSnapshot`, `CompositeRunResult`, and `CompositeAnalysisService.run(snapshot, task_id, progress_callback, cancel_requested)`.
- [ ] Reuse `StockAnalysisPipeline.run(..., send_notification=False, merge_notification=True, batch_item_callback=...)`; collect successful `AnalysisResult` values and failed codes.
- [ ] Reuse `build_market_review_runtime` / `run_market_review` with standalone file/notification disabled but history persistence enabled, so a successful composite run creates a queryable `MARKET / market_review` child history without duplicating market analysis logic.
- [ ] Compose `# 今日综合分析`, execution summary, optional market section, notifier-generated aggregate stock section, sanitized failure list, timestamp/model/disclaimer. Save `composite_analysis_<date>_<task-id-prefix>.md`.
- [ ] Persist a synthetic `AnalysisResult(code="COMPOSITE", name="今日综合分析", ...)` through `DatabaseManager.save_analysis_history(..., report_type="composite_analysis", news_content=report, context_snapshot=...)`; require a positive history ID. The final history set is one row per successful stock, one market-review row when that phase succeeds, and one composite row.
- [ ] If `notify=True`, call notifier once with the saved report; map false/exception to notification failure without deleting history.
- [ ] Run service tests; expect pass.
- [ ] Commit with `feat: orchestrate composite analysis reports`.

### Task 4: Add the composite API contract

**Files:**
- Modify: `api/v1/schemas/analysis.py`
- Modify: `api/v1/endpoints/analysis.py`
- Test: `tests/test_api_analysis.py` (or the existing analysis endpoint test module selected by `rg`)

- [ ] Write failing API tests for valid `202`, empty/oversized input `422/400`, conflict `409 composite_task_conflict`, additive task list/state fields, and cancellation.
- [ ] Run focused endpoint tests; expect 404 for `/analysis/composite`.
- [ ] Add `CompositeAnalysisRequest`, `CompositeTaskAccepted`, `CompositeConflictResponse`, and structured composite progress models. Allow `partial` in task status schemas.
- [ ] Add `POST /analysis/composite`: normalize language/region, freeze request values, build the service callable, and call `submit_composite_task` before returning `202`.
- [ ] Map `CompositeTaskConflictError` to a stable `409` payload. Do not expose paths, keys, raw prompts or full exceptions.
- [ ] Ensure existing list/status/SSE/cancel endpoints serialize composite fields without branching clients onto a parallel polling API.
- [ ] Run focused API and task-queue tests; expect pass.
- [ ] Commit with `feat: expose composite analysis API`.

### Task 5: Add the typed Web client and progress card

**Files:**
- Modify: `apps/dsa-web/src/types/analysis.ts`
- Modify: `apps/dsa-web/src/api/analysis.ts`
- Modify: `apps/dsa-web/src/api/__tests__/analysis.test.ts`
- Create: `apps/dsa-web/src/components/composite-analysis/CompositeTaskCard.tsx`
- Create: `apps/dsa-web/src/components/composite-analysis/__tests__/CompositeTaskCard.test.tsx`
- Modify: `apps/dsa-web/src/i18n/uiText.ts`

- [ ] Write failing client tests asserting snake-case request mapping, `202` camel-case response and structured `409` parsing.
- [ ] Add TypeScript types for request, conflict, phase, stock summary, market/report/notification stage and additive task fields; implement `analysisApi.triggerCompositeAnalysis`.
- [ ] Run API tests; expect pass.
- [ ] Write failing component tests for pending, stock progress, partial, notify-disabled, notify-failed, completed and “view report”.
- [ ] Implement an accessible four-stage card with semantic status text, progress bar and action callback; do not infer success from progress alone.
- [ ] Run component tests; expect pass.
- [ ] Commit with `feat: add composite task Web client`.

### Task 6: Integrate the responsive homepage action

**Files:**
- Modify: `apps/dsa-web/src/pages/HomePage.tsx`
- Modify: `apps/dsa-web/src/pages/__tests__/HomePage.test.tsx`
- Modify: relevant existing toolbar component if extraction is needed to keep `HomePage.tsx` bounded.

- [ ] Write failing tests that: disable composite action for empty watchlist; submit all watchlist codes independent of query input; pass notify/skills/language/region snapshots; render conflicts without partial task creation; recover active composite task from task list; and render the task card.
- [ ] Write responsive tests asserting wide layout exposes server, market review, composite and analyze actions, while narrow layout exposes composite/analyze and moves server/market review into an accessible “more” menu.
- [ ] Run the focused Home page tests; expect failures because the action is absent.
- [ ] Implement submit state, structured conflict feedback, active-task selection and report navigation. The normal Analyze button retains `disabled={!query || isAnalyzing}`; Composite Analyze depends on watchlist and composite submission state instead.
- [ ] Extract or refactor only the toolbar portion needed for responsive behavior; preserve existing strategy, notify and market-region semantics and keyboard navigation.
- [ ] Run Home page and component tests; expect pass.
- [ ] Commit with `feat: add homepage composite analysis action`.

### Task 7: Recovery, docs and full verification

**Files:**
- Modify: task-queue startup/reset path found during Task 1
- Modify: `docs/full-guide.md`
- Modify: `docs/README_EN.md` only if the corresponding English user workflow exists
- Modify: `docs/CHANGELOG.md`
- Test: focused recovery test module

- [ ] Add a failing recovery test for a stale persisted/rehydrated composite task and assert it becomes failed with sanitized “service restart interrupted task” text. If the task queue is intentionally memory-only, document and test the startup reconciliation boundary used by the existing queue rather than inventing durable execution state.
- [ ] Implement the smallest recovery hook consistent with existing task storage.
- [ ] Update full guide with Web composite behavior, conflict rules, notification switch, partial completion and CLI compatibility. Add a flat `[Unreleased]` changelog entry.
- [ ] Run `python -m py_compile` on changed Python files and all focused backend tests.
- [ ] Run `./scripts/ci_gate.sh`; require exit 0 or document unrelated baseline failures with exact evidence and rerun affected scopes.
- [ ] Run `cd apps/dsa-web && npm run lint && npm run build`; require exit 0.
- [ ] Start the dev server and perform two real Web/API acceptance runs with three stocks: notify off (report saved, no send) and notify on (one combined send). Capture task phase transitions and verify `composite_analysis` history/detail.
- [ ] Inspect `git diff --check`, `git status`, and the requirement checklist from the design spec.
- [ ] Commit with `docs: document Web composite analysis` and a final implementation commit only if uncommitted verified changes remain.

### Task 8: Add composite history browsing

**Files:**
- Modify: `src/services/history_service.py`
- Modify: `api/v1/schemas/history.py`
- Modify: `api/v1/endpoints/history.py`
- Modify: `apps/dsa-web/src/types/analysis.ts`
- Create: `apps/dsa-web/src/components/composite-analysis/CompositeHistoryView.tsx`
- Create: `apps/dsa-web/src/components/composite-analysis/__tests__/CompositeHistoryView.test.tsx`
- Modify: `apps/dsa-web/src/pages/HomePage.tsx`
- Modify: `apps/dsa-web/src/pages/__tests__/HomePage.test.tsx`
- Modify: `apps/dsa-web/src/i18n/uiText.ts`

- [ ] Write failing backend tests asserting composite list records expose a sanitized `composite_summary`, while ordinary stock records do not.
- [ ] Write failing component and Home page tests for the “重新分析 / 历史记录 / 完整分析报告” actions, loading/error/empty states, summary fields, pagination and selecting a prior report.
- [ ] Add the list-only composite summary contract and typed Web mapping without exposing the full context snapshot.
- [ ] Implement a dedicated composite history timeline; do not reuse stock price trend fields or request every report detail.
- [ ] Update bilingual UI text, the full guide and changelog, then run focused backend tests, Web tests, lint and build.
