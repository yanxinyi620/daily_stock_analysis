# DSA Mobile Daily Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 React/FastAPI 项目内实现共享业务层的移动日常使用端，提供五入口、分析/选股/问股/任务闭环、移动报告和最小 PWA 能力，同时保持桌面端兼容。

**Architecture:** 新增独立 `/m/*` 路由和 `MobileShell`，移动页面直接复用现有 API、类型、认证上下文与 Zustand 状态。移动专属代码只承担信息编排、卡片和安全区布局；桌面 `Shell` 与既有路由保持不变。

**Tech Stack:** React 19、React Router 7、TypeScript、Zustand、Tailwind CSS、Vitest、Testing Library、Playwright、Vite PWA 静态清单

---

## 文件边界

- `src/components/mobile/`：移动壳、底部导航、股票/任务/状态卡片。
- `src/hooks/useMobileDashboard.ts`：首页、自选、报告和任务的共享只读聚合，不复制领域状态。
- `src/pages/mobile/`：五入口、报告详情和选股页面编排。
- `src/App.tsx`：注册 `/m/*` 路由，不改变桌面路由。
- `src/i18n/uiText.ts`：移动端中英文文案。
- `e2e/mobile-companion.spec.ts`：真实移动视口闭环和视觉证据。
- `public/manifest.webmanifest`、`public/icons/*`：最小 PWA 安装元数据。

### Task 1: 移动路由和五入口界面壳

**Files:**
- Create: `apps/dsa-web/src/components/mobile/MobileBottomNav.tsx`
- Create: `apps/dsa-web/src/components/mobile/MobileShell.tsx`
- Create: `apps/dsa-web/src/components/mobile/__tests__/MobileShell.test.tsx`
- Modify: `apps/dsa-web/src/App.tsx`
- Modify: `apps/dsa-web/src/App.test.tsx`

- [x] 写失败测试：`MemoryRouter` 从 `/m/tasks` 渲染界面壳，断言五个 link、任务 link 的 `aria-current=page`、`100dvh` 和安全区底部留白；在 `App.test.tsx` 断言五个移动路由位于认证边界内。
- [x] 运行 `npm test -- --run src/components/mobile/__tests__/MobileShell.test.tsx src/App.test.tsx`，预期因模块和路由不存在而 FAIL。
- [x] 实现 `MobileBottomNav` 固定映射：首页 `/m`、自选 `/m/watchlist`、问股 `/m/chat`、任务 `/m/tasks`、我的 `/m/me`；点击目标最小 44px。
- [x] 实现 `MobileShell` 的单一滚动容器、移动顶栏、`100dvh`、安全区和固定底栏；在 `App.tsx` 注册独立嵌套路由及 `/mobile -> /m` 重定向。
- [x] 重跑相同测试，预期 PASS。

### Task 2: 移动数据聚合与任务契约

**Files:**
- Create: `apps/dsa-web/src/hooks/useMobileDashboard.ts`
- Create: `apps/dsa-web/src/hooks/__tests__/useMobileDashboard.test.tsx`
- Create: `apps/dsa-web/src/utils/mobileTask.ts`
- Create: `apps/dsa-web/src/utils/__tests__/mobileTask.test.ts`

- [x] 写失败测试：`groupMobileTasks()` 将任务稳定分为 active/completed/failed；`getMobileTaskDestination()` 将完成个股任务映射到 `/m/reports/:id`、选股映射到 `/m/screening`。
- [x] Hook 测试 mock `historyApi.getList`、`analysisApi.getTasks`、`systemConfigApi.getWatchlist`，验证并行加载、刷新失败保留旧数据并标记 stale、显式 `refresh()`。
- [x] 运行 `npm test -- --run src/hooks/__tests__/useMobileDashboard.test.tsx src/utils/__tests__/mobileTask.test.ts`，预期 FAIL。
- [x] 实现返回 `watchlistCodes/recentReports/tasks/loading/stale/error/refresh` 的 Hook；不得新增业务 Store，继续复用现有 API 与 `stockPoolStore`。
- [x] 重跑相同测试，预期 PASS。

### Task 3: 首页、自选和任务闭环

**Files:**
- Create: `apps/dsa-web/src/pages/mobile/MobileHomePage.tsx`
- Create: `apps/dsa-web/src/pages/mobile/MobileWatchlistPage.tsx`
- Create: `apps/dsa-web/src/pages/mobile/MobileTasksPage.tsx`
- Create: `apps/dsa-web/src/pages/mobile/__tests__/MobileHomePage.test.tsx`
- Create: `apps/dsa-web/src/pages/mobile/__tests__/MobileWatchlistPage.test.tsx`
- Create: `apps/dsa-web/src/pages/mobile/__tests__/MobileTasksPage.test.tsx`
- Create: `apps/dsa-web/src/components/mobile/MobileStockCard.tsx`
- Create: `apps/dsa-web/src/components/mobile/MobileTaskCard.tsx`

