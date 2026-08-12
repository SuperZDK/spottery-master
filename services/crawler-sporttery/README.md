# 足球数据爬虫系统 (football-scrapers)

多源足球数据爬虫系统，目前完整实现**竞彩 (sporttery.cn)** 的数据抓取，并预留了**球探体育**与 **SofaScore** 的演示接口。

- 竞彩数据源：`https://www.sporttery.cn`（通过 Puppeteer 页面内调用官方 API，复用浏览器会话）
- 球探体育 / SofaScore：stub 演示实现，返回硬编码示例数据

## 功能特性

- **反爬对抗**：puppeteer-extra stealth 插件 + 随机 User-Agent / 视口 + 代理池轮换
- **浏览器池**：默认最多 5 个 Puppeteer 页面，支持按需获取 / 释放 / 重置
- **定时调度**：基于 node-cron，每个爬虫独立 cron 表达式，支持优雅停机
- **历史批量爬取**：两阶段爬取竞彩 2015 年至今的历史赛程与比赛详情（含赔率历史）
- **自动落盘**：抓取结果自动保存为 JSON，并清理 7 天前的旧文件
- **后端推送**：可将数据批量 POST 到后端 API，内置 3 次指数退避重试

## 技术栈

| 类别 | 技术 |
|---|---|
| 语言 | TypeScript（ESM） |
| 浏览器自动化 | Puppeteer + puppeteer-extra-plugin-stealth |
| 定时任务 | node-cron |
| HTTP | axios |
| 运行 | tsx（开发）/ tsc + node（生产） |

## 目录结构

```
src/
├── index.ts                  # 入口：注册全部爬虫并启动调度
├── api-client.ts             # 后端 API 客户端（带重试）
├── repair-daily.ts           # 修复 daily 文件缺失字段
├── repair-missing.ts         # 批量修复历史数据缺失字段
├── engine/
│   ├── base-scraper.ts       # 爬虫抽象基类：抓取 → 存 JSON → 自动清理
│   ├── browser-pool.ts       # Puppeteer 浏览器池
│   └── scheduler.ts          # cron 调度器
├── middleware/
│   ├── stealth.ts            # 反爬 stealth 插件
│   └── proxy-pool.ts         # 代理池（存活检测 + 轮询）
├── parsers/
│   ├── odds-parser.ts        # 赔率解析 / 博彩公司名归一化
│   └── match-parser.ts       # 比赛时间 / 比分 / 队名解析
└── sources/
    ├── jingcai/              # 竞彩（完整实现）
    │   ├── schedule.ts       # 实时赛程
    │   ├── result.ts         # 近期赛果
    │   ├── odds.ts           # 实时赔率 (HAD/HHAD/TTG)
    │   ├── historical.ts     # 历史批量爬取 + 修复方法
    │   └── run-crawl.ts      # 历史爬取入口
    ├── qiutantiyu/           # 球探体育（stub）
    └── sofascore/            # SofaScore（stub）
```

## 快速开始

环境要求：Node.js ≥ 18

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env

# 3. 开发模式启动（自动重载）
npm run dev
```

生产构建与启动：

```bash
npm run build
npm start
```

## 定时任务

| 爬虫 | Cron 表达式 | 数据 |
|---|---|---|
| jingcai-schedule | `*/30 * * * *` | 实时赛程 |
| jingcai-result | `0 * * * *` | 近期赛果 |
| jingcai-odds | `*/15 * * * *` | 实时赔率 (HAD/HHAD/TTG) |
| qiutantiyu-matches | `*/15 * * * *` | 比赛数据 (stub) |
| qiutantiyu-odds | `*/10 * * * *` | 赔率 (stub) |
| qiutantiyu-stats | `*/30 * * * *` | 球队统计 (stub) |
| sofascore-matches | `*/15 * * * *` | 比赛数据 (stub) |
| sofascore-odds | `*/10 * * * *` | 赔率历史 (stub) |
| sofascore-lineups | `*/30 * * * *` | 首发阵容 (stub) |
| sofascore-stats | `*/15 * * * *` | 比赛统计 (stub) |

## 历史数据爬取

批量爬取竞彩历史数据（2015-06-01 ～ 昨天）。数据以 **文件存在 + 数据完整** 为有效依据，由**一张标记表** `data/jingcai/incomplete-dates.json` 驱动重爬，天然支持断点续跑。

```bash
cd scrapers
npx tsx src/sources/jingcai/run-crawl.ts            # 默认：增量（建表后只处理新日期 + 表内日期）
npx tsx src/sources/jingcai/run-crawl.ts --force    # 全量：逐日重建表并覆盖写盘
```

### 运行流程（读表驱动，非全量遍历）

```
首次运行 或 --force：
    遍历全部日期，逐日：重爬 daily → 逐场判定完整性 → 缺详情的当场重抓详情   ← 一次性全量建表
    lastScannedDate = 昨天
