# Project Introduction Plain-Language Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Rewrite the project introduction HTML in plain Chinese so product, technical, and non-technical readers can understand the system without losing factual or technical accuracy.

**Architecture:** Keep the existing offline single-page HTML, eight-section structure, visuals, responsive behavior, and verified Moutai case. Change the information labels and prose layer only: concrete Chinese first, technical identifiers second, and explicit explanations for every data state and tool.

**Tech Stack:** HTML5, CSS, vanilla JavaScript, pytest contract tests, Playwright CLI.

---

No commit steps are included because `AGENTS.md` requires explicit confirmation before `git commit`.

## File Structure

- Modify `docs/project-introduction.html`: rewrite headings, explanations, ledger labels, diagrams, quality states, provenance, architecture, and adoption text.
- Modify `tests/test_project_introduction_html.py`: add plain-language contracts while preserving all factual, offline, accessibility, and structural contracts.
- Modify `docs/CHANGELOG.md`: revise the existing project-introduction entry to mention plain-language presentation without adding a duplicate.
- Verify against `reports/report_20260812.md`: retain all historical facts and values.

### Task 1: Add the Plain-Language Contract

**Files:**
- Modify: `tests/test_project_introduction_html.py`

- [x] Add assertions requiring direct section names: `系统能解决什么问题`, `系统能做什么`, `这次分析有哪些数据`, `一份报告经历哪八步`, `最终报告长什么样`, `为什么得出这个结论`, `系统由哪些部分组成`, `怎样使用，以及哪些事不能依赖它`.
- [x] Add assertions requiring the seven step labels: `这一步要做什么`, `拿到什么`, `使用什么`, `怎样处理`, `得到什么`, `数据不足怎么办`, `接下来交给谁`.
- [x] Require Chinese-first quality labels: `可用（available）`, `部分可用（partial）`, `缺失（missing）`, `失败（failed）`, `结果为空（empty）`.
- [x] Require explanations for `DataFetcherManager`, `StockTrendAnalyzer`, `SearchService / SearXNG`, `AnalysisContextPack`, `LLM Analyzer`, and `Guardrails`.
- [x] Reject reader-facing abstract phrases including `证据边界`, `数据质量语义`, `生成式表达`, `模型可消费`, `契约化质量`, `可观测层`, `关键张力`, and `数据血缘`.
- [x] Run `TMPDIR=/tmp TMP=/tmp TEMP=/tmp .venv/bin/python -m pytest tests/test_project_introduction_html.py -q` and confirm failures are caused by the old wording.

### Task 2: Rewrite the Overview and Case Introduction

**Files:**
- Modify: `docs/project-introduction.html`

- [x] Replace promotional English eyebrow text and abstract chapter names with direct Chinese labels.
- [x] Rewrite the opening so it explains in three concrete sentences: what the user enters, what the system does, and what the user receives.
- [x] Rewrite the first three sections using short paragraphs and specific verbs; preserve the capability scope and historical disclaimer.
- [x] Replace `能力地图` with `系统能做什么`, and replace `证据边界` with `这次拿到了什么，哪些数据还不完整`.
- [x] Run the contract test and confirm the overview requirements pass.

### Task 3: Rewrite the Eight-Step Walkthrough

**Files:**
- Modify: `docs/project-introduction.html`

- [x] Replace all seven ledger labels while retaining their `data-ledger` attributes.
- [x] Rewrite each step in plain Chinese. Each cell must name the real input, tool, action, result, fallback behavior, and next recipient without relying on words such as `结构化`, `上下文`, `降级`, or `交付` alone.
- [x] On first mention, explain every tool in Chinese: data-source manager, technical indicator calculator, news search, unified analysis packet, language model, and rule checker.
- [x] Rename the lineage figure to `数据从哪里来，最后到哪里去` and use Chinese quality text in its nodes.
- [x] Keep the eight approved step titles, all tool identifiers, and all verified case facts.
- [x] Run the contract test and confirm all eight steps and tool explanations pass.

### Task 4: Rewrite Quality, Final Report, and Conclusion Explanation

**Files:**
- Modify: `docs/project-introduction.html`

- [x] Present each quality state as Chinese first with its system value in parentheses and a one-sentence case example.
- [x] Rename provenance terms and columns so the table answers `结论是什么`, `参考了哪些数据`, `系统怎样判断`, and `报告怎样表达`.
- [x] Rewrite surrounding prose to explain why the historical conclusion was `观望 / 震荡` without using slogans about AI or deterministic evidence.
- [x] Preserve all market, position, buy, stop, pressure, confidence, risk, and limitation facts.
- [x] Run the contract test and confirm both readability and factual contracts pass.

### Task 5: Rewrite the Technical and Usage Sections

**Files:**
- Modify: `docs/project-introduction.html`
- Modify: `docs/CHANGELOG.md`

- [x] Rename technical layers in reader-facing text: `使用入口`, `任务处理`, `数据和分析`, `保存与通知`.
- [x] Explain fallback and failure isolation with concrete examples rather than architecture jargon.
- [x] Rewrite the final section as a practical reading and usage guide with clear limits.
- [x] Revise the single existing `[Unreleased]` entry to mention plain-language explanations; keep the flat list format.
- [x] Confirm exactly one changelog entry describes the project introduction.

### Task 6: Verify Readability and Preserve Behavior

**Files:**
- Verify: `docs/project-introduction.html`
- Verify: `tests/test_project_introduction_html.py`
- Verify: `docs/CHANGELOG.md`

- [x] Run `TMPDIR=/tmp TMP=/tmp TEMP=/tmp .venv/bin/python -m pytest tests/test_project_introduction_html.py tests/test_history_share_image.py -q` and require all tests to pass.
- [x] Run `git diff --check` and require no whitespace errors.
- [x] Re-check every Moutai number against `reports/report_20260812.md` and confirm `永鼎股份` / `600105` remain absent.
- [x] Serve locally and inspect Chromium at 1440×1000, 736×900, and 360×800. Require zero document-level horizontal overflow, all eight sections and steps, loaded local images, and zero console errors or warnings.
- [x] Disable JavaScript and confirm all main content remains visible.
- [x] Verify reduced-motion and print modes: static workspace image, no hidden text, hidden navigation/progress, and zero document-level overflow.
- [x] Perform a final editorial pass: every paragraph must be understandable without knowing the system internals; English appears only as a product/tool identifier or parenthetical system value.
