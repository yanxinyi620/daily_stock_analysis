# A～C 验证记录

> **历史验收记录，保留有效事实（2026-09-18）。** 阶段 A～C 为旧报告发布方案编号，不代表 [当前 Runner 方案](vercel-supabase-plan.md) 的 Phase A～C 已完成。新 Runner、任务 API、聊天云端存储和每日综合 Actions 均须单独验收。下文“原稿未覆盖”等描述指各历史验收当时；本轮已给原稿追加弃用标记。

本次为增量开发，未提交或推送。用户已在独立 Supabase 项目执行迁移并创建两个测试成员。用户原稿 `docs/daily_stock_analysis_codex_plan.md` 未覆盖；请求路径不存在，实际依据见实施审计文档。

## 正式域名上线验收（2026-09-17）

- 正式入口为 `https://stock.xinyilab.top`，绑定现有 Vercel DSA 项目，默认 `daily-stock-analysis-psi.vercel.app` 保留，不做强制重定向。Vercel 域名校验 `verified=true`，DNS 配置 `misconfigured=false`。
- Cloudflare 新增唯一 `stock` CNAME → `121a074ebb43793c.vercel-dns-017.com`，DNS only、TTL Auto。通过 API 完整比较，原有 2 条 DNS 记录和根域 NS 未变化；没有修改腾讯云注册商或 CruxSet 服务。
- Vercel 证书 `cert_F8V94NVCr9cXOSNSVuXFA618` 已签发，自动续期开启。HTTPS 验证未跳过证书检查。
- 原 Supabase 项目 Site URL 从 `http://localhost:3000` 改为 `https://stock.xinyilab.top`；读取前后配置比较，仅 `site_url` 变化，原 Redirect URLs 为空并保持不变。当前邮箱密码登录不需要独立回调路由，未添加通配回调；恢复项目未修改。
- 无代理、未指定 IP 的真实 Chromium 浏览器验收通过：A/B 原密码登录、自选股新增/编辑/删除、本人报告、深链接刷新、Markdown 下载、跨用户详情拒绝，以及等待远端退出响应后关闭页面。只清理本次临时自选股，保留原报告。
- 网络边界：当前环境的代理路径访问正式域名曾返回 TLS EOF/连接关闭，去除进程代理配置后通过；原默认域名在无代理请求中曾超时，代理路径可达。不能将本机验收推断为所有地区/代理/手机网络均可达，未修改全局网络设置或为此增加 CDN。
- 证据保存在仓库外 `/tmp/dsa-cloud-evidence/domain-browser-direct.log`、`domain-A-detail.png` / `domain-B-detail.png`，截图账户信息已遮挡。平台变更前配置另存本机私有目录用于回滚，管理凭据未进入仓库、日志或前端。
- 本轮无运行代码修改，文档检查使用 `git diff --check`；中文专题无对应英文文档，未改 README。未提交、推送或开通付费资源。
- 回滚只涉及本次新增 stock CNAME、Vercel 自定义域名和 Site URL（原值如上）；默认生产域名仍保留。无需删除数据库、Storage 或历史报告。

## 独立项目备份恢复验收（2026-09-16）

