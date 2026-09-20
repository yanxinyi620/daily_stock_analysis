# daily_stock_analysis 云端 Web 改造实施说明（给 Codex）

> **历史方案 / 后续开发已弃用（2026-09-18）。** 后续以 [当前 Runner 方案](deployment/vercel-supabase-plan.md) 为准。原文保留供追溯，不再据此建设多人使用或网页 Actions 投递。此标记不否定已完成的报告发布与隔离能力。

版本：v0.1  
整理日期：2026-09-14  
目标技术栈：Vercel + Supabase Postgres / Auth / Storage + GitHub Actions  
建议正式域名：`stock.xinyilab.top`

## 0. 任务背景与执行要求

请在 daily_stock_analysis 的真实仓库中进行增量改造。先阅读 AGENTS.md、README、依赖、现有前后端、持久化和 GitHub Actions 工作流，完成简短审计，再分阶段实施和测试。本文不是仓库审计结果，不能把下文示例目录、接口或表名当作仓库现状。

使用规模按“我自己 + 1～2 位朋友、非商业、低频使用”设计。预算以免费层优先，不擅自开通付费资源。正式子域名暂定 stock.xinyilab.top；保留 xinyilab.top 当前的腾讯云注册商和 Cloudflare DNS/NS，不影响既有 CruxSet 域名与服务。

保留现有 Python 分析引擎、命令行使用方式、已有测试，以及实际存在的行情源、模型配置、通知和报告能力。不要为了上云把 Python 分析逻辑重写为 TypeScript，不要把完整分析引擎搬进 Vercel Functions。

### 必须先处理的 Actions 使用边界

公开仓库标准运行器免费，不等于 GitHub Actions 可作为不限用途的生产计算平台。GitHub 当前附加条款对无关软件项目生产、测试、部署、发布的托管运行器使用及作为 serverless 应用的使用设有限制。[1]

因此，第一阶段不新增“真实用户点击网页 → 自动占用 GitHub-hosted runner 分析”的线上能力。保留既有工作流文件、审查并记录其用途，不因已有工作流就认定其使用获得许可，也不要未经批准修改或扩展其生产调度。Actions 可继续承担明确适用的构建、测试和部署等工作。

先实现平台无关的 Python 结果发布能力，本地 CLI 能直接完成“分析 → 发布 Supabase”；只需轻量执行适配层，不建设通用调度平台。自动投递 Actions 的代码作为第二阶段可选功能，`ENABLE_ACTIONS_DISPATCH=false` 为默认值。真实启用前，需要核实具体用途是否符合 GitHub 规则；必要时向 GitHub 确认。不适用时替换执行环境，而不是把生产任务改名成测试、仅加限流或改用付费运行器来规避规则。

## 1. 推荐职责划分

| 组件 | 本次职责 | 不负责 |
|---|---|---|
| Vercel | 现有前端、少量鉴权后的轻量 API、未来受控任务提交 | 长时间 Python 分析、常驻队列消费者 |
| Supabase Auth | 登录、会话和用户身份 | 自行重新实现密码哈希、session 数据库 |
| Supabase Postgres | 自选股、任务状态、报告索引与必要结构化结果 | 全市场高频行情仓库、大文件 |
| Supabase Storage | 私有报告附件、图表等已有产物 | 公开暴露私人报告 |
| Python 引擎 | 复用现有行情、分析、模型调用、报告生成 | 耦合 Vercel 请求生命周期 |
| GitHub Actions | 构建、测试、部署和经核实允许的项目自动化 | 默认承担面向真实用户的通用生产任务后端 |
| Cloudflare | 此子域名的权威 DNS 管理 | 此站点的反向代理与额外 CDN |

建议链路：

```text
浏览器 → stock.xinyilab.top → Vercel Web / 轻量 API
                               │
                               ▼
                    Supabase Auth / Postgres / 私有 Storage
                               ▲
                               │ 发布结果
                        现有 Python 分析引擎
                          ├─ 本地 CLI
                          └─ 经核实适用的工作流/执行环境
```

