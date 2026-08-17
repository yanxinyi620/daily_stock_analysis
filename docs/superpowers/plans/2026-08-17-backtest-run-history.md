# Backtest Run History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and display lightweight backtest run history with same-parameter reruns.

**Architecture:** Store task-level metadata in a new `backtest_runs` table, update it at endpoint lifecycle boundaries, expose a paginated read API, and add a Web tab that reuses the existing submit path.

**Tech Stack:** SQLAlchemy, FastAPI/Pydantic, React/TypeScript, pytest, Vitest.

---

### Task 1: Persistence and lifecycle

**Files:** `src/storage.py`, `src/repositories/backtest_repo.py`, `tests/test_backtest_run_history.py`

- [ ] Write failing tests for create, complete, fail, and paginated ordering.
- [ ] Add `BacktestRun` and repository lifecycle methods.
- [ ] Run focused backend tests until green.

### Task 2: API contract

**Files:** `api/v1/schemas/backtest.py`, `api/v1/schemas/__init__.py`, `api/v1/endpoints/backtest.py`, `tests/test_backtest_api_tasks.py`

- [ ] Write failing endpoint tests for accepted-task persistence, failure persistence, and run listing.
- [ ] Persist sync and async lifecycle states and add `GET /runs`.
- [ ] Run focused API tests until green.

### Task 3: Web history view

**Files:** `apps/dsa-web/src/types/backtest.ts`, `apps/dsa-web/src/api/backtest.ts`, `apps/dsa-web/src/pages/BacktestPage.tsx`, related Vitest files and locale text.

- [ ] Write failing API and page tests for history loading, rendering, and same-parameter rerun.
- [ ] Add types/API methods and the result/history page switch.
- [ ] Reuse the existing run flow for rerun requests and refresh history after completion.
- [ ] Run focused Web tests until green.

### Task 4: Documentation and verification

**Files:** `docs/CHANGELOG.md`, `docs/full-guide.md`, `docs/full-guide_EN.md`

- [ ] Document the new table, API, UI and no-backfill boundary.
- [ ] Run backend regression, Web tests, lint, build, compile and diff checks.
- [ ] Restart only when no active backtest exists and smoke-test the run-history API.
