# Local CLI Setup Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make setup-status Agent messages display the actual local CLI used by ordinary analysis.

**Architecture:** Reuse the existing safe local CLI preset registry as the single source of display names. Resolve the normalized generation backend once inside the Agent setup check and interpolate that display name into all split-route messages; no routing behavior changes.

**Tech Stack:** Python, unittest/pytest, FastAPI setup-status endpoint.

---

### Task 1: Add failing OpenCode and Claude Code label tests

**Files:**
- Modify: `tests/test_system_config_service.py`

- [ ] Add a parameterized/subTest regression covering `opencode_cli` -> `OpenCode CLI` and `claude_code_cli` -> `Claude Code CLI` with a valid LiteLLM Agent model.
- [ ] Run `.venv/bin/python -m pytest -s tests/test_system_config_service.py -k "setup_status and (opencode or claude)" -q` and confirm the assertions fail because the message says `Codex CLI`.

### Task 2: Use the actual preset display name

**Files:**
- Modify: `src/services/system_config_service.py:3658-3750`

- [ ] Inside the local CLI branch, resolve `local_cli_display_name = resolve_local_cli_preset(generation_backend).display_name`.
- [ ] Replace all three hard-coded `普通分析使用 Codex CLI` fragments in `_build_setup_agent_llm_check()` with `普通分析使用 {local_cli_display_name}` while preserving the rest of each message.
- [ ] Run the focused OpenCode/Claude test and existing Codex setup tests; expect all to pass.

### Task 3: Document and verify

**Files:**
- Modify: `docs/CHANGELOG.md`

- [ ] Add a flat `[Unreleased]` fix entry describing accurate local CLI setup diagnostics.
- [ ] Run `.venv/bin/python -m pytest -s tests/test_system_config_service.py -q`.
- [ ] Run `.venv/bin/python -m py_compile src/services/system_config_service.py`.
- [ ] Restart the local FastAPI service so the Python change is loaded, then verify `/api/v1/system/config/setup/status` reports `OpenCode CLI` for the current configuration.
- [ ] Run `git diff --check` and inspect scoped changes. Do not commit or push.
