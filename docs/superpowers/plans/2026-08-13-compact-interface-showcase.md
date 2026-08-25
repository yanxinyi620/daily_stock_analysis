# Compact Interface Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cramped two-column product evidence block with two readable full-row interface showcases.

**Architecture:** Keep the existing local assets and offline single-file structure. Change only the compact HTML's evidence markup and CSS, backed by a static contract test and real-browser layout checks.

**Tech Stack:** HTML5, CSS, pytest, Playwright CLI.

---

No commit step is included because `AGENTS.md` requires explicit user confirmation before committing.

### Task 1: Lock the interface-showcase contract

**Files:**
- Modify: `tests/test_project_introduction_compact_html.py`

- [x] Require exactly two `data-interface-showcase` regions.
- [x] Require the Web 工作台 and 提醒中心 headings and their plain-language descriptions.
- [x] Require a single-column `.evidence` layout and reject the old unequal two-column rule.
- [x] Run the targeted test and confirm it fails because the new structure is not implemented yet.

### Task 2: Implement the full-row showcases

**Files:**
- Modify: `docs/project-introduction-compact.html`
- Modify: `docs/CHANGELOG.md`

- [x] Change `.evidence` to a one-column layout with more vertical spacing.
- [x] Add a numbered heading and short description above each image.
- [x] Keep both existing local assets at full available width and preserve their aspect ratios.
- [x] Keep the reduced-motion and print fallback behavior for the workspace animation.
- [x] Update the existing changelog entry to mention the readable full-width interface examples.
- [x] Run the targeted test and confirm it passes.

### Task 3: Verify the visual result

**Files:**
- Verify: `docs/project-introduction-compact.html`

- [x] Run all project-introduction and share-image tests.
- [x] Run `git diff --check`.
- [x] Check Chromium at 1440×1000, 736×900 and 360×800.
- [x] Confirm page overflow is zero, both images load and console warnings/errors are zero.
- [x] Inspect the desktop screenshot of the complete interface-showcase block.
- [x] Remove temporary browser evidence after inspection.
