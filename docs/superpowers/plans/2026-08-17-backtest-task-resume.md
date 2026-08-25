# Backtest Task Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore an active backtest after a browser refresh and prevent the page from presenting a second runnable action.

**Architecture:** Treat the in-memory server queue as the source of truth. Add a current-task endpoint, expose reusable polling in the Web API client, and let `BacktestPage` attach to an active task during initial load.

**Tech Stack:** FastAPI, Python task queue, React, TypeScript, Vitest, pytest.

---

### Task 1: Current backtest task API

**Files:**
- Modify: `api/v1/endpoints/backtest.py`
- Test: `tests/test_backtest_api_tasks.py`

- [ ] Add failing tests asserting an active `backtest_run` task is returned and an idle queue returns `null`.
- [ ] Run `.venv/bin/python -m pytest -s -q tests/test_backtest_api_tasks.py` and confirm the new tests fail because the endpoint is absent.
- [ ] Add `GET /api/v1/backtest/tasks/current`, reusing the task-status serializer and selecting only pending/processing `backtest_run` tasks.
- [ ] Re-run the focused backend tests and confirm they pass.

### Task 2: Reusable Web polling

**Files:**
- Modify: `apps/dsa-web/src/api/backtest.ts`
- Test: `apps/dsa-web/src/api/__tests__/backtest.test.ts`

- [ ] Add failing tests for `getCurrentTask()` and `waitForTask(taskId)`.
- [ ] Run the focused Vitest file and confirm failure because those methods are absent.
- [ ] Extract the existing polling loop into `waitForTask`; make `run` submit and delegate to it; add the nullable current-task request.
- [ ] Re-run the focused Vitest file and confirm it passes.

### Task 3: Page refresh recovery

**Files:**
- Modify: `apps/dsa-web/src/pages/BacktestPage.tsx`
- Test: `apps/dsa-web/src/pages/__tests__/BacktestPage.test.tsx`

- [ ] Add a failing mount test where `getCurrentTask` returns processing and `waitForTask` remains pending; assert the button says “回测中” and is disabled.
- [ ] Add a failing completion test asserting recovered task completion refreshes results and performance.
- [ ] During initial load, query the current task, attach to it, and reuse one completion handler for submitted and recovered tasks.
- [ ] Re-run page tests and confirm they pass.

### Task 4: Documentation and verification

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/full-guide.md`
- Modify: `docs/full-guide_EN.md`

- [ ] Document refresh recovery and server-side source-of-truth behavior.
- [ ] Run backend focused tests, Web focused tests, lint, build, and `git diff --check`.
- [ ] Restart the service only after confirming no active backtest task, then verify the current-task route is loaded.
