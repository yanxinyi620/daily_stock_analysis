# Full Introduction Seven-Chapter Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the full project introduction into seven coherent chapters without materially reducing its professional content.

**Architecture:** Preserve the existing offline single-file HTML, verified Moutai case and eight-step ledgers. Merge two pairs of related chapters, move the workflow before case data, add chapter-purpose cues and align product evidence with the compact version's readable full-width layout.

**Tech Stack:** HTML5, CSS, vanilla JavaScript, pytest, Playwright CLI.

---

No commit step is included because `AGENTS.md` requires explicit user confirmation before committing.

### Task 1: Define the seven-chapter contract

- [x] Update `tests/test_project_introduction_html.py` to require seven main chapters and the approved order.
- [x] Require the capability/collaboration and report/provenance pairs to be chapter-internal subsections.
- [x] Require chapter-purpose cues, compact-version navigation and full-width interface examples.
- [x] Run the targeted tests and confirm failure against the nine-chapter document.

### Task 2: Restructure the document

- [x] Update the table of contents to seven chapters.
- [x] Merge product capability and collaboration into chapter 2.
- [x] place the complete eight-step workflow before the Moutai data chapter.
- [x] Merge final report and conclusion provenance into chapter 5.
- [x] Renumber and retitle technical implementation and usage as chapters 6 and 7.
- [x] Add concise “本章回答” cues and cross-links between full and compact versions.
- [x] Change the two real interface examples to a readable full-row layout.

### Task 3: Verify content and rendering

- [x] Run full and compact project-introduction tests plus share-image tests.
- [x] Cross-check Moutai facts against `reports/report_20260812.md`.
- [x] Run `git diff --check`.
- [x] Verify Chromium at 1440×1000, 736×900 and 360×800.
- [x] Verify print, reduced-motion, no JavaScript, local requests and console output.
- [x] Remove temporary browser evidence after inspection.