以后每次：
    只对 (lastScannedDate+1 ~ 昨天] 的新日期走上面同样的流程               ← 增量
    lastScannedDate = 昨天
表内日期 ≠ 空：
    每轮：对表内每个日期整日重爬 daily → 只重抓该天 matches 列表里缺失详情的场
    attempts > 10 → 永久移出表
```

### 完整性的判定标准

- **一场比赛"已结算"** = `matchResult` 非空（`Payout` 有真实比分，`Refund`/卡在 `OddsIn` 的取消场是 `-1:-1`，均视为已结算）。
- **一场比赛"详情完整"** = `data/jingcai/matches/{matchId}.json` 同时存在 `matchInfo` 与 `oddsHistory` 两个字段。
- **一个日期"完整"** = 该日期所有比赛都已结算、且已结算非 `Refund` 的比赛详情都完整；否则该日期进表，并在 `matches` 里记录具体哪几场。

### 重爬的粒度

- **daily（赛程）**：整日重爬 —— `getVoteV1.qry`（HHAD + HAD 两池）一次拉回当天全部比赛并覆盖写盘，因为 daily 接口只有整日粒度。
- **详情**：**逐场** —— 只对表内日期中 `matches` 列出的、缺 `matchInfo`/`oddsHistory` 的场次重抓，绝不重抓已完整的详情。
- `Refund` 取消场与未结算场不抓详情。

### poolStatus 参考

| poolStatus | 含义 | 说明 |
|---|---|---|
| `Payout` | 已结算/派奖 | 有比分，完整 |
| `Refund` | 取消场 | `matchResult=-1:-1`，视为完整，不重爬 |
| `OddsIn` / `Close` / `Selling` | 未结算/赔率录入中 | 以 `matchResult` 是否非空判定；空则视为不完整 |
| `Close` | 销售关闭 | 同上 |

### 标记表 `data/jingcai/incomplete-dates.json`

```json
{
  "version": 2,
  "lastScannedDate": "2026-08-03",
  "dates": {
    "2026-08-03": { "attempts": 2, "matches": [2040704] },
    "2026-01-27": { "attempts": 2, "matches": [2037336] }
  }
}
```

- `lastScannedDate`：增量扫描边界，避免每次都全量遍历。
- `dates[日期]`：`attempts` = 已重爬次数；`matches` = 该天具体哪几场比赛不完整。
- 每次改动原子落盘；程序崩溃后下次运行自动从表恢复续爬。
- 某日期重爬仍不完整则 `attempts` 递增，**超过 10 次**永久移出表（避免卡死）。

辅助修复脚本：

```bash
npx tsx src/repair-daily.ts       # 修复 daily 文件缺失字段
npx tsx src/repair-missing.ts     # 修复指定区间缺失字段
```

## 数据目录

```
data/
├── jingcai/
│   ├── daily/          # 按日期组织的赛程列表（数千个文件）
│   ├── matches/        # 按 matchId 组织的比赛详情 + 赔率历史（数万个文件）
│   └── incomplete-dates.json  # 不完整日期标记表（天 → 具体不完整比赛，驱动重爬）
└── jingcai-odds/       # 一次性赔率导出快照
```

定时爬虫输出文件命名为 `{YYYYMMDD_HHmmss}.json`，超过 7 天自动清理。

## 配置项 (.env)

| 变量 | 默认值 | 说明 |
|---|---|---|
| `BACKEND_API_URL` | `http://localhost:8000` | 后端 API 地址 |
| `SCRAPER_API_KEY` | `scraper-secret-key` | 后端认证密钥 |
| `BROWSER_HEADLESS` | `true` | 设为 `false` 可查看 Chromium 界面 |
| `PROXY_LIST` | (空) | 逗号分隔的代理地址列表 |

## 后端 API 对接

爬虫数据可批量推送至后端：

- `POST /scraper/matches` — 批量比赛数据
- `POST /scraper/odds` — 批量赔率数据

请求头携带 `X-API-Key`，推送失败自动重试 3 次（1s → 2s → 4s 指数退避）。

## Docker 部署

`Dockerfile` 基于 `node:22-slim`，内置 Chromium 运行时：

```bash
docker build -t football-scrapers .
docker run -d \
  --name scrapers \
  -e BACKEND_API_URL=http://your-backend:8000 \
  -e SCRAPER_API_KEY=your-secret \
  -v scrapers-data:/app/data \
  football-scrapers
```

注意：爬取数据需通过 volume 挂载 `/app/data` 持久化，否则容器重建后数据丢失。

## 声明

本项目仅供学习研究使用，抓取数据请遵守目标网站的《用户协议》及 robots.txt 相关约束。
