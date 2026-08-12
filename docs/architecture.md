# Spottery 重构架构设计文档

> 版本：v0.2
> 日期：2026-08-06
> 状态：设计评审中，尚未开始编码
> 本次更新（v0.2）：unified_* 对齐规则与 DDL 定稿、后端 API 设计定稿、旧平台表废弃决策、开放问题 #1/#2 解决

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
13. [后端 API 设计](#十三后端-api-设计)
14. [Docker 编排](#十四docker-编排)
15. [迁移路径（三阶段）](#十五迁移路径三阶段)
16. [技术栈决策](#十六技术栈决策)
17. [风险与开放问题](#十七风险与开放问题)

---

## 一、背景与目标

### 1.1 背景

现有系统由 4 个独立仓库组成：

| 仓库 | 职责 | 技术栈 | 数据形式 |
|---|---|---|---|
| `spottery_pro` | 主平台（前后端+数据库） | FastAPI + React + PostgreSQL | 已有 17 张竞彩表（约 380 万行） |
| `crawler` | Sofascore 爬虫 | TS + Playwright | JSON 文件（约 8.8 万） |
| `spottery/scrapers` | 竞彩爬虫 | TS + Puppeteer | JSON 文件（约 7 万） |
| `titan007_pro` | 球探爬虫 | Python + Playwright | JSON 文件（约 51.5 万） |

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

| 决策点 | 结论 |
|---|---|
| 仓库组织 | 合并为 **Monorepo**（四个仓库并入 `spottery-master`） |
| 数据库拓扑 | **单 PG 容器，4 个 database**（spottery / sofascore / jingcai / titan007） |
| 爬虫技术栈 | **保持各自现有技术栈，不统一**（详见第十六章） |
| 爬虫写库方式 | **双写过渡**（PG + JSON 并行，全量对比验证后再关 JSON） |
| 聚合库定位 | 只存**聚合/计算结果**，不冗余源库明细 |
| 容器拆分 | 三个爬虫**各自独立容器**，暂不合并 |
| 缓存 | **第一版不加 Redis**，聚合库 + PG 索引作为唯一存储层 |
| 映射表 | **JSONB 数组方案**，人工维护后上传，可扩展新数据源 |
| 旧平台表 | **`matches` / `teams` / `leagues` 不迁移、废弃**，由 unified_* 完全取代（2026-08-06） |
| 对齐规则 | 对齐键 = league + home + away + kickoff_time，**±90 分钟容差**；任一源 FINISHED 即取完场；竞彩终赔/单关恒取竞彩源（2026-08-06） |
| 内容接口鉴权 | **前台内容全部公开只读**，登录仅限认证与控制面（2026-08-06） |
| 分析数据接口 | **单详情聚合接口 + 模块可选 + 前端逐块容错**（2026-08-06） |

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
  - daily：`data/jingcai/daily/{YYYY-MM-DD}.json`，3,779 个。
  - 详情：`data/jingcai/matches/{matchId}.json`，76,992 个，含 oddsHistory（HAD/HHAD/TTG/CRS/HAFU 赔率历史）+ matchInfo + recentResults + seasonFeatures + injuries + standings + players + fixtures + headToHead。
- **API**：`webapi.sporttery.cn/gateway/uniform/football`，12 个 endpoint。
- **调度**：node-cron 常驻进程，4 个定时任务（schedule 每 30min / result 每 60min / odds 每 15min）；另有历史批量爬取 run-crawl.ts 两阶段。
- **后端推送**：`api-client.ts` 已实现（POST /scraper/matches、/scraper/odds，X-API-Key 认证，3 次指数退避），但**尚未被任何爬虫调用**。
- **文件系统耦合**：约 30 处（base-scraper 写文件 + historical 两阶段 + repair 脚本 + collectMatchIds）。

#### 球探爬虫（`titan007_pro`，Python + Playwright）

- **反爬**：146 条真实 UA 轮换；`zh-CN` locale + `Asia/Shanghai` 时区；随机视口 1200~1400×800~900；Referer 校验（zq/vip/1x2/nowscore 各不同）；随机延迟 0.5~2s；JS 文件 URL 加随机 `?version=` 参数规避缓存；自动重试（默认 2 次）；**GBK 解码**（JS 数据文件编码）。
- **数据**：
  - schedule：`data/schedule/`，1,110 文件（leagues 422 + cups 688）。
  - analysis：`data/analysis/`，55,314 文件。
  - odds：`data/odds/asian|over_under|european/`，共 459,333 文件。
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

| # | 容器 | 镜像 | 职责 | 端口 |
|---|---|---|---|---|
| 1 | `db` | postgres:18 | 单实例 4 库 | 5432 |
| 2 | `crawler-sofascore` | node:22 + Playwright + Chromium | Sofascore 爬虫 | 3001 |
| 3 | `crawler-jingcai` | node:22 + Puppeteer + Chromium | 竞彩爬虫 | 3002 |
| 4 | `crawler-titan007` | python:3.12 + Playwright + Chromium | 球探爬虫 | 3003 |
| 5 | `api` | python:3.12 + FastAPI | 后端（读源库 + 写聚合库） | 8000 |
| 6 | `frontend` | node:22 + Vite | 前端 | 5173 |

**关于浏览器体积**：
- 三个爬虫容器各自内置 Chromium（镜像约 500~600MB/个），6 个容器总计约 2.5~3GB。
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

| 角色 | 可访问库 | 权限 |
|---|---|---|
| `crawler_sofascore` | sofascore | 读写 |
| `crawler_jingcai` | jingcai | 读写 |
| `crawler_titan007` | titan007 | 读写 |
| `api_service` | spottery | 读写 |
| | sofascore / jingcai / titan007 | **只读**（连接时 `SET default_transaction_read_only = on`） |
| `postgres` | 全部 | 超级管理员（初始化） |

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

Sofascore 源库 schema **已全部定稿**，详见 [`docs/sofascore-database.md`](sofascore-database.md)（含每张表的完整 DDL、字段来源与转化、已核实数据规模）。

共 **15 张表**：

| 分类 | 表 | 说明 |
|---|---|---|
| 维度 | `countries` | 国家/洲际区域（29 行） |
| 维度 | `leagues` | 联赛（29 行） |
| 维度 | `seasons` | 赛季（309 行） |
| 维度 | `teams` | 球队（2,159 行） |
| 主表 | `schedules` | 赛程（82,288 场，比分/状态/主客队） |
| 字典 | `status_codes` / `cup_round_types` / `round_prefixes` | 状态码 / 杯赛轮次 / 阶段标签 |
| 详情 | `match_details` | 裁判/球场/上座/阵容/赛前排位 |
| 详情 | `match_statistics` | 球队技术统计（is_home × period，~39 万行） |
| 详情 | `match_players` | 比赛阵容 + 球员单场统计 |
| 详情 | `players` | 球员维度薄表 |
| 详情 | `match_missing_players` | 伤停名单 |
| 详情 | `match_votes` | 球迷投票时间序列 |
| 详情 | `team_season_stats` | 球队赛季统计宽表（5,831 行 × 118 列） |

**关键设计约定**（详见定稿文档"〇、设计全局原则"）：
- 所有表**软关联（无 FOREIGN KEY）**，查询用 LEFT JOIN。
- 明细表统一冗余 `league_id/season_id` 作查询入口，配 `(league_id, season_id, ...)` 复合索引，免 JOIN schedules 即可按赛事/赛季过滤。
- `match_incidents`（比赛事件）**确认不建表**，进球/红牌等从比分与统计推断。
- 比分/状态以 `schedules` 表（schedules_v3）为准；详情表不重复存比分状态。

### 7.2 竞彩库

竞彩源库 schema **已全部定稿**，详见 [`docs/jingcai-database.md`](jingcai-database.md)（含每张表的完整 DDL、字段来源与转化、已核实数据规模与核验记录）。

共 **8 张表**（数据来自 `scrapers/data/jingcai/daily/*.json` 与 `matches/{matchId}.json`）：

| 表 | 行数（10 万场估算） | 说明 |
|---|---|---|
| `jingcai_schedules` | 100,000 | 竞彩比赛主体（赛程 + 比分 + 开赛时间 + 单关标记） |
| `jingcai_votes` | 200,000 | 投票时间序列表（HAD/RQSPF 两池基线，含 psy_error 心理误差档位；未来 append 轨迹快照） |
| `jingcai_odds_spf` | 380,000 | 胜平负赔率快照（无让球线） |
| `jingcai_odds_rqspf` | 392,000 | 让球胜平负赔率快照（唯一含 goal_line，-3..+3） |
| `jingcai_odds_ttg` | 211,000 | 总进球赔率快照（odds_0..odds_7） |
| `jingcai_odds_hafu` | 230,000 | 半全场赔率快照（9 组合） |
| `jingcai_odds_crs` | 208,000 | 比分赔率快照（31 列平铺） |
| `jingcai_pools` | 498,000 | 奖池（五池各一行） |

迁移方式：全量重建，按 `scrapers/data/jingcai` 解析导入（旧 18 表不迁移，其中 10 张确认不建）。

**关键设计约定**（详见定稿文档"〇、设计全局原则"）：
- 所有表**软关联（无 FOREIGN KEY）**，统一以 `match_id` 关联，只存 `match_id`（home/away/league 的 sporttery/uniform/内部 ID 一律不存，只保留 3 个名称字段）。
- 赔率快照**打平不做母表**（不建 `jingcai_odds` 汇总表），五池各一张平铺表。
- 字符串数值一律转数值存储（赔率/支持率/概率/error）；`error = supportRate − probability`，可为负。
- 恒值/可推导字段不落库：`*f` 变动方向、`oddsType`（恒 F）、`lineStatus`/`oddsGoalLine`（恒空）、`refundStatus`（恒 0）。
- HAD/TTG/HAFU/CRS 四池 `goalLine` 恒空，故 `goal_line` 仅出现在 `jingcai_odds_rqspf` 与 `jingcai_pools`。
- 旧 18 表中的 `standings` / `h2h` / `recent_results` / `fixtures` / `injuries` / `players` / `season_features` / `teams` / `leagues` / `import_files` **确认不建表**（衍生数据，详见"十二、不落库清单"）。
- **投票为时间序列**：`jingcai_votes` 用 `id BIGSERIAL` 代理主键 + `UNIQUE(match_id, pool, snapshot_at)`；历史基线 snapshot_at = 开售日停售时间点（普通日 22:00 / 周末 23:00，按开售日星期判定），未来复用 getMatchCalculatorV1 接口、赔率有变化才 append（详见定稿文档 votes 设计要点）。
- **索引原则**：只为过滤/排序/连接列建索引；`match_id` 已是各表 PK/UNIQUE 最左列，不额外建 `idx_*_match_id`；时间序列表走 PK `(match_id, snapshot_at)`。

#### `jingcai_schedules` — 竞彩比赛主体

| 字段名 | 类型 | 中文说明 |
| --- | --- | --- |
| `match_id` | Integer PK | 竞彩比赛 ID（daily.matchId = 详情文件名） |
| `business_date` | Date NOT NULL | 销售日（开售日期） |
| `match_date` | Date NOT NULL | 比赛日期 |
| `match_num` | String NOT NULL | 比赛编号（如 周六012） |
| `home_team` | String NOT NULL | 主队名 |
| `away_team` | String NOT NULL | 客队名 |
| `league` | String | 联赛名（已验证 = matchInfo.tournamentCnName） |
| `home_score` | Integer | 主队比分（空=未开赛/未结算，推断状态） |
| `away_score` | Integer | 客队比分（同上） |
| `pool_status` | String | 奖池状态（Payout/Refund） |
| `kickoff_time` | DateTime | 开赛时间（matchInfo.matchDateTime，已核实 100% 有值） |
| `single_spf` / `single_rqspf` / `single_ttg` / `single_hafu` / `single_crs` | Integer | 五池单关标记（0/1） |
| `scraped_at` | DateTime | 抓取时间 |

索引：`business_date`、`match_date`、`league`、`(home_team, away_team)`。

#### `jingcai_votes` — 投票时间序列表

| 字段名 | 类型 | 中文说明 |
| --- | --- | --- |
| `id` | BigInt PK（BIGSERIAL） | 代理主键 |
| `match_id` | Integer NOT NULL | 比赛 ID |
| `pool` | String NOT NULL | HAD / RQSPF |
| `snapshot_at` | DateTime NOT NULL | 历史基线=开售日停售时间点；未来=抓取端时间戳 |
| `goal_line` | Integer | 仅 RQSPF 有值（-3..+3） |
| `odds_home` / `odds_draw` / `odds_away` | Numeric | 三向赔率 |
| `support_rate_home` / `support_rate_draw` / `support_rate_away` | Numeric | 支持率（"27%"→0.27） |
| `probability_home` / `probability_draw` / `probability_away` | Numeric | 命中概率（"26%"→0.26） |
| `error_home` / `error_draw` / `error_away` | Numeric | error = 支持率 − 概率（可为负） |
| `voters_home` / `voters_draw` / `voters_away` | Integer | 投票人数 |
| `psy_error` | Integer | 心理误差档位 0/1/2（语义见定稿文档） |
| `result` | String | 结果（home/draw/away） |

唯一约束 `(match_id, pool, snapshot_at)`（时间序列，可存多次快照）。

#### `jingcai_odds_spf` — 胜平负明细快照

| 字段名 | 类型 | 中文说明 |
| --- | --- | --- |
| `match_id` | Integer NOT NULL | 比赛 ID |
| `snapshot_at` | DateTime NOT NULL | 快照时间（updateDate+updateTime） |
| `odds_home` / `odds_draw` / `odds_away` | Numeric | 三向赔率 |

唯一约束 `(match_id, snapshot_at)`。

#### `jingcai_odds_rqspf` — 让球胜平负明细快照

| 字段名 | 类型 | 中文说明 |
| --- | --- | --- |
| `match_id` | Integer NOT NULL | 比赛 ID |
| `snapshot_at` | DateTime NOT NULL | 快照时间 |
| `goal_line` | Integer | 让球盘（-3..+3） |
| `odds_home` / `odds_draw` / `odds_away` | Numeric | 三向赔率 |

唯一约束 `(match_id, snapshot_at)`。

#### `jingcai_odds_ttg` — 总进球明细快照

| 字段名 | 类型 | 中文说明 |
| --- | --- | --- |
| `match_id` | Integer NOT NULL | 比赛 ID |
| `snapshot_at` | DateTime NOT NULL | 快照时间 |
| `odds_0` .. `odds_7` | Numeric | 0 球 .. 7+ 球赔率 |

唯一约束 `(match_id, snapshot_at)`。

#### `jingcai_odds_hafu` — 半全场明细快照

| 字段名 | 类型 | 中文说明 |
| --- | --- | --- |
| `match_id` | Integer NOT NULL | 比赛 ID |
| `snapshot_at` | DateTime NOT NULL | 快照时间 |
| `odds_hh` .. `odds_aa` | Numeric | 9 种半全场组合赔率 |

唯一约束 `(match_id, snapshot_at)`。

#### `jingcai_odds_crs` — 比分明细快照

| 字段名 | 类型 | 中文说明 |
| --- | --- | --- |
| `match_id` | Integer NOT NULL | 比赛 ID |
| `snapshot_at` | DateTime NOT NULL | 快照时间 |
| `odds_s00s00` .. `odds_s05s05` | Numeric | 28 个具体比分赔率 |
| `odds_s-1sh` / `odds_s-1sd` / `odds_s-1sa` | Numeric | 胜其他 / 平其他 / 负其他 |

唯一约束 `(match_id, snapshot_at)`。

#### `jingcai_pools` — 奖池

| 字段名 | 类型 | 中文说明 |
| --- | --- | --- |
| `match_id` | Integer NOT NULL | 比赛 ID |
| `pool` | String NOT NULL | 玩法代码（HAD/HHAD/CRS/TTG/HAFU） |
| `combination` | String | 组合（"H"/"3:1"/"4"/"H:H"） |
| `combination_desc` | String | 组合描述 |
| `goal_line` | Integer | 进球线（仅 HHAD 有值） |
| `odds` | Numeric | 最终赔率 |
| `pool_id` | Integer | 奖池 ID |
| `pool_totals` | BigInt | 奖池总额（0=未结算/无总额） |

唯一约束 `(match_id, pool)`。

### 7.3 球探库

球探源库 schema **已全部定稿**，详见 [`docs/titan007-database.md`](titan007-database.md)（含每张表的完整 DDL、字段来源与转化、盘口映射表、已核实数据规模）。

共 **8 张表**（数据来自 `titan007_pro/data/` 的 schedule / analysis / odds，实测约 51.5 万 JSON 文件）：

| 分类 | 表 | 说明 |
|---|---|---|
| 维度 | `titan_competitions` | 联赛（98 行） |
| 维度 | `titan_teams` | 球队（数千行） |
| 维度 | `titan_companies` | 公司（9 行，欧赔 5 家 + 亚盘/大小球 4 家） |
| 主表 | `titan_schedules` | 赛程（297,120 场，全量赛事中心；比分/状态/主客队 ID+名冗余） |
| 详情 | `titan_euro_odds` | 欧赔快照（打平，≈613 万行，5 家公司） |
| 详情 | `titan_asian_odds` | 亚盘快照（打平，≈665 万行，4 家公司，line 中文+数值双列） |
| 详情 | `titan_over_under_odds` | 大小球快照（打平，≈62 万行，4 家公司 × full/half） |
| 详情 | `titan_analysis` | 赛前分析（55,314 行，衍生数据 JSONB + 不可推导标量 TEXT） |

**关键设计约定**（详见定稿文档"〇、设计全局原则"）：
- 所有表**软关联（无 FOREIGN KEY）**，查询用 LEFT JOIN。
- **ID 和名都存**：schedules / analysis 冗余球队、联赛名称列与 ID 列并存，查询免 JOIN；赔率表只存 `schedule_id`，不冗余联赛信息。
- **赔率按类型分 3 张表**（欧赔/亚盘/大小球 changes 结构不同），公司用 `company_id` 列区分，**不按公司拆表**。
- **赔率打平 + append-only**：`changes[]` 拆行，**`id BIGSERIAL` 代理主键 + 业务唯一键（`change_time + 盘口 + 赔率值`）**，不做 JSONB 母表；每次抓取仅插入新变动（`ON CONFLICT DO NOTHING`），绝不 UPDATE/DELETE 旧行（详见定稿文档"十四、增量写入与一致性设计"）。
- `changes[].time` 为球探原生格式（`M-d HH:MM` 无年份），导入脚本推断年份转 TIMESTAMPTZ；`(初盘)` 后缀由 `is_initial` 承载。
- 亚盘盘口中文存 `line_raw` + 映射值 `line_value` 双列；映射 dict 预置 `-7~+7` 全网格（0.25 步进）+ 简写变体，规则解析兜底。
- 欧赔恒 full 无 subtype 列；亚盘预置 subtype 列（为将来 half 预留）；大小球 full/half 双 subtype。
- analysis 的 recent/h2h/standings/lineup 整存 JSONB（衍生数据，聚合引擎可自算），preview/tip/weather 用 TEXT 列。

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
    id                  BIGSERIAL PRIMARY KEY,  -- 统一比赛 ID
    kickoff_time        TIMESTAMPTZ NOT NULL,   -- 开赛时间（对齐主键核心，NOT NULL 便于索引与对齐）

    -- 对齐引用（指向 unified_leagues / unified_teams；NULL = 该联赛/球队尚未映射）
    unified_league_id   INTEGER,
    unified_home_id     INTEGER,
    unified_away_id     INTEGER,

    -- 跨源合并结果（状态/比分取自主源，规则见下方「对齐规则」）
    status              TEXT NOT NULL,          -- SCHEDULED / LIVE / FINISHED / POSTPONED
    home_score          INTEGER,
    away_score          INTEGER,
    status_source       TEXT,                   -- 状态/比分取自哪个源（可追溯）
    season_key          TEXT,                   -- 如 "2025/26"

    -- 各源引用（JSONB，可扩展新源）
    source_refs         JSONB NOT NULL DEFAULT '{}',
    -- 例: {"sofascore": {"match_id": 12345},
    --      "jingcai": {"match_id": 1022716, "match_num": "周六012"},
    --      "titan007": {"schedule_id": 2789129}}

    -- 竞彩日赛冗余列（仅竞彩场次有值，其他源为 NULL；避免竞彩日赛页 JOIN 源库）
    business_date       DATE,                   -- 竞彩销售日（开售日期）
    match_num           TEXT,                   -- 比赛编号（如 "周六012"）
    single_spf          SMALLINT,               -- 五池单关标记 0/1
    single_rqspf        SMALLINT,
    single_ttg          SMALLINT,
    single_hafu         SMALLINT,
    single_crs          SMALLINT,

    -- 对齐审计
    aligned_sources     SMALLINT NOT NULL DEFAULT 1,  -- 已对齐的源数量（1~3）
    last_aligned_at     TIMESTAMPTZ DEFAULT now(),
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_um_kickoff  ON unified_matches (kickoff_time);
CREATE INDEX idx_um_league   ON unified_matches (unified_league_id);
CREATE INDEX idx_um_team     ON unified_matches (unified_home_id, unified_away_id);
CREATE INDEX idx_um_business ON unified_matches (business_date);   -- 竞彩日赛页
```

> **对齐规则（已确认）**：
> 1. **对齐键**：`unified_league_id + unified_home_id + unified_away_id + kickoff_time`，开赛时间允许 **±90 分钟**容差。
> 2. **流程**：每源新比赛 → 聚合引擎用 `cross_source_*` 映射表解析出 unified 三 ID → 在 `unified_matches` 中按对齐键查找匹配行：命中则 merge（补 `source_refs` / 更新字段），未命中则新建行。
> 3. **未对齐比赛**：只有单个源有数据（如仅竞彩开设、或仅球探收录）的场次**也建行**，`aligned_sources=1`，前端照常显示，只是缺少部分源的增强数据。
> 4. **状态/比分冲突规则**：任一源 FINISHED 即取 FINISHED + 比分（完场信息优先）；同为进行中取 `last_aligned_at` 最新的源；**竞彩终赔 / 单关标记永远取竞彩源**（见 titan007 文档 1.1.1 取数链路）。

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

- `users` / `predictions` / `briefings` / `injuries` / `odds_history` 等平台业务表（结构基本保留）。
- **`teams` / `leagues` / `matches` 旧表不迁移、废弃**，由 `unified_teams` / `unified_leagues` / `unified_matches` 完全取代（已确认，见 17.2 #1）。`team_aliases` / `match_source_mappings` 由 `cross_source_*` 映射表取代。

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

| 保证项 | 实现方式 |
|---|---|
| **幂等写入** | 所有表带 UNIQUE 约束 + `ON CONFLICT DO UPDATE`。同一条记录重抓不产生脏数据。现有 `import_jingcai.py` 已验证此模式。 |
| **增量游标** | 聚合引擎按源记录游标 `(source, last_processed_at)`，只处理新数据，可重入、可对账。 |
| **同步更新** | 聚合库更新是「源变 → 通知 → 立即增量重算 → 幂等写」的**同步链**，不是 TTL 过期重建。源库没变，聚合不跑；源库变了，聚合必然跑。不存在「旧缓存未失效」问题。 |
| **通知兜底** | 通知失败（HTTP 超时/网络抖）时，5 分钟定时扫描兜底，保证最终一致。 |
| **无脏读** | 后端连源库用只读事务（`default_transaction_read_only=on`）。 |
| **跨源对齐** | 所有跨源 JOIN 先查 cross_source_* 映射表；未映射的球队/联赛进「待映射」清单，由人工补全。 |
| **重算安全** | 聚合任务可随时重跑（幂等），全量重算有单独接口。 |

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

| 层级 | 内容 | 策略 |
|---|---|---|
| **聚合库** | 比赛列表、赔率快照、积分榜、预测结果 | 本身就是派生数据存储，预计算 + 同步更新，无需 TTL 淘汰 |
| **PG 物化视图** | 高频聚合查询（今日比赛 + 赔率汇总） | 定时刷新（可选，Phase 3 优化） |
| **Redis** | — | **第一版不加**。后续若前端 QPS 高，再加 Redis 作为聚合库的读副本，失效走「源变→重算→写 PG→写 Redis」同步链 |
| **前端** | TanStack Query | 已有，按接口特征设置 staleTime |

### 12.2 为什么第一版不加 Redis

- 聚合库就在 PG 里，正确索引下单表百万行查询毫秒级。
- 加 Redis 引入第二层缓存失效逻辑（源变 → 重算 → PG → Redis 都要同步），增加故障点，收益为零（当前访问量小）。
- 真正的「缓存更新一致性」由聚合库的同步更新机制保证（见 11.2），与 Redis 无关。

---

## 十三、后端 API 设计

> 所有路由挂在 `/api/v1` 前缀下。分三层：**前台只读内容**（公开）、**认证**（用户）、**控制面**（管理员 + 内部密钥）。**已定稿**（2026-08-06，见 17.2）。

### 13.1 分层总览

| 层 | 鉴权 | 读取数据源 | 说明 |
|---|---|---|---|
| 前台只读内容 | 公开 | spottery 聚合库（unified_*/aggregated_*） | 赛程/赔率/积分榜/状态/交锋/预测等展示数据 |
| 认证 | JWT | users 表 | 注册/登录/个人中心 |
| 控制面 | 管理员 + `X-Internal-Token` | 全部 | 触发爬虫/聚合、上传映射、查游标 |

**设计原则：**
1. **内容接口全部公开只读**，登录仅限认证与控制面；未来若做会员制，再在内容层加订阅标记收紧（17.2 记录）。
2. 后端内容接口**一律查聚合库**，不直连源库（读源库仅由聚合引擎/内部接口完成）。
3. **分析数据采用「单详情聚合接口 + 模块可选 + 前端逐块容错」**：某模块无数据返回 `null` / 空数组，前端按块判空显示，不阻塞整页。

### 13.2 前台只读内容 API（公开）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/matches` | unified_matches 分页列表 |
| GET | `/matches/{id}` | ★单详情聚合接口（一次返回全部模块，见下） |
| GET | `/matches/{id}/odds/{type}` | 赔率走势（唯一保留的细分接口，走势图独立加载） |
| GET | `/leagues` | 联赛列表 |
| GET | `/leagues/{id}/standings` | aggregated_standings 积分榜 |
| GET | `/teams` | 球队列表 |
| GET | `/teams/{id}` | 球队详情 + aggregated_form |
| GET | `/analysis/h2h` | 交锋历史（team1_id + team2_id） |

**`/matches` 查询参数**：`business_date`（竞彩日赛页）/ `date` / `league` / `status` / `source` / `page` / `page_size`。
竞彩日赛 = `/matches?source=jingcai&business_date=YYYY-MM-DD`，终赔与单关取自 unified_matches 冗余列 + `jingcai_odds_*` 最后快照（见 7.2 / titan007 1.1.1）。

> **MVP 直读过渡（2026-08-11 已实施）**：聚合引擎尚未建成，`/matches?source=jingcai&business_date=` 由 `services/api/app/services/jc_daily.py` 实现**双源直读**，前端 `frontend/`（自旧 spottery_pro 迁移）首页即用此接口。判据 = 该 business_date 的排干状态（workset.completeDate 游标）：
> - `business_date ∈ workset.dates`（未排干）→ 读 `crawler-sporttery` 的 `workset.json` + `matches/{id}.json`（5 池最新赔率取 `oddsHistory` 最后一条）
> - `business_date ≤ completeDate`（已排干）→ 读 sporttery 源库 `jingcai_schedules` + `jingcai_odds_*` 各池最后快照（`DISTINCT ON (match_id) ORDER BY snapshot_at DESC`）
> - 其余（未来/空）→ 空列表
>
> 响应结构见 `services/api/app/schemas/matches.py`：`{date, weekday, source, matches[]}`，每场含 5 池 `odds` + `singles`（单关标记）+ 由 `matchResult`/`pool_status`/`kickoff_time` 推导的 `status`。**待聚合引擎建成后回切到 unified_matches（架构原则 13.1-2）。**

**`/matches/{id}` 单详情聚合接口响应结构（模块全部可选）：**

```json
{
  "match":      { "id": 123, "kickoff_time": "...", "status": "FINISHED",
                  "home_team": "利物浦", "away_team": "曼联", "score": "2:1",
                  "league": "英超", "season_key": "2025/26",
                  "match_num": "周六012", "single_spf": 1, "source_refs": {...} },
  "standings":  { "home": [...], "away": [...] },
  "form":       { "home": [...], "away": [...] },
  "h2h":        [...],
  "odds":       { "spf": [...], "rqspf": [...] },
  "prediction": null,
  "briefing":   "暂无赛前简报",
  "comparison": {...},
  "injuries":   null
}
```

前端按块判空：`prediction` 为 null 显示"暂无预测"、`injuries` 为 null 隐藏伤停区块，整页不因单块缺失崩溃。

### 13.3 认证 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/register` | 注册（限流 5/min） |
| POST | `/auth/login` | 登录（限流 10/min） |
| GET | `/users/me` | 当前用户信息 |

### 13.4 控制面 API

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

### 13.5 旧版接口迁移对照（spottery_pro → 重构版）

| 旧接口 | 去向 |
|---|---|
| `/matches`（平台 Match 表） | `/matches`（unified_matches） |
| `/matches/betting`（JingcaiMatch 表） | `/matches?source=jingcai&business_date=` |
| `/matches/{id}` + 10 个拆分接口（odds/odds-history/analysis/briefing/comparison/injuries） | `/matches/{id}` 单详情聚合接口 |
| `/matches/{id}/odds` + `/matches/{id}/odds/history` | `/matches/{id}/odds/{type}` |
| `/analysis/h2h`、`/analysis/teams/{id}/form` | 同路径，改读 aggregated_* |
| `/analysis/*`（旧 async 版，与 matches 重复） | 删除 |
| `/scraper/*`（未接线 stub） | 删除（爬虫直写源库 + 控制面触发） |
| `/internal/matches/upsert`、`/internal/odds/snapshot`（爬虫推送） | 删除（爬虫直写源库，聚合引擎拉取） |
| `/admin/import/start\|stop\|status\|info` | 收敛为 `/internal/source/{source}/rebuild` + `/status` |

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

| 变量 | 说明 |
|---|---|
| `POSTGRES_PASSWORD` | PG 超级用户密码 |
| `PG_APP_PASSWORD` | 应用账号（crawler_*/api_service）密码 |
| `JWT_SECRET_KEY` | 后端 JWT 密钥 |
| `JWT_EXPIRE_DAYS` | Token 有效期 |
| `INTERNAL_API_KEY` | 爬虫↔后端内部通信令牌 |

### 14.2 开发 vs 生产

- **开发（Windows）**：`docker compose up -d` 启动全部；爬虫可以 `profile: [crawlers]` 按需启动，本地开发也可不启动爬虫直接用已有源库数据。
- **生产（Linux）**：`docker compose up -d` 全量启动 + 外部 PG 数据卷 + 反代（Nginx）+ HTTPS。爬虫容器内的定时任务由进程内调度器（node-cron / apscheduler / systemd-like）驱动。

---

## 十五、迁移路径（三阶段）

### Phase 1：建模型 + 一次性导入（不动采集代码）

目标：四库 schema 就绪，历史数据入库，聚合引擎骨架可跑。

| 步骤 | 内容 | 交付物 | 验证点 |
|---|---|---|---|
| 1a | 创建 4 个库的 DDL（`db/init/`） | DDL 脚本 | 建库成功，权限隔离生效 |
| 1b | 写三个一次性 JSON→PG 导入脚本（`db/migrate/`） | migrator 脚本 | 63 万 JSON 全部入库，与 JSON 逐字段对账 |
| 1c | 迁移平台库现有 17 张 `jingcai_*` 表到 `jingcai` 库 | pg_dump/restore | 行数与源库一致 |
| 1d | 建 `cross_source_leagues` / `cross_source_teams` 表 + 导入现有 mapping JSON | mapping 表数据 | 映射齐全 |
| 1e | 写三个 SourceAdapter + 聚合引擎骨架（unified_* 对齐 + aggregated_* 空表） | adapter + engine 代码 | 单元测试通过 |

> 本阶段不修改任何爬虫采集代码，纯新增。风险低，可随时回退。

### Phase 2：改采集逻辑 + 双写上线

目标：爬虫开始写 PG，聚合引擎上线，前端切数据源。

| 步骤 | 内容 | 验证点 |
|---|---|---|
| 2a | 每个爬虫新增 PG writer，**保留 JSON writer**（双写） | 同一批数据 PG 和 JSON 全量对比一致 |
| 2b | 每个爬虫新增 HTTP 控制接口（/crawl /status /health） | 后端可手动触发 |
| 2c | 聚合引擎上线（apscheduler 定时 + 事件触发） | 源库更新 → 聚合库同步更新 |
| 2d | 后端 source_admin 路由 + mapping upload 接口 | 手工触发/上传可用 |
| 2e | 前端切到聚合库数据源 | 页面功能回归 |
| 2f | **全量对比验证**：双写期间对每个 JSON 字段与 PG 记录对比 | 零差异后才进入 Phase 3 |

> 双写期可随时回退（关闭 PG writer 即回 JSON 模式）。

### Phase 3：清理 + 优化 + 部署

| 步骤 | 内容 |
|---|---|
| 3a | 确认聚合库稳定 → 关闭双写、移除 JSON writer |
| 3b | 清理/归档旧 JSON 文件（保留一份灾备快照） |
| 3c | 性能优化（物化视图、索引、连接池、PG 参数调优） |
| 3d | 备份策略上线（4 库每日备份） |
| 3e | 部署到 Linux 云服务器，补充监控（日志、健康检查） |
| 3f | 废弃旧平台表 `matches` / `teams` / `leagues`（已确认不迁移，见 9.3） |

---

## 十六、技术栈决策

### 16.1 结论：保持三源各自技术栈，不统一

| 爬虫 | 技术栈 | 反爬核心 | 不迁移的原因 |
|---|---|---|---|
| 竞彩 | TS + Puppeteer | `puppeteer-extra-plugin-stealth` | JS 生态独有商业级 stealth，Python 无等价方案，换语言后大概率被 sporttery.cn 识别拦截 |
| titan007 | Python + Playwright | 146 UA + **GBK 解码** | `bytes.decode("gbk")` 是 Python 标准库能力；TS 需第三方 `iconv-lite`（社区质量不稳） |
| Sofascore | TS + Playwright | `page.evaluate(fetch)` + UA/视口轮换 | 与竞彩共享 TS 生态，迁移无收益 |

### 16.2 改动范围（各爬虫）

- **不动的部分**：抓取逻辑、解析逻辑、反爬逻辑、调度逻辑、断点续爬逻辑。
- **改动的部分**：存储层。把「写 JSON 文件」替换为「写 PostgreSQL（幂等 upsert）」，断点判断从「文件存在性」改为「DB 记录存在性」。
- 每个爬虫文件系统耦合点：
  - Sofascore：约 21 处（schedules + details 两个文件）。
  - 竞彩：约 30 处（base-scraper + historical 两阶段 + repair + collectMatchIds）。
  - 球探：约 12 处写入 + 8 处读取（odds_store + utils + 各 pipeline inline dump）。

### 16.3 统一技术栈评估（供参考，不采用）

| 迁移方向 | 工作量 | 最大风险 |
|---|---|---|
| TS → Python（Sofascore） | ~14.5 人天 | Playwright 行为差异、反爬升级 |
| TS → Python（竞彩） | ~5 人天（1.7k 行） | **stealth 插件无等价物，极可能被识别** |
| Python → TS（titan007） | ~8-13 人天 | **GBK 解码、时区处理** |

结论：迁移风险/收益不成正比，保持现状最稳。

---

## 十七、风险与开放问题

### 17.1 风险清单

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| 1 | 63 万 JSON 导入耗时/失败 | 高 | 分源分阶段导入，脚本可断点续导，原始 JSON 保留 |
| 2 | 双写期数据不一致 | 中 | 全量逐字段对比，对比不通过不进入 Phase 3 |
| 3 | 反爬被目标网站升级检测 | 中 | 保持原反爬实现不重构，减少变化面 |
| 4 | 映射表人工维护出错导致跨源错配 | 中 | 管线校验 + 交叉验证表人工核对 |
| 5 | 聚合引擎计算逻辑错误 | 中 | 单元测试 + 与源数据独立校验 |
| 6 | 迁移后磁盘占用 | 低 | 旧 JSON 清理/归档策略 |
| 7 | 浏览器容器资源占用 | 低 | 独立容器可控，后续可优化 |

### 17.2 开放问题（待评审确认）

1. ~~现有平台基础表（`matches` / `teams` / `leagues`）与新的 `unified_*` 表语义重叠，Phase 3 是否合并/废弃？~~ **已解决（2026-08-06）：不迁移、废弃，unified_* 完全取代**（见 9.3）。
2. ~~聚合引擎的计算规则（积分榜口径、状态计算 N 场）是否需要与现有前端分析页面对齐，还是重新定义？~~ **部分已解决（2026-08-06）**：对齐键（±90 分钟容差）与状态/比分冲突规则已定稿（见 9.1）；积分榜/状态/交锋的具体计算口径迁移时以现有 `matches.py` 内联算法为基线（`_compute_standings` / `_stat_from_results`），是否调整待聚合引擎开发时评审。
3. `jingcai_*` 17 张表迁移到独立库后，现有 `import_jingcai.py` 是否退役，改由爬虫直接写库？
4. 前端页面是否全量切换到聚合库，还是过渡期保持对现有接口兼容？—— **API 设计已定稿（见第十三章）**，过渡期兼容与否待前端阶段确认。
5. 映射表上传接口的鉴权与校验（防误传损坏数据）。
6. 爬虫容器内定时任务与后端手动触发的并发控制（防止同一源同时抓取）。

---

## 附录 A：数据规模汇总

| 数据源 | JSON 文件数 | 预期入库表数 | 预期行数 |
|---|---|---|---|
| Sofascore | ~88,000 | 15 张 | 赛程 82,288 + 统计 ≈39 万 + 球队 2,159 |
| 竞彩 | ~80,800 | 8 张 | 约 222 万行（按 10 万场估算） |
| 球探 | ~515,757 | 8 张 | 赔率 ≈1,340 万 + 分析 55,314 + 赛程 297,120 |
| 聚合库（spottery） | — | unified 3 + aggregated 4 | unified_matches ≤ 各源去重并集（估算 25~30 万，待对齐验证）；unified_teams ≈ 数千；aggregated_* 由各源规模推导 |

## 附录 B：关键名词

| 名词 | 含义 |
|---|---|
| 源库 | 爬虫自维护的原始数据库（sofascore / jingcai / titan007） |
| 聚合库 | 平台库 spottery，存跨源计算/聚合结果 |
| SourceAdapter | 数据源适配器，聚合引擎与源库之间的统一接口 |
| 聚合引擎 | 读源库 → 对齐 → 计算 → 写聚合库的后端模块 |
| 跨源映射 | cross_source_leagues / cross_source_teams，人工维护 |
| 双写 | 爬虫同时写 JSON 和 PG，验证一致后停 JSON |

---

## 附录 C：PG 导入期调优参数

> 三源（sofascore / jingcai / titan）**全量批量导入**期间为对抗开发环境稳定性与提速临时调整的 5 项 PG 参数。本文记录其使用场景、开启方式、为何必须复原、如何复原。

### C.1 背景

Docker Desktop（Windows）的 bind mount 走 **9p 协议**，大并发写入时 PG 的 postmaster 会频繁崩溃（实测日志：`SIGKILL to recalcitrant children`、`invalid magic number in WAL segment`、`database system was interrupted`），且每次崩溃后需 WAL 重放恢复。批量导入（每源数百万行、数十万文件）期间，通过降低 WAL/fsync 开销来缓解写入压力、缩短窗口、配合脚本的窗口事务 + 断点重试扛过崩溃循环。

### C.2 五项参数

| 参数 | 默认 | 调优值 | 作用 |
|---|---|---|---|
| fsync | on | off | 关闭每事务 fsync，减少写盘等待 |
| full_page_writes | on | off | 关闭检查点后整页写 |
| synchronous_commit | on | off | 不等 WAL flush 即返回提交 |
| checkpoint_timeout | 300s | 900s | 拉长检查点间隔，减少 9p 写入风暴 |
| max_wal_size | 1024MB | 4096MB | 加大 WAL 容量，减少检查点频率 |

### C.3 使用场景

- **仅限开发环境**：Docker Desktop（Windows）+ 9p bind mount 数据卷。
- **仅限大规模批量导入/回填**：三源一次性全量导入（千万行级）。
- **不适用**：生产（Linux 原生磁盘，9p 不存在）；稳态增量更新（每日新文件、赔率 append，负载极小，默认参数足够）。

### C.4 开启方式

```sql
ALTER SYSTEM SET fsync = off;
ALTER SYSTEM SET full_page_writes = off;
ALTER SYSTEM SET synchronous_commit = off;
ALTER SYSTEM SET checkpoint_timeout = 900;
ALTER SYSTEM SET max_wal_size = 4096;
SELECT pg_reload_conf();
```

验证生效：

```sql
SHOW fsync; SHOW full_page_writes; SHOW synchronous_commit;
SHOW checkpoint_timeout; SHOW max_wal_size;
```

### C.5 为何必须复原

1. **数据安全底线**：`fsync=off` 在崩溃时 **WAL 可能损坏**（实测 `invalid magic number in WAL segment`），恢复靠丢弃损坏尾部 → 有丢失已提交数据风险；`full_page_writes=off` 崩溃恢复可能产生页面不一致；`synchronous_commit=off` 崩溃时可能丢最近提交。
2. **稳态不需要**：增量更新负载极小，默认参数毫无性能压力。
3. **生产必须默认**：PG 持久性保障要求 `fsync=on`，任何环境都不应在常态下关闭。

### C.6 如何复原

```sql
ALTER SYSTEM RESET fsync;
ALTER SYSTEM RESET full_page_writes;
ALTER SYSTEM RESET synchronous_commit;
ALTER SYSTEM RESET checkpoint_timeout;
ALTER SYSTEM RESET max_wal_size;
SELECT pg_reload_conf();
```

验证回落默认值：

| 参数 | 复原后 |
|---|---|
| fsync | on |
| full_page_writes | on |
| synchronous_commit | on |
| checkpoint_timeout | 5min |
| max_wal_size | 1GB |

**说明**：`ALTER SYSTEM` 持久化写入 `postgresql.auto.conf`（数据卷内），`RESET` 即删除对应条目；容器/Docker Desktop 重启不会重置，无需额外操作。
