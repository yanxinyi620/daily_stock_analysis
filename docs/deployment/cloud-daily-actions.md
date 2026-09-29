# 每日 Actions 云端综合分析

本专题延续[本地 Runner 方案](local-runner.md)：网页交互由本地 Runner 执行；每日综合分析由 GitHub 托管执行器独立完成。两个入口使用同一 Python 分析引擎和 Supabase 持久化，日报只归 `SUPABASE_PUBLISH_USER_ID` 指定的主账号，普通账号不可读取。

## 工作流与开关

复用 `.github/workflows/00-daily-analysis.yml`。手动选择 `cloud-full` 运行云端综合分析；仓库变量 `CLOUD_DAILY_ENABLED=true` 才将定时触发切换到云端模式。未启用时保留原 `full / market-only / stocks-only` 行为。网页 `ENABLE_ACTIONS_DISPATCH` 仍为 false。

原定时时间为周一至周五北京时间 18:00，默认使用 A 股交易日历；Python 再判断节假日。单市场 `MARKET_REVIEW_REGION` 必须明确配置，本轮正式部署为 `cn`。若改为美股等市场，需要另行调整收盘后运行时间，不能直接沿用 18:00 宣称当日收盘复盘。

日报使用独立执行身份，不使网页的 `local-primary` Runner 变为在线。报告可在本地电脑关闭时生成及查看。提交时读取主账号当前云端自选股并固定快照；空列表明确失败，不回退到工作流默认股票。相同日期、用户和市场的重复运行不会重新调用模型；强制运行仅跳过交易日检查，不绕过去重。

首次部署需按现有迁移顺序补齐 `supabase/migrations/202609200003_cloud_daily_actions.sql`。此迁移只增加 service_role 专用入口，复用原会话与快照函数；不修改旧迁移，不删除数据。

## GitHub 配置

仓库 Actions Secrets：

- `SUPABASE_URL`、`SUPABASE_SECRET_KEY`、`SUPABASE_PUBLISH_USER_ID`：正式项目及主账号。
- `CLOUD_RUNNER_DATABASE_URL`：密码已 URL 编码的 `postgresql+psycopg` Session pooler URI；不包含本机证书路径。
- `CLOUD_RUNNER_CA_CERT`：Supabase 数据库 CA 的 PEM 内容。工作流在临时目录写入权限 0600 的证书，强制使用 `verify-full`。
- 原网络模型、行情和搜索配置：沿用工作流已有变量入口，不依赖本地 Codex CLI 或本地 `.env`。模型令牌通过 Secrets 配置。

仓库 Actions Variables：`CLOUD_DAILY_ENABLED`（默认 false）、`MARKET_REVIEW_REGION`、`ANALYSIS_TIMEOUT_MINUTES`。超时由工作流终止；不无限等待，不在失败后自动重跑收费分析。

云端模式不上传报告、私有重试包或引擎日志为 GitHub artifact，也不在结束步骤输出日志尾部；已有本地模式的 artifact 行为保持不变。所有通知关闭，报告在登录后的正式站点读取。

## 验收与回滚

先运行离线 Python/数据库/工作流检查，再在 GitHub 手动选择 `cloud-full`。验证任务最终状态、私有历史、公开业务表中的用户归属及私有 Storage 下载；用另一个账号确认不可见。非交易日可显式强制一次验证，不能把该结果当作交易日实时行情。

真实验收通过后再设置 `CLOUD_DAILY_ENABLED=true`。只需停用整个每日工作流即可停止自动执行；设回 false 会恢复旧定时分析路径，不能用它表示“停掉所有任务”。回滚保留任务、历史和报告，不删除云端数据。浏览器端无需为此部署新 UI。

## 2026-09-20 实施与验证状态