- [ ] 写首页失败测试：展示服务状态、进行中任务、四个快捷操作、自选前五条和最近报告；单股调用 `analysisApi.analyzeAsync`，综合调用 `triggerCompositeAnalysis`，大盘调用 `triggerMarketReview`，选股进入 `/m/screening`。
- [ ] 写自选失败测试：添加、移除、分析单股/全部/未完成、打开 `/m/reports/:id`。
- [ ] 写任务失败测试：进行中/已完成/失败分组、进度、失败原因、完成报告跳转和刷新。
- [ ] 运行三个页面测试，预期因页面不存在而 FAIL。
- [ ] 实现页面和卡片；核心操作最小 44px，无页面级横向滚动；提交成功导航 `/m/tasks`，409 显示已有任务而不重复提交。
- [ ] 重跑三个页面测试，预期 PASS。

### Task 4: 移动报告和问股

**Files:**
- Create: `apps/dsa-web/src/pages/mobile/MobileReportPage.tsx`
- Create: `apps/dsa-web/src/pages/mobile/MobileChatPage.tsx`
- Create: `apps/dsa-web/src/pages/mobile/__tests__/MobileReportPage.test.tsx`
- Create: `apps/dsa-web/src/pages/mobile/__tests__/MobileChatPage.test.tsx`
- Reuse/Modify: `apps/dsa-web/src/components/report/ReportMarkdownPanel.tsx`

- [ ] 写报告失败测试：mock `historyApi.getDetail/getMarkdown`，首屏只显示评分、操作、趋势、风险和摘要；点击完整报告后才请求 Markdown；综合报告不显示单股按钮。
- [ ] 写问股失败测试：会话抽屉、消息、股票上下文、Skill、吸底输入框、发送和失败重试，动作必须来自现有 `agentChatStore`。
- [ ] 运行两个页面测试，预期 FAIL。
- [ ] 实现报告三层信息结构和移动聊天编排；输入区位于五入口导航之上，消息区只有一个纵向滚动容器。
- [ ] 重跑两个页面测试，预期 PASS。

### Task 5: 我的、选股和辅助能力

**Files:**
- Create: `apps/dsa-web/src/pages/mobile/MobileMePage.tsx`
- Create: `apps/dsa-web/src/pages/mobile/MobileScreeningPage.tsx`
- Create: `apps/dsa-web/src/pages/mobile/__tests__/MobileMePage.test.tsx`
- Create: `apps/dsa-web/src/pages/mobile/__tests__/MobileScreeningPage.test.tsx`

- [ ] 写“我的”失败测试：持仓、AI 建议、告警、用量、主题/语言/通知和只读运行状态；明确高级配置使用桌面端，禁止 API Key 编辑或显示。
- [ ] 写选股失败测试：策略加载、异步提交/轮询、候选卡、历史记录、详情恢复和失败原因。
- [ ] 运行两个页面测试，预期 FAIL。
- [ ] 实现“我的”摘要入口；实现选股页并复用 `screeningApi.getStrategies/startScreen/getScreenTask/getHistory/getRun`，不得复制桌面宽表。
- [ ] 重跑两个页面测试，预期 PASS。

### Task 6: PWA、安全区和双语

**Files:**
- Create: `apps/dsa-web/public/manifest.webmanifest`
- Create: `apps/dsa-web/public/icons/dsa-192.png`
- Create: `apps/dsa-web/public/icons/dsa-512.png`
- Modify: `apps/dsa-web/index.html`
- Modify: `apps/dsa-web/src/i18n/uiText.ts`
- Create: `apps/dsa-web/tests/mobile_manifest.test.ts`

- [ ] 写失败测试：manifest 的 `display=standalone`、`start_url=/m`、192/512 图标和主题色；`index.html` 包含 manifest、theme-color 与 apple-mobile 元数据。
- [ ] 运行 `npm test -- --run tests/mobile_manifest.test.ts`，预期 FAIL。
- [ ] 添加最小 Manifest 和图标；不注册 API/报告离线缓存；所有移动文案同时补齐 zh/en 并受 `UiTextKey` 约束。
- [ ] 运行 `npm test -- --run tests/mobile_manifest.test.ts tests/system_config_i18n.test.ts`，预期 PASS。

### Task 7: 视觉验收、文档与完整回归

**Files:**
- Create: `apps/dsa-web/e2e/mobile-companion.spec.ts`
- Modify: `apps/dsa-web/playwright.config.ts`
- Modify: `docs/full-guide.md`
- Modify: `docs/full-guide_EN.md`
- Modify: `docs/CHANGELOG.md`

- [ ] 配置 390×844 与 412×915 两个移动项目；测试五入口、无页面级横向溢出、底栏不遮挡、任务到报告闭环。
- [ ] 运行 `DSA_WEB_SMOKE_PASSWORD=<configured> npm run test:smoke -- mobile-companion.spec.ts`；截图只作为验收证据，不提交仓库。
- [ ] 中英文指南说明 `/m`、五入口、能力边界、PWA 安装与安全访问；Changelog `[Unreleased]` 使用扁平条目。
- [ ] 运行完整 `npm test -- --run`、`npm run lint`、`npm run build` 与仓库根目录 `git diff --check`。
- [ ] 按设计规格第 11 节逐项审计：五入口、单股/综合/选股/问股、任务失败、报告风险、高级配置边界、移动视觉和桌面回归必须均有直接证据；未经用户明确确认不得 commit 或 push。
