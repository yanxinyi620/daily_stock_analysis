# Generation Fallback Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex CLI to LiteLLM fallback attempts visible and ensure logs, usage transport, and run-flow summaries identify the actual successful model.

**Architecture:** Keep generation and fallback behavior unchanged. Record sanitized failed attempts at the point where each backend/model exception is caught, let the existing pipeline record the final success, and override the fallback audit transport before entering LiteLLM so persisted usage reflects the actual channel.

**Tech Stack:** Python 3.12, FastAPI service layer, pytest/unittest mocks, existing `GenerationError`, run diagnostics, and SQLite usage persistence.

---

### Task 1: Preserve the primary backend failure and actual fallback transport

**Files:**
- Modify: `src/analyzer.py`
- Test: `tests/test_generation_backend.py`

- [ ] **Step 1: Write a failing fallback-contract test**

Add a test that configures `codex_cli` as primary and `litellm` as fallback, makes the primary backend raise a fallbackable `GenerationError`, and makes LiteLLM return a DeepSeek result. Patch `src.analyzer.record_llm_run` and assert:

```python
record_llm_run.assert_any_call(
    success=False,
    provider="codex_cli",
    model="codex_cli",
    call_type="analysis",
    error_type="invalid_json",
    error_message="invalid_json at validation for backend codex_cli",
)
assert result_model == "deepseek/deepseek-v4-pro"
assert fallback_audit_context["transport"] == "litellm"
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
.venv/bin/python -m pytest -s tests/test_generation_backend.py -k "fallback_records_primary_failure_and_uses_litellm_transport" -v
```

Expected: FAIL because the primary error is not recorded and fallback audit context still carries `codex_cli`.

- [ ] **Step 3: Implement the minimal backend-boundary fix**

In `StockAnalyzer._call_litellm`, before invoking the fallback backend:

```python
record_llm_run(
    success=False,
    provider=exc.provider,
    model=exc.backend,
    call_type="analysis",
    error_type=exc.error_code.value,
    error_message=exc.message,
)
fallback_audit_context = dict(audit_context or {})
fallback_audit_context["transport"] = LITELLM_BACKEND_ID
```

Pass `fallback_audit_context` only to the fallback backend. Continue using the existing diagnostic sanitizer inside `record_llm_run`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2. Expected: PASS.

### Task 2: Record each failed LiteLLM model attempt

**Files:**
- Modify: `src/analyzer.py`
- Test: `tests/test_market_analyzer_generate_text.py`

- [ ] **Step 1: Write a failing model-chain test**

Add a test with `deepseek/deepseek-v4-flash` followed by `deepseek/deepseek-v4-pro`. Make Flash fail JSON validation and Pro succeed. Assert the diagnostic call for Flash precedes the existing final success and carries the next model:

```python
record_llm_run.assert_any_call(
    success=False,
    provider="deepseek",
    model="deepseek/deepseek-v4-flash",
    call_type="analysis",
    fallback_model="deepseek/deepseek-v4-pro",
    error_type="invalid_json",
    error_message="invalid_json at validation for backend litellm",
)
```

- [ ] **Step 2: Run the test and verify RED**

```bash
.venv/bin/python -m pytest -s tests/test_market_analyzer_generate_text.py -k "records_failed_model_before_fallback_success" -v
```

Expected: FAIL because `_call_litellm_impl` logs but does not record failed attempts.

- [ ] **Step 3: Record sanitized model failures at the catch boundary**

Iterate with an index in `_call_litellm_impl` and call:

```python
record_llm_run(
    success=False,
    provider=usage_provider,
    model=model,
    call_type="analysis",
    fallback_model=models_to_try[index + 1] if index + 1 < len(models_to_try) else None,
    error_type=(e.error_code.value if isinstance(e, GenerationError) else type(e).__name__),
    error_message=safe_error,
)
```

Do not record raw response bodies or prompts.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2. Expected: PASS.

### Task 3: Correct final success logging and run-flow entry metadata

