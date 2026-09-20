# 当前方案：云端 Web + Supabase + 本地 Python Runner

> **有效版本：2026-09-18，取代此前云端化后续开发方案。** 用户本次提供的要求为本轮范围依据。下文保留其完整方案；示例名称不代表代码已实现。审计、兼容决策与实施顺序见 [Runner 实施计划](../superpowers/plans/2026-09-18-local-runner-cloud.md)。
>
> Vercel 托管前端和轻量 API；Supabase 持久化；单一本地 Runner 执行交互分析；GitHub Actions 每交易日一次综合分析。Runner 离线拒绝新任务，不离线排队。此前 Vercel Python Functions 分析路线停止推进。
>
> “始终可以访问”是部署目标，不是免费平台可用性承诺。既有 CLI / FastAPI / 桌面端仍保留；新云端模式不要求启动本地网站。单用户不意味着撤销已有数据库与 Storage 隔离，也不删除现有测试账户或历史数据。

---

# daily_stock_analysis 云端化改造方案

## 1. 本阶段目标

将当前 `daily_stock_analysis` 从“本地完整 Web 应用”调整为：

```text
云端 Web
+
云端持久化数据
+
本地 Python Runner
+
GitHub Actions 每交易日定时综合分析
```

核心目标：

1. `stock.xinyilab.top` 前端始终可以访问。
2. 历史报告、自选股、GitHub Actions 定时产生的综合分析结果始终可以查看。
3. 本地只需要启动一个 Python 服务。
4. 本地 Python 服务在线时，可以执行项目现有的完整分析能力。
5. 本地 Python 服务离线时，禁止提交新的分析任务，不做离线排队。
6. GitHub Actions 每个交易日固定运行一次综合分析，并将结果写入同一套云端数据。
7. 第一阶段只供项目所有者本人使用，不建设多用户、权限体系、配额、计费等复杂能力。
8. 尽量复用现有 React/Vite 前端、Python 分析代码、登录入口、分析逻辑和报告格式，不重新实现第二套业务系统。

---

# 2. 推荐架构

```text
                     Cloudflare DNS
                           │
                           ▼
                  stock.xinyilab.top
                           │
                           ▼
                        Vercel
                 React / Vite Frontend
                  + 少量轻量 Server API
                           │
                           ▼
                        Supabase
           ┌───────────────┼───────────────┐
           │               │               │
          Auth          Postgres         Storage
           │               │               │
           │       ┌───────┴────────┐      │
           │       │                │      │
           │    Watchlist         Tasks    │
           │       │                │      │
           │    Reports           Chat     │
           │       │                │      │
           └───────┼────────────────┘      │
                   │                       │
           ┌───────┴────────┐              │
           │                │              │
           ▼                ▼              │
   Local Python Runner  GitHub Actions     │
   手动交互式分析        每交易日定时分析      │
           │                │              │
           └────────┬───────┘              │
                    ▼                      │
              Analysis Engine              │
                    │                      │
                    └──────────► Supabase ◄┘
```

---

# 3. 各组件职责

## Vercel

负责：

- 托管现有 React/Vite 前端。
- 登录页面。
- 自选股页面。
- 历史报告列表和详情。
- 分析任务页面。
- 问股页面。
- 查看 Runner 在线状态。
- 少量需要服务端执行的 API，例如创建任务。

Vercel **不负责执行耗时 Python 分析**。

不要将：

- 个股分析
- 大盘复盘
- 综合分析
- 选股
- 回测

迁移到 Vercel Functions 中执行。

---

## Supabase

成为云端业务数据的主要持久化位置。

使用：

```text
Supabase Auth
→ 登录

Supabase Postgres
→ 自选股
→ 任务
→ 报告
→ 问股历史
→ 必要业务状态

Supabase Storage
→ 报告附件
→ 图片
→ 导出文件
```

浏览历史数据不能依赖本地 Runner 在线。

---

## Local Python Runner

本地只保留一个 Python 服务。

建议角色名称：

```text
analysis-runner
```

或者：

```text
daily-stock-runner
```

它负责调用现有 Python Analysis Engine。

支持：

- 个股分析
- 大盘复盘
- 综合分析
- 问股
- 选股
- 回测
- 报告生成
- 行情读取
- 新闻搜索
- 模型调用
- 当前项目已有的其他分析能力

