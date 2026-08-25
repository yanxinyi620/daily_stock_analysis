# Project Introduction Feature Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a plain-language chapter showing how screening, daily composite analysis, single-stock analysis, ask-stock, backtesting, watchlists, and alerts support one research workflow.

**Architecture:** Extend the existing offline HTML with one semantic section between the capability overview and the Moutai case. Use native HTML/CSS for a responsive workflow figure and table; preserve all existing case and browser contracts.

**Tech Stack:** HTML5, CSS, vanilla JavaScript, pytest contract tests, Playwright CLI.

---

No commit steps are included because `AGENTS.md` requires explicit confirmation before `git commit`.

### Task 1: Add failing content contracts

- [x] Require `id="feature-collaboration"`, a matching contents link, and `data-visual="feature-collaboration"`.
- [x] Require the workflow functions, the four table headings, the Moutai example, and explicit non-automation boundaries.
- [x] Run the HTML tests and confirm they fail for the missing section.

### Task 2: Add the collaboration chapter

- [x] Add the new table-of-contents entry and renumber later visible chapters.
- [x] Add a six-step responsive workflow with concrete handoff text.
- [x] Add the input-purpose-output-next-step table.
- [x] Add the Moutai walkthrough and boundary callout.

### Task 3: Update metadata and verify

- [x] Revise the single project-introduction changelog entry to mention feature collaboration.
- [x] Run HTML and share-image tests plus `git diff --check`.
- [x] Verify desktop, tablet, mobile, print, reduced-motion, no-JavaScript, local requests, console, and page overflow in Chromium.
