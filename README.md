# Spottery Monorepo

三源数据（Sofascore / 球探 / 竞彩）+ 跨源聚合平台的统一仓库。

## 数据库拓扑（单 PG 实例，4 库）

| 库 | 角色 | 写入方 |
|---|---|---|
| `sofascore` | Sofascore 源库 | `crawler_sofascore`（读写） |
| `titan` | 球探源库 | `crawler_titan`（读写） |
| `sporttery` | 竞彩源库 | `crawler_sporttery`（读写） |
| `core` | 聚合/平台库 | `api_service`（读写） |

后端（`api_service`）**可读四库，只能写 core**；对三源库为只读（连接时 `default_transaction_read_only = on` 强制）。

## 目录结构

```
config/paths.json         # 源数据 JSON 路径配置（杜绝硬编码）
db/init/                  # 建库 + 4 库 schema DDL（docker 挂载自动执行）
db/migrate/               # 一次性 JSON→PG 导入脚本
services/crawler-*        # 三个源爬虫服务（sofascore / sporttery / titan）
services/api              # 后端 API（FastAPI，读源库 + workset JSON + 写 core）
frontend/                 # 前端（React 19 + Vite，从旧 spottery_pro 迁移）
docs/                     # 设计文档
```

## 快速开始

```bash
# 1. 准备环境变量
cp .env.example .env       # 填入 POSTGRES_PASSWORD / PG_APP_PASSWORD

# 2. 启动数据库（自动执行 db/init 建库）
docker compose up -d db

# 3. 导入历史数据（三源各一次）
#    sofascore:   npx tsx db/migrate/sofascore_json_to_pg.ts
#    sporttery:   npx tsx db/migrate/sporttery_json_to_pg.ts
#    titan:       python db/migrate/titan_json_to_pg.py

# 4. 启动后端 + 前端（本地开发）
cd services/api && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --port 8000
cd frontend && npm install && npm run dev      # http://localhost:5173
```

## 源数据位置

历史 JSON 数据（约 69 万文件）**不随代码迁移**，保留在原仓库路径（见 `config/paths.json`），作为导入源 + 灾备。待双写稳定后，爬虫改为直接写库。