保留当前前端技术栈。已有 Vite/React 就沿用；已有 Next.js 就沿用；没有可复用前端时再选择最小实现。不要仅因为部署到 Vercel 就迁移到 Next.js。隔离 Web 和计算端依赖，避免前端部署安装整个科学计算环境。

## 2. 先做仓库审计

输出一份简短现状报告：实际前端框架、构建/部署目录、API 清单、Python 分析入口、数据库和文件落点、当前工作流触发条件、现有通知、环境变量名称和测试结果。区分“确认存在”和“需新增”，不打印任何密钥值。

识别当前工作区未提交改动，不覆盖用户修改。运行能运行的基线测试。只增加必要抽象，不复制第二套分析引擎或业务逻辑。已有 FastAPI 可以保留用于本地/旧模式；线上先迁移需要的轻量能力，不以删除 FastAPI 为目标。

线上新增业务数据以 Supabase 为唯一权威来源；旧本地文件/SQLite 可保留为旧模式、缓存或测试数据，不建立长期双主同步。历史报告有必要时提供显式导入命令，支持 dry-run、重复执行去重、明确归属用户；不自动清空或全量覆盖云端。

## 3. 第一阶段功能与数据

第一阶段完成：登录/退出、查看和维护自己的自选股、查看报告列表与详情、查看真实发布任务状态、下载已有附件。先不用 Realtime，不做公开注册、支付、复杂团队、实时行情订阅、新增 PDF 渲染或全面改版。

### 3.1 数据表

以下为建议实体，请结合现有模型映射，表名不强制：

| 实体 | 建议内容 |
|---|---|
| `watchlists` | 用户、市场与股票标识、展示名称、排序和创建时间 |
| `analysis_tasks` | UUID、归属用户、输入快照、状态、幂等键、执行来源/运行 ID、起止与更新时间、脱敏错误 |
| `analysis_reports` | 关联任务、摘要、必要 JSON 结果、产物版本、附件对象路径、行情截至时间、生成时间 |
| `app_members`（需要应用准入控制时） | 允许访问的用户、启用状态及必要管理权限；禁止普通用户写入 |

股票标识沿用项目原有规范，不把带前导零的股票代码转换为整数。自选股建立用户 + 市场 + 股票唯一约束；任务/报告建立幂等与关联约束，报告与其任务必须保持同一归属。为用户 + 创建时间、任务状态等实际查询路径添加索引。时间持久化统一使用带时区时间戳，展示和调度时区明确配置，保留现有交易日规则。

用版本化 SQL migrations 管理表、约束、索引、授权和 RLS。不要只在控制台手工建表而不提交迁移。新增独立迁移，不随意修改已应用迁移。

### 3.2 身份与权限

使用 Supabase Auth，第一版采用邮箱密码登录，由项目所有者在控制台或受信任管理脚本中预创建少量应用用户，不开放匿名/公开注册。朋友是应用用户，不需要成为 Vercel、Supabase、GitHub 平台管理员。

初期不依赖邮件邀请、验证码或密码找回完成主流程。Supabase 默认邮件服务只向项目团队预授权地址发送并有严格限流，不能假设能直接给任意朋友发邮件。[3] 管理脚本可通过官方 admin createUser 建立已确认账户，但只能在受信任环境运行；临时密码不进入仓库/日志，安全交付并提供修改密码方式。[4] 后续邮件功能另配 SMTP。

所有对 Data API 暴露的业务表启用 RLS 并配置最小 grants。[5] 默认仅能读写本人自选股、读取本人任务/报告；不自动把所有报告共享给全部用户。普通用户不能修改任务归属、运行状态、结果、成员启用状态或管理员权限。不要把客户端可修改的 user_metadata 当作权限依据。

Vercel 对需密钥的操作验证真实用户身份，并再次检查成员资格和资源归属；不能只解码 JWT，不能信任请求体里的 user_id。即使服务端使用高权限 Secret Key，也必须显式做这些检查，因为该 key 绕过 RLS。[6]