- 源 `daily-stock-analysis` → 独立目标 `daily-stock-analysis-restore`；两边 PostgreSQL 17.6。用户提供 CA 后，两条 Session pooler 连接均以 verify-full 成功；目标公开注册/匿名登录关闭已通过远端接口复核。
- 同一只读 snapshot 导出业务 schema/data 与用户身份；4 个 Storage 附件另存。生成 AES-256 加密包，解密后验证 manifest 和文件摘要，再实际恢复。源项目只读访问，没有切换 Vercel 或删除源数据。
- 恢复后、登录测试前，6 张表的数量和完整行摘要均一致：成员 2、自选股 0、任务 4、报告 4、Auth 用户 2、身份 2。4 个对象的大小和 SHA-256 全部一致。
- 表/列/函数权限、默认权限、RLS、全部应用与 Storage policy、约束、索引和 bucket 限制均与源一致。验收发现并处理目标默认授权叠加问题：重置目标应用对象权限并从 archive 重放精确 ACL，随后重新比较通过。
- 恢复过程前两次事务分别因托管管理员 DEFAULT ACL、policy 的 search_path 依赖失败，均整笔回滚；确认空目标后修正恢复流程。最终成功包含 6 条 Storage policy 和 4 个附件，不把失败尝试当作成功证据。
- 恢复项目真实 API 验收通过：A/B 原密码及 UUID、本人报告/附件、跨用户与匿名拒绝、4 个发布 RPC 拒绝、刷新/退出；真实写权限测试通过，仅清理本次临时自选股及孤立对象。
- 本地 React/Vite 页面连接**真实恢复项目**的 Playwright 浏览器验收通过：A/B 密码表单、自选股新增/编辑/删除、本人报告、深链接刷新、下载、跨用户详情拒绝、退出。此项不是恢复项目的 Vercel 切换验收，线上站点仍连接源项目。
- 加密备份：`/home/yanxi/backups/dsa-cloud/20260916T055551Z/backup.tar.gpg`；密钥单独保存在本机私有目录，未写入仓库。备份与密钥仅本机保存，尚无异地副本。
- 仓库外证据：`/tmp/dsa-cloud-evidence/restore-data-verification.log`、`restore-access.log`、`restore-write-check.log`、`restore-browser.log`，以及账户信息已遮挡的 `restore-A-detail.png` / `restore-B-detail.png`。登录测试会更新恢复项目 Auth 的登录时间，完整 Auth 行摘要比较在登录前完成。
- 收尾复核：恢复项目保留 2 个成员、4 份报告、4 个对象，自选股和测试会话/刷新令牌均为 0。浏览器脚本已等待远端退出响应后才关闭页面；遗留测试会话只在恢复项目撤销。源数据摘要未变化；本次 5 个明文临时导出目录已移除，加密包、独立私有密钥及验收证据保留。
- 本轮仓库仅补充中文部署/验收文档与 changelog，`git diff --check` 通过；未改运行代码，因此未重复运行先前已通过的全部单元测试。这些专题没有对应英文文档，未改首页 README。
- 备份仅覆盖本应用所需数据；旧会话不迁移。Auth 平台设置、邮件、密钥、域名、完整平台镜像、异地备份与自动灾难切换不在本次通过范围。

## 后续验收最新结果（2026-09-15）

以下为后续修复后的结果；后面的初始开发表保留为历史记录，不代表当前仍有那些失败。

- 数据库隔离根因：旧测试 tearDown 删除 DATABASE_PATH，单例重建后回落应用默认路径。已增加测试间环境/单例恢复和 SQLite 打开前的保护；启动自定义路径、dotenv 两种插值优先级、URI 与软链接均覆盖。Windows URI 已按平台解析，但未在 Windows 实机运行。
- 独立无真实配置/历史数据副本的 `ci_gate.sh`：**5900 passed、4 deselected、503 subtests passed**，语法、关键 flake8 与确定性脚本也通过。该全套在第一版隔离修复上启动；其后补充的插值/URI 边界和新验收脚本，最终以 **79 项**（数据库保护 11、验收脚本 10、配置注册表 58）专项通过验证。
- 前端完整测试 **1169 passed、2 skipped**；两项旧断言已按当前系统报告置顶、告警三市场契约修正。另修复本地登录返回地址允许反斜杠/控制字符的问题，参数化回归先红后绿。
- `npm ci`、lint、普通构建、云端构建通过；lint 仍为一个既有 MobileChatPage hook 警告。Node **20.20.2** 下云端 15 项及两种构建也通过。
- 安全依赖升级保持原主版本：Axios 1.18.0、React Router 7.18.2、Vite 7.3.5、Vitest 4.1.11，更新相应传递依赖；Supabase 仍精确 2.109.0。最新 `npm audit` 为 **0 项已知漏洞**，不表示不存在未知漏洞。此前 22 项均来自原有锁定依赖。
- 新增 `scripts/verify_cloud_access.py`，默认不联网，明确 `--run` 后验证现有报告。10 项离线测试及真实测试项目运行全部通过；输出脱敏，会话在 finally 尽力注销。
- 新部署 **`dpl_DzYoPJoeguFrupDVqoz9RgJFEesD`** 已替换默认域名 https://daily-stock-analysis-psi.vercel.app 的旧版本，远端 npm ci 同样报告 0 漏洞。仍为原独立 Hobby 项目，仅上传前端源码与公开变量，没有 Git push、域名或付费变更。
- 真实浏览器 A/B **密码表单提交**、自选股添加/编辑/删除、本人报告、深链接刷新、下载、跨用户详情拒绝、退出全部通过。首次自选股脚本因下拉框定位超时，修正验收脚本的定位后通过，未为此修改产品代码。
- 真实网页改密成功，临时新密码登录成功，随后恢复 **A 原密码**并验证原密码登录；测试会话已注销，本地凭据文件未改变。
- 真实写权限：本人自选股新增/修改/删除及重复键拒绝；对方更新/删除无影响；owner 改写拒绝；普通用户对不存在目标的任务/报告/成员 PATCH/DELETE 被拒绝。Storage 孤立附件即使本人也不可读，普通浏览器上传覆盖/删除被拒绝，管理员复核内容未改变。仅清理本次临时自选股和孤立对象，没有删除历史报告。
- 发布恢复：在客户端注入上传前连接失败，远端状态为 publish_failed；注入提交成功后的响应丢失，远端仍为 succeeded；两者重试及再次重复发布都只有一份报告。测试保留两份明确标注虚构的恢复报告及本地重试包，未调用模型。这是带真实远端服务的故障注入，不是物理断网/多机并发压力测试。

