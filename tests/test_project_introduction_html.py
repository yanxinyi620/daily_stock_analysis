from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
HTML_PATH = ROOT / "docs" / "project-introduction.html"


def html_text() -> str:
    return HTML_PATH.read_text(encoding="utf-8")


def test_professional_report_has_complete_information_architecture():
    text = html_text()

    assert '<html lang="zh-CN">' in text
    assert '<meta name="viewport"' in text
    for section_id in (
        "executive-summary",
        "capability-map",
        "case-pipeline",
        "case-brief",
        "final-report",
        "technical-foundation",
        "adoption",
    ):
        assert f'id="{section_id}"' in text
    assert text.count('data-main-section="') == 7
    ordered_ids = (
        "executive-summary",
        "capability-map",
        "case-pipeline",
        "case-brief",
        "final-report",
        "technical-foundation",
        "adoption",
    )
    assert [text.index(f'id="{section_id}"') for section_id in ordered_ids] == sorted(
        text.index(f'id="{section_id}"') for section_id in ordered_ids
    )
    assert text.count('class="chapter-purpose"') == 7
    for step in range(1, 9):
        assert text.count(f'data-case-step="{step}"') == 1
    for ledger_item in (
        "goal",
        "input",
        "tool",
        "processing",
        "output",
        "quality",
        "next",
    ):
        assert text.count(f'data-ledger="{ledger_item}"') == 8
    for label in ("这一步要做什么", "拿到什么", "使用什么", "怎样处理", "得到什么", "数据不足怎么办", "接下来交给谁"):
        assert text.count(label) >= 8


def test_professional_report_uses_verified_moutai_case_facts():
    text = html_text()

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
        "观望",
        "震荡",
    ):
        assert fact in text
    assert "永鼎股份" not in text
    assert "600105" not in text


def test_professional_report_names_tools_and_quality_semantics():
    text = html_text()

    for tool in (
        "DataFetcherManager",
        "腾讯财经",
        "StockTrendAnalyzer",
        "SearchService",
        "SearXNG",
        "AnalysisContextPack",
        "LLM Analyzer",
        "Guardrails",
        "Report Renderer",
        "History Service",
        "Diagnostics",
        "Notification Service",
    ):
        assert tool in text
    for state in ("available", "partial", "missing", "failed", "empty"):
        assert f'data-quality-state="{state}"' in text
    assert "搜索为空不等于没有风险" in text


def test_professional_report_contains_visuals_and_conclusion_provenance():
    text = html_text()

    for visual in ("lineage", "quality-matrix", "price-position", "provenance-matrix"):
        assert f'data-visual="{visual}"' in text
    for phrase in ("5 日均价仍低于 10 日均价", "买入观察区", "成交量明显增加", "中等置信度"):
        assert phrase in text
    assert 'data-report="moutai-2026-08-12"' in text
    for required_report_detail in (
        "昨收 1348.86",
        "开盘 1346.50",
        "最高 1354.01",
        "最低 1332.51",
        "量比 0.96",
        "换手率 0.14%",
        "空仓者 0 成观察",
        "确认后不超过 2 成",
        "持仓者控制在 5 成以内",
        "理想买入点",
        "次优买入点",
        "收盘后复核",
    ):
        assert required_report_detail in text


def test_pipeline_matches_the_approved_eight_step_design():
    text = html_text()

    for title in (
        "标的识别与市场阶段",
        "行情与基础事实采集",
        "技术指标与趋势判断",
        "新闻与市场情报",
        "基本面、板块与数据质量",
        "整理成一份统一的分析资料",
        "模型整理结论，程序检查规则",
        "报告、历史、诊断与通知",
    ):
        assert title in text
    assert "技术数据整体只有部分可用（partial）" in text
    assert "技术 available" not in text


