# DSA Project Introduction HTML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a self-contained, responsive Chinese HTML introduction that explains DSA's product value and technical implementation in a 15–20 minute story.

**Architecture:** A single semantic HTML document owns content, visual diagrams, styles, and small progressive-enhancement scripts. Existing repository images are referenced with relative paths; native HTML/CSS/SVG provides all other visuals so the material remains offline-capable and build-free.

**Tech Stack:** HTML5, CSS, inline SVG, vanilla JavaScript, pytest contract tests, Playwright browser verification.

---

No commit steps are included because `AGENTS.md` requires explicit confirmation before `git commit`.

## File Structure

- Create `docs/project-introduction.html`: the complete presentation/self-reading artifact, including semantic content, CSS, SVG diagrams, navigation, progress, and animation behavior.
- Create `tests/test_project_introduction_html.py`: deterministic file-level checks for chapter coverage, asset references, offline behavior, accessibility hooks, and navigation hooks.
- Modify `docs/CHANGELOG.md`: append one flat `[文档]` entry to `[Unreleased]` without touching unrelated existing entries.
- Preserve `docs/assets/readme_workspace_tour_20260510.gif`, `docs/assets/sample.png`, and `docs/assets/alert-center-p5-web.png` unchanged and reference them from the HTML.

### Task 1: Define the HTML Contract With Failing Tests

**Files:**
- Create: `tests/test_project_introduction_html.py`

- [x] **Step 1: Write the failing contract tests**

```python
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
HTML_PATH = ROOT / "docs" / "project-introduction.html"


def html_text() -> str:
    return HTML_PATH.read_text(encoding="utf-8")


def test_project_introduction_contains_complete_story():
    text = html_text()
    assert '<html lang="zh-CN">' in text
    assert '<meta name="viewport"' in text
    for section_id in (
        "opening",
        "problem",
        "journey",
        "experience",
        "architecture",
        "delivery",
        "boundaries",
    ):
        assert f'id="{section_id}"' in text
    for phrase in (
        "把分散的市场信息",
        "AI 决策报告",
        "多市场数据",
        "失败隔离",
        "不构成投资建议",
    ):
        assert phrase in text


def test_project_introduction_uses_selected_local_assets_only():
    text = html_text()
    expected_assets = (
        "assets/readme_workspace_tour_20260510.gif",
        "assets/sample.png",
        "assets/alert-center-p5-web.png",
    )
    for asset in expected_assets:
        assert asset in text
        assert (HTML_PATH.parent / asset).is_file()
    assert not re.search(r'(?:src|href)=["\']https?://', text)


def test_project_introduction_has_accessible_navigation_and_motion_fallback():
    text = html_text()
    assert 'aria-label="章节导航"' in text
    assert 'aria-label="阅读进度"' in text
    assert "prefers-reduced-motion: reduce" in text
    assert "@media print" in text
    assert "ArrowRight" in text
    assert "ArrowLeft" in text
    assert "IntersectionObserver" in text
    assert "<noscript>" in text
    assert text.count("<img ") == text.count(' alt="')
```

- [x] **Step 2: Run the tests and verify the missing deliverable fails**

Run:

```bash
python -m pytest tests/test_project_introduction_html.py -q
```

Expected: failures with `FileNotFoundError` for `docs/project-introduction.html`.

### Task 2: Build the Semantic Story and Visual System

**Files:**
- Create: `docs/project-introduction.html`
- Test: `tests/test_project_introduction_html.py`

- [x] **Step 1: Create the complete document skeleton**

Use this exact top-level structure, then populate each section from the approved design spec:

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Daily Stock Analysis｜从市场信息到行动决策</title>
  <style>/* complete local visual system, responsive rules, reduced motion, print */</style>
</head>
<body>
  <div class="reading-progress" role="progressbar" aria-label="阅读进度"></div>
  <nav aria-label="章节导航">...</nav>
  <main>
    <section id="opening">...</section>
    <section id="problem">...</section>
    <section id="journey">...</section>
    <section id="experience">...</section>
    <section id="architecture">...</section>
    <section id="delivery">...</section>
    <section id="boundaries">...</section>
  </main>
  <noscript>页面内容可正常阅读；启用 JavaScript 后可使用章节动效与键盘导航。</noscript>
  <script>/* progress, reveal observer, section navigation, active state */</script>
