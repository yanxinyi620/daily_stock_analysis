# Local CLI Setup Label Design

## Goal

Make the setup-status Agent channel message name the local CLI generation backend that ordinary analysis actually uses.

## Current Problem

The setup-status service correctly detects `codex_cli`, `claude_code_cli`, and `opencode_cli` as local generation backends, but several Agent-channel messages hard-code `Codex CLI`. An OpenCode or Claude Code configuration therefore reports the correct runtime route with the wrong display name.

## Design

Add one internal display-name mapping for the supported local CLI generation backend IDs:

- `codex_cli` -> `Codex CLI`
- `claude_code_cli` -> `Claude Code CLI`
- `opencode_cli` -> `OpenCode CLI`

The setup Agent check will resolve the display name from the already-normalized `GENERATION_BACKEND` and use it in all messages that currently say `普通分析使用 Codex CLI`. This changes presentation only; backend selection, fallback, Agent routing, API keys, and saved settings remain unchanged.

## Tests

Keep existing Codex assertions and add regression coverage proving that both inherited and explicitly configured Agent models show the correct OpenCode or Claude Code label. Tests must fail before the implementation change and pass afterward.

## Documentation and Verification

Add one flat `[Unreleased]` changelog entry. Run the focused system-config service tests, Python compilation, the relevant setup-status API check, and inspect the final diff. Do not commit or push without explicit authorization.
