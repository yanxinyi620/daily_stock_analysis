# 云端工作台改版实施计划

> **For agentic workers:** Use superpowers:subagent-driven-development; the primary agent integrates and verifies.

**Goal:** 落地已确认工作台布局、股票名称、统一状态及本人可恢复删除。
**Architecture:** 保留 React 与现有发布契约；数据库增量增加删除标记和受限 RPC，列表按正常／回收站读取。前端弹窗复用一个可访问组件，现有执行逻辑保持。
**Tech Stack:** React / TypeScript / Supabase Postgres / Vitest / Python integration checks.

- [x] 数据库：新增 `supabase/migrations/202609210001_cloud_report_trash.sql`，定义 `cloud_set_report_deleted(p_task_id uuid, p_deleted boolean)`；从 auth.uid 获取本人，启用成员校验、任务行锁、进行中禁止删除，保护发布重试不清除删除标记。测试匿名、跨账户、停用、幂等和并发路径。
- [x] 数据层：`client.ts` 的 records 增加 trash 参数和 deleted_at、索引级股票名称；过滤列表与活跃计数；通过 RPC 删除／恢复。保持附件鉴权及旧数据回退。
- [x] 表格：`AnalysisRecords.tsx` 统一状态映射，个股直接显示股票名称，时间无副文案；增加确认删除、回收站／恢复及末页刷新纠正。测试状态、名称、取消、请求失败、分页、恢复。
- [x] 布局：`CloudApp.tsx` 与 `cloud.css` 采用左侧自选股、右侧分析／记录，账户顶栏弹窗、自选股按需编辑；`RunnerPanel.tsx` 使用分析类型选项卡和可读时间，折叠历史且标注回收站报告。测试既有提交、重试、权限与弹窗交互。
- [x] 验证：先相关测试，再完整前端测试、lint、普通／云端构建；恢复项目运行迁移与权限验证，通过后正式项目增量应用。浏览器验证桌面／手机、已有账号与私有报告，正式历史报告不作删除测试。
- [x] 交付：更新部署专题与 CHANGELOG，截图置仓库外；提交、推送、正式部署，分别记录本地、远端和未验证项及回滚限制。