仓库外证据：`/tmp/dsa-cloud-evidence/` 下 `backend-safe-full.log`、`final-safety-targeted.log`、`web-security-validation.log`、`node20-security.log`、`dependency-audit-after.json`、`vercel-security-deploy.log`、`reusable-remote-access.log`、`remote-write-check.log`、`real-form-browser.log`、`remote-publish-recovery.log`。新浏览器截图为 `security-A-detail.png` / `security-B-detail.png`，账户信息已遮挡；凭据经标准输入送入浏览器进程，未写入命令参数/操作日志。

## 初始开发验证历史

| 检查 | 实际结果 | 边界 |
| --- | --- | --- |
| 初始 backend-gate | 语法/关键 flake8/确定性检查通过；缺 pytest-timeout 阻止全套启动 | 本地补装测试依赖后继续 |
| 初始 Web 全套 | 1141 passed、2 failed、2 skipped | 两项既有失败见下 |
| 工作区后端全套 | 5870 passed、11 failed | 受本地配置及既有测试隔离问题影响，不作为纯净回归结论 |
| 原 HEAD 独立 archive 复核上述失败 | 10 passed、1 failed | 不含 .env/历史数据，数据库隔离断言仍失败 |
| 当前代码独立副本 backend-gate | 5886 passed、2 failed、4 deselected；503 subtests passed | 发现一项新增 env registry 覆盖遗漏，修复后做受影响专项；另一项是已复现的基线隔离问题 |
| 修复后的后端专项 | **350 passed** | 发布器（19 项）、配置注册表、配置服务/API、单股通知/流水线韧性；在无 .env/历史数据的独立副本运行 |
| 云端 Web + 数据库专项 | **15 passed** | 真实 PGlite PostgreSQL RLS/事务/约束（5项），SDK 边界、账户切换、Markdown、轮询等 |
| Web 全量（功能实现后） | 1154 passed、2 failed、2 skipped | 与初始基线同样两项失败；之后增加两项专项回归并通过，不声称最后重新跑过全部 Web 用例 |
| npm ci / lint | 安装完成；lint 0 errors、1 既有 warning | MobileChatPage 的 chat effect 依赖 warning |
| Node 20.20.2 | test:cloud、npm run build、npm run build:cloud 全部通过 | 保留原 CI Node 20；SDK 精确固定 2.109.0 |
| Python 编译 / 关键 flake8 | 所有改动 Python 文件通过 | 未执行真实行情/付费模型 |
| CLI | main.py --help、prepare --dry-run、相同报告重复 prepare 通过 | 仅虚构 Markdown，唯一私有包，无网络/模型调用 |
| Playwright 浏览器 | 密码登录、自选股新增/移除、报告列表、深链接刷新、安全 Markdown、下载、移动布局、退出通过 | 截获 Supabase HTTP 请求并返回虚构夹具；**本地模拟，不是真实 Supabase** |
| 配置文件 | GitHub workflow YAML / Supabase TOML 解析及关键值检查通过；Vercel 配置按官方 Draft-04 schema 验证通过 | 未运行 GitHub Actions 或 Vercel 部署 |
| 自审 / 独立复查 | 修复并验证并发日报正文覆盖问题；复查 cleanup 终态及权限无阻断发现 | 本地审查，不等于远端验收 |

