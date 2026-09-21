# 本地 Runner 验收记录

依据 [当前方案](vercel-supabase-plan.md) 与 [运行说明](local-runner.md)。下列 2026-09-18 记录只验收单股执行；2026-09-20 的大盘复盘与综合分析增量记录见后续章节。不是所有功能迁移完成。代码未提交或推送。

## 本地已验证

- 后端隔离副本执行 `scripts/ci_gate.sh`：5930 passed、4 deselected、503 subtests passed，gate 成功。副本不包含真实 `.env`、原数据库或报告；最终另行校验 Runner 配置边界，`tests/test_cloud_runner.py` 17 passed。
- Web 全量回归：126 文件通过，1195 passed、2 skipped。
- 云端专项：9 文件、41 passed，覆盖任务 API、真实 PostgreSQL 语义模拟的 RPC/RLS、旧会话迟到发布、报告与任务原子提交、私有 schema、离线按钮与轮询。
- `npm ci`、`npm run lint`、`npm run build`、`npm run build:cloud` 成功。lint 留有既有 MobileChatPage hooks 警告，无错误。云端构建新增 NodeNext API 编译检查。
- 首轮回归暴露两个既有测试问题：HTTP 全局 mock 干扰安全请求包装，以及固定日期离开 90 天筛选范围。分别调整测试作用域与使用相对时间，保留业务断言。

## 远端已验证

环境为 `daily-stock-analysis-restore`（txamwfxpbwcolsdlqiva）与 Vercel Preview；正式 Supabase/正式域名未切换。

- 两项新增迁移原子应用；原报告、发布记录、自选股、成员的迁移前后摘要相同。新增私有 `dsa_engine` 33 张表；独立 SQLAlchemy 连接验证 schema、表、列及 TLS。
- Vercel API 真实调用：所有者在线查询成功，另一测试账号返回 403；单股提交成功，同一请求重复提交返回同一执行记录。
- 真实 Python Runner 使用已有行情/模型配置执行股票 000001。执行 ID `1df53d4d-564a-47d3-ad84-0e36f0e8c0b2`；报告 ID `1400b14e-d407-5d3e-aaec-b3ca4b97ee20`。
- 2026-09-18 10:12:17.827 UTC 提交，10:18:05.442 UTC 完成，约 347.6 秒；进度 100、状态 succeeded。超过领取期限的长分析仍维持心跳，未被误判超时。
- 最终预览部署为 https://daily-stock-analysis-4z67f3th3-dsa-449e.vercel.app（受 Vercel 部署保护）。离线 GET 返回 online=false；离线 POST 返回 409/RUNNER_OFFLINE，执行记录数量不变；另一用户仍返回 403。
- 停止测试 Runner 后，新的数据库连接仍能读取一条对应引擎分析历史及一条公开 schema 中的私有用户报告。
- 真实浏览器登录后显示离线、禁止提交；报告直达链接、刷新和私有 Markdown 附件下载成功。截图保存在仓库外 `/tmp/dsa-cloud-evidence/runner-offline.png`、`runner-report.png`，不合入。
- 真实 Vercel 初次构建成功但请求失败，原因是函数 ESM 导入缺少 `.js`；修正后实际 API 调用通过，不能仅用 READY 判断功能通过。

## 未验证与限制

- 正式生产切换尚未执行；`stock.xinyilab.top` 保持原报告阅读部署。
- 截至 2026-09-18，大盘复盘、综合分析、选股、回测、问股的新云端执行入口、Actions 日报、旧 SQLite 导入尚未实现；后续变化见增量记录。
- 强杀、物理断网、机器重启及发布失败采用本地故障/协议测试覆盖；没有把这些场景全部在真实云端重复演练。当前仅一次真实单股样本，不代表所有市场、模型或行情源稳定性；执行时部分行情源失败后使用已有降级链路。
- 实际浏览器验收使用环境提供的显式网络代理；不承诺其他网络均可直连。没有做长期负载、峰值内存或端到端延迟分位数测量。
- 真实新任务保留，不清理旧数据。回滚为停止 Runner、回退前端部署；保留新增表及报告，不执行删表或恢复覆盖。

