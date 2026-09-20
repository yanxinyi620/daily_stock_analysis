# Local Runner 云端改造实施计划

> 执行时使用 superpowers:executing-plans，按阶段核对真实代码与验收证据。不自动提交、推送、开通付费资源或执行破坏性迁移。

**Goal:** 按 [当前需求](../../deployment/vercel-supabase-plan.md) 实现云端历史浏览、单一本地 Runner 交互分析与独立交易日日报。

**Architecture:** React/Vite + Vercel 轻量任务 API，Supabase Auth/Postgres/私有 Storage，本地 Python 主动心跳与拉取任务。Actions 仅做每日综合分析，与 Runner 共用分析与发布代码。

**Tech Stack:** 现有 React/Vite、Python 服务与 SQLAlchemy、PostgreSQL RPC、HTTP 轮询、GitHub Actions。不引入新的消息队列或实时连接。

## 1. 实施前只读审计与差异（2026-09-18）

以下表格记录实施前基线；实施后的状态见第 5 节与 Runner 验证记录。

| 分类 | 实际模块 | 复用或适配边界 |
| --- | --- | --- |
| 可直接复用 | `apps/dsa-web/src/cloud/CloudApp.tsx`、`client.ts` | 已有 Auth、自选股、报告与附件访问；继续沿用，不重新设计前端框架 |
| 可直接复用 | `src/services/cloud_publisher.py`、`supabase/migrations/202609140001_cloud_reports.sql` | 发布包、幂等上传、报告提交、RLS；已有迁移不修改重跑 |
| 需要适配 | `src/services/analysis_service.py`、`src/core/market_review.py`、`src/services/composite_analysis_service.py` | 复用同步分析和 CompositeAnalysisService.run，接入云端输入、进度与输出 |
| 需要适配 | `src/services/screening_service.py`、`backtest_service.py`、`agent_chat_session_service.py`、`api/v1/endpoints/agent.py` | 选股、回测、问股逐项接入；历史保存仍依赖本地存储，不能只上传 Markdown 就宣称完整迁移 |
| 需要适配 | `src/storage.py`、`src/repositories/`、`src/config.py` | 评估现有 SQLAlchemy 接入 Postgres；显式迁移与权限，不向托管库无条件 create_all；数据库连接日志不得泄露凭据 |
| 需要适配 | `src/services/task_queue.py`、`task_service.py` | 当前内存队列、线程池与 SSE 不能充当云端可靠任务状态；保留原本地模式 |
| 需要适配 | `.github/workflows/00-daily-analysis.yml` | 已有工作日 UTC 10:00 调度、main.py 与配置自选股；尚非“云端自选股 + 统一综合任务 + 幂等日报” |
| 需要新增 | Runner 进程、状态记录、原子提交/claim RPC、Vercel 任务 API | 当前没有远端消费者；`apps/dsa-web/vercel.json` 的 /api 当前返回 404 |
| 暂不处理 | 原 FastAPI/桌面启动、复杂配置编辑、多用户产品能力 | 保留原能力，不要求新部署模式运行本地网页，不扩建权限产品 |

现有 `analysis_tasks` 是 publishing / publish_failed / succeeded / cancelled 的**发布记录**；`analysis_reports.task_id` 外键和下载策略依赖该契约。新执行状态 pending / running / succeeded / failed 不得直接替换原约束。

## 2. 最小新增边界与一致性要求