不要在本地继续运行：

```text
React 前端开发服务器
完整本地 Web 网站
另一套独立业务数据库
另一套报告浏览系统
```

本地 Runner 可以保留必要：

```text
缓存
临时文件
模型 Token
数据源 Token
调试日志
```

但长期业务数据应以 Supabase 为准。

---

## GitHub Actions

只承担：

```text
每个交易日固定执行一次综合分析
```

不承担网页点击产生的即时任务。

流程：

```text
GitHub Actions schedule
        ↓
判断是否交易日
        ↓
运行现有综合分析
        ↓
生成报告
        ↓
写 Supabase Postgres
        ↓
上传必要附件至 Supabase Storage
        ↓
网页可以随时查看
```

GitHub Actions 与 Local Runner 应尽量调用同一套 Python Analysis Engine。

不要分别维护：

```text
github_analysis.py

和

local_analysis.py
```

两套业务实现。

---

# 4. 本地 Runner 与云端通信方式

## 不允许浏览器直接连接本地电脑

不要设计：

```text
浏览器
→ http://192.168.x.x:8000
```

也不要第一阶段引入：

```text
公网 IP
端口映射
Cloudflare Tunnel
WebSocket Tunnel
```

本地 Runner 应主动连接 Supabase。

推荐协议：

```text
heartbeat
claim
progress
outputs
complete
```

这与分析执行器天然适配。

---

# 5. Runner 在线状态

新增一个简单的 Runner 状态记录。

例如：

```text
runner_status
```

字段可以包括：

```text
runner_id
status
last_seen_at
version
started_at
current_task_id
```

第一阶段只有一个 Runner：

```text
runner_id = local-primary
```

Runner 每隔例如：

```text
15~30 秒
```

更新：

```text
last_seen_at
```

前端或 Vercel API 根据：

```text
当前时间 - last_seen_at
```

判断 Runner 是否在线。

阈值例如：

```text
60 秒
```

具体值做成配置，不写死在多个地方。

---

# 6. Runner 离线行为

这是本阶段的明确要求。

## Runner 在线

页面显示：

```text
本地分析服务
● 在线
```

允许使用：

```text
个股分析
大盘复盘
综合分析
问股
选股
回测
```

---

## Runner 离线

页面显示：

```text
本地分析服务
○ 离线

最后在线：
2026-09-18 17:20
```

执行类按钮全部 disabled：

```text
个股分析        禁用
大盘复盘        禁用
综合分析        禁用
问股            禁用
选股            禁用
回测            禁用
```

仍然允许：

```text
登录
查看自选股
修改自选股
查看历史报告
查看每日综合报告
查看历史任务
查看历史问股记录
下载已存在附件
```

### 非常重要

Runner 离线时：

```text
不要创建 pending task
```

Vercel 服务端也必须再次验证 Runner 在线状态。

不能只依靠：

```text
前端按钮 disabled
```

如果 Runner 离线：

```text
POST /api/tasks
```

应直接返回明确错误，例如：

```text
RUNNER_OFFLINE
```

并且：

```text
不创建任务记录
```

---

# 7. 分析任务执行流程

用户点击：

```text
分析腾讯控股
```

流程：

```text
Browser
   ↓
Vercel API
   ↓
验证登录
   ↓
检查 local-primary Runner 是否在线
   ↓
在线？
 ┌─┴───────────┐
 │             │
No            Yes
 │             │
拒绝          创建 task
 │             │
 │             ▼
 │         status=pending
 │             │
 │             ▼
 │      Local Runner polling
 │             │
 │             ▼
 │       atomic claim
 │             │
 │             ▼
 │        status=running
 │             │
 │             ▼
 │       Analysis Engine
 │             │
 │             ▼
 │      保存报告/附件
 │             │
 │             ▼
 │      status=succeeded
 │             │
 ▼             ▼
页面提示      页面显示报告
```

---

# 8. Task 模型

第一阶段使用统一任务表，不给每种分析单独建立任务系统。

例如：

```text
analysis_tasks
```

主要字段：

```text
id
user_id
task_type
status

input_json
progress
progress_message

execution_source
runner_id

created_at
started_at
completed_at

error_message
report_id
```

`task_type` 第一阶段支持：

```text
stock_analysis
market_review
composite_analysis
screening
backtest
ask
```