- 代码已提交并推送至 GitHub `main`、`dev`：功能提交 `22023172`，整合基线 `a366e83c`。
- 81 项 Python 相关测试、65 项云端测试通过；Web lint 无错误（已有 MobileChatPage Hook 警告 1 条），云端构建通过。本轮未重跑完整后端 gate 或 Docker 构建。
- 日报迁移已应用恢复项目及正式项目，既有执行记录、报告、自选股、成员和引擎历史摘要保持一致。迁移 SHA256：`a440973f1c1c8a02d4f28915a608d45699e76f3ca6bb0ab0c41a049db099595d`。
- GitHub 正式项目的云端数据库、CA、主账号和网络模型 Secrets 已配置；没有上传本地 CLI 登录凭据或通知凭据。交易市场配置为 cn，工作流时间预算为 60 分钟。
- [真实 GitHub Actions 验证](https://github.com/yanxinyi620/daily_stock_analysis/actions/runs/35497340161) 成功：依赖安装、证书设置、脚本入口均通过；周日按日历跳过，没有生成每日执行任务；报告 artifact 和日志尾部输出步骤均跳过。
- 正式 `local-primary` Runner 已于本次工作中启动并验证心跳在线；它是当前本机进程，不是开机自启服务。进程信息与私有日志位于忽略目录 `.cloud-publish/`，不入库。关闭本机或停止进程后网页恢复离线拒绝；日报 Actions 不依赖它。
- **未完成真实模型日报验收**：正式主账号自选股为空，已请求用户选择验收股票或自行添加。尚未创建验收自选股、触发收费模型分析或启用 `CLOUD_DAILY_ENABLED`。跨市场、大规模、多股和 Actions 中断后的人工恢复未远端验证。
- 下一步：确认自选股后，手动 `cloud-full + force_run` 验收一份日报，检查 A 可见/B 不可见及重复运行不重算；通过后启用云端定时变量。

中文专题暂无英文对应页，本次未扩展 README。报告来源页面不变，本轮无新 UI 截图要求。

验收等待期间，整个每日工作流已设为 `disabled_manually`，避免 `CLOUD_DAILY_ENABLED=false` 时仍执行旧默认股票任务。确认验收股票后先恢复工作流，手动验收通过再启用云端定时模式。

## 2026-09-20 真实日报验收与启用

用户授权添加 `000001` 后，已将平安银行加入正式 A 账号的自选股，保留该条目和所有验收报告。

- 首次 GitHub 实际分析运行：`35499195787`，当时查询到 completed/success；正式任务 `42a3bbeb-61a1-4c94-a792-afa6eebe91d4` 于 `08:19:47 UTC` 创建、`08:29:17 UTC` 完成，约 9 分 30 秒。
- [正式日报](https://stock.xinyilab.top/reports/05dba9ec-6cd3-52a5-b379-4535aac6fc7c)：1 支股票完成、0 支失败，大盘完成；业务摘要 outcome=completed，报告 4788 字符，无模板降级提示。
- 独立数据库连接确认个股、大盘和综合历史均已持久化。真实 A/B 登录验证确认 A 可读取任务、报告、私有附件；B 不可读取同一数据。正式浏览器验证报告深链、刷新和 Markdown 下载通过。
- 使用真实正式 Supabase 重复调用同日入口，在故意不提供引擎数据库/模型配置的情况下直接返回成功；任务、完成时间、报告及子项/综合历史数量保持不变，验证未重新运行分析引擎。
- 另发起了 GitHub 自身的重跑验证，但平台状态尚未确认：查询持续返回 queued/run_attempt=1 且无 jobs，取消请求却返回“Cannot cancel a workflow run that is completed”。**不声称该额外 GitHub 重跑通过或已取消**，也不使用它替代上述真实入口去重证据。
- 已核对仓库变量 `CLOUD_DAILY_ENABLED=true`，每日工作流 state=active；沿用周一至周五北京时间 18:00 的计划触发，cn 交易日历过滤节假日。网页 Actions 投递仍关闭，日报归属 A。
- 本次是周日强制验收，行情沿用可获得的数据，不代表周日存在实时交易。尚未观察下一次自然定时触发；多股、跨市场、真实部分失败和中断恢复仍不属于本次远端通过结论。

证据（仓库外）：`/tmp/dsa-daily-verification.json`、`/tmp/dsa-daily-before-retry.json`、`/tmp/dsa-daily-browser.log`、`/tmp/dsa-daily-live-report.png`。本轮为平台配置/数据验收及文档更新，无新代码修改；未重复运行代码回归测试。

## 2026-09-27 自然调度复核与过期任务收尾

本节更新上述历史验收缺口，不表示重新执行了模型分析。本节结论仅使用显式指定 `yanxinyi620/daily_stock_analysis` 的 GitHub 查询，避免将 fork 的 CLI 默认上游结果误作本仓库证据。

- 正式工作流仍为 `active`，`CLOUD_DAILY_ENABLED=true`。9 月 21～25 日均有自然 `schedule` 触发；其中 24 日失败，不能将平台运行成功一概等同于生成新日报。
- [9 月 23 日运行](https://github.com/yanxinyi620/daily_stock_analysis/actions/runs/35876167726) 对应执行 `6ce70463-0206-42c6-bee5-7e6470d55424`，已从正式数据库核对 `outcome=completed`、3 股成功、0 股失败、大盘完成及报告 `451b3dfb-fa25-5517-a5d2-7ccf3be61745`。正文 7514 字符，可信服务端读取私有附件 HTTP 200、14171 字节，与正文 UTF-8 字节完全一致；本次未用用户会话重新验证下载权限。多股自然调度的成功路径已有真实证据。
- [9 月 21 日运行](https://github.com/yanxinyi620/daily_stock_analysis/actions/runs/35623348126) 延迟至 UTC 16:05（北京时间次日 00:05）启动，业务按市场当前日期生成 9 月 22 日任务；22 日再次触发没有新增任务。现有实现按实际执行日去重，不能承诺每个计划日期都生成独立日报，也不能将北京时间 18:00 视为准时执行保证。
- [9 月 25 日运行](https://github.com/yanxinyi620/daily_stock_analysis/actions/runs/36151220437) 成功但没有新增云端任务；日志仅报告 `completed or skipped`。本地使用现有交易日历确认 9 月 25 日不是 CN 交易日，结合数据库记录判断此次为跳过，不能作为失败后的分析恢复证据。
- [9 月 24 日失败](https://github.com/yanxinyi620/daily_stock_analysis/actions/runs/36014222447) 发生于“执行股票分析”步骤，退出码 1。正式任务 `b8c90934-c46f-4057-b67c-2681188a2d2f` 停在 41%，最后心跳 UTC 14:47:02、租约 UTC 14:48:02 到期。公开日志仅提示查看私有日志；现有云端模式不上传该日志，无法据现存证据确定导致心跳停止及分析失败的底层原因。
- 过期任务仍显示 `running` 的原因已核对：清理依赖同一 Runner 的 snapshot/register/submit 等 RPC；非交易日会在调用这些 RPC 前返回。本次通过既有 `cloud_runner_snapshot` 核对 `github-actions-daily`，使任务按既有租约规则进入 `failed / RUNNER_OFFLINE`，并清空 `current_task_id`。前后执行 ID 集合、报告 ID 集合和自选股内容一致，没有重跑、发布或删除报告。该操作只收尾状态，不恢复丢失的分析结果。

证据保存在仓库外 `/tmp/dsa-validation-20260927/`：`cloud-readonly.json`、`daily-summaries.json`、`report-attachment.json`、`reconciliation.json`、`failed-job.log`、`latest-job.log`。原始日志及业务快照不入库；引用的 GitHub 运行链接可长期核查平台状态。

仍未覆盖：跨市场分别执行、真实部分失败报告、失败分析结果恢复，以及 24 日底层故障定位。后续宜单独收敛脱敏故障证据的保留方案及非交易日过期状态核对，不通过自动重跑收费分析掩盖失败。此次未更改调度开关、Secrets 或生产代码；失败终态应保留，不回写成 `running`。中文专题无对应英文文档。


## 2026-09-29 可靠性与定时分支调整

本轮代码增加如下保护，须发布后才影响线上运行：

- 在交易日判断前调用既有 `cloud_runner_snapshot`，非交易日也收尾过期任务；执行后停止本会话并再次核对。新增 `python scripts/run_cloud_daily.py --reconcile-only`，仅核对租约，不初始化模型、不提交分析、不接管有效会话。工作流以 `always()` 尝试执行收尾步骤。强制终止或平台超时仍可能阻止收尾；这种情况下由下一次调用核对，不能承诺租约到期瞬间自动更新。失败终态不自动重算。
- 云端入口生成 `logs/cloud-daily-diagnostics.json`，收尾入口另存 `logs/cloud-daily-cleanup.json`。仅记录固定阶段、结果类别、UTC 时间、耗时、异常类别及可取得的 HTTP 状态；不序列化异常正文、配置、账号、股票列表或报告。最多保留100条事件，原子写入，文件权限0600；写入失败不改变已完成的业务结果。
- 云端工作流只上传上述两份文件，保留7天。原始 `cloud-daily.log` 和发布包仍不上传。诊断中没有 `exit_code`、最后阶段仍未结束时，应按中断/结果未确认排查，不据此断言成功。`partial` 表示业务部分成功，与全成功区分。
- 云端不再额外等待0～59秒；旧非云端模式保留随机等待。计划时间仍为工作日北京时间18:00。
- 定时任务保持 GitHub 默认行为：从仓库默认分支 `main` 读取工作流并执行该次触发对应的代码；手动运行使用所选分支。`dev` 用于开发和验收，通过后再同步到 `main`。不单独指定 checkout 分支，避免工作流定义与执行代码来自不同分支。

### 为什么完成时间不固定

完成时间由“平台触发延迟 + 排队 + 环境准备 + 行情/新闻/模型请求 + 报告发布”共同决定，cron 定义的是计划触发时间，不是完成时间。GitHub 官方明确说明定时工作流可能因负载而延迟，尤其整点；换分支不能解决该平台限制。参见 [GitHub schedule 文档](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。本次证据只能确认延迟发生在工作流创建前，不能证明 GitHub 内部具体原因。

[9月28日自然运行](https://github.com/yanxinyi620/daily_stock_analysis/actions/runs/36461823178)原计划北京时间18:00，实际9月29日01:57:38启动、02:07:30结束。依赖安装46秒，执行分析步骤8分54秒；数据库业务任务01:58:39至02:07:25，3股及大盘均成功。主要偏差约7小时58分，发生在启动前。18:00不能作为固定完成时间承诺；即使使用更准时的外部调度器，外部服务耗时也仍会浮动。

日期仍按实际执行时的市场当地日期确定，跨日可能改变去重日期。不同市场分别使用各自交易日历；美股不适用A股18:00收盘后语义。

### 验收与边界

隔离副本后端 gate：6008项通过，4项网络测试未纳入；后续入口与结果分类补充后，定向69项通过。Web云端专项136项通过，lint及本地/云端构建通过，lint仍有原有Hook依赖警告。新增覆盖安全诊断、HTTP故障类别、心跳中断、磁盘写入失败、非交易日前清理、有效会话保护、CN/HK/US日期边界、部分成功分类及发布重试不重算。

真实正式数据库只读确认最近自然日报3股成功。恢复测试项目由管理API确认状态为 `INACTIVE`，数据库连接失败、REST连接未完成；真实跨市场、真实部分失败及远端中断恢复验收仍待恢复测试环境，不能用模拟成功替代。9月24日原始日志已丢失，新增诊断不能还原其底层异常。

回滚：还原上述工作流、入口和Runner诊断改动即可；无数据库迁移和新配置项。定时运行始终沿用默认分支，回滚时不必调整分支选择。中文专题没有英文对应页，本次无需同步README。


## 恢复测试环境与真实中断验收（2026-09-29）

用户确认组织为 Free Plan，并授权按需恢复测试项目。管理API接受恢复请求后，数据库以 verify-full 重新连接成功，原有2个成员、日报RPC及私有引擎schema均可用。本次未升级套餐、未添加保活任务、未切换正式站点或正式日报配置。

真实恢复数据库事务验证CN/HK/US三市场任务：有效租约保持运行，过期租约经snapshot转为 `failed / RUNNER_OFFLINE`，测试事务回滚。随后单独启动测试子进程，通过真实HTTP注册、提交和领取，再以退出码73直接退出，不执行心跳续期、完成或关闭操作。有效期内snapshot保持在线忙碌；等待租约自然到期后，调用真实日报非交易日入口完成收尾，任务无报告、未调用模型。该测试仅将入口Runner标识指向独立测试身份，未改变产品默认身份。

中断验收任务：`a33363cf-8ae3-47be-9208-239451fdb473`。仓库外摘要：`/tmp/dsa-reliability-20260929/interruption-acceptance.json`。失败终态保留在测试环境供复核，不自动重跑。此结论证明状态收尾，不表示能够恢复尚未保存的模型结果。


真实跨市场与部分失败闭环也已完成：执行 `52a3a1ec-c44b-489d-b07b-437362442fa1` 使用现有行情/模型配置分析 `000001`、`hk00700`、`MSFT`，三支股票各有一条成功模型调用的持久化诊断，耗时约695秒。为验证部分失败，验收程序明确注入大盘复盘异常；结果为3股完成、0股失败、大盘失败、`outcome=partial`。这不是自然发生的大盘故障，也不代表HK/US地区大盘复盘已实测。

报告 `c4283f15-d3d1-5fdc-a473-1df857f53ee9` 已保存至测试项目，并在正文首行标注故障注入用途。发布阶段第一次完成请求被验收程序中断，第二次使用相同保存内容成功；引擎调用1次、发布完成尝试2次。测试仅临时补充缺少的跨市场自选股，提交固定快照后立即移除本轮新增条目，核对原列表未变。Runner结束后独立连接确认离线且无运行中任务。

恢复项目权限复核：继承本机代理的两次请求分别在不同步骤失败，不能算通过；无进程环境代理的真实A/B登录、本人报告/任务/附件、跨用户及匿名拒绝、发布RPC拒绝、刷新与退出全部通过。未修改应用权限或全局代理配置。上述网络路径差异不证明所有地区访问稳定。

证据在 `/tmp/dsa-reliability-20260929/`：`live-acceptance.json`、`model-proof.json`、`interruption-acceptance.json`、`access-direct.log`；原始分析日志和发布包在其0700权限的 `private/` 子目录，不上传、不入库。报告与中断终态保留在测试环境供复核。项目按需使用，不增加自动保活，闲置允许平台暂停。本节取代前文“恢复环境停用导致验收待完成”的状态；正式发布、GitHub线上诊断artifact实测及9月24日历史根因仍不在通过结论中。

新增部分成功报告另行通过A本人读取和附件内容核对、B及匿名拒绝，测试登录会话均已退出。证据：`new-report-access.log`。本轮生成的两份临时凭据文件已移除，仓库原有私有配置未改。
