# 云端报告：Vercel + Supabase

> **现有版本运行手册，非最新开发范围（2026-09-18）。** 后续以 [当前 Runner 方案](vercel-supabase-plan.md) 为准。下文的“无任务 API”“Vercel 无服务端密钥”和多人开户步骤仅描述旧报告阅读版本，不适用于未来 Runner 任务 API；新阶段仅指定所有者，保留已有测试账号及隔离。已部署版本尚未因此改变。

这是现有 Python 项目的可选发布/阅读模式。仍使用 React/Vite，不迁移 Next.js，不将分析引擎放入 Vercel。默认本地 CLI、SQLite、FastAPI、桌面端和通知继续运行。线上新增业务数据以 Supabase 为权威来源，本地历史不会自动导入或双向同步。

## 结构与信任边界

```text
main.py → 原 Python pipeline → 原 Markdown / 通知
                            → 私有重试包 → Storage 上传
                                         → 发布 RPC（报告 + 成功状态事务）
浏览器 → Supabase Auth → SDK → RLS → 自选股 / 报告 / 发布状态 / 私有下载
```

`src/services/cloud_publisher.py` 使用已有 requests；SQL 位于 `supabase/migrations/202609140001_cloud_reports.sql`。普通用户仅能维护本人的自选股、读取本人报告与发布任务；任务/报告/成员写入和发布 RPC 仅授予 service_role。RLS 同时检查用户 UUID 与 app_members.enabled；权限不依赖可修改的 user_metadata。