状态尽量简单：

```text
pending
running
succeeded
failed
```

暂时不建设：

```text
复杂 retry 状态
优先级队列
多 runner 调度
自动故障转移
分布式锁服务
任务取消编排
```

---

# 9. Task Claim

即使第一阶段只有一个 Runner，也不要使用：

```text
SELECT pending task
↓
UPDATE running
```

两个完全独立的无保护操作。

应实现一个最小的原子 claim。

目标：

```text
同一个 task
只能被一个 runner claim 一次
```

可以通过 PostgreSQL transaction / RPC 等方式实现。

这也是以后如果增加 Cloud Runner 时能够直接复用的基础。

---

# 10. Runner Polling

Runner 启动后：

```text
while running:
    heartbeat()
    claim_task()
    if task:
        execute(task)
    sleep(...)
```

轮询间隔第一阶段可以简单使用：

```text
2~5 秒
```

不用引入：

```text
Redis
RabbitMQ
Kafka
Celery
Supabase Realtime
WebSocket
```

第一阶段优先简单。

---

# 11. 前端任务状态

任务运行期间：

```text
Vercel 页面
→ Supabase
→ 查询 task status
```

第一阶段使用轮询：

```text
每 3~5 秒
```

不使用 Realtime。

终态：

```text
succeeded
failed
```

出现后停止轮询。

后台标签页可以降低或暂停轮询。

---

# 12. 问股

问股第一阶段也采用简单任务模式。

不要为了保留逐 token streaming 引入复杂实时连接。

流程：

```text
输入问题
↓
创建 ask task
↓
Local Runner 执行
↓
生成完整回答
↓
保存 chat message
↓
页面显示回答
```

页面可以显示：

```text
正在思考...
```

但第一阶段不要求：

```text
逐 token streaming
WebSocket
实时工具调用日志
```

历史聊天存储到 Supabase。

本地 Runner 离线：

```text
问股输入框禁止提交
```

---

# 13. 自选股

自选股完全云端化。

```text
Browser
↓
Supabase
↓
watchlists
```

不依赖 Runner。

Runner 执行综合分析等任务时，从 Supabase 读取当前自选股。

不要：

```text
云端修改自选股
↓
改写本地某个 config 文件
```

Supabase 中的数据为主要来源。

---

# 14. 报告

所有新报告应写入统一云端报告表。

例如：

```text
analysis_reports
```

报告来源包含：

```text
local_runner
github_actions
```

网页不需要关心报告是谁生成的。

例如：

```text
2026-09-18 综合分析
source = github_actions

2026-09-18 腾讯控股
source = local_runner
```

都在同一个历史报告列表查看。

---

# 15. Storage

大文件不要放数据库。

例如：

```text
HTML
Markdown 附件
PDF
PNG
CSV
回测导出文件
```

放：

```text
Supabase Storage
```

数据库保存：

```text
object_path
```

而不是永久保存 signed URL。

第一阶段只迁移实际需要展示或下载的附件。

---

# 16. GitHub Actions 每日任务

GitHub Actions 不参与普通网页任务。

只运行：

```text
daily composite analysis
```

流程建议：

```text
schedule trigger
↓
Python 判断今天是否交易日
↓
非交易日
→ exit 0

交易日
↓
读取 Supabase 自选股/必要参数
↓
运行 Composite Analysis
↓
创建/更新 task
↓
生成 report
↓
上传附件
↓
写 Supabase
↓
完成
```

GitHub Actions 使用：

```text
GitHub Secrets
```

保存：

```text
SUPABASE
模型 API Key
数据源 Token
搜索 API Key
```

不得从网页读取本地 Runner 的 `.env`。

---

# 17. GitHub Actions 与 Local Runner 共用代码

目标代码关系：

```text
API / Runner / GitHub Actions
           │
           ▼
      Analysis Engine
```

例如现有服务最终应能从统一入口调用：

```python
analyze_stock(...)
run_market_review(...)
run_composite_analysis(...)
run_screening(...)
run_backtest(...)
ask_question(...)
```

不要因为新架构复制业务逻辑。

---

# 18. 配置管理

第一阶段配置设计保持简单。

## 本地 Runner Secret

继续使用本地：

```text
.env
```

例如：

```text
LLM_API_KEY
SEARCH_API_KEY
MARKET_DATA_TOKEN
```

