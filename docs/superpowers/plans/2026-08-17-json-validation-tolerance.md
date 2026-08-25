# JSON Validation Tolerance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept harmless prose around one analysis JSON object and accurately attribute fallback validation failures without weakening ambiguity or core-field checks.

**Architecture:** Extend the existing single-object extractor rather than adding a parallel parser. Keep `GenerationError` as the validation contract, while formatting LiteLLM per-model failures from the active model plus structured reason.

**Tech Stack:** Python 3.12, unittest/pytest, existing analyzer and generation-backend abstractions.

---

### Task 1: Lock parser boundaries with tests

**Files:**
- Modify: `tests/test_report_schema.py`
- Modify: `tests/test_market_analyzer_generate_text.py`

- [ ] Add a failing test that accepts one valid JSON object with short prose before and after it.
- [ ] Preserve tests that reject two objects, multiple fences, and non-JSON fences.
- [ ] Add a failing log-capture test asserting a fallback validation warning names the attempted DeepSeek model and `ambiguous_json` reason.
- [ ] Run the focused tests and confirm the new expectations fail for the intended reasons.

### Task 2: Implement safe extraction and diagnostics

**Files:**
- Modify: `src/analyzer.py`

- [ ] Decode all object candidates and accept exactly one candidate only when surrounding text contains no second decodable object.
- [ ] Keep fenced-response and minimal-contract rules unchanged except for permitting prose around one JSON fence/object.
- [ ] Format validation warnings with the actual LiteLLM model and structured reason.
- [ ] Strengthen both stock-analysis system prompts with a single-JSON/no-prose/no-fence instruction.
- [ ] Run focused tests until green.

### Task 3: Document and verify

**Files:**
- Modify: `docs/CHANGELOG.md`

- [ ] Add one `[Unreleased]` fix entry.
- [ ] Run report-schema, local-CLI, and analyzer fallback test modules.
- [ ] Run Python compilation for changed Python files.
- [ ] Inspect the final diff and report unrelated pre-existing work separately.

No commit is included because repository policy requires explicit user confirmation.