主要复现命令（仓库根目录）：

```bash
python -m py_compile src/config.py src/core/config_registry.py src/core/pipeline.py src/services/cloud_publisher.py src/services/system_config_service.py tests/test_cloud_publisher.py
python -m pytest tests/test_cloud_publisher.py tests/test_config_registry.py tests/test_system_config_service.py tests/test_system_config_api.py tests/test_pipeline_single_stock_notify.py tests/test_pipeline_optional_service_resilience.py -q --timeout=120
npm --prefix apps/dsa-web ci
npm --prefix apps/dsa-web run lint
npm --prefix apps/dsa-web run test:cloud
npm --prefix apps/dsa-web run build
npm --prefix apps/dsa-web run build:cloud
```

注意：后端全量请在不含真实 `.env` 与应用数据库的独立副本执行。原测试 `tests/test_pytest_database_isolation.py::test_pytest_session_never_uses_application_database` 在原 HEAD 也失败；已有 conftest 的环境隔离无法保证后续重置不回落应用默认路径。后续已修复测试间环境恢复，并增加 SQLite 连接前保护；最新回归结果见后续验收记录。

首轮是在原工作区按仓库指引执行，因此**无法确认全部既有测试均未访问应用数据库**，也没有运行前数据库快照可证明前后数据完全相同。发现后已改用独立副本，不执行数据清理或自动恢复；额外以只读源连接保留了当前数据库的私有快照：`/tmp/dsa-private-db-snapshot-aa1vqx54/stock_analysis.db`（0700 目录/0600 文件，本机临时保护，不是运行前备份）。如需证明历史内容未变化，需要与你已有备份比对。没有把数据库内容放入仓库或公开证据。

Web 基线失败：

- `HomePage > shows market review history in the stock bar`。
- `AlertRuleForm > shows JP/KR options for market region in Chinese UI mode`。

本次新增 env registry 遗漏已修复：将 6 个可信发布设置声明为 Web schema 隐藏项；SUPABASE_SECRET_KEY 在原始配置响应中服务端掩码。受影响 350 项回归通过，但未为此再次重复整个后端全套。

## 远端已验证

2026-09-15：用户在独立 Supabase 项目完成迁移、创建 A/B 账户及成员授权，截图确认两位成员 enabled=true。随后通过本地发布器实际连接托管服务：

- A/B 各发布一份明确标注虚构内容的报告，Storage 上传及发布 RPC 均返回 succeeded。
- 各重复发布一次仍为 succeeded，按 task_id 查询均只有一份报告。
- Publishable key 未登录请求报告表均为 HTTP 401；准确附件路径的公开下载均为 HTTP 400，未返回文件。
- 重试包保存在 Git 忽略的 `.cloud-publish/remote-smoke/`；私钥与测试配置只保存在本地忽略文件中，未打印。

随后使用 A/B 普通账户直接调用托管 Auth、PostgREST、Storage，全部检查通过：

- 密码登录返回预期用户 UUID；成员/任务/报告/自选股列表未包含他人行。
- 按确切任务 ID 读取本人任务/报告各一行，对方任务/报告为空。
- 携带用户身份下载本人附件，内容与原包一致；按准确路径下载对方附件被拒绝。
- 两位用户调用全部四个发布/清理 RPC 均被拒绝；跨用户插入自选股被拒绝。
- 两位用户 refresh_token 换取会话成功，并注销本次测试会话。

真实 Supabase 公开配置下 `npm run build:cloud` 成功；构建完成后扫描产物，未包含本地 Secret key 或 A/B 测试密码。已部署到 Vercel Hobby 独立项目，详见下方。