不要求从网页修改这些 Secret。

---

## GitHub Actions Secret

独立放到：

```text
GitHub Secrets
```

---

## 云端普通配置

例如：

```text
默认模型名称
新闻时间窗口
综合分析参数
回测默认参数
页面偏好
```

如果现有配置页面容易复用，可以逐步放入 Supabase。

如果迁移配置页面需要大量修改：

> 第一阶段允许暂时不支持网页修改 Secret 和复杂系统配置。

第一阶段重点是：

```text
分析能力完整
```

而不是：

```text
运维配置能力全部云端化
```

---

# 19. 登录

保留已经开发的登录入口。

第一阶段：

```text
只创建一个本人账号
关闭公开注册
```

不建设：

```text
管理员/普通用户角色
团队
邀请
配额
计费
复杂权限
```

如果现有 Supabase Auth 已接入：

```text
继续复用
```

不要重新实现密码系统。

---

# 20. 数据迁移原则

云端上线后：

```text
Supabase
=
业务数据主来源
```

本地 SQLite 不再作为新的业务数据主库。

但不要一次删除旧数据。

提供一次性迁移脚本，将需要保留的：

```text
历史报告
自选股
必要聊天历史
必要回测结果
```

迁移到 Supabase。

不要迁移：

```text
可重新生成缓存
临时文件
无价值日志
依赖下载缓存
```

迁移完成后：

```text
不维护 SQLite ↔ Supabase 长期双向同步
```

如果部分分析代码强依赖 SQLAlchemy：

优先评估将现有 Repository / SQLAlchemy 存储层适配到 Supabase Postgres，而不是把全部 Python 数据访问重写成 Supabase SDK。

---

# 21. 本地 Runner 启动形式

最终希望达到：

```bash
python main.py --runner
```

或者：

```bash
docker compose up runner
```

启动后：

```text
连接 Supabase
↓
注册 heartbeat
↓
开始 polling task
↓
等待分析任务
```

不要求启动本地 Web 页面。

停止 Runner：

```text
Ctrl+C
```

云端网页约一分钟后自动显示：

```text
Runner 离线
```

---

# 22. 保留现有 FastAPI 的策略

第一阶段不要直接删除现有 FastAPI。

原因：

```text
便于回归测试
便于本地调试
避免一次性迁移风险
```

但是正式云端网页：

```text
不再依赖浏览器直接访问本地 FastAPI
```

可以逐步将 FastAPI 定位为：

```text
legacy/local debug interface
```

等 Runner 架构稳定后再决定是否精简。

---

# 23. Cloudflare / Vercel 域名

保持：

```text
腾讯云
→ 注册 xinyilab.top

Cloudflare
→ 管理 DNS

stock.xinyilab.top
→ Vercel
```

Cloudflare 继续作为 DNS 管理平台。

Vercel 子域名按照 Vercel 实际提供的 DNS target 配置。

不影响 CruxSet。

---

# 24. 第一阶段明确不做

不要主动增加：

```text
多用户支持
公开注册
复杂角色系统
用户配额
支付
Redis
Celery
RabbitMQ
Kafka
WebSocket
Supabase Realtime
本地服务公网暴露
Cloudflare Tunnel
多 Runner 调度
自动任务迁移到 GitHub Actions
复杂工作流编排
逐 token 问股 streaming
离线任务队列
```

除非现有代码必须依赖其中某项，否则第一阶段不要引入。

---

# 25. 实施阶段

## Phase A：仓库审计

先检查真实代码，不根据本文示例文件名假设项目结构。

确认：

```text
现有 React/Vite 前端
现有登录
现有 FastAPI
现有 Analysis Service
TaskQueue
SQLite / SQLAlchemy
报告存储
Chat
Screening
Backtest
Composite Analysis
GitHub workflows
```

输出：

```text
可直接复用
需要适配
需要新增
暂不处理
```

四类清单。

---

## Phase B：Supabase 云端数据闭环

完成：

```text
Auth
Watchlist
Tasks
Reports
Storage
Chat history
```

及必要 migrations。

把历史报告浏览改成：

```text
Vercel → Supabase
```

此阶段即使本地 Runner 没启动，也应该能够：

```text
登录
查看自选股
查看历史报告
查看报告详情
下载已有附件
```