**Files:**
- Modify: `src/analyzer.py`
- Modify: `src/core/pipeline.py`
- Test: `tests/test_market_analyzer_generate_text.py`
- Test: `tests/test_run_flow.py`

- [ ] **Step 1: Write failing tests for the successful model identity**

Capture analyzer logs for a configured `codex_cli` call that returns `deepseek/deepseek-v4-pro` and assert:

```python
assert "[LLM返回] deepseek/deepseek-v4-pro 响应成功" in caplog.text
assert "[LLM返回] codex_cli 响应成功" not in caplog.text
```

Add a flow test with two failed runs and one successful run; assert `failed_attempts == 2`, `fallback_count == 1`, and final model is Pro.

- [ ] **Step 2: Run both tests and verify RED**

```bash
.venv/bin/python -m pytest -s tests/test_market_analyzer_generate_text.py tests/test_run_flow.py -k "actual_success_model or backend_fallback_chain" -v
```

Expected: at least the log assertion fails with the current configured-model message.

- [ ] **Step 3: Use actual model in success output and configured backend in start metadata**

Change the analyzer success line to:

```python
logger.info(
    "[LLM返回] %s 响应成功, 耗时 %.2fs, 响应长度 %d 字符",
    model_used,
    elapsed,
    len(response_text),
)
```

Change the standard pipeline `record_llm_run_started` model to the resolved generation backend identifier when a local CLI backend is selected. Keep the final `record_llm_run` based on `result.model_used`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

### Task 4: Verify persisted usage transport and sanitization

**Files:**
- Test: `tests/test_generation_backend.py`
- Test: `tests/test_llm_usage.py`

- [ ] **Step 1: Add integration-level assertions**

Assert a DeepSeek fallback usage payload passed to persistence contains:

```python
assert usage["transport"] == "litellm"
assert model_used == "deepseek/deepseek-v4-pro"
```

Use a primary error containing a fake authorization value and assert it does not appear in the captured run diagnostic payload.

- [ ] **Step 2: Run the tests and verify RED or existing GREEN coverage**

```bash
.venv/bin/python -m pytest -s tests/test_generation_backend.py tests/test_llm_usage.py -k "fallback or sanit" -v
```

If a new assertion passes immediately because Tasks 1–3 already establish the behavior, retain it as integration coverage and document that its dependency was proven RED in the earlier unit test.

- [ ] **Step 3: Make only the minimal correction required by failures**

Do not add new persistence columns. Reuse the existing `transport`, `model`, provider, and run-diagnostic fields.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

### Task 5: Documentation and complete verification

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/full-guide.md`
- Modify: `docs/full-guide_EN.md`

- [ ] **Step 1: Document the corrected behavior**

Add a flat `[Unreleased]` changelog entry and explain that local CLI fallback attempts appear in run diagnostics while billable API usage is attributed to the actual fallback model and `litellm` transport. Keep Chinese and English guides aligned.

- [ ] **Step 2: Run backend regression tests**

```bash
.venv/bin/python -m pytest -s \
  tests/test_generation_backend.py \
  tests/test_market_analyzer_generate_text.py \
  tests/test_run_flow.py \
  tests/test_run_diagnostics_p1.py \
  tests/test_run_diagnostics_p2.py \
  tests/test_llm_usage.py
```

Expected: all selected tests pass.

- [ ] **Step 3: Run static and diff checks**

```bash
.venv/bin/python -m py_compile \
  src/analyzer.py src/core/pipeline.py src/llm/generation_backend.py
git diff --check
```

Expected: exit code 0.

- [ ] **Step 4: Restart safely and smoke-test**

Confirm no stock/composite/backtest task is active, restart the existing server with its current WSL/NVM environment, and run one user-authorized smoke analysis. Verify the flow endpoint displays failed attempts and the usage endpoint attributes API usage to the actual DeepSeek model.

### Commit boundary

Do not commit automatically. After verification, show the final diff and request explicit commit authorization, as required by `AGENTS.md`.