### 3.3 附件

创建 private bucket，例如 `analysis-reports`。建议对象路径为 `<user_uuid>/<task_id>/<filename>`，但路径本身不是授权；还要用 Storage RLS 验证所有权。[7]

只上传已存在且必要的产物，不为了改造额外制造一套 HTML/PDF/图片。优先用结构化数据或安全渲染的 Markdown 展示，禁止未净化的 LLM HTML 执行脚本。

数据库保存 bucket/object path，不保存过期签名 URL。下载时使用带身份的请求或短期签名 URL；签名 URL 过期前持有者可访问，勿打印到公开日志。[8]

## 4. Python 发布与前端接入

在现有分析完成出口增加一个小型结果发布模块，而非另写分析引擎：

```text
复用现有分析函数
  → 生成统一结果
  → 上传必要附件
  → 写报告记录并更新任务结果
  → 保留原有通知/输出行为
```

发布模块提供关闭开关和明确错误，不配置 Supabase 时原有本地模式仍可运行。线上模式缺配置应明确报错，不静默切换本地数据库。

同一任务重复发布不能制造重复报告。文件上传与数据库提交不是一个分布式事务：先确认必要文件就绪，再在数据库事务/RPC 中保存报告并更新成功状态；失败要能重试发布、清理孤立文件，避免仅因上传失败就重新调用付费模型。

常规查询/自选股可通过统一前端数据访问层调用 Supabase SDK，并由 RLS 保护。涉及 GitHub token、任务调度、管理等逻辑才放 Vercel 服务端，尽量保持现有 UI 与调用契约。不要机械地给全部 Supabase API 再加一层 Vercel 代理。

报告列表分页，默认一页 20 条可配置；详情按需加载。仅有未完成任务时轮询状态，建议从 5 秒开始、失败后退避、后台页面暂停、终态停止。第一阶段不依赖 Realtime。

新报告写入 Supabase 后，通过正常刷新/查询即可出现，不需要 git commit、重新构建或重新发布前端。

## 5. 第二阶段：受控异步任务（默认不开启）

在规则和执行环境适用性明确后再接入真实投递。第一阶段可以完成接口契约和 mock 测试，但不要假装线上任务已经可用。

建议流程：

```text
POST /api/tasks
  → 验证身份、成员资格、输入、幂等和额度
  → 持久化 pending 任务
  → 受控执行适配层投递
  → 返回 202 + task_id，不等待分析完成
  → Python 原子认领任务、读取可信输入、运行并回写结果
```

默认关闭时 UI 不提供“立即分析”，API 明确拒绝且不留下无人消费的任务。任务执行接口不要与 GitHub 深度绑定。

状态可使用 `pending → queued → running → succeeded / failed / cancelled / timed_out`，并记录派发是否确认。派发请求超时属于结果不确定，不能自动无限重发；需可核对。工作流开始时回写实际 run ID，不只依赖前端派发结果。

最低可靠性要求：数据库原子认领与幂等保护；并发下额度检查一致；同一任务不重复启动；已完成状态不被迟到回调覆盖；超时/取消等可核对。不能仅靠 `finally` 或 workflow `always()` 保证硬终止后回写。提供管理员核对/修复命令，不必新增高频常驻巡检服务。

建议初始可配置限制：每次提交 1 只股票、每人最多 1 个未完成任务、每人每天最多 5 次网页请求。全局并发根据现有分析耗时和模型预算确定。以上是成本保护默认值，不是平台官方额度，也不是合规保证。不把 GitHub concurrency 当作可靠的业务队列。

如采用 GitHub workflow_dispatch：token 限定本仓库 `Actions: write`；owner/repo/workflow/ref 由服务端固定；浏览器不得指定任意 ref、命令、模型端点或密钥。[9] 优先只传不敏感的 task_id，Python 再读取服务端保存的任务参数，不直接把不可信输入拼进 shell。按当前 GitHub API 文档设置版本并处理响应，不复制陈旧示例假设。