此专题无对应英文版本，未扩写 README。

## 2026-09-20 增量：单市场大盘复盘

代码新增 `market_review` 任务和五个单市场选项（cn/hk/us/jp/kr），复用原大盘复盘入口与初始化模块；模型未成功时保留模板降级能力并明确标注。原单股、CLI/API 多市场入口继续保留。实施依据为 [增量计划](../superpowers/plans/2026-09-20-runner-market-review.md)。

### 本地验证

- 隔离副本完整 `scripts/ci_gate.sh` 通过：5947 passed、4 deselected、503 subtests passed，约 543 秒；其后补充的空结果/上下文清理用例包含在下述 158 项定向验证中。
- 158 项定向后端测试通过：新 Runner 适配、真实复盘持久化流程（外部行情/模型替身）、空报告与历史保存失败、诊断上下文清理、原大盘运行和 API 契约。
- 云端专项 9 文件、47 项通过；包括新 RPC/PGlite、五市场输入、非法输入、跨任务类型幂等冲突、离线/忙碌零写入及权限约束。
- Web 完整回归 126 文件、1201 项通过、2 项跳过；lint 无错误（一个既有 MobileChatPage 警告）；普通构建、云端构建及 NodeNext API 编译通过。
- 独立审查未发现协议、安全或持久化阻断项。`git diff --check` 通过。

### 远端验证

- 仅恢复项目应用 `202609200001_cloud_market_review.sql`；SHA256 `899b5345e1784d2fe38337cc1db75a1744c8dad6cc5305b8e694bc51dbf1b899`。原报告、发布账本、自选股、成员、执行记录、Runner 状态的迁移前后摘要一致；两个旧迁移文件摘要不变。
- Vercel Preview：<https://daily-stock-analysis-2c0tovefs-dsa-449e.vercel.app>（受部署保护）。真实浏览器选择“大盘复盘 / A 股”提交成功，无股票代码字段要求。
- 执行 ID `dd8b5165-fe04-4bd0-9297-c74f3608a5a0`；报告 ID `6c81bca4-8ed6-5c6a-993a-46dd893324fa`。2026-09-20 01:07:25.031 UTC 提交，01:09:10.251 UTC 完成，约 105.2 秒。状态 succeeded、进度 100。成功模型诊断对应的报告未触发模板提示，Markdown 2556 字符。
- 真实重复提交返回同一任务；另一账号提交返回 403；`region=both` 返回 400。
- Runner 正常退出后，独立数据库连接读取到一条 `MARKET` / `market_review` 引擎历史与一条关联报告。
- A 账号可读取任务/报告及下载 Storage 附件；B 账号读不到该任务或报告，下载被拒绝。
- 离线 GET 返回 online=false；POST 大盘复盘返回 409/RUNNER_OFFLINE，任务数量不增加。浏览器离线按钮禁用，报告直达、刷新、私有下载通过。首次离线探测未得到期望状态、浏览器等待超时；确认进程退出后重试全部通过，未改写测试为忽略离线断言。
- UI/报告截图在仓库外 `/tmp/dsa-cloud-evidence/market-online.png`、`market-offline.png`、`market-report.png`。自动浏览器使用环境提供的显式代理。

### 该阶段未验证范围与回滚

真实执行仅验证一次 A 股复盘；其他四市场输入和协议经过本地测试，但尚未逐市场远端运行。2026-09-20 为非交易日，报告使用引擎可用行情且保留数据缺失/交易日期提示，不证明行情实时性或投资结论准确性。模板降级由本地测试覆盖，未额外消耗真实模型调用制造失败。

大盘复盘验收时，综合分析、选股、回测、问股、独立 Actions 日报、旧历史导入和生产切换仍未完成；综合分析的后续验证见下一节。正式 Supabase 与 `stock.xinyilab.top` 未变更；测试 Runner 已停止。后续上线须先停止只认识单股的旧 Runner，再更新迁移、Runner 和匹配前端。回滚停止新 Runner、回退前端即可，保留新旧历史与新增表。代码未提交/推送，无新增配置项；中文专题无对应英文文档。

