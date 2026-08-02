# Spottery 重构架构设计文档

> 版本：v0.1（草案待评审）
> 日期：2026-08-02
> 状态：设计评审中，尚未开始编码

---

## 目录

1. [背景与目标](#一背景与目标)
2. [现状盘点](#二现状盘点)
3. [总体架构](#三总体架构)
4. [仓库组织（Monorepo）](#四仓库组织monorepo)
5. [容器拓扑](#五容器拓扑)
6. [数据库拓扑](#六数据库拓扑)
7. [源库 Schema 设计](#七源库-schema-设计)
8. [跨源映射表设计](#八跨源映射表设计)
9. [平台聚合库 Schema 设计](#九平台聚合库-schema-设计)
10. [可插拔 SourceAdapter 架构](#十可插拔-sourceadapter-架构)
11. [数据流与一致性设计](#十一数据流与一致性设计)
12. [缓存策略](#十二缓存策略)
13. [后端控制面 API](#十三后端控制面-api)
14. [Docker 编排](#十四docker-编排)
15. [迁移路径（三阶段）](#十五迁移路径三阶段)
16. [技术栈决策](#十六技术栈决策)
17. [风险与开放问题](#十七风险与开放问题)

---

## 一、背景与目标

### 1.1 背景

现有系统由 4 个独立仓库组成：

| 仓库                | 职责                    | 技术栈                       | 数据形式                        |
| ------------------- | ----------------------- | ---------------------------- | ------------------------------- |
| `spottery_pro`      | 主平台（前后端+数据库） | FastAPI + React + PostgreSQL | 已有 17 张竞彩表（约 380 万行） |
| `crawler`           | Sofascore 爬虫          | TS + Playwright              | JSON 文件（约 8.8 万）          |
| `spottery/scrapers` | 竞彩爬虫                | TS + Puppeteer               | JSON 文件（约 7 万）            |
| `titan007_pro`      | 球探爬虫                | Python + Playwright          | JSON 文件（约 47 万）           |

当前问题：

- 三个爬虫各自把数据落盘为 JSON 文件，主平台通过**硬编码绝对路径**（`config.py` 里的 `D:\data\...\scrapers\data\jingcai`）去读，跨仓库文件耦合脆弱。
- 主平台只接了竞彩一个数据源，Sofascore / 球探数据未接入。
- 数据无法跨源统一查询、对齐（球队/联赛跨源映射只有手工维护的 Excel/JSON，未入数据库）。
- 无统一编排，本地依赖 `.bat` / `.ps1` / systemd 手动启动。
- 无法扩展新的数据源。

### 1.2 目标

1. **三源数据全部入库**：三个爬虫各自维护自己的 PostgreSQL 源库（不再以 JSON 文件为最终存储）。
2. **统一聚合**：后端读取三源库，计算二次数据（积分榜、近期状态、交锋、赔率汇总、AI 预测等），写入平台聚合库。
3. **跨源对齐**：通过人工维护的映射表（入数据库）实现球队/联赛的跨源统一 ID。
4. **可插拔数据源**：新增数据源 = 新增一个适配器，不改聚合引擎。
5. **Docker 统一编排**：Windows 本地开发，后期迁移 Linux 云服务器。
6. **数据安全**：63 万历史 JSON 数据不能丢，需一次性导入新库，且保留原始 JSON 作为灾备。

### 1.3 关键决策（已确认）

| 决策点       | 结论                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| 仓库组织     | 合并为 **Monorepo**（四个仓库并入 `spottery-master`）                      |
| 数据库拓扑   | **单 PG 容器，4 个 database**（spottery / sofascore / jingcai / titan007） |
| 爬虫技术栈   | **保持各自现有技术栈，不统一**（详见第十六章）                             |
| 爬虫写库方式 | **双写过渡**（PG + JSON 并行，全量对比验证后再关 JSON）                    |
| 聚合库定位   | 只存**聚合/计算结果**，不冗余源库明细                                      |
| 容器拆分     | 三个爬虫**各自独立容器**，暂不合并                                         |
| 缓存         | **第一版不加 Redis**，聚合库 + PG 索引作为唯一存储层                       |
| 映射表       | **JSONB 数组方案**，人工维护后上传，可扩展新数据源                         |

---

## 二、现状盘点

### 2.1 三个爬虫的深度调研结论

#### Sofascore 爬虫（`crawler`，TS + Playwright）

- **反爬**：Playwright 无头浏览器 + `page.evaluate(fetch)` 在浏览器沙箱发请求（TLS/JA3 指纹像真实浏览器）；随机视口 4 组；随机 UA（Chrome 120~134）；覆盖 `navigator.webdriver`；`zh-CN` locale + `Asia/Shanghai` 时区；Referer 校验；限速（并发 5，间隔 200ms+随机 300ms）。
- **数据**：
  - 赛程：`data/schedules_v2/{联赛}/{赛季}.json`，285+ 文件。
  - 详情：`data/details/{联赛}/{赛季}/{matchId}.json`，8.7 万+ 文件，含 pregameForm / votes / lineups / statistics / incidents。
  - 球队统计：`data/details/{联赛}/{赛季}/teams/{teamId}.json`，懒加载。
- **API**：`api.sofascore.com/api/v1`，共 11 个 endpoint（schedule 4 + detail 7）。
- **调度**：一次性脚本，无常驻进程；`crawl-all.ps1` 按 33 联赛优先级编排，`crawl_progress.json` 断点续爬。
- **文件系统耦合**：`fetch-schedules.ts` / `fetch-details.ts` 共约 8 处 `writeFileSync`、7 处 `readFileSync`、6 处 `existsSync/mkdir`。

#### 竞彩爬虫（`spottery/scrapers`，TS + Puppeteer）

- **反爬**：`puppeteer-extra-plugin-stealth`（JS 生态最成熟的 stealth 方案）；随机视口 1280~1479×720~919；3 个 Chrome UA 轮换；代理池（已实现未接入）；超时 30s；故障恢复（重置浏览器 + 10s 等待）；限速 500~3000ms。
- **数据**：
  - daily：`data/jingcai/daily/{YYYY-MM-DD}.json`，3,772 个。
  - 详情：`data/jingcai/matches/{matchId}.json`，65,939 个，含 oddsHistory（HAD/HHAD/TTG/CRS/HAFU 赔率历史）+ matchInfo + recentResults + seasonFeatures + injuries + standings + players + fixtures + headToHead。
- **API**：`webapi.sporttery.cn/gateway/uniform/football`，12 个 endpoint。
- **调度**：node-cron 常驻进程，4 个定时任务（schedule 每 30min / result 每 60min / odds 每 15min）；另有历史批量爬取 run-crawl.ts 两阶段。
- **后端推送**：`api-client.ts` 已实现（POST /scraper/matches、/scraper/odds，X-API-Key 认证，3 次指数退避），但**尚未被任何爬虫调用**。
- **文件系统耦合**：约 30 处（base-scraper 写文件 + historical 两阶段 + repair 脚本 + collectMatchIds）。

#### 球探爬虫（`titan007_pro`，Python + Playwright）

- **反爬**：146 条真实 UA 轮换；`zh-CN` locale + `Asia/Shanghai` 时区；随机视口 1200~1400×800~900；Referer 校验（zq/vip/1x2/nowscore 各不同）；随机延迟 0.5~2s；JS 文件 URL 加随机 `?version=` 参数规避缓存；自动重试（默认 2 次）；**GBK 解码**（JS 数据文件编码）。
- **数据**：
  - schedule：`data/schedule/`，387 文件。
  - analysis：`data/analysis/`，54,345 文件。
  - odds：`data/odds/asian|over_under|european/`，共 41.5 万文件。
- **Pipeline**：schedule / analysis / asian / ou / euro / live 六个，live 由 systemd timer 每 5 分钟触发（P0/P1 节流）。
- **文件系统耦合**：`core/odds_store.py`（save/load）、`core/utils.py`（schedule/match_index/latest_seasons）、各 pipeline inline `json.dump` 共 12 处写入 + 8 处读取。

### 2.2 主平台现状（`spottery_pro`）

- FastAPI 后端 + SQLAlchemy + PostgreSQL 18（Docker 容器 `spottery-pg`）。
- 10 张平台基础表（users / teams / leagues / matches / team_aliases / odds_history / injuries / predictions / briefings / match_source_mappings）。
- 17 张竞彩表（`jingcai_*`，约 380 万行真实数据）。
- `import_jingcai.py`：从竞彩爬虫 JSON 全量导入（Phase A 赛程 + Phase B 详情），幂等 upsert。
- 已有 `routers/scraper/`（matches.py / odds.py）接收爬虫推送的 stub。
- 前端 React 19 + Vite + TanStack Query + Zustand + shadcn/ui。

### 2.3 三源映射管线现状（`mapping/`）

- `league_mapping.json`：三源联赛名对照（sofascore / titan_cn / titan / spottery）。
- `standard_names.json`：两个 section：
  - `sofascore`：(联赛 → 原始名 → 标准名)。
  - `cn_to_en`：任意来源中文/英文变体 → 标准英文名。
- `*_teams.json`：按联赛提取的三源球队名列表。
- 管线脚本：extract → create xlsx → fill_standard_names → create_cross_verify。
- **全部人工维护**（用户编辑 JSON → 运行管线 → 生成核对表 → 补全标准名）。

---

## 三、总体架构

```
┌──────────────────────────── 数据采集层 ────────────────────────────┐
│                                                                     │
│   crawler-sofascore    crawler-jingcai    crawler-titan007          │
│   (TS + Playwright)    (TS + Puppeteer)   (Python + Playwright)     │
│        │                     │                    │                 │
│        写各自源库（幂等 upsert）                        │            │
│        ▼                     ▼                    ▼                 │
│   ┌──────────┐         ┌──────────┐        ┌──────────┐            │
│   │sofascore │         │ jingcai  │        │ titan007 │  ← 源库     │
│   │   DB     │         │   DB     │        │   DB     │             │
│   └──────────┘         └──────────┘        └──────────┘             │
│        └───────────────┬──────────────┘                            │
└────────────────────────┼──────────────────────────────────────────┘
                         │ 后端只读（SourceAdapter）
                         ▼
┌──────────────────── 数据聚合层 ────────────────────────────────────┐
│                                                                     │
│              api/aggregation/engine.py                              │
│                ┌────────────────────┐                               │
│                │  聚合引擎（定时+事件）│                              │
│                │  读源库→对齐→计算→写聚合库 │                          │
│                └────────────────────┘                               │
│                         │ 写聚合结果                                  │
│                         ▼                                           │
│   ┌───────────────────────────────┐                                │
│   │  spottery 聚合库（平台库）        │                                │
│   │  unified_* / aggregated_*     │                                │
│   │  cross_source_* / users/pred… │                                │
│   └───────────────────────────────┘                                │
└────────────────────────────────────────────────────────────────────┘
                         │ 后端 API 只读聚合库
                         ▼
┌──────────────────── 展示层 ────────────────────────────────────────┐
│                      frontend (React)                               │
└─────────────────────────────────────────────────────────────────────┘
```

**数据流核心规则：**

1. 爬虫**只写自己的源库**，不读其他库。
2. 后端**只读三个源库**（只读事务），**读写平台聚合库**。
3. 聚合引擎把跨源计算结果写入聚合库，前端只读聚合库。
4. 源库数据变化 → 爬虫通知后端 → 聚合引擎增量重算受影响行 → 写聚合库。
5. 无消息队列，用「HTTP 回调 + 定时兜底轮询」双保险。

---

## 四、仓库组织（Monorepo）

### 4.1 目录布局

```
spottery-master/
├── docker-compose.yml              # 一键启动全部服务
├── .env                            # 共享环境变量（PG 密码等）
├── .env.example
├── .gitignore
│
├── services/
│   ├── crawler-sofascore/          # 从 D:\data\VSCode_file\vscode_file\crawler 移入
│   │   ├── src/
│   │   │   ├── scrapers/sofascore/ #   爬虫逻辑（原样保留）
│   │   │   ├── config/             #   31 联赛配置
│   │   │   ├── db/                 #   ✨新增：PG 写入层 + schema
│   │   │   │   ├── schema.sql
│   │   │   │   ├── writer.ts       #   upsert 逻辑
│   │   │   │   └── migrator.ts     #   一次性 JSON→PG 导入
│   │   │   └── server.ts           #   ✨新增：HTTP 控制接口（/crawl,/status）
│   │   ├── package.json
│   │   └── Dockerfile
│   │
│   ├── crawler-jingcai/            # 从 D:\data\VSCode_file\vscode_file\spottery\scrapers 移入
│   │   ├── src/
│   │   │   ├── sources/jingcai/
│   │   │   ├── engine/
│   │   │   ├── middleware/
│   │   │   ├── db/                 #   ✨新增：PG 写入层
│   │   │   │   ├── schema.sql      #   沿用现有 17 张 jingcai_* 表结构
│   │   │   │   ├── writer.ts
│   │   │   │   └── migrator.ts
│   │   │   └── server.ts           #   ✨新增：HTTP 控制接口
│   │   ├── package.json
│   │   └── Dockerfile
│   │
│   ├── crawler-titan007/           # 从 D:\data\VSCode_file\vscode_file\titan007_pro 移入
│   │   ├── pipelines/
│   │   ├── core/
│   │   ├── config/
│   │   ├── db/                     #   ✨新增：PG 写入层
│   │   │   ├── schema.sql
│   │   │   ├── writer.py
│   │   │   └── migrator.py
│   │   ├── server.py               #   ✨新增：HTTP 控制接口
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   │
│   └── api/                        # 从 spottery_pro/backend 移入（更名 api）
│       ├── app/
│       │   ├── main.py
│       │   ├── models/             # 仅平台模型 + 聚合模型（jingcai_* 已移出）
│       │   ├── schemas/
│       │   ├── routers/
│       │   │   ├── auth.py / users.py / teams.py / matches.py
│       │   │   ├── internal.py / admin.py
│       │   │   └── source_admin.py #   ✨新增：爬虫触发控制接口
│       │   ├── source_adapter/     #   ✨新增：可插拔数据源适配器
│       │   │   ├── base.py
│       │   │   ├── sofascore.py
│       │   │   ├── jingcai.py
│       │   │   └── titan007.py
│       │   ├── aggregation/        #   ✨新增：聚合引擎
│       │   │   ├── engine.py
│       │   │   ├── match_agg.py
│       │   │   ├── team_agg.py
│       │   │   ├── standings_agg.py
│       │   │   └── scheduler.py
│       │   └── dependencies/
│       ├── tests/
│       ├── requirements.txt
│       └── Dockerfile
│
├── frontend/                       # 从 spottery_pro/frontend 移入（不变）
│   ├── src/
│   └── package.json
│
├── mapping/                        # 从 D:\data\VSCode_file\vscode_file\mapping 移入
│   ├── league_mapping.json         # 三源联赛名对照（人工维护）
│   ├── standard_names.json         # 标准译名映射（人工维护）
│   ├── *.py                        # 管线脚本
│   └── README.md
│
├── db/
│   ├── init/
│   │   ├── 00-create-databases.sql # 建 4 个 database
│   │   ├── sofascore/01-schema.sql
│   │   ├── jingcai/01-schema.sql
│   │   ├── titan007/01-schema.sql
│   │   └── spottery/01-schema.sql
│   └── migrate/
│       ├── sofascore_json_to_pg.ts
│       ├── jingcai_json_to_pg.ts
│       └── titan007_json_to_pg.py
│
├── docs/
│   └── architecture.md             # 本文档
│
└── README.md                       # 项目总说明
```

### 4.2 迁移仓库的操作方式

- 采用「复制 + git 保留历史」方式：各源仓库作为 remote，用 `git fetch` + `git subtree` / `git filter-repo` 将历史并入，或简单拷贝代码后在新 repo 重建初始提交。
- 由于三个爬虫仓库均只有 1~2 个 commit（init + README），**直接拷贝 + 重新初始化提交即可**，无历史包袱。
- 主平台 `spottery_pro` 有完整 git 历史（本地领先 4 个 commit 未推送），建议保留历史迁入。

### 4.3 说明

- 各爬虫的 `data/` JSON 目录**不随代码迁移**（63 万文件太大且已在 gitignore），留在原路径作为 Phase 1 导入数据源 + 灾备。

---

## 五、容器拓扑

最终 **6 个容器**：

| #   | 容器                | 镜像                                | 职责                      | 端口 |
| --- | ------------------- | ----------------------------------- | ------------------------- | ---- |
| 1   | `db`                | postgres:18                         | 单实例 4 库               | 5432 |
| 2   | `crawler-sofascore` | node:22 + Playwright + Chromium     | Sofascore 爬虫            | 3001 |
| 3   | `crawler-jingcai`   | node:22 + Puppeteer + Chromium      | 竞彩爬虫                  | 3002 |
| 4   | `crawler-titan007`  | python:3.12 + Playwright + Chromium | 球探爬虫                  | 3003 |
| 5   | `api`               | python:3.12 + FastAPI               | 后端（读源库 + 写聚合库） | 8000 |
| 6   | `frontend`          | node:22 + Vite                      | 前端                      | 5173 |

**关于浏览器体积**：

- 共 **6 个容器**，其中 3 个爬虫容器各自内置 Chromium（镜像较大，约 500~600MB/个）；db / api / frontend 三个容器镜像很小（不含浏览器）。
- 全部镜像磁盘占用总计约 2.5~3GB。
- 云服务器典型 40GB 系统盘足够。
- 后期优化方向：合并 TS 爬虫共享 Chromium 基础镜像，或引入共享浏览器池。当前**独立容器**以保证稳定性（一个爬虫崩溃不影响其他）。

---

## 六、数据库拓扑

### 6.1 单 PG 实例、4 库

```
PostgreSQL 18（容器 spottery-pg，端口 5432）
├── spottery   ← 平台聚合库（api 读/写，存聚合结果 + 映射表 + 平台表）
├── sofascore  ← 源库（crawler-sofascore 写，api 只读）
├── jingcai    ← 源库（crawler-jingcai 写，api 只读）
└── titan007   ← 源库（crawler-titan007 写，api 只读）
```

### 6.2 用户与权限隔离

| 角色                | 可访问库                       | 权限                                                        |
| ------------------- | ------------------------------ | ----------------------------------------------------------- |
| `crawler_sofascore` | sofascore                      | 读写                                                        |
| `crawler_jingcai`   | jingcai                        | 读写                                                        |
| `crawler_titan007`  | titan007                       | 读写                                                        |
| `api_service`       | spottery                       | 读写                                                        |
|                     | sofascore / jingcai / titan007 | **只读**（连接时 `SET default_transaction_read_only = on`） |
| `postgres`          | 全部                           | 超级管理员（初始化）                                        |

### 6.3 备份策略

**目标**：每日把 4 个库分别导出为备份文件，保留最近 14 天（14 份），防止数据丢失。

**备份命令**（4 库各导出一份，用 `pg_dump -Fc` 压缩格式）：

```powershell
# 在 Docker 容器内导出，再拷到宿主机（沿用现有 backup_pg.ps1 思路）
docker exec spottery-pg pg_dump -U postgres -Fc spottery  -f /tmp/spottery.dump
docker exec spottery-pg pg_dump -U postgres -Fc sofascore -f /tmp/sofascore.dump
docker exec spottery-pg pg_dump -U postgres -Fc jingcai   -f /tmp/jingcai.dump
docker exec spottery-pg pg_dump -U postgres -Fc titan007  -f /tmp/titan007.dump
docker cp spottery-pg:/tmp/spottery.dump  ./backup/spottery-<日期>.dump
docker cp spottery-pg:/tmp/sofascore.dump ./backup/sofascore-<日期>.dump
# ... 其余两库同理
```

**为什么用 `pg_dump -Fc` 分库导出，而不用 `pg_dumpall`**：

- `pg_dumpall` 一次导出所有库 + 用户 + 权限，输出纯 SQL 文本，体积大，且恢复时只能整体恢复。
- `pg_dump -Fc` 每个库一个独立压缩文件，**恢复粒度细**（某个库坏了只恢复那个库，甚至可以只恢复某张表），文件更小。推荐。

**"保留最近 14 份"的含义**：每天生成一份带日期戳的备份文件，脚本自动删除超过 14 天的最旧文件，保证硬盘上永远只有最近 14 天的备份，不会无限堆积。

**改造现有 `backend/backup_pg.ps1`**：当前脚本只备份 `spottery` 一个库。重构后循环处理 4 个库，输出到 `db/backup/`（每库一个目录），同样保留 14 份。

---

## 七、源库 Schema 设计

### 7.1 Sofascore 库

基于 `schedules_v2/`（新版赛程）与 `details/`（比赛详情）的真实 JSON 结构设计。共 **11 张表**。

**建表原则**：
- 有明确实体、需要筛选/聚合的数据（事件、阵容、统计）→ **拆行存关系表**。
- 小结构、整体读、不筛选的数据（赛前排位、投票）→ JSONB。
- 固定字段的指标快照（球队赛季统计）→ **固定列宽表**。
- 源库只存 Sofascore 源 ID，不存跨源统一 ID（跨源对齐在聚合库 mapping 层做）。

```sql
-- ============================================
-- sofascore 库：Sofascore 爬虫数据（11 张表）
-- ============================================

-- ① 联赛表（来自赛程 JSON 顶层 league 对象）
CREATE TABLE leagues (
    league_id       INTEGER PRIMARY KEY,          -- unique-tournament ID
    name            TEXT,                         -- 英文联赛名
    short_name      TEXT,                         -- 中文简称
    slug            TEXT,                         -- URL slug
    country         TEXT,                         -- 国家
    scraped_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ② 赛季表
CREATE TABLE seasons (
    season_id       INTEGER PRIMARY KEY,          -- Sofascore season ID
    league_id       INTEGER NOT NULL REFERENCES leagues(league_id),
    season_key      TEXT NOT NULL,                -- 如 "16/17" / "2024"
    UNIQUE (league_id, season_key)
);

-- ③ 球队表（Sofascore 源球队，只存源 ID）
CREATE TABLE teams (
    team_id         INTEGER PRIMARY KEY,          -- Sofascore 球队 ID
    name            TEXT,                         -- 球队英文名
    country         TEXT,                         -- 国家（若有）
    scraped_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ④ 赛程主表（来自 schedules_v2 的 matches 数组）
CREATE TABLE matches (
    match_id        INTEGER PRIMARY KEY,          -- Sofascore event ID
    league_id       INTEGER NOT NULL REFERENCES leagues(league_id),
    season_id       INTEGER NOT NULL REFERENCES seasons(season_id),
    season_key      TEXT NOT NULL,                -- 冗余赛季标识，查询方便
    slug            TEXT,                         -- 比赛 slug
    home_team_id    INTEGER NOT NULL REFERENCES teams(team_id),
    away_team_id    INTEGER NOT NULL REFERENCES teams(team_id),
    home_score      INTEGER,                      -- 主队比分
    away_score      INTEGER,                      -- 客队比分
    round_num       INTEGER,                      -- 轮次
    round_slug      TEXT,                         -- 轮次 slug
    round_prefix    TEXT,                         -- 轮次前缀
    kickoff_time    TIMESTAMPTZ NOT NULL,         -- 开赛时间
    status          TEXT NOT NULL,                -- finished / postponed / inprogress...
    tournament_name TEXT,                         -- 赛事名称
    scraped_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (league_id, season_id, match_id)
);
CREATE INDEX idx_matches_kickoff ON matches (kickoff_time);
CREATE INDEX idx_matches_league_season ON matches (league_id, season_id);
CREATE INDEX idx_matches_team ON matches (home_team_id, away_team_id);

-- ⑤ 赛程原始文件表（按 联赛×赛季 一份，存整份原始响应灾备）
CREATE TABLE schedule_raw_files (
    league_id       INTEGER NOT NULL,
    season_key      TEXT NOT NULL,
    season_id       INTEGER,
    raw             JSONB NOT NULL,               -- 整份赛程 JSON（含所有比赛）
    scraped_at      TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (league_id, season_key)
);

-- ⑥ 比赛详情单值表（1:1 matches；冗余比分/状态，单表即得详情）
CREATE TABLE match_details (
    match_id        INTEGER PRIMARY KEY REFERENCES matches(match_id),
    season_id       INTEGER,
    referee         TEXT,                         -- 裁判
    venue           TEXT,                         -- 球场
    attendance      INTEGER,                      -- 上座人数
    -- 冗余比分/状态（详情 JSON 顶层本就有，避免查详情还要 JOIN 赛程）
    home_score      INTEGER,
    away_score      INTEGER,
    status          TEXT,
    pregame_form    JSONB,                        -- 赛前排位/近期状态（小结构）
    votes           JSONB,                        -- 赛前投票（小结构）
    data_raw        JSONB,                        -- 原始详情响应（灾备）
    scraped_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ⑦ 阵容球员表（来自 lineups.home/away.players[]，拆行）
CREATE TABLE match_players (
    id              BIGSERIAL PRIMARY KEY,
    match_id        INTEGER NOT NULL REFERENCES matches(match_id),
    team_type       TEXT NOT NULL,                -- home / away
    player_id       INTEGER NOT NULL,             -- 球员 Sofascore ID
    player_name     TEXT NOT NULL,                -- 球员名
    shirt_number    INTEGER,                      -- 球衣号
    position        TEXT,                         -- 位置代码 (G/D/M/F)
    substitute      BOOLEAN DEFAULT FALSE,        -- 是否替补
    rating          FLOAT,                        -- 评分
    minutes_played  INTEGER,                      -- 出场分钟
    total_pass      INTEGER,                      -- 传球总数
    accurate_pass   INTEGER,                      -- 传球成功数
    total_shots     INTEGER,                      -- 射门总数
    saves           INTEGER,                      -- 扑救数
    UNIQUE (match_id, team_type, player_id)
);
CREATE INDEX idx_players_match ON match_players (match_id);

-- ⑧ 伤停球员表（来自 lineups.home/away.missingPlayers[]，拆行）
CREATE TABLE match_missing_players (
    id              BIGSERIAL PRIMARY KEY,
    match_id        INTEGER NOT NULL REFERENCES matches(match_id),
    team_type       TEXT NOT NULL,                -- home / away
    player_id       INTEGER NOT NULL,             -- 球员 ID
    player_name     TEXT NOT NULL,                -- 球员名
    missing_type    TEXT,                         -- 伤停类型（如 "missing"）
    description     TEXT,                         -- 描述（如 "ACL Knee Injury"）
    expected_end_date TIMESTAMPTZ,                -- 预计复出时间
    UNIQUE (match_id, team_type, player_id)
);

-- ⑨ 技术统计表（来自 statistics[]，拆行：period+group+stat_name 一行）
CREATE TABLE match_statistics (
    id              BIGSERIAL PRIMARY KEY,
    match_id        INTEGER NOT NULL REFERENCES matches(match_id),
    period          TEXT NOT NULL,                -- ALL / 1H / 2H
    group_name      TEXT NOT NULL,                -- 统计分组（Match overview / Shots...）
    stat_name       TEXT NOT NULL,                -- 指标名（Ball possession / Total shots...）
    home_display    TEXT,                         -- 主队显示值（如 "47%"）
    away_display    TEXT,                         -- 客队显示值
    home_value      NUMERIC,                      -- 主队数值
    away_value      NUMERIC,                      -- 客队数值
    UNIQUE (match_id, period, group_name, stat_name)
);
CREATE INDEX idx_statistics_match ON match_statistics (match_id);

-- ⑩ 比赛事件表（来自 incidents[]，拆行）
CREATE TABLE match_incidents (
    id              BIGSERIAL PRIMARY KEY,
    match_id        INTEGER NOT NULL REFERENCES matches(match_id),
    time            INTEGER,                      -- 事件时间（分钟）
    incident_type   TEXT,                         -- goal / substitution / period / redcard...
    incident_class  TEXT,                         -- regular / penalty / own_goal...
    is_home         BOOLEAN,                      -- 是否主队方
    player_id       INTEGER,                      -- 相关球员 ID
    player_name     TEXT,                         -- 相关球员名
    assist_id       INTEGER,                      -- 助攻球员 ID
    assist_name     TEXT,                         -- 助攻球员名
    replacement_id  INTEGER,                      -- 换上的球员 ID（换人事件）
    replacement_name TEXT,                        -- 换上的球员名
    home_score      INTEGER,                      -- 事件时主队比分
    away_score      INTEGER,                      -- 事件时客队比分
    reason          TEXT,                         -- 原因（红牌/取消等）
    text            TEXT                          -- 文本（如 "FT" / "HT"）
);
CREATE INDEX idx_incidents_match ON match_incidents (match_id);
CREATE INDEX idx_incidents_type ON match_incidents (incident_type);

-- ⑪ 球队赛季统计表（111 列宽表：107 个统计指标 + 4 个元数据列）
--    注：原 JSON statistics 对象共 111 个字段，其中 4 个为元数据
--    （id / matches / awardedMatches / statisticsType），其余 107 个为统计指标。
--    统计指标均为固定字段，采用固定列宽表（类型安全、可索引、可直接聚合）。
CREATE TABLE team_season_stats (
    team_id         INTEGER NOT NULL REFERENCES teams(team_id),
    league_id       INTEGER NOT NULL REFERENCES leagues(league_id),
    season_id       INTEGER NOT NULL REFERENCES seasons(season_id),
    -- ===== 元数据 =====
    stats_id        INTEGER,                      -- JSON id
    matches_cnt     INTEGER,                      -- JSON matches（场次数）
    awarded_matches INTEGER,                      -- JSON awardedMatches（获赠场次）
    statistics_type TEXT,                         -- JSON statisticsType
    -- ===== 进攻指标 =====
    goals_scored    INTEGER,                      -- 进球数
    goals_conceded  INTEGER,                      -- 失球数
    own_goals       INTEGER,                      -- 乌龙球
    assists         INTEGER,                      -- 助攻
    shots           INTEGER,                      -- 射门
    penalty_goals   INTEGER,                      -- 点球进球
    penalties_taken INTEGER,                      -- 点球次数
    free_kick_goals INTEGER,                      -- 任意球进球
    free_kick_shots INTEGER,                      -- 任意球射门
    goals_inside_box INTEGER,                     -- 禁区内进球
    goals_outside_box INTEGER,                    -- 禁区外进球
    shots_inside_box INTEGER,                     -- 禁区内射门
    shots_outside_box INTEGER,                    -- 禁区外射门
    headed_goals    INTEGER,                      -- 头球进球
    left_foot_goals INTEGER,                      -- 左脚进球
    right_foot_goals INTEGER,                     -- 右脚进球
    big_chances     INTEGER,                      -- 重大机会
    big_chances_created INTEGER,                  -- 创造重大机会
    big_chances_missed INTEGER,                   -- 错失重大机会
    shots_on_target INTEGER,                      -- 射正
    shots_off_target INTEGER,                     -- 射偏
    blocked_scoring_attempt INTEGER,              -- 被阻挡射门
    successful_dribbles INTEGER,                  -- 成功过人
    dribble_attempts INTEGER,                     -- 过人尝试
    corners         INTEGER,                      -- 角球
    hit_woodwork    INTEGER,                      -- 击中门框
    fast_breaks     INTEGER,                      -- 快速反击
    fast_break_goals INTEGER,                     -- 反击进球
    fast_break_shots INTEGER,                     -- 反击射门
    -- ===== 传球/控球 =====
    average_ball_possession NUMERIC,              -- 场均控球率
    total_passes    INTEGER,                      -- 传球总数
    accurate_passes INTEGER,                      -- 传球成功数
    accurate_passes_percentage NUMERIC,           -- 传球成功率(%)
    total_own_half_passes INTEGER,                -- 后场传球总数
    accurate_own_half_passes INTEGER,             -- 后场传球成功
    accurate_own_half_passes_percentage NUMERIC,  -- 后场传球成功率(%)
    total_opposition_half_passes INTEGER,         -- 前场传球总数
    accurate_opposition_half_passes INTEGER,      -- 前场传球成功
    accurate_opposition_half_passes_percentage NUMERIC, -- 前场传球成功率(%)
    total_long_balls INTEGER,                     -- 长传总数
    accurate_long_balls INTEGER,                  -- 长传成功
    accurate_long_balls_percentage NUMERIC,       -- 长传成功率(%)
    total_crosses   INTEGER,                      -- 传中总数
    accurate_crosses INTEGER,                     -- 传中成功
    accurate_crosses_percentage NUMERIC,          -- 传中成功率(%)
    -- ===== 防守 =====
    clean_sheets    INTEGER,                      -- 零封场次
    tackles         INTEGER,                      -- 抢断
    interceptions   INTEGER,                      -- 拦截
    saves           INTEGER,                      -- 扑救
    errors_leading_to_goal INTEGER,               -- 失误导致丢球
    errors_leading_to_shot INTEGER,               -- 失误导致射门
    penalties_commited INTEGER,                   -- 送点
    penalty_goals_conceded INTEGER,               -- 被判点球
    clearances      INTEGER,                      -- 解围
    clearances_off_line INTEGER,                  -- 门线解围
    last_man_tackles INTEGER,                     -- 最后一人抢断
    total_duels     INTEGER,                      -- 对抗总数
    duels_won       INTEGER,                      -- 对抗获胜
    duels_won_percentage NUMERIC,                 -- 对抗胜率(%)
    total_ground_duels INTEGER,                   -- 地面对抗总数
    ground_duels_won INTEGER,                     -- 地面对抗获胜
    ground_duels_won_percentage NUMERIC,          -- 地面对抗胜率(%)
    total_aerial_duels INTEGER,                   -- 空中对抗总数
    aerial_duels_won INTEGER,                     -- 空中对抗获胜
    aerial_duels_won_percentage NUMERIC,          -- 空中对抗胜率(%)
    possession_lost INTEGER,                      -- 丢球权次数
    offsides        INTEGER,                      -- 越位
    fouls           INTEGER,                      -- 犯规
    yellow_cards    INTEGER,                      -- 黄牌
    yellow_red_cards INTEGER,                     -- 两黄变红
    red_cards       INTEGER,                      -- 红牌
    avg_rating      NUMERIC,                      -- 平均评分
    -- ===== 对手指标（Against，衡量防守压力）=====
    accurate_final_third_passes_against INTEGER,  -- 对手前场传球成功
    accurate_opposition_half_passes_against INTEGER, -- 对手前场传球成功数
    accurate_own_half_passes_against INTEGER,     -- 对手后场传球成功数
    accurate_passes_against INTEGER,              -- 对手传球成功总数
    big_chances_against INTEGER,                  -- 对手重大机会
    big_chances_created_against INTEGER,          -- 对手创造重大机会
    big_chances_missed_against INTEGER,           -- 对手错失重大机会
    clearances_against INTEGER,                   -- 对手解围
    corners_against INTEGER,                      -- 对手角球
    crosses_successful_against INTEGER,           -- 对手传中成功
    crosses_total_against INTEGER,                -- 对手传中总数
    dribble_attempts_total_against INTEGER,       -- 对手过人尝试
    dribble_attempts_won_against INTEGER,         -- 对手过人成功
    errors_leading_to_goal_against INTEGER,       -- 对手失误导致进球
    errors_leading_to_shot_against INTEGER,       -- 对手失误导致射门
    hit_woodwork_against INTEGER,                 -- 对手击中门框
    interceptions_against INTEGER,                -- 对手拦截
    key_passes_against INTEGER,                   -- 对手关键传球
    long_balls_successful_against INTEGER,        -- 对手长传成功
    long_balls_total_against INTEGER,             -- 对手长传总数
    offsides_against INTEGER,                     -- 对手越位
    red_cards_against INTEGER,                    -- 对手红牌
    shots_against INTEGER,                        -- 对手射门
    shots_blocked_against INTEGER,                -- 对手射门被阻挡
    shots_inside_box_against INTEGER,             -- 对手禁区内射门
    shots_outside_box_against INTEGER,            -- 对手禁区外射门
    shots_off_target_against INTEGER,             -- 对手射偏
    shots_on_target_against INTEGER,              -- 对手射正
    blocked_scoring_attempt_against INTEGER,      -- 对手被阻挡射门
    tackles_against INTEGER,                      -- 对手抢断
    total_final_third_passes_against INTEGER,     -- 对手前场传球总数
    opposition_half_passes_total_against INTEGER, -- 对手前场传球总数
    own_half_passes_total_against INTEGER,        -- 对手后场传球总数
    total_passes_against INTEGER,                 -- 对手传球总数
    yellow_cards_against INTEGER,                 -- 对手黄牌
    scraped_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (team_id, league_id, season_id)
);
```

> **统计指标说明**：原 JSON `statistics` 对象共 111 个字段，其中 4 个为元数据（`id` / `matches` / `awardedMatches` / `statisticsType`），107 个为统计指标。上表已全部建模为固定列。字段名的 `_against` 后缀表示"对手在该指标上的表现"，用于衡量防守压力。

### 7.2 竞彩库

沿用现有 `spottery_pro/backend/app/models/jingcai.py` 的全部 **17 张表结构不变**，迁到 `jingcai` 独立 database：

| 表                        | 行数    | 说明                               |
| ------------------------- | ------- | ---------------------------------- |
| `jingcai_matches`         | 76,969  | 竞彩比赛主体                       |
| `jingcai_odds`            | 349,234 | 赔率汇总（SPF/RQSPF/CRS/TTG/HAFU） |
| `jingcai_odds_spf`        | 261,485 | 胜平负明细快照                     |
| `jingcai_odds_rqspf`      | 268,489 | 让球胜平负明细快照                 |
| `jingcai_odds_crs`        | 139,285 | 比分明细快照                       |
| `jingcai_odds_ttg`        | 145,285 | 总进球明细快照                     |
| `jingcai_odds_hafu`       | 158,270 | 半全场明细快照                     |
| `jingcai_pools`           | 325,588 | 奖池                               |
| `jingcai_standings`       | 354,042 | 积分榜                             |
| `jingcai_h2h`             | 421,051 | 历史交锋                           |
| `jingcai_recent_results`  | 243,271 | 近期赛果                           |
| `jingcai_fixtures`        | 5,482   | 未来赛程                           |
| `jingcai_injuries`        | 138,925 | 伤病名单                           |
| `jingcai_players`         | 381,905 | 球员数据                           |
| `jingcai_season_features` | 65,896  | 赛季特征                           |
| `jingcai_teams`           | 2,771   | 球队映射                           |
| `jingcai_leagues`         | 134     | 联赛映射                           |

迁移方式：`pg_dump -t 'jingcai_*'` 从平台库导出 → `pg_restore` 到 `jingcai` 库。

### 7.3 球探库

```sql
-- ============================================
-- titan007 库：球探爬虫数据
-- ============================================

-- 赛程
CREATE TABLE schedules (
    schedule_id     INTEGER NOT NULL,
    competition_id  INTEGER NOT NULL,
    competition_name_cn TEXT,
    competition_name_en TEXT,
    season          TEXT NOT NULL,
    is_cup          BOOLEAN DEFAULT FALSE,
    group_name      TEXT,
    round_name      TEXT,
    match_time      TIMESTAMPTZ,
    home_team_id    INTEGER,
    away_team_id    INTEGER,
    home_team       TEXT,
    away_team       TEXT,
    home_team_en    TEXT,
    away_team_en    TEXT,
    full_score      TEXT,
    half_score      TEXT,
    status          INTEGER,
    data_raw        JSONB,
    scraped_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (schedule_id, competition_id, season)
);
CREATE INDEX idx_schedules_time ON schedules (match_time);
CREATE INDEX idx_schedules_comp_season ON schedules (competition_id, season);

-- 分析数据（赛前简报/阵容/伤停/积分榜等，JSONB body）
CREATE TABLE analysis (
    schedule_id     INTEGER PRIMARY KEY,
    competition_id  INTEGER,
    season          TEXT,
    data            JSONB NOT NULL,
    scraped_at      TIMESTAMPTZ DEFAULT now()
);

-- 赔率（统一表：亚盘 / 大小球 / 欧赔）
CREATE TABLE odds (
    schedule_id     INTEGER NOT NULL,
    company_id      INTEGER NOT NULL,
    company_name    TEXT,
    odds_type       TEXT NOT NULL,    -- asian / over_under / european
    odds_subtype    TEXT,             -- full / half（欧赔为 NULL）
    source          TEXT NOT NULL,    -- titan / nowscore
    changes         JSONB NOT NULL,   -- 赔率变化数组
    data_raw        JSONB,
    fetched_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (schedule_id, company_id, odds_type, odds_subtype)
);
```

> 设计说明：把 47 万 JSON 文件压成 3 张表。`changes` 存赔率变化序列（JSONB），既满足走势查询，也避免把每条变化拆成一行导致的表爆炸。若后续需要按时间筛选赔率变化，再考虑拆行物化视图。

---

## 八、跨源映射表设计

> 来源：`mapping/` 管线的数据库化。**人工维护**，通过后端接口上传 JSON 后 upsert 入库。数据源可扩展（JSONB 结构）。

### 8.1 表结构（平台库 spottery）

```sql
-- ============================================
-- spottery 库：跨源映射表
-- ============================================

-- 联赛映射（对应 league_mapping.json）
CREATE TABLE cross_source_leagues (
    id                  SERIAL PRIMARY KEY,
    standard_name       TEXT NOT NULL UNIQUE,   -- 标准中文简称（如 "英超"）
    standard_name_cn    TEXT,                   -- 标准中文全称
    standard_name_en    TEXT,                   -- 标准英文名

    -- 各源标识
    source_ids          JSONB NOT NULL DEFAULT '{}',
    -- 例: {"sofascore": 17, "titan007": 36, "jingcai": 142}
    source_names        JSONB NOT NULL DEFAULT '{}',
    -- 例: {"sofascore": "英超", "titan007": "English_Premier_League",
    --      "jingcai": "英格兰超级联赛"}

    maintained_by       TEXT DEFAULT 'manual',
    updated_at          TIMESTAMPTZ DEFAULT now()
);

-- 球队映射（对应 standard_names.json）
CREATE TABLE cross_source_teams (
    id                  SERIAL PRIMARY KEY,
    standard_name       TEXT NOT NULL UNIQUE,   -- 标准英文名（如 "Liverpool"）
    standard_name_cn    TEXT,                   -- 标准中文名（如 "利物浦"）

    -- 各源变体名（JSONB 数组，可扩展新源）
    source_names        JSONB NOT NULL DEFAULT '{}',
    -- 例: {"sofascore": ["Liverpool FC", "Liverpool"],
    --      "titan007_cn": ["利物浦"],
    --      "titan007_en": ["Liverpool"],
    --      "jingcai": ["利物浦"]}

    -- 各源 ID（精确匹配）
    source_ids          JSONB NOT NULL DEFAULT '{}',
    -- 例: {"sofascore": 44, "titan007": 205, "jingcai": 1234}

    maintained_by       TEXT DEFAULT 'manual',
    updated_at          TIMESTAMPTZ DEFAULT now()
);

-- 索引：按源名快速查找标准名
CREATE INDEX idx_leagues_source_names ON cross_source_leagues USING GIN (source_names);
CREATE INDEX idx_teams_source_names ON cross_source_teams USING GIN (source_names);
```

### 8.2 维护与上传流程

```
用户编辑 mapping/league_mapping.json + standard_names.json
        │
        ▼
运行 mapping/run_pipeline.py 校验 + 生成核对表
        │
        ▼
人工核对 xlsx（补全缺失标准名）
        │
        ▼
上传到后端：POST /internal/mapping/upload
        │
        ▼
后端解析 → upsert 到 cross_source_leagues / cross_source_teams
```

### 8.3 聚合引擎使用映射表

```python
# 伪代码：把源队名解析为标准名
def resolve_team(source: str, raw_name: str) -> str | None:
    row = db.query(
        "SELECT standard_name FROM cross_source_teams "
        "WHERE source_names @> $1::jsonb",
        json.dumps({source: [raw_name]})
    ).first()
    return row.standard_name if row else None
```

### 8.4 可扩展性

- 新增数据源时，只需在 `source_ids` / `source_names` JSONB 中新增一个 key（如 `"winstar"`），无需改表结构。
- 映射表是数据源对齐的核心，聚合引擎所有跨源 JOIN 必须先过映射表。

---

## 九、平台聚合库 Schema 设计

> 平台库 `spottery` 存：跨源映射表 + 聚合结果表 + 平台基础表。**不冗余源库明细**。

### 9.1 统一实体表（由映射表 + 各源对齐生成）

```sql
-- 统一联赛（跨源聚合后的一张视图表）
CREATE TABLE unified_leagues (
    id                  SERIAL PRIMARY KEY,
    standard_name       TEXT NOT NULL UNIQUE,   -- 标准中文简称
    standard_name_en    TEXT,
    country             TEXT,
    season              TEXT,                   -- 当前赛季标识（可为 NULL）
    -- 冗余各源 ID（查询时避免每次 JOIN 映射表）
    sofascore_id        INTEGER,
    titan007_id         INTEGER,
    jingcai_id          INTEGER,
    UNIQUE (sofascore_id), UNIQUE (titan007_id), UNIQUE (jingcai_id)
);

-- 统一球队（跨源聚合）
CREATE TABLE unified_teams (
    id                  SERIAL PRIMARY KEY,
    standard_name       TEXT NOT NULL UNIQUE,
    standard_name_cn    TEXT,
    country             TEXT,
    sofascore_id        INTEGER,
    titan007_id         INTEGER,
    jingcai_id          INTEGER,
    UNIQUE (sofascore_id), UNIQUE (titan007_id), UNIQUE (jingcai_id)
);

-- 统一比赛（跨源对齐后的比赛视图）
CREATE TABLE unified_matches (
    id                  SERIAL PRIMARY KEY,
    unified_league_id   INTEGER REFERENCES unified_leagues(id),
    unified_home_id     INTEGER REFERENCES unified_teams(id),
    unified_away_id     INTEGER REFERENCES unified_teams(id),
    kickoff_time        TIMESTAMPTZ NOT NULL,
    status              TEXT,                   -- SCHEDULED / LIVE / FINISHED
    home_score          INTEGER,
    away_score          INTEGER,
    season_key          TEXT,
    -- 各源引用
    source_refs         JSONB NOT NULL DEFAULT '{}',
    -- 例: {"sofascore": {"match_id": 12345},
    --      "jingcai": {"match_id": 1022716, "match_num": "周三001"},
    --      "titan007": {"schedule_id": 2789129}}
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_unified_matches_kickoff ON unified_matches (kickoff_time);
CREATE INDEX idx_unified_matches_league ON unified_matches (unified_league_id);
CREATE INDEX idx_unified_matches_team ON unified_matches (unified_home_id, unified_away_id);
```

### 9.2 聚合计算结果表

```sql
-- 积分榜聚合（由各源赛程/积分榜计算）
CREATE TABLE aggregated_standings (
    id                  SERIAL PRIMARY KEY,
    unified_league_id   INTEGER NOT NULL REFERENCES unified_leagues(id),
    unified_team_id     INTEGER NOT NULL REFERENCES unified_teams(id),
    season_key          TEXT NOT NULL,
    as_of_match_id      INTEGER,                 -- 计算时点（该场比赛前）
    phase_name          TEXT,                    -- 阶段（常规赛/季后赛）
    rank                INTEGER,
    played              INTEGER,
    wins                INTEGER,
    draws               INTEGER,
    losses              INTEGER,
    goals_for           INTEGER,
    goals_against       INTEGER,
    goal_diff           INTEGER,
    points              INTEGER,
    source_weights      JSONB,                   -- 各源结果（可追溯）
    computed_at         TIMESTAMPTZ DEFAULT now(),
    UNIQUE (unified_league_id, unified_team_id, season_key, as_of_match_id)
);
CREATE INDEX idx_standings_league_season ON aggregated_standings (unified_league_id, season_key);

-- 球队近期状态聚合
CREATE TABLE aggregated_form (
    id                  SERIAL PRIMARY KEY,
    unified_team_id     INTEGER NOT NULL REFERENCES unified_teams(id),
    as_of_match_id      INTEGER,
    season_key          TEXT,
    last_5              TEXT,                    -- 如 "WDLWW"
    recent_results      JSONB,                   -- 最近 N 场明细
    computed_at         TIMESTAMPTZ DEFAULT now(),
    UNIQUE (unified_team_id, as_of_match_id)
);

-- 交锋历史聚合（跨源合并）
CREATE TABLE aggregated_h2h (
    id                  SERIAL PRIMARY KEY,
    unified_home_id     INTEGER NOT NULL REFERENCES unified_teams(id),
    unified_away_id     INTEGER NOT NULL REFERENCES unified_teams(id),
    match_date          DATE,
    home_score          INTEGER,
    away_score          INTEGER,
    source_refs         JSONB,
    computed_at         TIMESTAMPTZ DEFAULT now(),
    UNIQUE (unified_home_id, unified_away_id, match_date)
);

-- 赔率汇总快照（三源赔率合并，用于走势图）
CREATE TABLE aggregated_odds_history (
    id                  SERIAL PRIMARY KEY,
    unified_match_id    INTEGER NOT NULL REFERENCES unified_matches(id),
    source              TEXT NOT NULL,           -- sofascore / jingcai / titan007
    odds_type           TEXT NOT NULL,           -- SPF/RQSPF/asian/over_under/european...
    snapshot_at         TIMESTAMPTZ NOT NULL,
    home_odds           FLOAT,
    draw_odds           FLOAT,
    away_odds           FLOAT,
    handicap            TEXT,
    raw                 JSONB,                   -- 原始赔率数据
    UNIQUE (unified_match_id, source, odds_type, snapshot_at)
);
```

### 9.3 平台基础表（沿用现有结构）

- `users` / `predictions` / `briefings` / `teams` / `leagues` / `matches` / `odds_history` / `injuries` / `team_aliases` / `match_source_mappings`（现有 10 张表，结构基本保留，部分表被 unified\_\* 取代后弃用或保留兼容）。
- 现有 `matches` / `teams` / `leagues` 若与 unified\_\* 语义重叠，规划合并方案（Phase 3 处理）。

---

## 十、可插拔 SourceAdapter 架构

### 10.1 抽象基类

```python
# services/api/app/source_adapter/base.py
from abc import ABC, abstractmethod
from datetime import datetime


class SourceAdapter(ABC):
    """数据源适配器抽象基类。新增数据源 = 新增一个子类文件。"""

    source_id: str  # "sofascore" | "jingcai" | "titan007"

    # ---------- 爬虫控制 ----------
    @abstractmethod
    async def trigger_crawl(self) -> None: ...

    # ---------- 增量读取（聚合引擎调用）----------
    @abstractmethod
    async def get_changed_matches(self, since: datetime) -> list[dict]: ...

    @abstractmethod
    async def get_match_detail(self, match_ref: dict) -> dict: ...

    @abstractmethod
    async def get_standings(self, league_ref: dict, before_match: datetime) -> list[dict]: ...

    # ---------- 映射与标准化 ----------
    def resolve_league(self, raw: str | int) -> str | None: ...
    def resolve_team(self, raw: str | int) -> str | None: ...
```

### 10.2 注册与发现

```python
# 注册表
REGISTRY: dict[str, SourceAdapter] = {}

def register(adapter: SourceAdapter) -> None:
    REGISTRY[adapter.source_id] = adapter

# 启动时自动注册三个适配器
from app.source_adapter import sofascore, jingcai, titan007
for mod in (sofascore, jingcai, titan007):
    register(mod.adapter())
```

### 10.3 新增数据源的工作量

1. 新建爬虫容器（自己的抓取逻辑 + 自己的源库 schema + PG writer）。
2. 新建 `source_adapter/{source}.py`，实现 `SourceAdapter` 子类。
3. 注册到 `REGISTRY`。
4. 在 `cross_source_leagues` / `cross_source_teams` 的 JSONB 里新增该源 key（人工维护映射）。

聚合引擎无需改动。

---

## 十一、数据流与一致性设计

### 11.1 端到端数据流

```
爬虫定时任务 / 后端手动触发
        │
        ▼
[爬虫抓取] → [解析/标准化] → [写源库 upsert]
        │
        │ 写完后 HTTP POST /internal/source-updated?source=jingcai&ts=2026-08-02T10:00:00Z
        ▼
┌──────────────────────────────────────────────┐
│  聚合引擎 (apscheduler)                       │
│                                              │
│  触发方式：                                    │
│    A. 收到 /source-updated 通知 → 立即处理    │
│    B. 每 5 分钟定时扫描各源 updated_at 游标   │
│                                              │
│  处理流程：                                    │
│    1. 取增量（get_changed_matches(since)）    │
│    2. 查 cross_source_* 做 ID 对齐            │
│    3. upsert unified_matches / unified_teams  │
│    4. 增量计算积分榜/状态/H2H/赔率汇总         │
│    5. 写 aggregated_* 表（幂等 upsert）       │
│    6. 更新游标 last_processed_at              │
└──────────────────────────────────────────────┘
        │
        ▼
前端 ← API ← 聚合库（数据已最新）
```

### 11.2 一致性保证（不依赖消息队列）

| 保证项       | 实现方式                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **幂等写入** | 所有表带 UNIQUE 约束 + `ON CONFLICT DO UPDATE`。同一条记录重抓不产生脏数据。现有 `import_jingcai.py` 已验证此模式。                                        |
| **增量游标** | 聚合引擎按源记录游标 `(source, last_processed_at)`，只处理新数据，可重入、可对账。                                                                         |
| **同步更新** | 聚合库更新是「源变 → 通知 → 立即增量重算 → 幂等写」的**同步链**，不是 TTL 过期重建。源库没变，聚合不跑；源库变了，聚合必然跑。不存在「旧缓存未失效」问题。 |
| **通知兜底** | 通知失败（HTTP 超时/网络抖）时，5 分钟定时扫描兜底，保证最终一致。                                                                                         |
| **无脏读**   | 后端连源库用只读事务（`default_transaction_read_only=on`）。                                                                                               |
| **跨源对齐** | 所有跨源 JOIN 先查 cross*source*\* 映射表；未映射的球队/联赛进「待映射」清单，由人工补全。                                                                 |
| **重算安全** | 聚合任务可随时重跑（幂等），全量重算有单独接口。                                                                                                           |

### 11.3 游标表

```sql
CREATE TABLE aggregation_cursors (
    source              TEXT PRIMARY KEY,      -- sofascore / jingcai / titan007
    last_processed_at   TIMESTAMPTZ,
    last_notify_at      TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ DEFAULT now()
);
```

---

## 十二、缓存策略

### 12.1 分层

| 层级            | 内容                                 | 策略                                                                                                       |
| --------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **聚合库**      | 比赛列表、赔率快照、积分榜、预测结果 | 本身就是派生数据存储，预计算 + 同步更新，无需 TTL 淘汰                                                     |
| **PG 物化视图** | 高频聚合查询（今日比赛 + 赔率汇总）  | 定时刷新（可选，Phase 3 优化）                                                                             |
| **Redis**       | —                                    | **第一版不加**。后续若前端 QPS 高，再加 Redis 作为聚合库的读副本，失效走「源变→重算→写 PG→写 Redis」同步链 |
| **前端**        | TanStack Query                       | 已有，按接口特征设置 staleTime                                                                             |

### 12.2 为什么第一版不加 Redis

- 聚合库就在 PG 里，正确索引下单表百万行查询毫秒级。
- 加 Redis 引入第二层缓存失效逻辑（源变 → 重算 → PG → Redis 都要同步），增加故障点，收益为零（当前访问量小）。
- 真正的「缓存更新一致性」由聚合库的同步更新机制保证（见 11.2），与 Redis 无关。

---

## 十三、后端控制面 API

```python
# ✨ 新增路由: services/api/app/routers/source_admin.py

# 触发指定源立即增量抓取
POST /internal/source/{source}/crawl
  → 调用爬虫容器 HTTP 接口 (http://crawler-{source}:300x/crawl)
  → 爬虫执行增量抓取 → 写源库 → 通知后端

# 触发指定源全量重建（高危，需二次确认 token）
POST /internal/source/{source}/rebuild

# 查询各源爬取状态
GET  /internal/source/status
  → { sofascore: {last_crawl, running}, jingcai: {...}, titan007: {...} }

# 手动触发一次聚合
POST /internal/aggregate/run

# 查询聚合游标状态
GET  /internal/aggregation/cursors

# 上传跨源映射（人工维护后更新）
POST /internal/mapping/upload
  → 接受 league_mapping.json + standard_names.json
  → upsert 到 cross_source_leagues / cross_source_teams

# 查询未映射球队/联赛清单（需人工补全）
GET  /internal/mapping/pending
```

爬虫容器自身暴露的 HTTP 接口：

```
POST /crawl        # 增量抓取
POST /rebuild      # 全量重建
GET  /status       # 状态
GET  /health       # 健康检查
```

---

## 十四、Docker 编排

```yaml
# docker-compose.yml
version: "3.9"

services:
  db:
    image: postgres:18
    container_name: spottery-pg
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql
      - ./db/init:/docker-entrypoint-initdb.d
    restart: unless-stopped

  crawler-sofascore:
    build: ./services/crawler-sofascore
    container_name: crawler-sofascore
    environment:
      DATABASE_URL: postgresql://crawler_sofascore:${PG_APP_PASSWORD}@db:5432/sofascore
      API_BASE_URL: http://api:8000
      API_KEY: ${INTERNAL_API_KEY}
    ports:
      - "3001:3001"
    depends_on: [db]
    restart: unless-stopped

  crawler-jingcai:
    build: ./services/crawler-jingcai
    container_name: crawler-jingcai
    environment:
      DATABASE_URL: postgresql://crawler_jingcai:${PG_APP_PASSWORD}@db:5432/jingcai
      API_BASE_URL: http://api:8000
      API_KEY: ${INTERNAL_API_KEY}
    ports:
      - "3002:3002"
    depends_on: [db]
    restart: unless-stopped

  crawler-titan007:
    build: ./services/crawler-titan007
    container_name: crawler-titan007
    environment:
      DATABASE_URL: postgresql://crawler_titan007:${PG_APP_PASSWORD}@db:5432/titan007
      API_BASE_URL: http://api:8000
      API_KEY: ${INTERNAL_API_KEY}
    ports:
      - "3003:3003"
    depends_on: [db]
    restart: unless-stopped

  api:
    build: ./services/api
    container_name: spottery-api
    environment:
      DATABASE_URL: postgresql://api_service:${PG_APP_PASSWORD}@db:5432/spottery
      SOFASCORE_DB_URL: postgresql://api_service:${PG_APP_PASSWORD}@db:5432/sofascore
      JINGCAI_DB_URL: postgresql://api_service:${PG_APP_PASSWORD}@db:5432/jingcai
      TITAN007_DB_URL: postgresql://api_service:${PG_APP_PASSWORD}@db:5432/titan007
      JWT_SECRET_KEY: ${JWT_SECRET_KEY}
      INTERNAL_API_KEY: ${INTERNAL_API_KEY}
    ports:
      - "8000:8000"
    depends_on: [db]
    restart: unless-stopped

  frontend:
    build: ./frontend
    container_name: spottery-frontend
    environment:
      VITE_API_BASE_URL: /api/v1
    ports:
      - "5173:5173"
    depends_on: [api]
    restart: unless-stopped

volumes:
  pgdata: {}
```

### 14.1 环境变量（根 .env）

| 变量                | 说明                                    |
| ------------------- | --------------------------------------- |
| `POSTGRES_PASSWORD` | PG 超级用户密码                         |
| `PG_APP_PASSWORD`   | 应用账号（crawler\_\*/api_service）密码 |
| `JWT_SECRET_KEY`    | 后端 JWT 密钥                           |
| `JWT_EXPIRE_DAYS`   | Token 有效期                            |
| `INTERNAL_API_KEY`  | 爬虫↔后端内部通信令牌                   |

### 14.2 开发 vs 生产

- **开发（Windows）**：`docker compose up -d` 启动全部；爬虫可以 `profile: [crawlers]` 按需启动，本地开发也可不启动爬虫直接用已有源库数据。
- **生产（Linux）**：`docker compose up -d` 全量启动 + 外部 PG 数据卷 + 反代（Nginx）+ HTTPS。爬虫容器内的定时任务由进程内调度器（node-cron / apscheduler / systemd-like）驱动。

---

## 十五、迁移路径（三阶段）

### Phase 1：建模型 + 一次性导入（不动采集代码）

目标：四库 schema 就绪，历史数据入库，聚合引擎骨架可跑。

| 步骤 | 内容                                                                        | 交付物                | 验证点                                  |
| ---- | --------------------------------------------------------------------------- | --------------------- | --------------------------------------- |
| 1a   | 创建 4 个库的 DDL（`db/init/`）                                             | DDL 脚本              | 建库成功，权限隔离生效                  |
| 1b   | 写三个一次性 JSON→PG 导入脚本（`db/migrate/`）                              | migrator 脚本         | 63 万 JSON 全部入库，与 JSON 逐字段对账 |
| 1c   | 迁移平台库现有 17 张 `jingcai_*` 表到 `jingcai` 库                          | pg_dump/restore       | 行数与源库一致                          |
| 1d   | 建 `cross_source_leagues` / `cross_source_teams` 表 + 导入现有 mapping JSON | mapping 表数据        | 映射齐全                                |
| 1e   | 写三个 SourceAdapter + 聚合引擎骨架（unified*\* 对齐 + aggregated*\* 空表） | adapter + engine 代码 | 单元测试通过                            |

> 本阶段不修改任何爬虫采集代码，纯新增。风险低，可随时回退。

### Phase 2：改采集逻辑 + 双写上线

目标：爬虫开始写 PG，聚合引擎上线，前端切数据源。

| 步骤 | 内容                                                     | 验证点                             |
| ---- | -------------------------------------------------------- | ---------------------------------- |
| 2a   | 每个爬虫新增 PG writer，**保留 JSON writer**（双写）     | 同一批数据 PG 和 JSON 全量对比一致 |
| 2b   | 每个爬虫新增 HTTP 控制接口（/crawl /status /health）     | 后端可手动触发                     |
| 2c   | 聚合引擎上线（apscheduler 定时 + 事件触发）              | 源库更新 → 聚合库同步更新          |
| 2d   | 后端 source_admin 路由 + mapping upload 接口             | 手工触发/上传可用                  |
| 2e   | 前端切到聚合库数据源                                     | 页面功能回归                       |
| 2f   | **全量对比验证**：双写期间对每个 JSON 字段与 PG 记录对比 | 零差异后才进入 Phase 3             |

> 双写期可随时回退（关闭 PG writer 即回 JSON 模式）。

### Phase 3：清理 + 优化 + 部署

| 步骤 | 内容                                              |
| ---- | ------------------------------------------------- |
| 3a   | 确认聚合库稳定 → 关闭双写、移除 JSON writer       |
| 3b   | 清理/归档旧 JSON 文件（保留一份灾备快照）         |
| 3c   | 性能优化（物化视图、索引、连接池、PG 参数调优）   |
| 3d   | 备份策略上线（4 库每日备份）                      |
| 3e   | 部署到 Linux 云服务器，补充监控（日志、健康检查） |
| 3f   | 统一旧平台表与 unified\_\* 的兼容/废弃            |

---

## 十六、技术栈决策

### 16.1 结论：保持三源各自技术栈，不统一

| 爬虫      | 技术栈              | 反爬核心                             | 不迁移的原因                                                                         |
| --------- | ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| 竞彩      | TS + Puppeteer      | `puppeteer-extra-plugin-stealth`     | JS 生态独有商业级 stealth，Python 无等价方案，换语言后大概率被 sporttery.cn 识别拦截 |
| titan007  | Python + Playwright | 146 UA + **GBK 解码**                | `bytes.decode("gbk")` 是 Python 标准库能力；TS 需第三方 `iconv-lite`（社区质量不稳） |
| Sofascore | TS + Playwright     | `page.evaluate(fetch)` + UA/视口轮换 | 与竞彩共享 TS 生态，迁移无收益                                                       |

### 16.2 改动范围（各爬虫）

- **不动的部分**：抓取逻辑、解析逻辑、反爬逻辑、调度逻辑、断点续爬逻辑。
- **改动的部分**：存储层。把「写 JSON 文件」替换为「写 PostgreSQL（幂等 upsert）」，断点判断从「文件存在性」改为「DB 记录存在性」。
- 每个爬虫文件系统耦合点：
  - Sofascore：约 21 处（schedules + details 两个文件）。
  - 竞彩：约 30 处（base-scraper + historical 两阶段 + repair + collectMatchIds）。
  - 球探：约 12 处写入 + 8 处读取（odds_store + utils + 各 pipeline inline dump）。

### 16.3 统一技术栈评估（供参考，不采用）

| 迁移方向                 | 工作量             | 最大风险                               |
| ------------------------ | ------------------ | -------------------------------------- |
| TS → Python（Sofascore） | ~14.5 人天         | Playwright 行为差异、反爬升级          |
| TS → Python（竞彩）      | ~5 人天（1.7k 行） | **stealth 插件无等价物，极可能被识别** |
| Python → TS（titan007）  | ~8-13 人天         | **GBK 解码、时区处理**                 |

结论：迁移风险/收益不成正比，保持现状最稳。

---

## 十七、风险与开放问题

### 17.1 风险清单

| #   | 风险                           | 等级 | 缓解                                           |
| --- | ------------------------------ | ---- | ---------------------------------------------- |
| 1   | 63 万 JSON 导入耗时/失败       | 高   | 分源分阶段导入，脚本可断点续导，原始 JSON 保留 |
| 2   | 双写期数据不一致               | 中   | 全量逐字段对比，对比不通过不进入 Phase 3       |
| 3   | 反爬被目标网站升级检测         | 中   | 保持原反爬实现不重构，减少变化面               |
| 4   | 映射表人工维护出错导致跨源错配 | 中   | 管线校验 + 交叉验证表人工核对                  |
| 5   | 聚合引擎计算逻辑错误           | 中   | 单元测试 + 与源数据独立校验                    |
| 6   | 迁移后磁盘占用                 | 低   | 旧 JSON 清理/归档策略                          |
| 7   | 浏览器容器资源占用             | 低   | 独立容器可控，后续可优化                       |

### 17.2 开放问题（待评审确认）

1. 现有平台基础表（`matches` / `teams` / `leagues`）与新的 `unified_*` 表语义重叠，Phase 3 是否合并/废弃？
2. 聚合引擎的计算规则（积分榜口径、状态计算 N 场）是否需要与现有前端分析页面对齐，还是重新定义？
3. `jingcai_*` 17 张表迁移到独立库后，现有 `import_jingcai.py` 是否退役，改由爬虫直接写库？
4. 前端页面是否全量切换到聚合库，还是过渡期保持对现有接口兼容？
5. 映射表上传接口的鉴权与校验（防误传损坏数据）。
6. 爬虫容器内定时任务与后端手动触发的并发控制（防止同一源同时抓取）。

---

## 附录 A：数据规模汇总

| 数据源    | JSON 文件数 | 预期入库表数 | 预期行数                              |
| --------- | ----------- | ------------ | ------------------------------------- |
| Sofascore | ~88,000     | 3 张         | 赛程 ~2 万行/季 × 10 季               |
| 竞彩      | ~69,700     | 17 张        | 约 380 万行（已迁移）                 |
| 球探      | ~470,000    | 3 张         | 赔率 41.5 万 + 分析 5.4 万 + 赛程 387 |

## 附录 B：关键名词

| 名词          | 含义                                                     |
| ------------- | -------------------------------------------------------- |
| 源库          | 爬虫自维护的原始数据库（sofascore / jingcai / titan007） |
| 聚合库        | 平台库 spottery，存跨源计算/聚合结果                     |
| SourceAdapter | 数据源适配器，聚合引擎与源库之间的统一接口               |
| 聚合引擎      | 读源库 → 对齐 → 计算 → 写聚合库的后端模块                |
| 跨源映射      | cross_source_leagues / cross_source_teams，人工维护      |
| 双写          | 爬虫同时写 JSON 和 PG，验证一致后停 JSON                 |