## 6. 密钥、工作流与成本保护

| 位置 | 允许的配置 |
|---|---|
| 浏览器 | Supabase URL、Publishable Key、公开站点 URL |
| Vercel 服务端 | 必要时使用 Supabase Secret Key；启用受控投递后才配置本仓库 GitHub token |
| 可信 Python 执行环境 | Supabase 写入凭据、现有 LLM/行情等密钥 |
| 本地迁移环境 | 单独管理的数据库/CLI 凭据，不打包到 Web |

前端公开前缀按真实框架选择 `VITE_*` 或 `NEXT_PUBLIC_*`。Supabase Secret Key、GitHub token、LLM key 不得使用公开前缀。[6] 初期少量可信发布流程可以采用服务端 Secret Key，但必须说明其是项目级高权限，不应声称是表级最小权限。按环境分开、可轮换。

提交 `.env.example` 但只写变量名和占位；实际密钥只在平台 Secret 或本地忽略文件里。没有密钥时完成 mock/单测/构建并列出真实联调缺项，不得声称远端成功。

需要密钥的工作流仅运行受信任代码；不允许 fork PR、不可信 checkout 或未经审查的依赖步骤拿到生产密钥。不用 pull_request_target 执行不可信代码。[10]

公开仓库不等于业务数据应公开：工作流日志/输出、缓存、产物不能包含私人自选股、完整报告、邮箱、token 或签名下载地址；只保留必要脱敏诊断信息。不要自动将报告 commit 回仓库。

设置合理的 workflow 超时、缓存必要依赖，避免重复安装/重复分析浪费；缓存不是持久化数据库。已有合法定时工作流需记录真实时区、默认分支行为及调度延迟；公共仓库长期无活动时定时工作流可能被关闭，不能把它当强准点服务。[11]

第一阶段不自动升级 Vercel/Supabase，不增加付费自定义 Supabase 域名、付费备份/分支。Vercel Hobby 限个人非商业用途。[2] Supabase Free 有 500 MB 数据库、1 GB 文件存储、流量限制，闲置可能暂停，且不含自动备份；应提供数据库与对象文件分别导出的恢复说明，而不是把源码仓库当数据备份。[12]

不要长期存储全量分钟行情、搜索原始结果、大量中间图或完整 LLM 交互。提供清理命令与 dry-run；不默认删除已有历史数据。LLM、行情、搜索等外部 API 费用独立于基础设施免费额度。

## 7. Vercel、域名与环境

Vercel 连接现有 GitHub 仓库，Root Directory、构建与输出目录按真实前端确定。生产分支由仓库现状决定，不强行重命名。代码部署与分析结果发布分开。

Production 使用正式 Supabase 项目；Preview/Development 使用隔离的测试项目、本地 Supabase 或 mock，不自动配置生产 Secret Key。没有安全测试环境就禁用写操作和真实任务，不默认让每个 Preview 操作生产数据。[13]

域名按以下步骤配置：

1. Vercel 项目添加 `stock.xinyilab.top`。
2. Cloudflare 增加 `stock` 对应的 CNAME，target 以 Vercel 当前项目页面实际给出的值为准；按要求增加验证 TXT。[14]
3. 该记录设置为 DNS only（灰云），由 Vercel 承接 HTTPS；不修改根域 NS 和其他项目记录，不叠加 Cloudflare 反向代理。[15]
4. Supabase 使用默认项目域名，Site URL 为 `https://stock.xinyilab.top`；Redirect URLs 仅允许实际实现的精确生产回调路径及必要本地测试地址，不照抄 `/**` 或放行所有 Vercel 预览域名。[16]

选择当前套餐支持的相近 Vercel/Supabase 区域。上线前分别测页面、Supabase Auth、Data API、Storage 的无代理手机/电脑访问；页面域名可访问不代表全部链路可用。不要承诺此组合天然改善中国大陆访问体验，也不要未经测试全面增加代理层。