## 2026-09-20 增量：综合分析

实现依据为 [综合分析增量计划](../superpowers/plans/2026-09-20-runner-composite.md)。复用原综合服务与股票批处理，默认本地行为保留；云端关闭额外文件/通知/旧 CLI 发布，固定云端自选股快照并原子保存业务结果摘要。`succeeded` 表示报告发布成功，`result_summary.outcome` 区分 completed/partial；缺失摘要显示“结果待确认”。

### 本地验证

- 隔离完整后端 gate：5959 passed、4 deselected、503 subtests passed，约 550 秒。
- 最终代码定向验证：76 passed，包括其后补充的恢复包身份校验、组件历史验证、空结果与取消、原组合 API、单股/复盘及发布路径。
- 云端专项：9 文件、58 passed。覆盖服务端自选股排序与隔离、快照变化后的幂等重试、空/超限快照、输入注入、partial 摘要校验、全部 JSON null 字段拒绝、原子保存、完成 RPC 防绕过和权限不扩大。
- Web：126 文件、1212 passed、2 skipped；lint 无错误（一个既有 MobileChatPage 警告），普通与云端构建通过。
- 独立审查与补丁复核通过。子项历史检查放在批处理之后，避免被原 fail-open 进度回调吞掉；缺失历史明确计为失败，查询异常中止任务。旧 CLI/API 默认仍保存本地报告。

### 远端环境与迁移

- 只在恢复项目应用 `202609200002_cloud_composite.sql`；SHA256 `bd19da51a13b9636c9166ecfafcd454c0fa118e8baf2a6cccc6bc0577b89db72`。旧公开表和私有引擎历史的迁移前后摘要相同（比较执行记录时排除新增的空 result_summary 字段）。`report_type` 扩为 varchar(32)，不删除历史。
- 预览版本：<https://daily-stock-analysis-q3s1pn55d-dsa-449e.vercel.app>（受部署保护）。正式 Supabase 与正式域名未切换。
- 恢复项目 A 账号原自选股为空，经该账号权限追加一条 `000001 / 综合联调样本` 供真实测试；样本保留，未覆盖或删除既有自选股。
- 浏览器选择“综合分析 / A 股”提交，服务端返回固定的一只自选股快照。重复请求返回原任务；B 账号提交 403；客户端传 stock_codes 被拒绝 400。

### 真实综合执行与留存

- 执行 ID `24825df0-0a7b-4719-bba3-71f73cd7cb34`；报告 ID `f95f3f5d-56eb-5be1-92ca-cdd57983d9a4`。
- 2026-09-20 01:28:35.026 UTC 提交，01:34:29.241 UTC 完成，约 354.2 秒。执行 succeeded、业务 completed，成功股票 1、失败 0、大盘 completed。公开报告 6691 字符，未触发模板降级提示。
- 进程正常退出后，独立连接确认：历史类型字段实际宽度 32、一条已保存的个股历史、一条大盘历史、一条 COMPOSITE 历史及一条云端报告；子项 query_id 从综合历史映射反查。
- 隔离运行目录没有生成本地业务 SQLite 文件或额外报告文件；业务数据依赖 Supabase，私有发布包仅用于恢复。
- A 账号可读任务/报告并下载附件，B 账号查不到该任务与报告且不能下载对应 Storage 文件。
- 停止 Runner 后 GET online=false，POST 综合任务返回 409/RUNNER_OFFLINE 且执行记录数量不变；浏览器按钮禁用，报告直达链接、刷新和私有 Markdown 下载通过。截图保存在仓库外 `/tmp/dsa-cloud-evidence/composite-online.png`、`composite-offline.png`、`composite-report.png`。浏览器使用环境提供的显式代理。

### 未验证与后续范围

