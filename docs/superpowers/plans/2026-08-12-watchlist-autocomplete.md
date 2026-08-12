# Watchlist Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse stock autocomplete for watchlist quick-add while guaranteeing selection adds only and never analyzes.

**Architecture:** Replace the plain quick-add `Input` with the existing `StockAutocomplete`. Adapt its `onSubmit` callback to the existing `onAddToWatchlist` prop, keeping manual form submission and the plus button intact.

**Tech Stack:** React, TypeScript, Vitest, Testing Library.

---

### Task 1: Add-only autocomplete

**Files:**
- Modify: `apps/dsa-web/src/components/watchlist/HomeStockWorkspace.tsx`
- Test: `apps/dsa-web/src/components/watchlist/__tests__/HomeStockWorkspace.test.tsx`

- [ ] Add a failing test whose autocomplete candidate callback selects `600519.SH` / 贵州茅台 and asserts `onAddToWatchlist("600519.SH")` is called once, with no analysis callback exposed or invoked.
- [ ] Run the focused test and confirm it fails because the workspace still renders a plain input.
- [ ] Replace the plain input with `StockAutocomplete`; set `onChange={setDraftCode}` and make `onSubmit` call the same add-only helper used by manual form submission.
- [ ] Clear the draft after a successful add; preserve the existing plus-button and Enter behavior.
- [ ] Run the focused workspace tests, lint, and production build.
- [ ] Commit with `feat: add watchlist stock autocomplete`.