</body>
</html>
```

- [x] **Step 2: Implement the confirmed A × B art direction**

Define local CSS variables for deep navy, warm paper, action green, signal gold, and editorial red. Use a dark, high-contrast opening and decision sections; alternate warm-paper explainer sections for the journey, architecture, and delivery. Use typographic scale, whitespace, borders, grain/grid effects, and inline SVG instead of generic card grids.

- [x] **Step 3: Implement all seven story sections**

Populate the sections with the exact scope in `docs/superpowers/specs/2026-08-12-project-introduction-html-design.md`: problem framing, five-stage journey, product capability map, the three selected real images, four-layer architecture, fallback/fail-open/failure-isolation explanation, scenario-based run modes, and the investment-risk boundary. Add visible timing labels totaling approximately 17 minutes.

- [x] **Step 4: Implement progressive-enhancement interactions**

Use native JavaScript with these stable hooks:

```javascript
const sections = [...document.querySelectorAll("main > section[id]")];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const observer = new IntersectionObserver(onIntersect, { threshold: 0.2 });
sections.forEach((section) => observer.observe(section));
window.addEventListener("scroll", updateProgress, { passive: true });
window.addEventListener("keydown", navigateByArrowKey);
```

`navigateByArrowKey` must ignore events originating from inputs, textareas, selects, buttons, and editable elements. `ArrowRight`/`ArrowDown` move forward, `ArrowLeft`/`ArrowUp` move backward, and navigation uses `scrollIntoView({behavior: reduceMotion.matches ? "auto" : "smooth"})`.

- [x] **Step 5: Run the contract tests**

Run:

```bash
python -m pytest tests/test_project_introduction_html.py -q
```

Expected: all tests pass.

### Task 3: Document the User-Visible Material

**Files:**
- Modify: `docs/CHANGELOG.md`

- [x] **Step 1: Append one flat Unreleased entry**

Add this exact line after the current final `[Unreleased]` item, preserving concurrent changes:

```markdown
- [文档] 新增面向产品、技术及非技术受众的项目介绍 HTML 材料，以图解、精选产品截图和轻量动画说明核心能力、分析流程、技术架构、运行方式与使用边界。
```

- [x] **Step 2: Verify the changelog format**

Run:

```bash
sed -n '1,35p' docs/CHANGELOG.md
```

Expected: the new line is inside `[Unreleased]`, uses the flat `- [文档]` format, and no category heading was added.

### Task 4: Browser and Content Verification

**Files:**
- Verify: `docs/project-introduction.html`
- Verify: `tests/test_project_introduction_html.py`
- Verify: `docs/CHANGELOG.md`
- Temporary evidence only: `.runtime/project-introduction/`

- [x] **Step 1: Run deterministic tests**

Run:

```bash
python -m pytest tests/test_project_introduction_html.py -q
```

Expected: all tests pass.

- [x] **Step 2: Serve the repository locally**

Run:

```bash
python -m http.server 8765
```

Expected: `http://127.0.0.1:8765/docs/project-introduction.html` returns HTTP 200 and the three relative image requests return HTTP 200.

- [x] **Step 3: Verify desktop and mobile behavior with Playwright**

At 1440×1000, 736×900, and 360×800:

- open the page and assert the title, all seven sections, and three images are visible or reachable;
- assert there is no horizontal overflow;
- click a chapter navigation link and confirm its section becomes current;
- press `ArrowRight` and `ArrowLeft` and confirm the active chapter changes;
- scroll through the page and confirm progress advances;
- emulate reduced motion and confirm the complete content remains visible;
- capture temporary full-page screenshots under `.runtime/project-introduction/` for QA only.

- [x] **Step 4: Verify print and offline behavior**

Emulate print media and confirm navigation and progress UI are hidden and content is not clipped. Block all network requests except localhost and confirm there are no failed external dependencies.

- [x] **Step 5: Run repository-appropriate final checks**

Run:

```bash
python -m pytest tests/test_project_introduction_html.py -q
git diff --check
git status --short
```

Expected: tests pass, `git diff --check` is silent, and status lists only the intended new/modified files plus pre-existing unrelated changes.

- [x] **Step 6: Perform a timed content walk-through**

Read the visible content in chapter order using the timing labels. Confirm the primary talk track fits 15–20 minutes and that every technical term needed by non-technical readers has an adjacent plain-language explanation.
