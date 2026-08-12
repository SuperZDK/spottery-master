# Football Scrapers — Project Summary

Multi-source football data scraping system for 竞彩 (sporttery.cn), 球探体育 (qiutantiyu), and SofaScore.

## Architecture

```
src/
├── index.ts                  # Entry point — registers all scrapers with scheduler
├── api-client.ts             # HTTP client for pushing data to backend API
├── engine/
│   ├── base-scraper.ts       # Abstract base: execute() → save JSON → auto-cleanup old files
│   ├── browser-pool.ts       # Puppeteer browser pool (maxPages, stealth, random UA/viewport)
│   └── scheduler.ts          # node-cron scheduler — runs each scraper on its cron expression
├── middleware/
│   ├── stealth.ts            # Puppeteer-extra stealth plugin setup
│   └── proxy-pool.ts         # Proxy rotation pool (alive/dead tracking, round-robin)
├── parsers/
│   ├── odds-parser.ts        # Odds value parsing, bookmaker name normalization
│   └── match-parser.ts       # Match time/score parsing, team name normalization
└── sources/
    ├── jingcai/              # 竞彩 (China Sports Lottery)
    │   ├── schedule.ts       # Live match schedule (cron: */30 * * * *)
    │   ├── result.ts         # Recent match results (cron: 0 * * * *)
    │   ├── odds.ts           # Live odds: HAD/HHAD/TTG pools (cron: */15 * * * *)
    │   ├── historical.ts     # Bulk historical data crawler (daily + match details)
    │   └── run-crawl.ts      # Historical crawl entry point
    ├── qiutantiyu/           # 球探体育 (demo/stub only)
    │   ├── matches.ts        # Live match data (stub)
    │   ├── odds.ts           # Live odds (stub)
    │   └── stats.ts          # Team statistics (stub)
    └── sofascore/            # SofaScore (demo/stub only)
        ├── matches.ts        # Live match data (stub)
        ├── odds.ts           # Odds history (stub)
        ├── lineups.ts        # Lineups (stub)
        └── stats.ts          # Match statistics (stub)
```

## Data Sources

### 竞彩 (sporttery.cn) — Fully Implemented
- **Web**: `https://www.sporttery.cn`
- **API**: `https://webapi.sporttery.cn/gateway/uniform/football`
- All API calls are made via `page.evaluate()` inside Puppeteer (uses the browser's session).
- Key API endpoints:
  - `getMatchCalculatorV1.qry` — live schedule + odds (HAD/HHAD/TTG pools)
  - `getUniformMatchResultV1.qry` — recent match results
  - `getVoteV1.qry` — historical daily match lists (HHAD + HAD)
  - `getFixedBonusV1.qry` — historical odds history per match
  - `getMatchHeadV1.qry` — match info
  - `getMatchResultV1.qry` — team recent results
  - `getMatchFeatureV1.qry` — season features
  - `getInjurySuspensionV1.qry` — injuries/suspensions
  - `getMatchTablesV2.qry` — standings
  - `getMatchPlayerV1.qry` — player lists
  - `getFutureMatchesV1.qry` — upcoming fixtures
  - `getResultHistoryV1.qry` — head-to-head

### 球探体育 (qiutantiyu) — Stub/Demo Only
- Stub scrapers return hardcoded demo data. Not yet implemented.

### SofaScore — Stub/Demo Only
- Stub scrapers return hardcoded demo data. Not yet implemented.

## Scheduled Scrapers (src/index.ts)

| Scraper | Cron | Data |
|---|---|---|
| jingcai-schedule | `*/30 * * * *` | Live match schedule |
| jingcai-result | `0 * * * *` | Recent match results |
| jingcai-odds | `*/15 * * * *` | Live odds (HAD, HHAD, TTG) |
| qiutantiyu-* | various | Stub |
| sofascore-* | various | Stub |

## Historical Crawler (run-crawl.ts)

Two-phase bulk crawler for 竞彩 historical data (2015-06-01 ~ yesterday).

### Phase 1: Daily Match Lists
- Scrapes `getVoteV1.qry` (HHAD + HAD pools) for each date
- Direction: **yesterday → 2015** (reverse chronological)
- Output: `data/jingcai/daily/{YYYY-MM-DD}.json`
- Fields per match: matchId, teams, league, handicap odds, support rates, probabilities, results
- Resumable: skips existing daily files
- Error recovery: resets browser session on failure
- Delay: 500-3000ms between dates

### Phase 2: Match Details
- Collects unique matchIds from daily files via `collectMatchIds()`
- Direction: **2015 → yesterday** (chronological)
- For each matchId, fetches 9 detail APIs (see above)
- Output: `data/jingcai/matches/{matchId}.json`
- Includes `oddsHistory` field with full fixed-bonus data
- Progress: logs every 50 matches
- Delay: 200-800ms between matches

### Run Command
```bash
cd scrapers
npx tsx src/sources/jingcai/run-crawl.ts
```

## Data Directory Structure

```
data/
├── jingcai/
│   ├── daily/          # 3,767 files — per-date match lists
│   └── matches/        # 53,444 files — per-matchId detail + odds history
├── jingcai-odds/       # One-off odds export snapshots
```

Output files are date-stamped `{YYYYMMDD_HHmmss}.json` and auto-cleaned after 7 days.

## Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| `BACKEND_API_URL` | `http://localhost:8000` | Backend API endpoint |
| `SCRAPER_API_KEY` | `scraper-secret-key` | API key for backend auth |
| `BROWSER_HEADLESS` | `true` | Set `false` to see Chromium UI |
| `PROXY_LIST` | (empty) | Comma-separated proxy URLs |

## Engine Components

### BrowserPool
- Manages a pool of Puppeteer pages (default max 5)
- Random viewport (1280-1479 × 720-919) and user agent per page
- `getPage()` / `releasePage()` / `resetPage()` lifecycle
- All browsers created with stealth plugin

### BaseScraper
- Abstract class: every scraper extends it
- `execute()` → calls `scrape()` → saves JSON → cleans old files (>7 days)
- Output: `data/{scraper.name}/{timestamp}.json`

### Scheduler
- Wraps `node-cron` to run scrapers on schedule
- Graceful shutdown on SIGINT/SIGTERM

## Backend API

When scraper modules push data, they POST to:
- `POST /scraper/matches` — batch match data
- `POST /scraper/odds` — batch odds data

With retry: 3 attempts, exponential backoff (1s → 2s → 4s).