- 新增一套所有分析类型共用的执行记录（建议 `execution_tasks`），保留旧 `analysis_tasks` 作为发布账本，通过执行记录关联已有报告。不是按分析类型建多个队列；不迁移或重命名线上旧表来追求示例表名一致。
- 新增 `runner_status`；唯一逻辑 Runner 的身份由配置给出。heartbeat、在线阈值、poll 间隔统一配置并同步 `.env.example`、配置注册与文档。长任务执行时仍独立维持心跳，同一进程不要求第二个服务。
- Vercel API 验证真实登录与所有者身份；数据库事务使用数据库时间再次检查当前 Runner 会话和心跳，然后创建任务。离线返回 `RUNNER_OFFLINE`，不写任何执行记录；浏览器无权绕过 RPC 直接写任务或伪造心跳。
- 原子 claim 检查 pending、Runner 当前会话及领取期限；同一任务只允许一个执行者。提交重试使用幂等键，同键异输入拒绝。第一阶段顺序执行；忙碌时拒绝额外执行请求并返回明确忙碌提示，避免积累待处理工作。
- 心跳只能证明最近存活，不能保证下一秒在线。提交后失联的 pending 必须在短领取期限后失败；重启产生新会话，不领取旧会话任务。running 失联超时后标记失败，不自动重新调用模型。状态读取/新提交/Runner 启动的有界对账负责收敛，不依赖额外常驻调度器。迟到进度和完成写入须校验会话与任务状态，不能覆盖终态。
- 结果附件先落 Storage，报告事务提交后才能成功；发布失败复用现有包重试，不重跑分析。问股完整答案与聊天记录持久化后完成，不要求逐 token 输出。综合分析保留部分失败明细，禁止将部分失败无条件显示为完整成功。
- 已有 RLS、私有 Storage 与隔离测试保留。只开放指定所有者的新执行权限，不新增角色、邀请、配额或计费；不删除第二测试账户。
- 浏览器只调用云端，不接本机 IP、端口或 Tunnel。高权限凭据仅存在可信服务端、本地环境或 GitHub Secrets，不能进入 VITE_*。

## 3. 分阶段工作与验收

### Phase A：审计（本轮已完成初步审计）

- [x] 对照实际入口、存储、队列、发布器、前端与现有 workflow 列出差异。
- [x] 标注被替代文档并保留历史验收事实。
- [ ] 实施前逐项核对各分析类型的输入、返回值、业务写入与可再生缓存，形成存储映射；不按示例函数名新增第二套引擎。

### Phase B → C：单股最小闭环，离线保护同步落地

涉及现有 `main.py`、`src/config.py`、`src/core/config_registry.py`、`.env.example`、`src/storage.py`、`src/services/cloud_publisher.py`、前端 cloud 数据层及 `vercel.json`。已新增 `src/services/cloud_runner.py`、`src/services/cloud_engine_storage.py`、两项增量迁移和 `apps/dsa-web/api/tasks.ts`；执行适配保留在现有 Runner 模块，未另建平行服务。

- [x] 先为离线拒绝且零插入、并发 claim、重复提交、过期心跳、旧会话迟到完成、匿名/非所有者/浏览器伪造写入编写失败测试。
- [x] 增量迁移执行记录、Runner 状态、RPC 与权限；保留旧报告 FK、发布状态和下载授权。用现有 Postgres 测试框架验证事务与 RLS。
- [x] 将单股依赖的长期业务写入适配到 Supabase；本地只留缓存、日志与临时发布包，不以 SQLite 持有新云端业务的唯一副本。
- [x] 增加 `main.py --runner` 模式，调用原同步分析入口；启动只连接云端，退出停止领取；心跳不被分析调用阻塞。
- [x] 接入 Vercel 轻量提交 API、前端在线状态、单股入口与任务轮询；原页面优先替换数据层，不重写业务页面。未知在线状态默认禁止执行。
- [x] 单股结果经现有发布器保存并关联执行任务，刷新后仍可查看。验证 API 离线拒绝与按钮禁用；Phase D 的安全契约不推迟到功能上线后。
- [x] 隔离测试目录运行后端 gate、受影响测试；Web 执行 npm ci、lint、本地/云端构建。不得让测试使用真实 `.env` 或历史数据库。
- [ ] 真实测试项目/Vercel 预览联调后再切生产；不覆盖已有恢复演练数据。记录启动、断网、强杀、重启与保存失败路径。

### Phase C 扩展 → D：逐项能力与离线体验

