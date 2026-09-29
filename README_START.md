# 启动命令速查

适用于当前 Linux / WSL 环境，依赖与配置已就绪。以下命令从项目根目录执行，按需选择；前台服务用 `Ctrl+C` 停止。

## 1. 原始完整前端控制台

显式构建本地模式，避免 `.env.local` 中的云端设置使页面切换到云端版：

```bash
VITE_DATA_BACKEND=local npm --prefix apps/dsa-web run build && VITE_DATA_BACKEND=local .venv/bin/python main.py --serve-only
```

打开 <http://127.0.0.1:8000>（默认端口）。此模式保留本地完整控制台，不在启动时自动分析。

已完成本地模式构建后，日常启动可用：

```bash
VITE_DATA_BACKEND=local .venv/bin/python main.py --serve-only
```

若仍显示云端页面，使用第一条命令重新构建并强制刷新浏览器；运行前先停止旧服务。

## 2. 新版本地 Python Runner

```bash
ENV_FILE=.env.runner .venv/bin/python main.py --runner
```

在已部署的云端网页使用单股、大盘复盘和综合分析。Runner 不启动本地网页，使用期间保持进程运行。

`.env.runner` 是独立运行配置，已整合本地分析与云端连接参数；以后修改 `.env` 的模型等设置时，需同步到 `.env.runner`。其数据库连接引用本地 `.cloud-publish/runner-ca.crt`，移动项目目录后需更新证书路径。

## 3. 原始控制台 + 定时分析

先按第 1 节完成本地模式构建，再启动：

```bash
VITE_DATA_BACKEND=local .venv/bin/python main.py --serve --schedule --no-run-immediately
```

按已有定时配置执行，启动时不立即分析；默认访问 <http://127.0.0.1:8000>。

## 4. 仅命令行分析（按需选择一条）

```bash
# 执行个股与大盘分析
.venv/bin/python main.py

# 仅大盘复盘
.venv/bin/python main.py --market-review

# 定时分析，不启动网页，也不立即执行
.venv/bin/python main.py --schedule --no-run-immediately
```

## 5. Docker 原始 WebUI

```bash
docker compose --env-file .env -f docker/docker-compose.yml up -d --build server
```

默认访问 <http://127.0.0.1:8000>。停止：

```bash
docker compose --env-file .env -f docker/docker-compose.yml down
```

## 6. Windows 桌面端源码启动

在 Windows PowerShell 中执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run-desktop.ps1
```

已安装桌面客户端时直接打开应用即可。

## 7. 云端每日自动分析

GitHub → **Actions → 每日股票分析 → Run workflow → 选择 `cloud-full`**。无需启动本机 Runner。
