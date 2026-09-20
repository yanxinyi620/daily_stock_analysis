# Vercel + Supabase 增量实施与审计

> **旧阶段实施记录（2026-09-18 更新）。** 后续开发依据 [当前 Runner 方案](vercel-supabase-plan.md) 与 [实施计划](../superpowers/plans/2026-09-18-local-runner-cloud.md)。旧 A～C 完成标记仅针对报告发布/阅读；不代表新的 Runner 阶段已实现。

依据：用户提供的 `docs/daily_stock_analysis_codex_plan.md`（未跟踪原稿保持原样）；当时请求中的 `docs/deployment/vercel-supabase-plan.md` 不存在；现已用该路径保存最新 Runner 方案。基线 HEAD：`9d619af5`。

## A：确认的仓库现状

- React 19 / Vite 7 / TypeScript，`apps/dsa-web`，`npm run build` 输出根目录 `static/`；Electron 继续消费原有 Web 构建。
- `main.py` / `src/core/pipeline.py` 执行 Python 分析，`pipeline.run` 汇总后保存 Markdown，再发送通知；复用这个出口。
- `server.py` / FastAPI：`api/v1/router.py` 聚合 auth、agent、analysis、history、stocks、backtest、system、usage、portfolio、alerts、decision-signals、screening、intelligence、health。本地接口保持原状，不将整个 Python 服务部署到 Vercel。
- `src/storage.py` 的 SQLAlchemy / SQLite（`DATABASE_PATH` 默认 `./data/stock_analysis.db`）保存行情与 `analysis_history`，`reports/` 保存 Markdown；不自动搬迁、清空或双向同步。
- 通知包括企业微信、钉钉、飞书、Telegram、邮件、Pushover、ntfy、Gotify、PushPlus、自定义 webhook、Discord、Slack、AstrBot。原配置和行为保持。
- 配置统一入口 `src/config.py` / `.env.example`；已有 STOCK_LIST、DATABASE_PATH、REPORT_TYPE、REPORT_LANGUAGE、模型/行情/通知变量；不记录密钥值。
- 工作流：每日分析 schedule 工作日 UTC 10:00（上海 18:00）及手动触发；network-smoke 工作日 UTC 02:00 及手动；stale 每日 UTC 00:00；CI pull_request；pr-review 手动；auto-tag/create-release push；Docker/desktop 发布 push 或手动；ghcr-dockerhub 手动。既有用途不等于新增生产任务获准，本次不扩展触发器。

## 实施计划与边界

- [x] A：只读审计与基线检查（结果见交付验证记录）。
- [x] B1：独立 SQL migration，app_members / watchlists / analysis_tasks / analysis_reports，最小 grants、RLS、private bucket、服务端专用发布 RPC。
- [x] B2：使用现有 requests 的 Python 发布器；先保存可重试发布包，再上传已有 Markdown，事务提交报告和成功状态；明确发布错误，不重跑模型。
- [x] B3：确定性 HTTP 测试、实际 Postgres 引擎的权限/事务测试；远端 Storage/Auth 独立列为待验证。
- [x] C1：构建时可选云端入口；沿用 React/Vite、主题、Markdown；统一 Supabase 数据访问层；原 App 不改变接口契约。
- [x] C2：预建用户密码登录/退出/改密、自选股 CRUD、分页报告/详情/附件、真实发布状态；无自动执行入口。
- [x] C3：会话切换清空数据、终态停止轮询、后台暂停、错误退避；单测、lint、两种构建及截图。
- [x] 交付：环境示例、平台配置、恢复/显式导入、孤立文件清理 dry-run、验证缺口和回滚说明。

优先完成上述已授权实现，不新建调度系统。云端查询直接使用 SDK + RLS；当前无需服务端 Secret 的浏览器操作，不新增 Vercel API 代理。无 Actions 投递 API，`ENABLE_ACTIONS_DISPATCH=false` 仅保留禁用契约，设 true 明确报错。

设计：任务表示**发布任务**（publishing / publish_failed / succeeded / cancelled），不是假装存在分析执行器。每次原有分析批次对应一个报告，保留原有汇总 Markdown 与精简结构化结果。发布 ID 由归属用户和幂等键确定，内容摘要锁定输入，同一键不同内容拒绝；成功报告不可变。附件使用内容摘要路径且只读授权必须匹配已提交报告，孤立上传不可读。高权限发布者只在可信 Python 环境使用，RPC 再检查成员与任务归属。

## 2026-09-18 后续方向调整（以最后一次用户更新为准）

此前提出的 Vercel Python Functions 可行性验证路线现已弃用。后续采用 Vercel 前端/轻量 API + Supabase + 单一本地 Python Runner；Actions 仅承担交易日每日综合分析。Runner 离线拒绝新任务，不离线排队。已有 A～C 和域名、恢复验收记录保留，新执行能力按当前实施计划逐项开发验证。
