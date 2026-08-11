# Generation Backend Smoke Test Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Web settings page from timing out before a generation-backend smoke test completes, while making no unsupported change to DeepSeek streaming.

**Architecture:** Keep the shared Axios client's 30-second timeout and override it only at the generation-backend smoke-test call site with 300 seconds. Treat the earlier empty-stream log as a separate diagnostic gate: verify existing fallback behavior and change production streaming policy only if a provider-specific failure is reproducible.

**Tech Stack:** React/TypeScript, Axios, Vitest, Python/LiteLLM, pytest, FastAPI static frontend.

---

### Task 1: Add a dedicated browser timeout for generation-backend smoke tests

**Files:**
- Modify: `apps/dsa-web/src/api/__tests__/systemConfig.test.ts`
- Modify: `apps/dsa-web/src/api/systemConfig.ts`

- [ ] **Step 1: Extend the existing smoke-test expectation with the desired Axios timeout**

Add `{ timeout: 300_000 }` as the third expected argument to the existing smoke-test `post` assertion.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
cd apps/dsa-web && npm test -- src/api/__tests__/systemConfig.test.ts
```

Expected: the smoke-test case fails because `post` currently receives only two arguments.

- [ ] **Step 3: Add the minimal call-site timeout**

Define this operation-specific constant in `apps/dsa-web/src/api/systemConfig.ts`:

```ts
const GENERATION_BACKEND_SMOKE_TIMEOUT_MS = 300_000;
```

Pass it only to `testGenerationBackend()`:

```ts
const response = await apiClient.post<Record<string, unknown>>(
  '/api/v1/system/config/generation-backends/smoke-test',
  toSnakeGenerationBackendSmokePayload(payload),
  { timeout: GENERATION_BACKEND_SMOKE_TIMEOUT_MS },
);
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same Vitest command. Expected: all tests in the file pass.

### Task 2: Close the DeepSeek empty-stream diagnostic gate

**Files:**
- Inspect: `src/analyzer.py:2910-3290`
- Inspect: matching analyzer tests found with `rg`
- Modify only if reproducible: the narrowest relevant analyzer test and implementation file

- [ ] **Step 1: Confirm the evidence boundary**

Measure unauthenticated DeepSeek endpoint timing through the proxy and directly, then confirm the historical `stream returned empty response` log sequence. Expected: connection establishment is sub-second, so proxy latency is not the root cause.

- [ ] **Step 2: Run existing LiteLLM streaming/fallback tests**

```bash
rg -n "stream_response|stream=True|partial_received" tests/test_market_analyzer_generate_text.py
.venv/bin/python -m pytest tests/test_market_analyzer_generate_text.py -q
```

Expected: the analyzer's intended stream and fallback behavior passes.

- [ ] **Step 3: Apply the evidence gate**

If a current minimal DeepSeek stream consistently returns no content while non-stream succeeds, first add a failing provider-specific regression test, then implement the smallest DeepSeek-only non-stream policy and verify red-green. If it is not reproducible, make no production streaming change and retain the existing fallback.

### Task 3: Document and verify the user-visible fix

**Files:**
- Modify: `docs/CHANGELOG.md`
- Generated build output: `static/`

- [ ] **Step 1: Add the flat Unreleased changelog entry**

```md
- [修复] 修复生成后端冒烟测试仍在运行时 Web 设置页因通用 30 秒请求上限提前误报超时的问题。
```

- [ ] **Step 2: Run Web verification**

```bash
cd apps/dsa-web
npm test -- src/api/__tests__/systemConfig.test.ts
npm run lint
npm run build
```

Expected: every command exits 0 and the Vite build refreshes `static/`.

- [ ] **Step 3: Verify the served application**

```bash
curl -fsS http://127.0.0.1:8000/api/v1/health
curl -fsS -o /dev/null http://127.0.0.1:8000/
```

Expected: both requests succeed. A settings-page JSON smoke test must continue waiting beyond 30 seconds instead of raising `ECONNABORTED`.

- [ ] **Step 4: Review the final diff**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only scoped files/build outputs are changed. Do not commit, tag, or push without explicit authorization.
