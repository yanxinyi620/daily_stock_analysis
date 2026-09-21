# 本地 Runner：单股、大盘复盘与综合分析

当前开发依据为 [云端改造方案](vercel-supabase-plan.md)。已实现单股、单市场大盘复盘与云端自选股综合分析；选股、回测、问股尚未接入新执行协议；每日 Actions 接入见[专题说明](cloud-daily-actions.md)。旧本地功能继续保留。

## 运行边界

- Vercel 继续部署 `apps/dsa-web`，新增 `/api/tasks` Node API，只校验身份、读取在线状态、提交任务，不运行 Python 分析。入口采用 [Vercel 官方 fetch 导出](https://vercel.com/docs/functions/runtimes/node-js)。
- Supabase 的 `execution_tasks` 是统一执行记录；已有 `analysis_tasks` 仍是报告发布账本。报告、下载路径和旧记录不改名、不删除。
- `runner_status` 保存短期会话与心跳；所有提交/领取在数据库锁内判断。一台 Runner 同时只接受一个 pending/running 任务，忙碌直接拒绝，不积累离线任务。
- Runner 失联后，状态查询、领取或新会话启动会将过期非终态记录收敛为失败。没有浏览器和 Runner 活动时不会额外运行清理服务，下次访问再收敛；终态不会被失联检查改写。
- 长分析由独立线程维持心跳，领取期限仅适用于 pending。心跳失败后停止领取，失效会话无法完成旧任务，也不能提交可见报告；可再生的孤立上传保留原清理流程。
- 最终报告提交与任务成功在 `cloud_complete_runner_publish` 同一事务完成。发布重试使用私有包，最多两次，绝不重新调用分析引擎。模型调用中途断电的任务不会自动重跑。
- 新模式通过现有 SQLAlchemy 持久化到不暴露给浏览器的 `dsa_engine` schema；保留现有 ORM 表结构与依赖，显式迁移 33 张表，运行时只检查而不 create_all。该 schema 对 anon/authenticated 无访问权限。原 CLI 默认仍用 SQLite。

## 配置与启动

先在独立测试环境按顺序应用以下新增迁移，已有第一个迁移不重复运行：

1. `supabase/migrations/202609140001_cloud_reports.sql`（既有基础）。
2. `supabase/migrations/202609180001_cloud_runner.sql`（执行协议）。
3. `supabase/migrations/202609180002_cloud_engine.sql`（私有引擎存储）。
4. `supabase/migrations/202609200001_cloud_market_review.sql`（扩展单市场大盘复盘）。
5. `supabase/migrations/202609200002_cloud_composite.sql`（综合分析快照、业务结果摘要、私有历史类型字段扩宽）。
6. `supabase/migrations/202609200003_cloud_daily_actions.sql`（可选每日 Actions 原子接入；沿用原快照和发布协议）。

迁移只新增，不接管同名已有 schema，不删除恢复项目或正式项目中的历史。私有 schema 应由可信数据库连接使用，不能添加到 Supabase 的 exposed schemas。运行凭据需要该私有 schema 的 DML/sequence 权限；建表凭据仅在迁移时使用。迁移本身不向浏览器角色授予这些权限。

本地安装原 Python 依赖，并安装额外 Postgres 驱动：

```bash
pip install -r requirements.txt -r requirements-runner.txt
python main.py --runner
```

必须配置：

| 变量 | 用途 |
| --- | --- |
| `SUPABASE_URL`、`SUPABASE_SECRET_KEY` | 可信 Runner 的云端 RPC/Storage 访问 |
| `SUPABASE_PUBLISH_USER_ID` | 唯一执行账号；必须是有效成员 |
| `CLOUD_RUNNER_DATABASE_URL` | `postgresql+psycopg` Session pooler URI，显式 `sslmode=verify-full` 与 CA；密码须 URL 编码 |
| `CLOUD_RUNNER_ID` | 默认 `local-primary`；Runner 与 Vercel 必须相同 |
| `CLOUD_RUNNER_HEARTBEAT_SECONDS` | 默认 15，必须小于在线阈值的一半 |
| `CLOUD_RUNNER_ONLINE_SECONDS` | 默认 60，数据库限制 15～300 |
| `CLOUD_RUNNER_CLAIM_SECONDS` | 默认 30；限制 5～120 且不超过在线阈值 |
| `CLOUD_RUNNER_POLL_SECONDS` | 默认 3，必须小于领取期限 |
| 原模型、行情、搜索配置 | 继续使用本地受保护 `.env`；本阶段不支持从网页编辑密钥 |

`SUPABASE_PUBLISH_ENABLED` 控制旧 CLI 的可选发布，不是 Runner 启用开关。Runner 显式执行并发布；`ENABLE_ACTIONS_DISPATCH` 继续为 false。`--runner` 在本地 Web 和调度启动前返回；无需启动前端开发服务器。停止使用 Ctrl+C，正常退出会主动离线，异常断电按心跳期限判断。

Vercel 服务端配置 `SUPABASE_URL`、`SUPABASE_SECRET_KEY`、`SUPABASE_PUBLISH_USER_ID`、`CLOUD_RUNNER_ID`。公开浏览器变量仍只有 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`。这些服务端密钥绝不能加 `VITE_` 前缀。Preview 使用测试项目，Production 保留正式项目；先验收 Preview 再切换。

## 大盘复盘

从单股版升级时，先停止旧 Runner，再应用新增迁移、更新 Runner 代码并部署匹配的前端/API；不要让只认识单股的旧 Runner 领取大盘任务。

网页选择“大盘复盘”和一个市场即可提交，不需要股票代码。复用 CLI/API 的 `build_market_review_runtime` 与 `run_market_review`；本模式禁止额外通知和本地报告文件，原入口的默认行为不变。引擎历史以任务 ID、MARKET、market_review 保存到私有 schema，确认保存后才进入统一报告发布。报告附件和任务状态仍按原用户隔离。

每次只接受一个市场；原 CLI/API 的多市场能力保留。非交易日手动复盘沿用引擎可获得的数据，不代表当日实时行情。若没有成功的模型生成记录，公开报告和摘要明确标注模板降级；“任务成功”表示结果已保存，并不保证所有数据源或模型均成功。

## 综合分析

网页选择“综合分析”和复盘市场；服务端在提交事务中读取当前用户全部云端自选股，按顺序固定代码和快照。复盘市场只控制大盘部分，不过滤自选股市场。客户端不能传入股票列表；空自选股或超过任务记录大小上限（65,536 字节）会明确拒绝，不能创建空任务。同一请求重试返回原任务和原快照，之后修改自选股不改变任务内容。

执行复用 `CompositeAnalysisService`。云端仅一个股票工作线程，关闭本地报告文件、额外通知和旧 CLI 发布。每个成功个股的 query_id 都必须对应已保存历史，组合历史保留 `stock_query_ids` 便于追踪；未保存的子项计入失败，数据库查询异常不会被进度回调吞掉。大盘历史同样校验，最终 COMPOSITE 历史保存后才进入发布。失联后尚未开始的股票不再调用引擎；已经开始的外部调用不会被强杀。

`execution_tasks.status=succeeded` 表示报告发布完成；业务是否完整由同事务保存的 `result_summary.outcome=completed/partial` 区分，包含成功数、失败数、失败股票代码、大盘状态。页面和报告明确显示部分完成，缺失结果摘要显示“结果待确认”，不会冒充全部完成。全部股票与大盘均失败时任务失败，不发布成功报告。模板降级继续明确标注。

发布包带有同一业务摘要，上传重试复用包，不重跑模型；读取恢复包还会校验内容摘要、所有者和当前任务关联。回滚到旧 Runner 前必须停止新任务提交；旧进程不认识综合任务。历史类型字段扩宽只在新增云端迁移中执行，不对本地 SQLite 做破坏性迁移。

## 测试与故障处理

- 离线登录后仍可浏览历史、自选股与下载；分析按钮不可用，直接 POST 返回 `RUNNER_OFFLINE` 且不插入任务。接口配置缺失、网络失败或身份无权时同样禁止执行。
- API 使用 Auth 服务验证令牌和指定所有者，不信任请求体 user_id。任务 RPC 只授予 service_role；普通用户只能在 RLS 下读本人执行记录。
- 请求 ID 保证同一次提交重试不重复执行；同 ID 不同输入拒绝。单股输入仅允许股票代码；大盘复盘输入仅允许 cn/hk/us/jp/kr 中一个 region，不允许浏览器注入模型密钥或本地路径。
- 本地 `<LOG_DIR>/cloud-runner-packages` 中的包为私有发布恢复材料，非第二业务主库。发布失败先查任务/报告是否已成功，再显式使用既有发布工具恢复；不重新提交分析来修复上传故障。若任务已终止，手动导入包只补报告，不谎称旧执行成功。
- 长任务时断网、杀进程、替换会话、延迟提交、重复完成均需测试。模型和行情真实调用与模拟测试分别记录。

后端测试应在不含真实 `.env`、历史数据库和报告的隔离副本中执行 `scripts/ci_gate.sh`；前端执行 `npm ci`、`npm run test:cloud`、`npm run lint`、`npm run build`、`npm run build:cloud`。UI 截图存放仓库外。

## 回滚与限制

回滚 Vercel 至原报告阅读部署、停止 Runner 即可停用新执行功能。原 CLI/桌面端保留；不要为回滚删除新增表、报告或 SQLite 备份。已经写入云端的数据留存，旧 SQLite 不双向同步。

本轮并未完成选股、回测与问股、聊天页面云端历史、旧 SQLite 一次性导入或 Docker Runner 启动服务。功能是否已在真实平台验证以 [Runner 验证记录](local-runner-validation.md) 为准，不使用旧报告站验收替代。此中文专题无对应英文文档，未修改 README。

## 工作台与分析记录

首页左侧展示自选股，右侧发起分析并查看记录；添加／编辑自选股与修改密码按需打开弹窗。个股、大盘、综合分析通过页签切换，保留离线保护与重试。发起分析区域不再重复展示近期执行记录，保留当前任务进度及错误反馈；历史报告集中在分析记录表。最近连接使用较小字号，综合分析提交前不再展示快照提示，其服务端快照行为不变。

分析记录只保留报告名称、来源、状态、时间、操作五列。个股名称优先使用报告保存时的股票名称，旧记录缺少名称时显示代码，不添加“个股分析”前缀，也不根据后来编辑的自选股改写历史报告名称。综合分析与大盘报告使用对应类型名。

“已完成”与“部分完成”均表示报告已经保存；缺少可信执行摘要时只显示“已保存”。保存中、保存失败和已取消单独显示，成功任务缺少报告或执行摘要冲突时提示异常，不伪装全部成功。时间仅显示日期和时分；分页按任务更新时间倒序，报告存在时显示报告生成时间，否则显示状态更新时间。

操作提供查看、私有下载与删除。删除经确认后移入回收站，可恢复，不自动清空、不永久删除报告或附件。只有当前已启用账户可以操作自己的记录；保存中或关联执行仍进行中的记录不能删除。回收站记录不出现在正常列表和计数中；其本人报告深链与私有下载仍可用，当前任务的报告入口会提示报告在回收站。存储使用量不会因移入回收站而减少。

从之前版本升级需先应用增量迁移 `supabase/migrations/202609210001_cloud_report_trash.sql`，再部署新前端。它增加删除标记及受限 RPC，保护发布重试与删除的互斥，原发布工具、CLI 和分析引擎无需更改。无新增环境变量。数据库测试见 `supabase/tests/cloud_report_trash.sql`（恢复项目、事务回滚）；浏览器及真实平台证据见 [验收记录](local-runner-validation.md)。

回滚前端至上一版部署时保留迁移和所有数据；旧版不理解删除标记，可能重新显示回收站记录，这是展示兼容性差异，不能通过删除数据库表来回滚。此中文专题没有对应英文版本，未修改 README。