def test_report_uses_plain_chinese_for_reader_facing_explanations():
    text = html_text()

    for heading in (
        "项目解决什么问题",
        "产品能力怎样相互配合",
        "一份报告怎样经过八步完成",
        "贵州茅台案例使用了哪些数据",
        "最终报告与结论依据",
        "为什么得出这个结论",
        "系统怎样实现，并在出错时保留结果",
        "怎样使用，以及哪些事不能依赖它",
    ):
        assert heading in text
    for ledger_label in (
        "这一步要做什么",
        "拿到什么",
        "使用什么",
        "怎样处理",
        "得到什么",
        "数据不足怎么办",
        "接下来交给谁",
    ):
        assert text.count(ledger_label) >= 8
    for quality_label in (
        "可用（available）",
        "部分可用（partial）",
        "缺失（missing）",
        "失败（failed）",
        "结果为空（empty）",
    ):
        assert quality_label in text


def test_report_explains_tools_and_avoids_abstract_reader_facing_phrases():
    text = html_text()

    for explanation in (
        "数据来源管理器 DataFetcherManager",
        "技术指标计算器 StockTrendAnalyzer",
        "新闻搜索工具 SearchService / SearXNG",
        "统一资料包 AnalysisContextPack",
        "负责整理说明的 LLM Analyzer",
        "规则检查器 Guardrails",
    ):
        assert explanation in text
    for abstract_phrase in (
        "证据边界",
        "数据质量语义",
        "生成式表达",
        "模型可消费",
        "契约化质量",
        "可观测层",
        "关键张力",
        "数据血缘",
    ):
        assert abstract_phrase not in text


def test_report_explains_how_product_features_work_together():
    text = html_text()

    assert 'id="feature-collaboration"' in text
    assert 'href="#feature-collaboration"' not in text
    assert 'data-subsection="feature-collaboration"' in text
    assert 'data-visual="feature-collaboration"' in text
    for feature in (
        "选股",
        "每日综合分析",
        "单股分析",
        "问股",
        "回测",
        "自选股与提醒",
    ):
        assert feature in text
    for heading in ("拿到什么", "主要解决什么问题", "得到什么", "常见下一步"):
        assert heading in text
    for statement in (
        "贵州茅台串联示例",
        "选股结果不等于买入建议",
        "回测结果不能保证未来表现",
        "不是自动交易流程",
    ):
        assert statement in text


def test_report_title_covers_the_complete_research_workflow():
    text = html_text()

    assert "从发现机会到持续跟踪" in text
    assert "如何连接选股、每日分析、问股、回测与提醒" in text
    assert "一份分析报告，" not in text


def test_professional_report_is_offline_accessible_and_print_safe():
    text = html_text()
    expected_assets = (
        "assets/readme_workspace_tour_20260510.gif",
        "assets/alert-center-p5-web.png",
    )

    for asset in expected_assets:
        assert asset in text
        assert (HTML_PATH.parent / asset).is_file()
    assert "assets/sample.png" not in text
    assert not re.search(r"(?:src|href)=[\"']https?://", text)
    assert re.search(r'<link\s+rel="icon"\s+href="data:image/svg\+xml,', text)
    assert 'class="animated-tour"' in text
    assert 'class="static-tour"' in text
    assert "prefers-reduced-motion: reduce" in text
    assert "@media print" in text
    assert 'aria-label="报告目录"' in text
    assert 'aria-label="阅读进度"' in text
    assert "IntersectionObserver" in text
    assert re.search(r'<noscript\s+class="noscript-note"\s*>', text)
    assert 'document.documentElement.classList.add("js")' in text
    assert ".js .reveal" in text
    images = re.findall(r"<img\b[^>]*>", text, flags=re.DOTALL)
    assert images
    assert all(re.search(r'\balt="[^"]+"', image) for image in images)


def test_full_report_uses_the_approved_seven_chapter_titles_and_subsections():
    text = html_text()

    for entry in (
        "01 项目价值",
        "02 产品能力与协同",
        "03 系统怎样完成分析",
        "04 贵州茅台完整案例",
        "05 最终报告与结论依据",
        "06 技术实现与系统边界",
        "07 使用方式与限制",
    ):
        assert entry in text
    assert text.count('class="toc-chapter"') == 7
    assert 'data-subsection="feature-collaboration"' in text
    assert 'data-subsection="conclusion-provenance"' in text
    assert 'href="project-introduction-compact.html"' in text
    assert text.count('data-interface-showcase="') == 2
