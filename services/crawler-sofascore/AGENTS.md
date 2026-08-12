# Sofascore 爬虫项目总结

## 项目结构

```
crawler/
├── src/
│   ├── config/
│   │   └── sofascore.ts          # 31 个联赛/杯赛配置（id, slug, seasonIds 等）
│   ├── scrapers/
│   │   └── sofascore/
│   │       ├── fetch-schedules.ts  # 赛程爬虫（按轮次/按球队）
│   │       ├── fetch-details.ts    # 详情爬虫（单场比赛6个API并行）
│   │       └── sofascore-api.ts    # API 端点文档
│   ├── types/
│   │   └── index.ts               # 类型定义
│   └── utils/
│       └── curl.ts                 # curl 封装（--max-time 30）
├── data/
│   ├── schedules/                  # 赛程 JSON（304 赛季文件）
│   └── details/                    # 详情 JSON
│       └── {联赛名}/{赛季}/
│           ├── {matchId}.json      # 单场比赛详情
│           └── teams/{teamId}.json # 球队赛季统计
├── crawl-all.bat                   # 双击启动批处理
├── crawl-all.ps1                   # 全量爬取脚本（32联赛按优先级）
└── AGENTS.md                       # 本文件
```

## 配置说明（src/config/sofascore.ts）

31 项赛事，分 3 类：

| 类型 | 赛季格式 | 示例 |
|------|---------|------|
| 跨年联赛 | `"24/25"` | 英超、西甲、德甲等 |
| 单年联赛 | `"2024"` | 瑞典超、芬超、挪超、日职联、日职乙、美职联 |
| 杯赛 | `"24/25"` | 欧冠、欧联、欧协联、各国杯赛 |

**重要：欧协联 seasonId 已全部更正**（原配置 4 个旧赛季 ID 错误，已修复）

## 运行方式

```powershell
# 全量爬取
.\crawl-all.ps1          # 或双击 crawl-all.bat

# 按需爬取详情（支持 slug 过滤）
npx tsx src/scrapers/sofascore/fetch-details.ts premier-league laliga

# 全部详情（不传参）
npx tsx src/scrapers/sofascore/fetch-details.ts

# 重新抓赛程（需先删旧文件）
npx tsx src/scrapers/sofascore/fetch-schedules.ts
```

## 爬取状态

| 阶段 | 进度 |
|------|------|
| 赛程 data/schedules/ | 全部 304 赛季 ✅（欧协联 4 季已修正，需重新抓取） |
| 详情 data/details/ | 社区盾杯全 10 季 ✅、英超 16/17 ✅、17/18 ~ 19/20 进行中 |
| 球队统计 | 随详情懒加载 |

## 已知问题

### 赛程数据
- **欧协联 21/22 ~ 24/25 赛季**：seasonId 配错导致赛程为空（已修配置，待重新抓取）
- **延期比赛处理**：Sofascore 对延期比赛保留原 matchId（status=postponed），重排后给新 matchId（status=finished），轮次 round 不变。赛程中两种记录都存在，取 finished 的为主
- **英超 16/17 有 391 场**：380 正常 + 11 延期，正常现象
- **周中比赛**：某些轮次有周中补赛（R26有12场、R28有15场等），Sofascore 按实际比赛时间归类

### 详情爬取
- **pregame-form**：老比赛（2016-2020）可能没有
- **lineups**：老比赛可能没有阵型和球员评分
- **超时处理**：每个 API 请求 `--max-time 30`，不存在的 matchId 会卡 30s
- **速度优化**：6 个 API 用 `Promise.all` 并行，跨场间隔 200ms，约 8 场/分

## 后续计划

1. 补抓欧协联赛程（删旧文件后重跑 fetch-schedules.ts）
2. 继续跑详情：英超 → 西甲 → 德甲 → 意甲 → 法甲 → 欧冠 → 其他
3. 如需添加 round 字段到详情 JSON，在 `toMatchDetail` 中从 `ev.roundInfo?.round` 或 schedule 数据中传入