本轮远端仅验证一只 A 股自选股加 A 股复盘的完整成功路径。多股票、跨市场、真实部分失败、真实断网/强杀在本轮未重复运行；部分完成、失败摘要、原子性、取消和恢复包错误由本地确定性测试覆盖，不以真实单样本代替这些场景。非交易日数据和模型结论准确性不属于部署通过的证明。

选股、回测、问股、Actions 日报、旧 SQLite 导入、生产切换仍待后续。测试样本和新增报告保留；测试 Runner 停止后可回退前端停用功能，不删除历史或逆向缩短数据库字段。没有新增配置变量、付费资源或域名变更，未提交/推送代码。专题无对应英文文档；README 未扩写。

## 2026-09-20 正式站点发布

用户授权提交代码并更新正式地址后，代码提交为 `1cbfeb6c`（`feat: add Supabase reports and local runner cloud analysis`），通过 Vercel CLI 从同一工作区部署生产版本，无 Git push 或自动发布 tag。

- 正式地址：<https://stock.xinyilab.top>；生产部署 `dpl_7BiSfxabpqYC7SXARVExz9awz9iP`，状态 READY。
- Production 继续使用原 Supabase 项目 `uwqvohwgaxedxzvfjqkm`，已有账号不变；Preview 继续使用恢复项目。
- 正式项目补齐 `202609180001`、`202609180002`、`202609200001`、`202609200002` 四个迁移，同一事务执行；已有基础迁移未重复运行。原 public 业务记录、Auth 用户/身份、Storage 桶/对象记录的迁移前后摘要一致。
- 迁移前 public schema/data 备份保存在本机受限目录 `~/backups/dsa-cloud/pre-runner-20260920T014717Z/`，附迁移摘要；不入库。未删除历史记录、修改 DNS 或 CruxSet 服务。
- 本次发布前重新验证：81 项后端相关测试、58 项云端测试通过；Web lint 无错误（既有 MobileChatPage Hook 警告 1 条），云端构建通过。此前完整回归结果仍见上文，不冒充本次重新执行。
- 正式环境 API 验证：A/B 原账号登录通过；A 可读取自己的报告与附件，B 无法读取 A 的记录或附件；B 无执行权限，匿名请求被拒绝。三个任务类型均在 Runner 离线时返回 409，未插入执行记录。
- 正式环境浏览器验证：登录、三个任务选项、离线按钮禁用、报告深链、刷新及 Markdown 下载通过。证据保存在仓库外 `/tmp/dsa-production-browser.log`、`/tmp/dsa-production-verify.log` 与 `/tmp/dsa-cloud-evidence/production-*.png`。
- 私有 `dsa_engine` schema 对 anon/authenticated 均不可访问，历史类型字段宽度已确认为 32。
- 限制：本次未在正式项目执行真实模型分析，完整分析闭环证据来自前述恢复项目；正式 Runner 当前未启动。用户需启动连接正式项目的 Runner 后才能执行新分析，网页不会替代本地执行进程。
- 回滚：停止 Runner 并将 Vercel 恢复为此前报告阅读部署 `dpl_DzYoPJoeguFrupDVqoz9RgJFEesD`；保留新增表、迁移和所有历史数据。已执行迁移保持原始内容与摘要，不为格式调整重写迁移文件。

本文为中文部署专题，无对应英文版本；未扩展 README。

## 2026-09-21 分析记录合并验收

