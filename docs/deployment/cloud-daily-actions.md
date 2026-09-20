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
