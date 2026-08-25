# Async Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Web-triggered backtests as observable background tasks so slow market-data refills cannot exceed the browser request timeout.

**Architecture:** Reuse `AnalysisTaskQueue` and add backward-compatible backtest task endpoints. The Web API submits once and polls local task status until a terminal result is available.

**Tech Stack:** FastAPI, Python thread-backed task queue, React, TypeScript, Axios, pytest, Vitest.

---

### Task 1: Backend task contract

**Files:** `api/v1/schemas/backtest.py`, `api/v1/endpoints/backtest.py`, `tests/test_backtest_api_tasks.py`

- [ ] Write failing tests for accepted tasks, duplicate reuse, status completion, and missing task handling.
- [ ] Add accepted/status schemas and additive task endpoints.
- [ ] Run focused tests until green.

### Task 2: Backtest progress

**Files:** `src/services/backtest_service.py`, `tests/test_backtest_service.py`

- [ ] Write a failing callback test.
- [ ] Report candidate discovery, per-record progress, and finalization through an optional callback.
- [ ] Run focused tests until green.

### Task 3: Web polling

**Files:** `apps/dsa-web/src/api/backtest.ts`, `apps/dsa-web/src/types/backtest.ts`, `apps/dsa-web/src/pages/BacktestPage.tsx`, corresponding tests

- [ ] Write failing API tests proving submit/status polling replaces the long synchronous request.
- [ ] Add task types and polling with bounded status-request intervals.
- [ ] Display progress in the running button/summary and preserve final refresh behavior.
- [ ] Run focused Web tests until green.

### Task 4: Documentation and verification

**Files:** `docs/full-guide.md`, `docs/CHANGELOG.md`

- [ ] Document asynchronous Web behavior and synchronous API compatibility.
- [ ] Run backend focused tests, Python compilation, Web lint, and Web build.
- [ ] Restart only after the currently active backtest finishes.

No commit is included without separate user confirmation.