- 页面合并为单一分析记录表，保留报告查看、私有下载、保存失败记录、分页和后台轮询；分析结果与保存状态分列。旧数据缺少来源或结果摘要时显示“未记录”。
- 本地验证：完整前端测试 1,225 项通过、2 项跳过；lint 无错误（既有 MobileChatPage Hook 警告 1 条）；普通版与云端版构建均通过。浏览器连接真实 Supabase，A 账号 4 份报告显示为 4 行，来源和结果正确，私有下载及手机宽度检查通过。
- 本轮不修改数据库、Storage 策略或历史数据。失败、分页重试与轮询回归由本地测试覆盖；不在生产创建失败任务来验证展示。
- 页面截图保存在仓库外 `/tmp/dsa-records-before-desktop.png`、`/tmp/dsa-records-local-desktop.png`、`/tmp/dsa-records-local-mobile.png`，不作为仓库文件提交。
- 回滚本次 UI：将 Vercel 恢复到 `dpl_7BiSfxabpqYC7SXARVExz9awz9iP`；无数据库回滚步骤。
- 远端验证：正式部署 `dpl_4b7tg9Y1WiTNhRegVXSe3zppXAur` 为 READY，已绑定 `https://stock.xinyilab.top`。上线后 A 账号真实浏览器登录、4 行唯一记录、每日定时来源与全部完成摘要、私有下载、手机页面宽度及无页面异常检查通过。证据为仓库外 `/tmp/dsa-records-browser-production.log`、`/tmp/dsa-records-production-desktop.png`、`/tmp/dsa-records-production-mobile.png`。本轮未重新执行分析引擎或制造生产失败任务，B 账号远端隔离沿用先前验收，相关权限策略未修改。

## 2026-09-21 工作台改版与可恢复删除

- 用户确认左右工作台布局；自选股添加／编辑与账户修改密码改为弹窗，分析类型页签化，执行历史折叠。分析记录合并状态、去掉时间副文案，个股直接显示保存时的股票名称（缺失时仅显示代码）。
- 迁移 `202609210001_cloud_report_trash.sql` 已先在恢复项目、后在正式项目应用，新增 deleted_at 与本人操作 RPC，发布重试不会自动恢复回收站记录。迁移前后 tasks（排除新增空列）、reports、execution、runner、watchlist、member、engine history、Storage 对象记录摘要一致。摘要证据在仓库外 `/tmp/dsa-redesign-migration-DSA_RESTORE.json`、`/tmp/dsa-redesign-migration-DSA_SOURCE.json`。
- 本地：完整 Web 1,236 项通过、2 项跳过；隔离副本中发布器、Runner、综合分析与迁移契约 45 项 Python 测试通过。覆盖统一状态、股票名称、删除取消／错误／恢复、末页删除纠正、账户与自选股弹窗等。
- 恢复项目：事务回滚 SQL 测试覆盖本人／他人／匿名／停用用户、保存中与关联运行中任务、重复删除恢复及保留报告。实际 HTTP 校验匿名与 B 不能删除 A 的记录；浏览器验证真实 A 登录、股票名称、取消删除、移入回收站、恢复、账户及自选股弹窗、手机宽度和无页面异常。浏览器中的 Runner 离线响应为模拟，不作为引擎或执行 API 验收。
- 恢复项目双连接并发：确认第二连接实际等待数据库行锁，分别验证删除先赢、发布开始先赢、Runner 完成发布后删除三种顺序，均符合预期且无死锁；晚到 complete/fail/cleanup 不清除删除标记，authenticated 直接 UPDATE 被拒绝。测试新建的并发记录与附件已精确清理，未删除既有历史。证据在 `/tmp/dsa-redesign-concurrency.log`。
- 正式项目：A/B 原账号登录与私有附件边界通过；B 和匿名删除 A 报告请求均被拒绝。未对正式既有 4 份报告执行删除测试，未重新运行真实模型分析或修改密码。
- 截图与浏览器日志存放仓库外 `/tmp/dsa-redesign-restore-desktop.png`、`/tmp/dsa-redesign-restore-mobile.png`、`/tmp/dsa-redesign-browser-restore.log`，不作为仓库文件提交。回收站保留本人深链和附件访问，不代表永久擦除，也不减少 Storage 用量。
- 回滚前端至 `dpl_4b7tg9Y1WiTNhRegVXSe3zppXAur` 时保留数据库迁移和数据；旧版不理解删除标记，可能重新显示回收站记录。不要删除新增列、历史报告或附件来回滚。
- 最后审查补充自选股保存错误在弹窗内展示、关闭编辑弹窗返回原编辑按钮的回归测试，最终云端相关 84 项通过；lint 无错误（既有 MobileChatPage Hook 警告 1 条），普通与云端构建均通过。完整 1,236 项结果为这两处修正前的全量回归，修正后未再重复整个非云端测试集。
- 测试清理后重新核对恢复与正式项目全部上述数据摘要，均与迁移前一致；只清理本次新建的恢复测试样例。
- 正式部署 `dpl_9v2fVbbvV3p6LZZXkZ5TrK3Z8Yvh` 已 READY 并绑定 `https://stock.xinyilab.top`。上线后真实浏览器验证 A 登录、保留 4 行记录、五列表格、无时间副文案、账户／自选股弹窗、私有下载、手机宽度和无页面异常。正式截图在仓库外 `/tmp/dsa-redesign-production-desktop.png`、`/tmp/dsa-redesign-production-mobile.png`，日志为 `/tmp/dsa-redesign-browser-production.log`。本轮未修改正式密码、未重新执行模型分析；删除恢复的成功路径在恢复项目完成。

