# DSA Professional Project Case Study Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Upgrade the existing project introduction into a professional scrolling report that explains DSA through a complete, evidence-backed Guizhou Moutai analysis case.

**Architecture:** Keep the deliverable as one offline HTML document, but replace the slide-like seven-section story with a denser research-report structure. Native HTML/CSS/SVG presents eight case steps, business-level input/output ledgers, a rebuilt final report, data lineage, quality states, and conclusion provenance; small vanilla JavaScript only enhances navigation, progress, and optional details.

**Tech Stack:** HTML5, CSS, inline SVG, vanilla JavaScript, pytest contract tests, Playwright CLI browser verification.

---

No commit steps are included because `AGENTS.md` requires explicit confirmation before `git commit`.

## File Structure

- Modify `docs/project-introduction.html`: replace the current presentation-oriented content and interaction with a professional long-form case report.
- Modify `tests/test_project_introduction_html.py`: replace presentation timing assertions with case-study, lineage, tool, quality, provenance, accessibility, and offline contracts.
- Modify `docs/CHANGELOG.md`: revise the existing project-introduction entry rather than adding a duplicate entry.
- Preserve `reports/report_20260812.md` and `data/stock_analysis.db` as read-only evidence sources.
- Preserve existing assets under `docs/assets/`; use them only as product-surface evidence, not as the primary case report.

### Task 1: Define the Professional Case Contract

**Files:**
- Modify: `tests/test_project_introduction_html.py`

- [x] **Step 1: Add failing assertions for the new document structure**

Require these section IDs:

```python
for section_id in (
    "executive-summary",
    "capability-map",
    "case-brief",
    "case-pipeline",
    "final-report",
    "provenance",
    "technical-foundation",
    "adoption",
):
    assert f'id="{section_id}"' in text
```

Require eight ledger steps using `data-case-step="1"` through `data-case-step="8"`, and require each ledger vocabulary item: `本步目标`, `输入`, `使用工具`, `关键处理`, `输出`, `数据质量与降级`, `流向下一步`.

- [x] **Step 2: Add failing assertions for the real Moutai case**

Require `贵州茅台`, `600519`, `2026-08-12`, `1345.43`, `1331.71`, `1336.47`, `1316.86`, `1354.01`, `趋势强度 40`, `观望`, and `震荡`. Assert `永鼎股份` and `600105` are absent.

- [x] **Step 3: Add failing assertions for tool and quality semantics**

Require `DataFetcherManager`, `腾讯财经`, `StockTrendAnalyzer`, `SearchService`, `SearXNG`, `AnalysisContextPack`, `LLM Analyzer`, `Guardrails`, `Report Renderer`, `History Service`, `Diagnostics`, and `Notification Service`. Require the five quality states `available`, `partial`, `missing`, `failed`, and `empty`, plus the sentence `搜索为空不等于没有风险`.

- [x] **Step 4: Add failing assertions for visuals and provenance**

Require visible hooks `data-visual="lineage"`, `data-visual="quality-matrix"`, `data-visual="price-position"`, and `data-visual="provenance-matrix"`. Require provenance terms `MA5 < MA10`, `买入观察区`, `放量跌破`, `中等置信度`, and a reconstructed report marker `data-report="moutai-2026-08-12"`.

- [x] **Step 5: Preserve and refine accessibility/offline assertions**

Keep checks for `lang="zh-CN"`, viewport, local-only `src`/`href`, inline favicon, `prefers-reduced-motion`, `@media print`, the JavaScript enhancement class, `noscript`, alt text, and exact existing asset paths. Remove direction-key and presentation-timing requirements.

- [x] **Step 6: Run the contract tests and verify the expected red state**

Run:

```bash
TMPDIR=/tmp TMP=/tmp TEMP=/tmp .venv/bin/python -m pytest tests/test_project_introduction_html.py -q
```

Expected: failures for missing professional sections, case steps, case facts, tools, visuals, and reconstructed report.

### Task 2: Rebuild the Document as a Professional Scrolling Report

**Files:**
- Modify: `docs/project-introduction.html`
- Test: `tests/test_project_introduction_html.py`

- [x] **Step 1: Replace the top-level information architecture**

Build eight continuous sections with the exact IDs defined in Task 1. Remove visible timing labels, direction-key instructions, and keyboard chapter navigation. Keep a top reading progress bar and implement a professional contents rail or compact sticky table of contents using anchor links.

- [x] **Step 2: Implement the editorial research-report visual system**

Retain deep navy and warm paper colors, but reduce viewport-sized headings and increase reading density. Use a 720–780px narrative column, 1100–1180px wide figures, source labels, evidence notes, ruled tables, footnotes, and print-safe contrast tokens. Do not use external fonts, libraries, or network assets.

- [x] **Step 3: Build the executive summary and capability map**

Explain the product purpose, the deterministic-evidence-first principle, the complete value loop, and the relationship between multi-market data, reports, Web/Desktop, Agent, imports, backtests, portfolios, alerts, automation, API, Bot, and notifications.

- [x] **Step 4: Build the case brief and historical-data disclaimer**

State the historical date, evidence sources, user question, analysis scope, known inputs, missing inputs, and report deliverables. Clearly label every numeric case value as historical demonstration data and not current market data.

### Task 3: Implement the Eight-Step Input/Tool/Output Ledger