---

## Phase C：Local Runner

新增最小 Runner：

```text
heartbeat
poll
claim
execute
progress
complete
```

优先接通：

```text
个股分析
```

完成闭环：

```text
网页提交
→ Runner
→ 原 Analysis Engine
→ Supabase
→ 网页查看报告
```

然后依次接：

```text
大盘复盘
综合分析
选股
回测
问股
```

不要同时重写所有模块。

---

## Phase D：Runner Offline UX

完成并验证：

```text
Runner 在线
→ 分析按钮可用

Runner 离线
→ 所有分析按钮禁用
→ API 拒绝任务
→ 不创建 pending task
```

同时：

```text
历史报告
自选股
历史聊天
```

仍然正常。

---

## Phase E：GitHub Actions

只接入：

```text
交易日每日综合分析
```

Actions 与 Local Runner 共用 Analysis Engine 和 Supabase 发布代码。

验证：

```text
无需本地电脑
↓
GitHub Actions 执行
↓
Supabase 产生报告
↓
stock.xinyilab.top 可以查看
```

---

## Phase F：一次性数据迁移与切换

迁移需要保留的历史数据。

切换后：

```text
Supabase
=
主数据源
```

旧 SQLite 保留备份，不再双写。

---

# 26. 验收标准

## 云端基础

本地电脑完全关闭时：

```text
✓ stock.xinyilab.top 正常打开
✓ 可以登录
✓ 可以查看自选股
✓ 可以查看历史报告
✓ 可以查看 GitHub Actions 生成的日报
✓ 可以查看已保存聊天记录
✓ 可以下载历史附件
```

同时：

```text
✓ 分析按钮显示 Runner 离线
✓ 无法提交新分析任务
✓ 数据库中不会留下新的 pending task
```

---

## Local Runner

启动 Runner 后：

```text
✓ 页面自动识别 Runner 在线
✓ 个股分析可以正常执行
✓ 大盘复盘可以正常执行
✓ 综合分析可以正常执行
✓ 问股可以返回完整答案
✓ 选股可以执行
✓ 回测可以执行
✓ 结果都写入 Supabase
✓ 重新打开网页仍可查看结果
```

---

## GitHub Actions

本地电脑关闭：

```text
✓ 交易日 schedule 能执行综合分析
✓ 非交易日不会生成错误报告
✓ 生成的报告进入 Supabase
✓ 与 Local Runner 报告使用同一历史报告页面
✓ 不依赖 Local Runner 在线
```

---

# 27. 给 Codex 的执行要求

请按上述方案改造 `daily_stock_analysis`。

优先原则：

1. 不重新设计现有 Analysis Engine。
2. 不重写现有 React/Vite 页面，优先替换数据访问层。
3. 不一次性删除 FastAPI、SQLite 或旧代码。
4. 先建立 Supabase 数据闭环，再增加 Runner。
5. 本地 Runner 只主动连接云端，不接受公网入站调用。
6. Runner 离线时严禁创建新的分析任务。
7. GitHub Actions 只承担交易日每日一次综合分析。
8. 问股第一阶段不要求逐 token streaming。
9. 不引入 Redis、Celery、Realtime、多用户和复杂调度。
10. 每个阶段都先运行现有测试并补充必要的新测试。
11. 不覆盖当前未提交修改。
12. 不执行生产数据破坏性迁移。
13. 不开通付费资源。
14. 缺少 Supabase/Vercel/GitHub Secret 时，先完成代码、migration、mock 和本地测试，并集中列出需要人工配置的内容。

首先执行只读仓库审计，并给出：

- 当前代码与本方案之间的差异；
- 可以直接复用的模块；
- 需要新增的最小抽象；
- 数据迁移范围；
- 建议实施顺序；
- 风险点。

确认架构后，优先完成 Phase B → Phase C 的最小闭环：

```text
云端查看历史报告
+
Local Runner 在线检测
+
单股分析提交
+
Runner 执行
+
Supabase 保存
+
网页查看结果
```

该闭环通过后，再逐项接入其他分析类型。

最终交付报告必须区分：

```text
代码已实现
本地已验证
真实 Vercel 已验证
真实 Supabase 已验证
真实 GitHub Actions 已验证
仍需人工配置/验证
```

不得将尚未真实联调的部分写成已经完成。