## 2026-09-21 发起分析区域精简

- 最近连接字号缩至 0.75rem；移除近期执行记录列表及综合分析提交前的快照提示。当前任务进度、结果、错误反馈与服务端快照行为保留，历史数据不变。内部仍查询执行记录以恢复进行中的任务，仅查询当前任务的回收站标记。
- 本地验证：云端相关 84 项测试通过，lint 无错误（既有 MobileChatPage Hook 警告 1 条），普通和云端构建通过。既有综合分析结果测试改为覆盖当前提交返回的结果，并验证历史列表与提示不再渲染。
- 无数据库、Storage、环境变量或引擎变更；本轮不重新执行真实分析。回滚至前版 Vercel 部署 `dpl_9v2fVbbvV3p6LZZXkZ5TrK3Z8Yvh` 即可恢复原展示，无需回滚数据。此中文专题无对应英文文档。
- 正式部署 `dpl_CYEMbdSn2i9U3WnhgkKCPi4aLrqf` 已 READY 并绑定 `https://stock.xinyilab.top`。真实 A 账号浏览器验证最近连接为 12px、近期执行记录与综合分析快照提示均不再显示、复盘市场控件与 4 份报告保留、手机无整页横向溢出；未提交分析任务。截图位于仓库外 `/tmp/dsa-panel-production-desktop.png`、`/tmp/dsa-panel-production-mobile.png`，日志 `/tmp/dsa-panel-browser.log`。

## 2026-09-21 顶栏刷新与回收站永久删除

- 顶栏品牌右侧使用紧凑刷新图标与提示，点击完整刷新当前页面，保留登录会话；标题区缩小留白。回收站增加永久删除二次确认，失败重新读取状态并保留重试入口，开始删除后禁止恢复。仅删除发布报告及附件，独立执行记录和引擎历史保留。
- 迁移 `202609210002_cloud_report_purge.sql` 先恢复项目、后正式项目应用。对两项目的 tasks（排除新增空列）、reports、execution、runner、watchlist、member、engine history 和 Storage 对象记录做摘要比较，原数据保持一致。测试只创建并清理带本次标记的新样例。
- 本地：云端前端及 API 12 组／101 项测试通过；迁移静态测试 4 项通过；lint 无错误（MobileChatPage 既有 Hook warning）；普通前端与云端构建通过。SQL 事务回滚套件在真实恢复项目通过，覆盖权限、进行中保护、重复操作、附件未删除保护、读取隔离、恢复及发布防复活。
- 真实恢复项目：本地运行正式 API handler，使用真实 Auth、RPC 和 Storage；A 删除新建报告与实际附件后，数据库和认证下载确认均已清理。B／匿名拒绝、未入回收站拒绝、重复删除、手动中断后重试通过。浏览器真实登录、刷新会话保持、取消及确认永久删除、手机布局通过。浏览器的 Runner 离线响应为模拟，不作为分析引擎验收。
- 截图与日志保存在仓库外 `/tmp/dsa-purge-restore-confirm.png`、`/tmp/dsa-purge-restore-desktop.png`、`/tmp/dsa-purge-restore-mobile.png`、`/tmp/dsa-purge-browser-live.log`；迁移与数据保留摘要为 `/tmp/dsa-purge-migration-DSA_RESTORE.json`、`/tmp/dsa-purge-migration-DSA_SOURCE.json`。首次浏览器脚本按钮名称定位错误，修正匹配完整无障碍名称后通过，未放宽产品断言。
- 边界：没有删除正式已有报告；未执行新的个股、大盘或综合分析。永久删除正向链路的证据来自本地 API 连接真实恢复项目，不能替代 Vercel 上的破坏性端到端验收。
- 回滚可将前端恢复至 `dpl_CYEMbdSn2i9U3WnhgkKCPi4aLrqf`，保留增量数据库结构和数据。旧前端可能展示已删除发布墓碑，但不能恢复已清理正文或附件；回滚部署不能撤销永久删除。中文专题无对应英文版本，未修改 README。