## 8. 分阶段实施与验收

| 阶段 | 完成条件 |
|---|---|
| A：审计与基线 | 明确复用范围、真实入口、风险、既有测试及阶段计划 |
| B：云端数据闭环 | migrations + RLS + private bucket；本地 Python 产生一份测试报告并幂等发布 |
| C：Web MVP | 登录、自选股、报告列表/详情/下载、权限测试；Vercel 构建通过 |
| D：部署联调 | 人工完成必要平台配置后，验证正式域名与真实 Auth/DB/Storage 链路 |
| E：可选受控任务 | 用途确认后才启用；未启用时接口关闭、mock 测试通过、不阻塞前四阶段 |

必要验收：

- 现有 CLI/分析行为不因新增部署模式失效。
- 两个应用用户互相不能通过 UI、直接 Data API 或文件路径读取/修改对方数据；匿名请求同样被拒绝。
- 浏览器无法修改 task status、user_id 或管理员权限，无法越过 API 限额直接创建执行任务。
- 发布一次报告后页面可见，无需重新部署；重复发布不重复建报告。
- 发布失败与模型失败区分，旧报告仍可读；未配置密钥/执行器时明确关闭而非永久 queued。
- 真实投递启用后覆盖重复点击、派发结果不确定、runner 启动失败/硬终止、超时/重试、晚到回写等场景。
- 前端产物、日志、测试快照、Actions 产物中没有真实密钥和私人业务数据。
- 深链接刷新、会话刷新和私有附件过期访问符合预期；跨用户缓存隔离。
- 未经许可不开通付费、不删历史数据、不修改 CruxSet DNS、不擅自执行破坏性生产迁移。

交付内容：代码修改、SQL migrations、测试、`.env.example`、简短架构说明、部署配置步骤、账号建立流程、备份/导入/恢复步骤、需要我在平台手动完成的清单。

最终报告区分“本地已验证”“远端已验证”“未验证/阻塞”，列出测试命令与结果。先尽可能完成无需外部权限的实施与测试，不因缺少云端 Secret 就只停留在口头建议。涉及创建资源、真实计费模型测试、生产部署和数据迁移，遵守现有权限与审批要求。

**本次核心：保留分析能力，先打通云端报告与账号，再决定如何接入受控异步执行；不从零重写项目，不把免费额度当作长期生产可用性承诺。**

---

## 官方核对资料（2026-09-14）

[1] GitHub 附加产品条款，Actions 使用范围： https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#actions

[2] Vercel Hobby： https://vercel.com/docs/plans/hobby

[3] Supabase 默认邮件/SMTP 限制： https://supabase.com/docs/guides/auth/auth-smtp

[4] Supabase admin createUser： https://supabase.com/docs/reference/javascript/auth-admin-createuser

[5] Supabase Data API 安全与 RLS： https://supabase.com/docs/guides/api/securing-your-api ； https://supabase.com/docs/guides/database/postgres/row-level-security

[6] Supabase API Keys： https://supabase.com/docs/guides/getting-started/api-keys

[7] Supabase Storage 访问控制： https://supabase.com/docs/guides/storage/security/access-control

[8] Supabase 私有文件访问： https://supabase.com/docs/guides/storage/serving/downloads

[9] GitHub workflow_dispatch REST API： https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event

[10] GitHub Secrets： https://docs.github.com/en/actions/concepts/security/secrets

[11] GitHub schedule： https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule

[12] Supabase Free 资源、暂停和备份： https://supabase.com/pricing

[13] Vercel 环境隔离： https://vercel.com/docs/deployments/environments

[14] Vercel 自定义域名： https://vercel.com/docs/domains/working-with-domains/add-a-domain

[15] Vercel 对 Cloudflare 反向代理的说明： https://vercel.com/kb/guide/cloudflare-with-vercel

[16] Supabase Auth 重定向： https://supabase.com/docs/guides/auth/redirect-urls
