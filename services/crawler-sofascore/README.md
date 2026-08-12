# Sofascore 足球数据爬虫

基于 [Sofascore](https://www.sofascore.com/) 公开 API 的足球数据爬虫，覆盖 29 项启用的联赛与杯赛（配置中共定义 31 项，另含 2 项待补充的注释配置），抓取赛程、比赛详情、球队赛季统计等数据，以 JSON 形式持久化到本地，供足球数据分析与模型研究使用。

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [运行命令](#运行命令)
- [配置说明](#配置说明)
- [支持的赛事](#支持的赛事)
- [数据格式](#数据格式)
- [爬取策略](#爬取策略)
- [已知问题](#已知问题)
- [许可证](#许可证)

## 功能特性

- **29 项启用赛事**：覆盖欧洲五大联赛、次级联赛、澳超/日韩联赛及欧战杯赛
- **赛季跨度**：跨年联赛覆盖 `16/17` ~ `25/26`（部分含 `26/27`），单年联赛覆盖 `2016` ~ `2025`
- **赛程爬取（V3 富字段）**：按轮次拉取，杯赛自动降级为按球队拉取（team-based fallback）；输出嵌套结构（tournament / season / roundInfo / status / homeTeam / awayTeam / homeScore / awayScore 等）
- **详情爬取**：单场并行请求 6 个 API，包含赛前预测、投票、阵容、技术统计、比赛事件
- **断点续爬**：按文件存在性跳过已爬取的比赛，可随时中断恢复
- **全量编排**：`crawl-all.ps1` 按优先级顺序爬取 32 个 slug 并记录进度
- **图标下载**：国家/联赛/球队 Logo 下载脚本（`download-icons.ts`）
- **反爬措施**：Playwright 无头浏览器模拟真实请求，随机 UA 与视口

## 技术栈

| 组件 | 用途 |
|------|------|
| Node.js + TypeScript | 开发语言 |
| tsx | 直接运行 TypeScript |
| Playwright (Chromium) | 浏览器级 HTTP 请求，规避反爬 |
| curl.exe | 图标下载（download-icons.ts） |

## 快速开始

### 环境要求

- Node.js ≥ 18（ESM，`type: "module"`）
- Git Bash / PowerShell（Windows 推荐）

### 安装

```bash
npm install
npx playwright install chromium   # 首次需安装 Chromium 内核
```

## 项目结构

```
crawler/
├── src/
│   ├── config/
│   │   ├── sofascore.ts          # 29 项启用赛事配置（id, slug, seasonIds, seasonRounds 等）
│   │   └── index.ts              # 配置导出入口
│   ├── scrapers/
│   │   └── sofascore/
│   │       ├── fetch-schedules.ts  # 赛程爬虫（按轮次 / 按球队两种策略）
│   │       ├── fetch-details.ts    # 详情爬虫（单场 6 API 并行）
│   │       └── sofascore-api.ts    # Sofascore API 接口文档（含响应结构说明）
│   ├── jobs/
│   │   └── download-icons.ts       # 国家/联赛/球队图标下载
│   ├── types/
│   │   └── index.ts                # 全部 TypeScript 类型定义
│   └── utils/
│       └── curl.ts                 # Playwright 请求封装（含限速、随机延迟）
├── scripts/                        # 调试脚本
├── tools/                          # 辅助工具（校验配置、比对 API 等）
├── images/                         # 下载的国家/联赛/球队图标
├── data/
│   ├── schedules/                  # 赛程 JSON（旧版扁平结构，已弃用）
│   ├── schedules_v2/               # 赛程 JSON（旧版目录，保留作对比/备份）
│   ├── schedules_v3/               # 赛程 JSON（当前 V3 富字段结构，爬虫实际输出）
│   ├── details/                    # 比赛详情 + 球队赛季统计
│   ├── crawl_log.txt               # 全量爬取运行日志
│   └── crawl_progress.json         # 全量爬取进度（按 slug 记录完成时间/耗时）
├── crawl-all.ps1                   # 全量爬取脚本（按优先级）
├── crawl-all.bat                   # 双击启动批处理
├── AGENTS.md                       # 项目说明 / 爬取状态
└── package.json
```

## 运行命令

### 爬取赛程

```bash
# 全部赛事（跳过已有非空文件；--force 强制重抓）
npx tsx src/scrapers/sofascore/fetch-schedules.ts
npx tsx src/scrapers/sofascore/fetch-schedules.ts --force

# 只爬指定联赛（按 slug）
npx tsx src/scrapers/sofascore/fetch-schedules.ts premier-league laliga
```

> 输出目录为 `data/schedules_v3/`。赛程爬取会跳过已有非空文件，如需重抓需先删除旧文件或使用 `--force`。

### 爬取比赛详情

```bash
# 全部联赛
npx tsx src/scrapers/sofascore/fetch-details.ts

# 只爬指定联赛（按 slug）
npx tsx src/scrapers/sofascore/fetch-details.ts premier-league laliga
```

> 详情爬取读取 `data/schedules_v3/` 下的赛程文件，输出到 `data/details/{联赛名}/{赛季}/`。
> 已存在的比赛详情文件会自动跳过，可安全中断续跑。

### 全量爬取

```bash
.\crawl-all.ps1     # 或双击 crawl-all.bat
```

按 `crawl-all.ps1` 中定义的 5 个阶段优先级顺序爬取 32 个 slug，每个联赛完成自动记录到 `data/crawl_progress.json`。

### 下载图标

```bash
npx tsx src/jobs/download-icons.ts
```

从各联赛积分榜收集球队，下载国家、联赛、球队三类图标到 `images/`。

## 配置说明

所有赛事配置集中在 `src/config/sofascore.ts`。

### LeagueConfig 关键字段

| 字段 | 说明 |
|------|------|
| `id` | Sofascore 联赛/杯赛 ID（`unique-tournament` id） |
| `slug` | URL slug，用于命令行过滤 |
| `shortName` | 中文简称，用作本地目录名 |
| `type` | `"league"` 联赛 / `"cup"` 杯赛 |
| `tier` | 联赛级别（1=顶级联赛，0=杯赛/欧战） |
| `rounds` | 固定轮次列表（仅简单联赛使用） |
| `seasonRounds` | 每赛季轮次映射，可含 `slug`（杯赛轮次）、`prefix`（荷甲升降级附加赛分组）、`nameCn`（中文轮次名） |
| `seasonIds` | 赛季 key → seasonId 映射 |

### 赛季 key 格式

| 类型 | 格式 | 示例 |
|------|------|------|
| 跨年联赛 | `"16/17"` | 英超、西甲、德甲、欧冠等 |
| 单年联赛 | `"2016"` | 瑞典超、挪超、日职联、日职乙等 |

### 当前注释掉的赛事

- **芬超**（Veikkausliiga）：Sofascore 数据结构未完整配置
- **美职联**（MLS）：2018 年起 API 未返回常规赛轮次

> 配置中共定义 31 项赛事，其中 2 项被注释，实际启用 29 项。
> 注意：`crawl-all.ps1` 中的优先级列表仍包含 `mls`、`veikkausliiga`，但配置中对应赛事已注释，运行时会被跳过。

## 支持的赛事

### 五大联赛（跨年赛季）

| 联赛 | slug | 等级 |
|------|------|------|
| 英超 Premier League | `premier-league` | 1 |
| 英冠 Championship | `championship` | 2 |
| 英甲 League One | `league-one` | 3 |
| 西甲 LaLiga | `laliga` | 1 |
| 德甲 Bundesliga | `bundesliga` | 1 |
| 德乙 2. Bundesliga | `2-bundesliga` | 2 |
| 意甲 Serie A | `serie-a` | 1 |
| 法甲 Ligue 1 | `ligue-1` | 1 |
| 法乙 Ligue 2 | `ligue-2` | 2 |

### 其他联赛

| 联赛 | slug | 赛季格式 |
|------|------|---------|
| 葡超 Liga Portugal | `liga-portugal` | 跨年 |
| 荷甲 Eredivisie | `eredivisie` | 跨年 |
| 荷乙 Eerste Divisie | `eerste-divisie` | 跨年 |
| 澳超 A-League Men | `a-league-men` | 跨年 |
| 瑞典超 Allsvenskan | `allsvenskan` | 单年 |
| 挪超 Eliteserien | `eliteserien` | 单年 |
| 日职联 J1 League | `j1-league` | 单年 |
| 日职乙 J2 League | `j2-league` | 单年 |

### 杯赛

| 杯赛 | slug |
|------|------|
| 欧冠 UEFA Champions League | `uefa-champions-league` |
| 欧联 UEFA Europa League | `uefa-europa-league` |
| 欧协联 UEFA Conference League | `uefa-conference-league` |
| 英足总杯 FA Cup | `fa-cup` |
| 英格兰联赛杯 EFL Cup | `efl-cup` |
| 社区盾杯 Community Shield | `community-shield` |
| 德国杯 DFB Pokal | `dfb-pokal` |
| 意大利杯 Coppa Italia | `coppa-italia` |
| 法国杯 Coupe de France | `coupe-de-france` |
| 西班牙国王杯 Copa del Rey | `copa-del-rey` |
| 西超杯 Supercopa de España | `supercopa-de-espana` |
| 日联杯 J. League Cup | `j-league-cup` |

## 数据格式

### 赛程文件（`data/schedules_v3/{联赛名}/{赛季}.json`）

顶层结构与旧版一致（`league` / `season` / `seasonId` / `matches`），但每条 match 改为嵌套的富字段结构：

```json
{
  "league": { "id": 17, "name": "Premier League", "shortName": "英超", "slug": "premier-league", "country": "england" },
  "season": "16/17",
  "seasonId": 11733,
  "matches": [
    {
      "id": 7089875,
      "slug": "hull-city-leicester-city",
      "tournament": {
        "name": "Premier League",
        "slug": "premier-league",
        "category": { "name": "England", "slug": "england" }
      },
      "season": { "name": "Premier League 16/17", "year": "16/17", "id": 11733 },
      "roundInfo": {
        "round": 1,
        "name": "Round of 16",
        "slug": "round-of-16",
        "prefix": "Relegation-Promotion",
        "cupRoundType": 8
      },
      "status": { "code": 100, "description": "Ended", "type": "finished" },
      "winnerCode": 1,
      "homeTeam": {
        "name": "Hull City", "slug": "hull-city", "shortName": "Hull",
        "userCount": 61771, "nameCode": "HUL",
        "country": { "alpha2": "EN", "alpha3": "ENG", "name": "England", "slug": "england" },
        "id": 96,
        "teamColors": { "primary": "#de8f38", "secondary": "#000000", "text": "#000000" }
      },
      "awayTeam": { "...": "结构同 homeTeam" },
      "homeScore": { "current": 0, "display": 0, "period1": 0, "period2": 0, "normaltime": 0 },
      "awayScore": { "current": 1, "display": 1, "period1": 0, "period2": 1, "normaltime": 1 },
      "hasXg": false,
      "hasEventPlayerStatistics": true,
      "hasEventPlayerHeatMap": true,
      "startTimestamp": 1494615600,
      "date": "2017-05-13 03:00:00",
      "finalResultOnly": false
    }
  ]
}
```

#### 各字段说明

| 字段 | 说明 |
|------|------|
| `id` / `slug` | 比赛 ID / URL slug |
| `tournament` | 所属赛事：`name` 赛事名、`slug`、`category` 国家/地区（`name` + `slug`） |
| `season` | 所属赛季：`name` 显示名、`year` 年份标识、`id` 赛季 ID |
| `roundInfo` | 轮次信息：`round` 轮次号；`name` / `slug` / `prefix` 用于杯赛轮次及附加赛分组；`cupRoundType` 淘汰赛阶段类型（仅杯赛有） |
| `status` | 比赛状态：`code` / `description` / `type`（如 finished） |
| `winnerCode` | 赛果：`1` 主胜 / `2` 客胜 / `3` 平 |
| `homeTeam` / `awayTeam` | 球队：`name` 全名、`slug`、`shortName` 短名、`userCount` 关注数、`nameCode` 三字代码、`country` 所属国家、`id` 球队 ID、`teamColors` 主/次/文字颜色 |
| `homeScore` / `awayScore` | 比分：`current` 当前、`display` 显示、`period1`/`period2` 各半场、`normaltime` 常规时间 |
| `hasXg` / `hasEventPlayerStatistics` / `hasEventPlayerHeatMap` | 是否包含 xG / 球员统计 / 球员热力图数据 |
| `startTimestamp` / `date` | 开球时间（Unix 秒 + 北京时间） |
| `finalResultOnly` | 是否仅含最终赛果 |

> 说明：
> - `roundInfo.round` 优先取配置的轮次，`slug` / `prefix` 遵循 **config 优先、API 兜底**：联赛按轮次抓取时取 `seasonRounds` 配置值，杯赛按球队 fallback 时取 API `ev.roundInfo`。
> - 联赛轮次的 `name` / `slug` / `prefix` / `cupRoundType` 通常不存在（JSON 中省略）；附加赛轮次才有 `slug` / `prefix`（如荷甲升降级附加赛分组）。

### 比赛详情（`data/details/{联赛名}/{赛季}/{matchId}.json`）

| 字段 | 来源 API | 说明 |
|------|---------|------|
| `matchId` / `slug` / `startTimestamp` / `status` / 比分 | `/event/{id}` | 比赛基本信息 |
| `referee` / `venue` / `attendance` | `/event/{id}` | 裁判 / 球场 / 上座人数 |
| `pregameForm` | `/event/{id}/pregame-form` | 两队赛前排位与近期状态 |
| `votes` | `/event/{id}/votes` | 赛前预测投票 |
| `lineups` | `/event/{id}/lineups` | 首发/替补/球员评分 + 伤停名单 |
| `statistics` | `/event/{id}/statistics` | 双方技术统计（按半场分组） |
| `incidents` | `/event/{id}/incidents` | 进球/红黄牌/换人/中框等事件 |

### 球队赛季统计（`data/details/{联赛名}/{赛季}/teams/{teamId}.json`）

```json
{
  "teamId": 42,
  "leagueId": 17,
  "seasonId": 61627,
  "statistics": { "...": "约 115 项进攻/控球/防守/纪律指标" }
}
```

由 `/team/{teamId}/unique-tournament/{leagueId}/season/{seasonId}/statistics/overall` 接口提供，随详情爬取懒加载。

## 爬取策略

### 赛程

- **联赛**：优先用配置的 `seasonRounds`/`rounds` 按轮次拉取 `/events/round/{round}`，并用 `/rounds` 接口补充配置缺失的轮次
- **杯赛**：轮次拉不到数据时降级为 **按球队拉取**——获取赛季参赛球队列表，逐个球队通过 `/team/{id}/events/last/{offset}` 翻页过滤出目标赛事与时间范围
- **roundInfo.slug / prefix 填充逻辑**：config 优先、API 兜底。联赛按轮次路径传入 `seasonRounds` 配置里的 `slug`/`prefix`；杯赛按球队 fallback 路径取 API `ev.roundInfo` 的 `slug`/`prefix`
- 并发 5，请求间隔 ≥ 200ms，按 `startTimestamp` 升序去重排序
- 输出 V3 富字段结构到 `data/schedules_v3/`

### 详情

- 单场 6 个 API 用 `Promise.all` 并行，跨场间隔 200ms + 随机延迟（约 8 场/分钟）
- 球队赛季统计懒加载：每场比赛涉及的新球队才拉取一次
- 已存在的 `{matchId}.json` 直接跳过，天然支持断点续爬

### 请求封装（`src/utils/curl.ts`）

- Playwright 无头 Chromium，禁用自动化检测特征，随机 UA（Chrome 120~134）与视口
- 每个请求设置 `--max-time` 级别的超时保护，异常返回 `null` 不中断主流程

## 已知问题

### 赛程数据

- **欧协联 21/22 ~ 24/25**：seasonId 曾配置错误导致赛程为空（已修正配置，需删除旧文件后重新抓取）
- **延期比赛**：Sofascore 对延期比赛保留原 matchId（`status: postponed`），重排后给予新 matchId（`status: finished`），轮次不变。赛程中两种记录都存在，取 finished 的为主
- **英超 16/17 有 391 场**：380 正常 + 11 延期，属正常现象
- **周中比赛**：某些轮次有周中补赛（如 R26 有 12 场、R28 有 15 场），Sofascore 按实际比赛时间归类

### 详情爬取

- **pregame-form**：老比赛（2016-2020）可能缺失
- **lineups**：老比赛可能没有阵型和球员评分
- **超时**：不存在的 matchId 单请求最多等待 30s
- **h2h 接口**：返回的是含比赛后数据的全部往绩，不适合投注分析，需自行从赛程中计算

### 环境

- **Playwright 浏览器版本不匹配**：`curl.ts` 使用 Playwright 无头 Chromium 发请求。若升级 Playwright 包后出现每轮都 `FAIL`（`curlJson` 抛 `Executable doesn't exist at ...\chromium-1234\...`），说明本机下载的浏览器构建与包版本不一致，需执行 `npx playwright install chromium` 重新下载匹配版本

## 许可证

私有项目，仅限个人研究使用。数据版权归 Sofascore 所有，请勿用于商业用途。