- 正式 Vercel 部署 `dpl_HdDZX2Ux3dhDrrAUMvk1h9wY7m83` 已绑定 `https://stock.xinyilab.top`；远端构建通过，DELETE 路由真实校验匿名 401、B 操作 A 403、A 未入回收站 409。浏览器刷新后登录保留，记录数按本人数据库查询核对：A 为 3 条正常、1 条回收站（并非 4 条都在正常列表）。正式页面的永久删除确认框只取消，不提交删除。验收日志 `/tmp/dsa-purge-production.log`，截图 `/tmp/dsa-purge-production-desktop.png` 与 `/tmp/dsa-purge-production-mobile.png`。

## 2026-09-21 修正右侧面板上方留白

- 根因是工作台标题仍为通栏区域；将标题与说明收进左侧栏，右侧面板距顶栏 20px，和左侧标题顶部对齐。手机端保持标题、自选股、发起分析、记录的纵向顺序。
- 本地云端 101 项测试、构建通过；lint 无错误，仅既有 MobileChatPage Hook warning。浏览器连接恢复项目实测桌面坐标和手机无溢出通过；Runner 离线响应为模拟，此次不验证引擎执行或删除行为。
- 本地截图保存在仓库外 `/tmp/dsa-layout-local-desktop.png` 和 `/tmp/dsa-layout-local-mobile.png`。仅页面结构和间距改变，无数据库迁移或数据操作；可回滚至 `dpl_HdDZX2Ux3dhDrrAUMvk1h9wY7m83`。中文专题无对应英文版本。
- 正式部署 `dpl_FdwFYd9kjJ3EJ8a8sqd6uHhbyGcr` 已绑定正式域名；真实登录后的桌面 20px 间距、标题与右侧顶部对齐、手机纵向顺序和无溢出均通过。证据：`/tmp/dsa-layout-browser-production.log`、`/tmp/dsa-layout-production-desktop.png`、`/tmp/dsa-layout-production-mobile.png`。未重新运行分析或删除报告，此次仅布局验收。

## 2026-09-21 移除重复介绍文案

- 按用户要求删除「分析工作台」与「发起分析，回看每一次判断。」及空容器、样式，左侧自选股直接与右侧面板顶部对齐。
- 本地云端 101 项测试和构建通过；lint 无错误，仅既有 MobileChatPage Hook warning。正式部署 `dpl_6EeXrjuwP1kHEsbfBME4SFVYuQix` 已绑定正式域名；浏览器验证两行文案消失、桌面左右栏对齐、手机顺序与无溢出通过。证据在仓库外 `/tmp/dsa-intro-browser-production.log`、`/tmp/dsa-intro-production-desktop.png`、`/tmp/dsa-intro-production-mobile.png`。
- 仅展示调整，无数据操作；未重跑分析或删除报告。回滚可恢复部署 `dpl_FdwFYd9kjJ3EJ8a8sqd6uHhbyGcr`。中文专题无对应英文版本。