Secret Key / legacy service_role JWT 是**项目级高权限**，并非表级最小权限。只允许放在可信 Python 环境；不要放入 Vercel 浏览器公开变量、日志或工作流产物。本阶段 Vercel 不需要任何 Secret Key、GitHub token 或模型密钥。授权模型依据 [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Storage 访问控制](https://supabase.com/docs/guides/storage/security/access-control)和 [API Keys](https://supabase.com/docs/guides/getting-started/api-keys)。

每个 Python 批次发布一份现有汇总 Markdown 和精简结果；不上传原始新闻、完整 prompt 或模型调试响应。数据字段 `market_as_of` 未知时保持 null，不能用生成时间冒充行情截止时间。自选股代码保留字符串：A 股六位、港股 `hk` 加五位、美股大写含点/短横线等现有常见符号；云端自选股暂不接入其他市场。

状态表示**结果发布**，并非远端分析执行：`publishing → succeeded / publish_failed`。失败可使用同一包重试；维护清理将未完成任务变为 `cancelled`，不可恢复。随机批次键区分新分析；同一重试包的 task UUID/内容摘要不变，同键异内容拒绝，成功报告不可变。附件先上传，事务验证对象存在后写报告并更新状态；中断可能留下不可读的孤立附件或 publishing 状态，可重试或明确取消。没有声称自动检测进程硬终止。

只上传已有 Markdown；私有 bucket 名称为 `analysis-reports`，路径 `<user_uuid>/<task_uuid>/<content_hash>.md`。路径前缀不是授权，Storage SELECT 必须匹配当前用户已提交的报告。普通用户无上传/改写/删除权限。网页使用携带身份的 SDK download，不保存签名 URL；Markdown 沿用现有安全渲染器，不启用原始 HTML 执行。

## 集中平台配置清单（需要站点所有者操作）

1. **Supabase 测试项目**：先准备独立测试项目；不得直接复用 CruxSet 的数据库或资源。执行迁移前确认当前项目和备份。使用 Supabase SQL Editor 执行上述完整 migration，或在可信环境用官方 CLI link 后先 `supabase db push --dry-run`，核对只有本迁移再执行 `supabase db push`。迁移是新增表和 bucket，不清空历史；如果同名表/bucket 已存在会失败，需要先审查，不自动接管。已应用迁移以后只新增迁移。
2. **Auth**：关闭允许新用户注册、匿名登录和非必要 provider；保留邮箱密码登录。`supabase/config.toml` 只控制本地开发，**不会自动关闭托管项目的注册**，控制台必须单独设置。
3. **账户建立**：Auth → Users → Add user / Create user，预创建你和朋友的邮箱密码账户并设置邮箱已确认（不要走依赖邮件的邀请）。临时密码通过安全渠道单独交付；不进入 Git、命令行参数或日志。登录后可在账户区域改密码（至少 12 位）。如项目启用了安全改密/重新认证要求，按项目设置完成重新认证；主闭环不依赖默认邮件投递。
4. **成员准入**：复制 Auth 用户 UUID，在 SQL Editor 为每位已创建用户执行下面参数化示意的 INSERT，UUID 由你替换，不要把邮箱当 user_id。普通用户不能执行此写入。停用时设 enabled=false，后续 DB/Storage 请求会失去权限；已经下载到设备的内容不能撤回。
5. **Python**：在可信本地忽略的 `.env` 中填写 `SUPABASE_URL`、`SUPABASE_SECRET_KEY`、`SUPABASE_PUBLISH_USER_ID`。发布配置仅通过可信环境配置，不加入本地 Web 设置 schema；原始配置查询中的 Secret Key 也做服务端掩码。自动发布设置 `SUPABASE_PUBLISH_ENABLED=true`；超时 `SUPABASE_PUBLISH_TIMEOUT=30` 秒。配置错误在 pipeline.run 的分析前报错；执行中的发布故障保留本地结果和通知，并输出脱敏错误。成功与失败不改变既有 CLI 返回结果契约；自动化若要单独判定发布成败，运行下面独立 publish 命令，以退出码 0/1 为准。
6. **Vercel**：建立独立项目并关联现有仓库，Root Directory=`apps/dsa-web`，Install=`npm ci`，Build=`npm run build:cloud`，Output=`dist`。仓库内 `vercel.json` 已提供这些配置及 SPA 深链接规则。`/api` 返回 404，不会创建无消费者任务。生产分支由你按实际仓库选择。构建仅安装 Web 依赖。
7. **前端公开配置**：Production 只填写正式 Supabase 的 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`；可选 `VITE_CLOUD_REPORT_PAGE_SIZE=20`（1～100）、`VITE_CLOUD_TIME_ZONE=Asia/Shanghai`。`build:cloud` 固定选择云端入口；开发时在 `apps/dsa-web/.env.local` 设置 `VITE_DATA_BACKEND=supabase`。普通 `npm run build` 仍默认本地模式，输出根目录 static。云端缺配置显示配置错误，不退回 SQLite。
8. **环境隔离**：Preview/Development 使用独立测试项目及测试账户。没有测试项目时不给 Preview 配置 Supabase URL/Key，页面会停在配置错误状态；不要复制 Production 变量。云端项目不设置任何 VITE_* 高权限 Key；客户端会拒绝误填的 Secret Key 或 service_role JWT，但构建产物内出现真实密钥时仍应立即轮换，不能依赖运行时检查补救。
9. **域名（阶段 D）**：在 Vercel 添加计划中的 stock 子域名，Cloudflare 仅增加该子域名 CNAME 和必要验证 TXT，目标以 Vercel 项目实际提示为准，DNS only。不要修改根域 NS、已有记录或 CruxSet 服务。Supabase Site URL 设为实际生产站点；此版本是密码直登，没有 OAuth/邮件回调路由，不配置虚构 callback 或通配 Preview Redirect URLs。后续新增邮件/OAuth 时再增加精确回调。
10. **费用/执行器**：仅使用明确指定的独立免费测试资源，不升级套餐或修改已有 DNS。当前默认域名测试部署及验证状态见 [验证记录](vercel-supabase-validation.md)。`ENABLE_ACTIONS_DISPATCH=false`；设 true 会在配置验证时报告未实现。既有工作流未扩展。网页自动触发 Actions 不属于 A～C 的依赖。

```sql
-- 替换为实际 Auth 用户 UUID；只在可信管理环境执行。
insert into public.app_members(user_id) values ('<AUTH_USER_UUID>');
-- 停用示例（需要时由所有者执行）：
-- update public.app_members set enabled=false where user_id='<AUTH_USER_UUID>';
```

## 首次闭环与无模型费用的发布测试

先用现有报告或自行创建一份仅含虚构数据的测试 Markdown。以下命令从仓库根目录运行，参数路径由你填写；prepare 不访问云端。不要对第一次连通性测试运行付费分析。

```bash
python -m src.services.cloud_publisher prepare --report <已有报告.md> --user-id <AUTH_USER_UUID> --key <稳定导入键> --output-dir <私有目录> --dry-run
python -m src.services.cloud_publisher prepare --report <已有报告.md> --user-id <AUTH_USER_UUID> --key <稳定导入键> --output-dir <私有目录>
python -m src.services.cloud_publisher publish <输出的发布包.json>
python -m src.services.cloud_publisher publish <同一发布包.json>
```

同一报告/用户/导入键重复 prepare 复用完全相同的已有包；输入不同不会覆盖旧包。修改源文件会改变摘要/时间，重复导入时请直接复用原包。换机器导入应携带原包；同键内容冲突宁可报错，不自动创建重复云端记录。旧 SQLite 保留，当前显式导入单位是已有 Markdown，不批量扫描或自动迁移 SQLite 历史。

自动发布：配置 enabled 后按现有方式运行 `python main.py --stocks <股票列表>`，流水线汇总报告出口产生 `reports/.cloud-publish/<task_uuid>.json`（具体根目录沿用原报告落点），权限 0600；目录 0700。包中含私人正文，请不要上传到 Git、共享缓存或公开 Actions artifact。自动发布失败后使用独立 publish 重试，**不重新调用模型**。本轮正文直接从生成结果捕获，避免并发运行覆盖共享日报后串报告。仅 `pipeline.run` 的汇总出口自动接入；单独的大盘报告、单股 API 或其他已有产物可用 prepare 显式发布，不假装所有旧出口都已自动同步。

登录后点击刷新，应能看到新报告，无需重新构建。报告索引分页，正文按需获取。状态只有未完成发布时按 5 秒轮询，失败退避至最多 60 秒；后台标签暂停、返回时查询，终态停止。换用户、退出、会话 token 刷新均卸载前一会话数据；页面无共享报告缓存。没有 Realtime。

SDK 固定为 `@supabase/supabase-js@2.109.0`，保留仓库 Node 20 构建兼容性；[官方支持策略](https://github.com/supabase/supabase-js#support-policy)指出 2.110 起不再支持 Node 20。未来运行环境升级时应连同 SDK 一起评估。

CI 的现有 web-gate 在 Web 或 supabase/** 变更时执行 lint、原构建、`npm run test:cloud` 和云端构建；云端单测不使用 Secrets、不访问真实项目，不扩展每日分析工作流。

## 失败核对与孤立附件清理

上传失败与模型失败分开：publish 命令错误退出，流水线记录云端失败但保留原分析/通知；数据库可显示 publish_failed。开始发布 RPC 之前的配置/网络失败不会伪造云端任务，硬终止后可能仍显示 publishing。先检查发布包与网络，再重复 publish；成功状态不会被迟到的失败覆盖。

若决定放弃未成功的发布，先停止同一包的所有发布进程，然后：

```bash
python -m src.services.cloud_publisher cleanup <发布包.json>
# 上一步为默认 dry-run，不改状态/文件。确认放弃此未发布任务后才执行：
python -m src.services.cloud_publisher cleanup <发布包.json> --apply
```

apply 先锁定任务、检查归属/摘要和不存在报告，事务标记 cancelled，再删除该任务的确切对象；不能删除已发布报告。删除失败可重复 cleanup；已经取消的任务不能重试发布，若重新需要应 prepare 新键。若原上传进程在取消后才完成上传，可能再次出现不可读孤立对象，停止进程后重复 cleanup 即可。此命令不清理历史报告、不遍历整个 bucket；没有发布包的孤立数据需要管理员核对后处理，不默认删除。

## 备份、恢复与回滚

- 数据库和对象是两份备份。先暂停发布，使用可信数据库连接的 `pg_dump`（交互密码或安全 `.pgpass`，不在参数中写密码）或 Supabase CLI `supabase db dump` 分别导出 schema/data/必要角色；确认包括业务表及恢复身份所需 Auth 数据。备份文件加密保存在仓库外，包含私人数据。
- 使用 Storage Dashboard 下载 `analysis-reports` 对象，或官方 Storage 导出/S3 工具按原始路径保存对象及清单。**数据库里的 storage.objects 元数据不是文件备份**；源码和发布包也不代替完整数据库备份。参考 [Storage 文件导出](https://supabase.com/docs/guides/storage/management/download-objects)。
- 恢复先在隔离项目演练：恢复/重建 Auth 用户并保持 UUID 映射，恢复业务表和授权，使用 Storage API 上传原对象路径。不要仅 INSERT storage.objects 来伪造已恢复的文件。若无法保持原用户 UUID，需要经审查的显式 ID 映射迁移，不能直接把旧报告归给任意新用户。
- 验证两位用户各自报告和附件，再决定是否切换 Production URL/公开 Key/可信发布 Key。切换期间暂停发布，避免写入两个权威数据库。
- 回滚应用：关闭 `SUPABASE_PUBLISH_ENABLED`，使用原有本地 Web 构建/CLI，或 Vercel 回退上一个部署；保留新增云端表、bucket 和报告，不执行 DROP/清库。撤销/轮换云端密钥独立操作，不影响本地分析历史。

## 上线前必须完成的远端验收

在专用测试项目中创建两个已确认且启用的用户 A/B。各发布一份虚构报告：

- A/B 分别通过页面及直接 Data API 查询 watchlists/tasks/reports，只能看到本人行；请求对方 task_id 返回空或拒绝，不能仅依据 UI 判断隔离。
- 匿名请求不能读取业务表；普通用户直接 POST/PATCH/DELETE task/report/member，及调用发布/清理 RPC 均被拒绝。自选股写入其他 user_id、修改 owner、重复唯一键应失败，跨用户删除不能影响对方记录。
- A 能 authenticated download 本人附件；B 和匿名即使知道 A 的准确 bucket/path 也失败；`/object/public/analysis-reports/...` 不可读。普通用户上传、覆盖、删除都失败。没有对应报告的孤立对象即便路径正确也不可读。
- 停用 A 后，其新的 Data API/Storage 请求失败或为空；恢复 enabled 后可读。已有设备副本/已签发签名 URL 的撤销语义不等同于 RLS；本应用不生成签名 URL。
- 重复 publish 不重复建报告；上传失败没有成功报告，完整包重试能恢复；提交响应超时后重试能识别已成功状态。发布后页面刷新可见，不重新部署。
- 首次密码登录、退出、改密、刷新会话、用户切换、报告深链接刷新、分页、附件下载及后台暂停轮询；无登录时深链接回到登录，登录后仍打开该报告。
- Vercel `/api/tasks` 返回 404，浏览器没有“立即分析”投递能力，不产生永远 queued 的任务。
- 生产域名 HTTPS、手机/电脑无代理分别检查 Auth、Data API、Storage；页面可访问不等于全链路可达。不承诺大陆访问性能。

本地 PostgreSQL 测试使用 PGlite 执行真实约束、RLS 和 RPC，但 auth/storage 基础表是最小测试夹具，不运行 Supabase 网关、Auth 服务或对象存储；必须补以上远端验证。浏览器模拟联调也不能替代远端验证。部署参考 [Vercel 配置](https://vercel.com/docs/project-configuration/vercel-json)、[Supabase 密码登录](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)。

中英同步：本次新增中文专题，无既有英文对应页；README 与旧模式文档不改，以避免把新部署语义写入首页或宣称现有部署已迁移。


## 开发回归与数据库保护

运行后端完整回归时，继续使用不含真实 `.env`、SQLite 历史和私有发布包的独立源码副本；不要复制整个工作目录或使用真实报告作为测试夹具。`tests/conftest.py` 会设置临时数据库默认值，在各测试之间恢复环境变量和 Config/DatabaseManager 单例。SQLite 的连接审计会在打开文件前拒绝应用默认数据库及启动环境/配置文件指定的数据库，URI 与软链接也会解析后检查。测试显式使用 `tmp_path`、临时目录或内存库仍可运行。

如果收到 `pytest refused to open an application database`，应修复对应测试的临时数据库设置；不要关闭保护，也不要移动或删除历史数据库来让测试通过。这是测试进程内的保护，不会修改 Python 正常运行时的数据库配置，也不能追溯证明修复之前的测试没有接触过历史数据。


## 可重复的远端权限验收

在单独忽略的测试配置文件中填写已有发布配置，以及 `VITE_SUPABASE_PUBLISHABLE_KEY`、`DSA_TEST_A_EMAIL`、`DSA_TEST_A_PASSWORD`、`DSA_TEST_B_EMAIL`、`DSA_TEST_B_PASSWORD`。这些测试账户字段只供手动验收，不参与应用启动。A/B 必须是不同账户，各至少已有一份成功报告；发布用户 UUID 必须属于其中之一。不要在命令参数或聊天中传密码。文件仅按字面值读取，不做环境变量插值。

```bash
# 默认只验证配置，无网络请求。
python scripts/verify_cloud_access.py --env-file <私有测试配置文件>
# 明确连接配置指向的项目，创建临时登录会话并验收。
python scripts/verify_cloud_access.py --env-file <私有测试配置文件> --run
```

脚本不发布/删除报告，不变更成员或密码；管理员密钥仅用于读取现有成功报告及任务。随后以 A/B 和匿名身份检查数据库、认证下载、公开下载及发布 RPC 权限，再刷新和注销本次登录会话。发布 RPC 的拒绝检查复用已成功任务，清理探测固定 `p_apply=false`。返回码 0 表示全部所选检查通过，非 0 表示至少一项失败；输出仅含固定检查名和 HTTP 状态，失败时仍尽力注销。

这不代替浏览器交互、全量写入权限矩阵、网络故障恢复或备份演练。若任一用户尚无报告，脚本会明确失败，不会自动创建或导入历史数据。


## 当前独立项目的后续部署

当前 Vercel 项目尚未关联 Git，使用的是只包含 Web 源码的独立副本，Root Directory 为 `.`。在新准备的 Web 副本中（包含 package.json、锁文件、src、public、Vite/TypeScript 配置、vercel.json、.vercelignore，不包含任何 `.env*`、node_modules、dist）执行：

```bash
vercel link --project <已确认的独立项目名> --scope <免费团队标识>
vercel deploy --prod --scope <同一团队标识>
```

先确认 link 指向已有 DSA 项目而不是其他服务。当前两个 Production 公开变量已保存在项目中，无需复制本地 Secret Key。link 可能生成 `.env.local`（含临时 Vercel OIDC 信息）；仓库的 `.vercelignore` 明确排除它。不要在未检查文件清单的整个仓库根目录执行 deploy。每次部署前执行 Web 测试、lint、两种构建和 `npm audit`，部署后复核 `/api/tasks` 404、报告深链接、登录阅读与下载。

未来若改用 Git 集成，先按仓库规则确认并提交/推送代码，再将 Vercel Root Directory 设为 `apps/dsa-web`；这与当前单独上传 Web 副本的 `.` 配置不同，不要混用。

## 备份恢复演练与重复执行

2026-09-16 已完成一次独立 Free 项目恢复，详细证据见 [验证记录](vercel-supabase-validation.md)。线上项目保持不变；恢复项目用于演练，不自动替换 Vercel 的公开变量。

此次范围为 `public` 业务 schema/data、`auth.users` / `auth.identities`（保留 UUID 与密码哈希）、Storage bucket 安全配置、6 条自定义 Storage policy 和实际附件字节。旧会话/刷新令牌不迁移，恢复后重新登录。不是整个 Supabase 平台镜像：Auth 平台设置、邮件、密钥、域名、项目配置需要另行配置；MFA、SSO、Vault 等有数据时，必须扩大备份范围后再执行。本次源项目这些额外身份/加密能力未使用。

重复演练步骤：

1. 准备新的独立空项目，关闭注册与匿名登录。使用 Session pooler、项目下载的 CA 证书和 `sslmode=verify-full`；密码只读本地私有配置或安全密码文件。先核对数据库用户所属项目、API 项目、源目标不同，以及目标业务表、Auth 用户、bucket/object 和自定义 Storage policy 均为空。
2. 使用兼容服务器主版本的官方 `pg_dump` / `pg_restore` / `psql`；本次服务器 17.6、客户端 17.11，工具在仓库外安装并校验官方仓库签名和包摘要。检查 Auth 表列结构与 managed migration 版本一致。
3. 保持发布静止，用只读 repeatable-read 连接导出同一 snapshot，分别执行 `pg_dump --snapshot=... --format=custom --schema=public` 和 `pg_dump --snapshot=... --data-only --table=auth.users --table=auth.identities --no-owner --no-privileges`。单独保存 Storage policy 定义和 bucket 配置，通过 Storage API 下载对象；禁止用直接 INSERT storage.objects 代替文件恢复。
4. 保存行数、完整行摘要、对象路径/字节数/SHA-256 和备份文件摘要。新的只读连接复核源业务数据未变化、附件等于报告正文；若不同，调查并重新取得一致备份。备份在仓库外加密，解密密钥另存。恢复必须从加密包解密并校验，而不是直接使用导出工作目录。
5. public schema 在目标已存在，跳过 archive 中仅创建该 schema 的 TOC 项。Supabase 的 `supabase_admin` 默认权限不能由项目 postgres 重设：仅在源目标默认权限完全一致时，跳过对应 3 项 DEFAULT ACL；保留 postgres 默认权限和应用 ACL。不要忽略整个恢复过程的错误。
6. **必须抵消目标默认授权。** 新表/函数会继承目标默认权限，单纯重放 pg_dump 的 GRANT 可能留下 anon/authenticated 的额外权限。在同一恢复事务内，完成 Auth/业务导入后，先撤销 public、anon、authenticated、service_role 对应用表/函数的权限，再从 archive 重放应用 TABLE / COLUMN / FUNCTION ACL；逐项检查列权限。仅限核对过的独立空目标和应用对象，不能对运行项目套用广泛 REVOKE。
7. 自定义 Storage policy 若从默认 search_path 下的 `pg_policies` 导出，可能含未限定 schema 的表名。`pg_restore` 输出会清空 search_path，执行这些 policy 前需显式设置 `search_path = public, pg_catalog`，或在导出时生成完整限定名称。Auth、业务和 policy SQL 使用 `psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1`，任何错误整笔回滚。
8. 数据库提交后，以 Storage API 创建私有 bucket 并按原路径上传，禁止覆盖已有对象。这一步与数据库不构成分布式事务；上传失败时保持目标隔离，检查清单后仅补齐缺项，不能绕过空目标保护盲目全量重跑。
9. 验证所有业务/Auth 行摘要（登录测试前）、用户 UUID、表/列/函数授权、默认权限、RLS、策略、约束、索引、bucket 限制、附件摘要。再执行双用户访问脚本和浏览器登录、报告/下载、跨用户与匿名拒绝、写权限测试。验收临时数据按本次精确 ID 清理，历史报告保留。
10. 通过后移除本次生成的明文临时导出，保留加密包和分开保存的密钥。当前仅本机保存；异地副本、定时备份、保留策略和灾难切换需另外落实，不能由一次恢复成功推断已经具备这些能力。

回滚边界：本次不切换线上站点，不清理源数据。恢复中断时保持演练目标隔离，数据库事务失败应确认目标仍为空；若已提交数据库后失败，禁止自动删除目标数据或重建项目。

## 当前正式入口（2026-09-17）

正式域名为 `https://stock.xinyilab.top`，原 `https://daily-stock-analysis-psi.vercel.app` 继续指向同一项目，不强制跳转。Cloudflare 的 stock CNAME 指向 Vercel 为当前项目分配的 `121a074ebb43793c.vercel-dns-017.com`，使用 DNS only；今后更换项目时应重新读取 Vercel 推荐值，不机械复用此值。

源 Supabase Site URL 已更新为正式域名，现有邮箱密码登录不需要新增回调路由。若以后引入邮件找回密码、OAuth 或魔法链接，应先实现对应回调页面，再增加精确 Redirect URL。域名、证书、权限边界、网络限制及回滚见 [正式域名验收记录](vercel-supabase-validation.md)。