脱敏执行日志：`/tmp/dsa-cloud-evidence/remote-auth-check.log`。这些是直接 API 的真实远端检查。另已暂时停用 A，确认报告查询为空且私有附件拒绝下载；随后恢复 enabled=true，确认附件重新可读。仍未覆盖所有写操作和故障恢复路径。没有调用行情/模型、触发 Actions、修改自定义 DNS 或 CruxSet 服务，也未开通付费资源。

用户关闭公开注册后，重新 GET `/auth/v1/settings` 实测 `disable_signup=true`、`anonymous_users=false`、Email=true；同时查询确认 A/B 两位成员均保持 enabled=true。仅查询配置验证，未发起真实注册请求。

## Vercel 实际部署（2026-09-15）

- 团队 `DSA`（`dsa-449e`），API 核实套餐为 Hobby；新建独立项目 `daily-stock-analysis`。
- 站点：https://daily-stock-analysis-psi.vercel.app
- 部署 ID：`dpl_3SjuctQNaFS7ZGhNyofuh7sdY1hC`。
- 从只包含 Web 源码的临时副本部署，未上传根目录、历史数据、任何 `.env` 或测试账户凭据；Vercel 仅配置两个公开变量。CLI link 自动产生的本地 OIDC 文件也通过 `.vercelignore` 排除。
- 此次 CLI 上传根目录即 Web 目录，因此云端 Root Directory 为 `.`。未关联 Git；未来关联完整仓库时须改为 `apps/dsa-web`。代码仍未 commit/push。
- 远端 Node 24.x，执行 `npm ci` 与 `npm run build:cloud` 成功。`/` 与报告深链接 HTTP 200；`/api/tasks` HTTP 404。
- A/B 使用真实密码登录取得会话后，通过 Playwright 私有 storage state 恢复到线上浏览器；两者各自报告、深链接刷新、认证附件下载、跨用户详情拒绝、移动宽度及退出全部通过。浏览器未模拟 API；没有在浏览器脚本中记录密码。此测试没有实际填写线上密码表单。
- 截图（顶部账户信息已遮挡）：`/tmp/dsa-cloud-evidence/remote-A-detail.png`、`remote-A-mobile.png`、`remote-B-detail.png`、`remote-B-mobile.png`；执行日志同目录 `remote-browser-A.log` / `remote-browser-B.log`。浏览器已退出并关闭，临时会话文件已移除。
- 云端安装输出报告 22 个依赖漏洞（1 low、6 moderate、15 high）；尚未逐项审计，不因构建成功声称依赖安全检查通过，未运行自动依赖升级。

## 未验证 / 上线前缺口

- 大于一页的真实报告分页、其他客户端/地区可达性；密码表单、改密、自选股及主要写入/覆盖/删除权限已验证，完整多场景压力测试未覆盖。
- 自定义域名配置与无代理跨地区可达性；Vercel 默认域名 HTTPS、构建、部署及路由检查已通过。
- 后续若调整 Auth 安全改密/重新认证策略，需重新验收；当前托管策略下已完成改密和原密码恢复，公开注册关闭已复核。
- 真实网络上传中断、提交响应不确定、双进程同时发布/清理；本地协议/事务用例已覆盖对应设计路径，但未运行完整 Supabase 多连接压力测试。
- 手机/电脑无代理访问、异地备份及实际灾难切换；独立恢复演练已通过，Electron 打包、Docker 构建及线上 GitHub Actions 未运行（本次未改变它们的启动/发布流程）。
- 网页自动执行仍未实现，ENABLE_ACTIONS_DISPATCH=false；不属于本阶段上线前提。

全部平台操作与逐项验收见 [部署说明](vercel-supabase.md)。回滚：关闭自动发布并恢复原本地模式或旧前端部署，保留云端表/bucket/历史数据，不执行 DROP。

## 仓库外可视证据

本机可查看（仅虚构夹具）：

- 登录：`/tmp/dsa-cloud-evidence/login.png`
- 桌面报告列表：`/tmp/dsa-cloud-evidence/reports-desktop.png`
- 详情：`/tmp/dsa-cloud-evidence/report-detail.png`
- 移动布局：`/tmp/dsa-cloud-evidence/reports-mobile.png`

截图不入库。创建 PR 时需把这些图片作为附件上传到 PR body/评论或外部证据位置；这些本机路径不是可供远端审查者访问的附件。本次没有创建 PR。
