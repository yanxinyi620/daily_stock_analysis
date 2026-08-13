from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
COMPACT_PATH = ROOT / "docs" / "project-introduction-compact.html"
FULL_PATH = ROOT / "docs" / "project-introduction.html"


def compact_text() -> str:
    return COMPACT_PATH.read_text(encoding="utf-8")


def test_compact_version_is_independent_and_has_six_sections():
    text = compact_text()

    assert FULL_PATH.is_file()
    assert COMPACT_PATH != FULL_PATH
    assert '<html lang="zh-CN">' in text
    assert '<meta name="viewport"' in text
    section_ids = (
        "value",
        "capabilities",
        "workflow",
        "case",
        "trust",
        "usage",
    )
    for section_id in section_ids:
        assert f'id="{section_id}"' in text
        assert f'href="#{section_id}"' in text
    assert text.count('data-main-section="') == 6


def test_compact_version_states_value_and_product_path_clearly():
    text = compact_text()

    for phrase in (
        "从股票代码，到有据可查的分析结论",
        "自动分析",
        "有据可查",
        "持续跟踪",
        "8 步分析过程",
        "5 种数据状态",
        "3 层报告内容",
        "程序负责取数和计算",
        "模型根据已有资料整理判断",
        "规则程序负责复核",
    ):
        assert phrase in text
    for feature in (
        "选股",
        "每日综合分析",
        "单股分析",
        "问股",
        "回测",
        "自选股与提醒",
    ):
        assert feature in text
    assert text.count('data-product-step="') == 6
    assert "选股不等于买入" in text
    assert "回测不能保证未来" in text
    assert "不是自动交易程序" in text


def test_compact_version_has_eight_concise_analysis_steps_and_tools():
    text = compact_text()

    assert text.count('data-analysis-step="') == 8
    for tool in (
        "DataFetcherManager",
        "腾讯财经",
        "StockTrendAnalyzer",
        "SearchService / SearXNG",
        "AnalysisContextPack",
        "LLM Analyzer",
        "Guardrails",
        "Report Renderer",
        "History Service",
        "Notification Service",
    ):
        assert tool in text


def test_compact_version_preserves_verified_moutai_case():
    text = compact_text()

    for fact in (
        "贵州茅台",
        "600519",
        "2026-08-12",
        "1345.43",
        "1331.71",
        "1336.47",
        "1316.86",
        "1354.01",
        "趋势强度 40",
        "评分 54",
        "观望",
        "震荡",
        "中等把握",
        "空仓者 0 成观察",
        "确认后不超过 2 成",
        "持仓者控制在 5 成以内",
    ):
        assert fact in text
    assert "永鼎股份" not in text
    assert "600105" not in text


def test_compact_version_explains_quality_and_conclusion_sources():
    text = compact_text()

    for state in (
        "可用（available）",
        "部分可用（partial）",
        "缺失（missing）",
        "失败（failed）",
        "结果为空（empty）",
    ):
        assert state in text
    assert "搜索为空不等于没有风险" in text
    assert 'data-visual="quality"' in text
    assert 'data-visual="conclusion-sources"' in text
    for conclusion in ("为什么观望", "买入观察区", "止损位", "上方阻力", "新闻保持中性"):
        assert conclusion in text


def test_compact_version_is_offline_accessible_and_printable():
    text = compact_text()

    for asset in (
        "assets/readme_workspace_tour_20260510.gif",
        "assets/alert-center-p5-web.png",
    ):
        assert asset in text
        assert (COMPACT_PATH.parent / asset).is_file()
    assert "assets/sample.png" not in text
    assert not re.search(r"(?:src|href)=[\"']https?://", text)
    assert 'aria-label="精简版目录"' in text
    assert 'aria-label="阅读进度"' in text
    assert "prefers-reduced-motion: reduce" in text
    assert "@media print" in text
    assert "<noscript" in text
    assert 'document.documentElement.classList.add("js")' in text
    images = re.findall(r"<img\b[^>]*>", text, flags=re.DOTALL)
    assert images
    assert all(re.search(r'\balt="[^"]+"', image) for image in images)


def test_interface_examples_use_readable_full_row_layout():
    text = compact_text()

    assert text.count('data-interface-showcase="') == 2
    assert "Web 工作台" in text
    assert "发起分析，查看任务进度和历史报告" in text
    assert "提醒中心" in text
    assert "把关键价位和触发条件保存为持续关注事项" in text
    assert ".evidence{display:grid;grid-template-columns:1fr;" in text
    assert "grid-template-columns:1.35fr .65fr" not in text
    assert text.count('class="figure-head"') == 2