**Files:**
- Modify: `docs/project-introduction.html`
- Test: `tests/test_project_introduction_html.py`

- [x] **Step 1: Add all eight ledger articles**

Create one semantic article per step with `data-case-step="N"`. Every article contains the seven business labels from Task 1 and uses tables or concise evidence blocks rather than raw JSON.

- [x] **Step 2: Add the data-lineage visual**

Use native HTML/SVG to connect input, market phase, quote/history, technical analysis, intelligence, quality/context pack, LLM/guardrails, and report/history/notification. Every node must include the actual business payload it passes forward.

- [x] **Step 3: Add the price-position visual**

Plot MA20 1316.86, MA5 1331.71, MA10 1336.47, current 1345.43, and pressure 1354.01 on one labeled horizontal scale. Use text labels in addition to color, and reflow to a vertical ledger on narrow screens.

- [x] **Step 4: Add the data-quality matrix**

Show the semantics and case examples for `available`, `partial`, `missing`, `failed`, and `empty`. Explain how each state affects evidence usage, confidence, and final wording.

- [x] **Step 5: Run the contract tests**

Run the Task 1 command. Expected: new structure, case, tool, lineage, and quality tests pass; final-report/provenance tests may still fail until Task 4.

### Task 4: Reconstruct the Final Report and Provenance

**Files:**
- Modify: `docs/project-introduction.html`
- Test: `tests/test_project_introduction_html.py`

- [x] **Step 1: Build the complete HTML report**

Create `data-report="moutai-2026-08-12"` with: case identity, current price, advice, trend, score 54, confidence, empty/held position advice, market table, moving averages, data limitations, intraday guardrail, observation conditions, buy/stop/target points, position plan, news/risk/catalyst wording, checklist, attribution weights, and disclaimer.

- [x] **Step 2: Build the conclusion-provenance matrix**

Map advice, trend, buy zone, stop, pressure, neutral news, and confidence to their facts and guardrail logic. Include a prose explanation showing how deterministic evidence constrains model language.

- [x] **Step 3: Add product-surface evidence**

Keep the current Web workspace animation with its static reduced-motion/print fallback, plus selected report/alert screenshots as small evidence figures. Do not present the old Yongding screenshot as the Moutai case.

- [x] **Step 4: Run the complete contract tests**

Run the Task 1 command. Expected: all tests pass.

### Task 5: Update Documentation Metadata

**Files:**
- Modify: `docs/CHANGELOG.md`

- [x] **Step 1: Revise the existing flat Unreleased entry**

Replace the current project-introduction entry with:

```markdown
- [文档] 新增面向产品、技术及非技术受众的专业项目介绍 HTML，以贵州茅台历史分析为完整案例，展示每一步输入、工具、输出、数据质量、报告成品与结论溯源，并说明核心能力、技术架构、运行方式和使用边界。
```

- [x] **Step 2: Verify Unreleased format and uniqueness**

Confirm exactly one entry describes `project-introduction.html`, it remains in the flat `[Unreleased]` list, and no category heading is added.

### Task 6: Browser, Print, Offline, and Content Verification

**Files:**
- Verify: `docs/project-introduction.html`
- Verify: `tests/test_project_introduction_html.py`
- Verify: `docs/CHANGELOG.md`
- Temporary evidence only: `.runtime/project-introduction-case-study/`

- [x] **Step 1: Run fresh deterministic verification**

```bash
TMPDIR=/tmp TMP=/tmp TEMP=/tmp .venv/bin/python -m pytest tests/test_project_introduction_html.py tests/test_history_share_image.py -q
git diff --check
```

Expected: all tests pass and `git diff --check` is silent.

- [x] **Step 2: Serve and inspect in Chromium**

Serve the repository on localhost. At 1440×1000, 736×900, and 360×800 verify:

- all eight top-level sections exist and are reachable;
- all eight case ledgers are readable;
- document-level horizontal overflow is absent;
- wide tables use only their intended local overflow containers;
- sticky navigation follows the current section without covering content;
- the reconstructed report and provenance matrix remain readable;
- all images load and console output contains no errors or warnings.

- [x] **Step 3: Verify details and no-JavaScript behavior**

If optional `<details>` blocks are used, verify they are keyboard accessible and closed content is supplementary only. Disable JavaScript and confirm the primary case, all inputs/outputs, report, and provenance remain visible.

- [x] **Step 4: Verify reduced motion and print**

Under reduced motion, confirm the workspace uses the static data-SVG and no text remains hidden. Under print at an A4-landscape-like viewport, confirm all details are expanded or duplicated in printable content, navigation/progress are hidden, diagrams are in final state, colors are readable, and there is no document-level overflow.

- [x] **Step 5: Verify offline requests**

Confirm all network requests are localhost HTML and the approved local assets; no external fonts, scripts, APIs, or images are requested.

- [x] **Step 6: Perform the evidence and narrative audit**

Cross-check every Moutai value against `reports/report_20260812.md`, quality/source statements against the matching local context snapshot, and tool descriptions against current implementation. Verify quick reading fits about 10–15 minutes and complete reading about 25–35 minutes.

- [x] **Step 7: Request independent review and resolve findings**

Request a read-only review for correctness, fact fidelity, accessibility, responsive behavior, print behavior, test quality, and preservation of unrelated user changes. Fix all Critical and Important findings, re-run verification, then remove temporary browser artifacts using the system trash.
