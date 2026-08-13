# Composite History Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the expanded composite Markdown on Home with a stock-report-style task summary while retaining the full-report drawer.

**Architecture:** Keep report routing in `HomePage`, make `CompositeAnalysisReportView` a focused context-snapshot presenter, and add one persisted notification-request flag for future history records. Existing records remain compatible through defensive field normalization.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, Python/pytest.

---

### Task 1: Define summary behavior with tests

**Files:**
- Modify: `apps/dsa-web/src/pages/__tests__/HomePage.test.tsx`

- [ ] Replace expanded-Markdown assertions with task-summary assertions.
- [ ] Assert Markdown section headings are absent before opening the full-report drawer.
- [ ] Run `npm test -- --run src/pages/__tests__/HomePage.test.tsx -t "renders composite history"` and confirm it fails because Markdown is still rendered.

### Task 2: Implement the composite summary card

**Files:**
- Modify: `apps/dsa-web/src/components/composite-analysis/CompositeAnalysisReportView.tsx`
- Modify: `apps/dsa-web/src/pages/HomePage.tsx`
- Modify: `apps/dsa-web/src/i18n/uiText.ts`

- [ ] Normalize `contextSnapshot` values without unsafe casts.
- [ ] Render overall state, stock counts, market-review state, stock scope, failed stocks, and notification-request state using the existing report card visual language.
- [ ] Remove all default rendering of `details.newsContent` from the summary component.
- [ ] Run the focused Home test and confirm it passes.

### Task 3: Persist notification request and document behavior

**Files:**
- Modify: `src/services/composite_analysis_service.py`
- Modify: `tests/test_composite_analysis_service.py`
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/full-guide.md`
- Modify: `docs/full-guide_EN.md`

- [ ] Add a failing service assertion for `notification_requested` in the saved context snapshot.
- [ ] Persist the boolean flag with the composite history record.
- [ ] Update user documentation to describe the default summary and full-report drawer.
- [ ] Run the focused Python service test.

### Task 4: Verify the Web bundle

**Files:**
- Verify: `apps/dsa-web/`

- [ ] Run the complete Home page test file.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check` and verify the service health endpoint.
