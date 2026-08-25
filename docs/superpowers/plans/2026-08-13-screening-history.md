# Screening History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在选股页面展示服务端已保存的运行历史，并允许恢复完整历史结果。

**Architecture:** 复用现有历史摘要和详情 API，在 `StockScreeningPage` 内增加独立历史视图状态。详情仍通过现有 `applyScreenResult` 进入当前结果展示，避免复制结果渲染逻辑。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、Tailwind CSS

---

### Task 1: 历史列表和详情恢复测试

**Files:**
- Test: `apps/dsa-web/src/pages/__tests__/StockScreeningPage.test.tsx`

- [ ] 增加 `getHistory`、`getRun` mock，并在 `beforeEach` 设置空历史默认值。
- [ ] 编写测试：切换“历史记录”后展示两条摘要，点击一条后加载详情、切回“当前结果”并展示候选股。
- [ ] 运行 `npm test -- StockScreeningPage.test.tsx`，确认测试因页面尚无历史入口而失败。

### Task 2: 页面历史交互

**Files:**
- Modify: `apps/dsa-web/src/pages/StockScreeningPage.tsx`

- [ ] 引入 `ScreeningRunSummary`，增加视图、历史列表、加载与错误状态。
- [ ] 实现 `loadHistory` 和 `handleOpenHistoryRun`，分别调用 `screeningApi.getHistory({ limit: 20 })` 与 `screeningApi.getRun(runId)`。
- [ ] 在结果区域增加“当前结果 / 历史记录”切换和历史摘要列表；详情加载成功后通过 `applyScreenResult` 恢复结果。
- [ ] 新任务完成后刷新已加载过的历史列表。
- [ ] 重新运行页面测试，确认通过。

### Task 3: 文档与完整验证

**Files:**
- Modify: `docs/CHANGELOG.md`

- [ ] 在 `[Unreleased]` 增加选股历史页面能力说明。
- [ ] 运行 `npm run lint`。
- [ ] 运行 `npm run build`。
- [ ] 检查 `git diff --check`，确认没有空白错误。