- [x] 接入单市场大盘复盘，复用统一 execution_tasks、同步入口与持久化；详见 [大盘复盘增量计划](2026-09-20-runner-market-review.md)。
- [x] 接入综合分析，固定云端自选股快照并明确区分部分完成；详见 [综合分析增量计划](2026-09-20-runner-composite.md)。
- [ ] 继续接入选股、回测、问股；每种类型通过后再开放按钮。
- [x] 综合分析从 Supabase 原子冻结自选股快照，结果摘要与报告发布同事务落库。
- [ ] 问股以 ask 任务保存完整回答和会话；回测/选股历史及实际需要的导出附件云端留存。
- [ ] 检查所有执行入口离线禁用；登录、自选股增删改查、历史报告/任务/问股与附件下载独立于 Runner。
- [ ] 前端轮询终态停止、后台暂停/降频；UI 改动保留仓库外截图证据。

### Phase E：独立交易日综合分析

- [ ] 改造现有每日 workflow，复用 CompositeAnalysisService 和发布器；不使用网页 dispatch，不将 Runner 任务转交 Actions。
- [ ] 从云端读取自选股和必要普通参数；密钥独立配置 GitHub Secrets；不读取或上传本地 .env。
- [ ] 按市场交易日历判断，非交易日退出成功；交易日期 + 所有者 + 综合范围作为幂等标识，workflow concurrency 防止重复执行；重新发布不得重新调用模型。指定市场范围/运行时刻沿用当前配置作为初始候选，真实启用前明确展示。
- [ ] 本地 Runner 离线不阻止 Actions 建立自己的综合任务；Actions 不领取交互任务，也不能伪造本地在线状态。
- [ ] 实际手动工作流验收与实际 schedule 验收分开记录；排程可能延迟，不能将配置 cron 等同于已验证按时执行。不额外购买资源。

### Phase F：一次性导入与切换

- [ ] 只读盘点旧 SQLite 报告、自选股、必要聊天与回测结果，先备份；显式选择导入范围，不搬缓存、临时文件或无价值日志。
- [ ] 提供 dry-run 清单、来源 ID 映射、幂等导入和附件校验；核对数量与摘要后切换云端业务主库。历史 SQLite 原样保留，不长期双向同步。
- [ ] 新模式可关闭回退到旧本地启动方式或现有云端阅读版本；回退代码不回滚删除新增业务数据。

## 4. 风险与配置待办

主要风险为旧发布/新执行状态混淆、心跳过期竞态、SQLAlchemy 的 SQLite 专用行为、选股/回测文件历史遗漏，以及 Actions 重复调度导致重复模型调用。按上面事务、会话、幂等与类型验收处理，不引入分布式锁服务或自动故障转移。

后续集中核对所有者身份、Runner 凭据与连接、Vercel 服务端配置、GitHub 仓库/Secrets、每日市场范围及时间。当前不要求用户重新提交已提供凭据，不打印密钥，不因为计划更新直接启用远端调度；提交/推送仍遵循 AGENTS.md。

## 5. 验证状态与文档关系

| 类别 | 本轮状态 |
| --- | --- |
| 代码已实现 | 单股、单市场大盘复盘与综合分析 Runner、执行 RPC、私有 Postgres 引擎存储、任务 API 与云端界面；选股/回测/问股和每日 Actions 待接入 |
| 本地已验证 | 后端/前端验证结果见 [Runner 验证记录](../../deployment/local-runner-validation.md) |
| 真实 Vercel 已验证 | 独立 Preview 的身份、单股/复盘/综合任务、重复提交、离线保护与报告下载；生产站点未切换 |
| 真实 Supabase 已验证 | 恢复项目已应用四项 Runner 相关增量迁移；真实单股/复盘/综合成功，独立连接读到子项与最终历史、报告；原有数据摘要保持一致 |
| 真实 GitHub Actions 已验证 | 新的云端自选股综合调度尚未实现或验证 |
| 人工配置/验证 | 本轮无额外凭据需求；正式切换和常用电脑 Runner 启动仍待后续验收 |

旧验证记录只表示当时版本的事实。生产站点仍是现有报告阅读模式。专题目前无对应英文版本；不修改 README。回滚运行方式见 [Runner 运行说明](../../deployment/local-runner.md)，停止 Runner 并回退前端即可，不删除新增数据。
