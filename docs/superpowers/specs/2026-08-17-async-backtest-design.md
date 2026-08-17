# Async Backtest Design

## Goal

Prevent browser timeouts while backtests synchronously refill daily market data, without removing the existing synchronous API.

## Design

- Add `POST /api/v1/backtest/tasks` to submit a backtest to the existing background task queue.
- Add `GET /api/v1/backtest/tasks/{task_id}` to return pending, processing, completed, or failed state and the final `BacktestRunResponse`.
- Deduplicate pending/processing backtest tasks inside one server process; a repeated submit returns the existing task instead of starting another refill loop.
- Add an optional progress callback to `BacktestService.run_backtest()` and report candidate progress without changing evaluation semantics.
- Make the Web client submit and poll short requests. Display the current task message while retaining the existing final summary and result refresh behavior.
- Keep `POST /api/v1/backtest/run` unchanged for compatibility.

## Error Handling

External provider failures remain per-record backtest outcomes. A background orchestration failure is logged server-side and exposed as a bounded generic task failure. Polling requests use the normal short timeout because each status response is local and fast.

## Verification

Backend API tests cover acceptance, status/result mapping, missing tasks, and duplicate reuse. Service tests cover progress callbacks. Web API and page tests cover polling and visible progress. Backend focused tests, Web lint, and Web build are required.
