# 竞彩源库数据库设计（已定稿部分）

> 本文档记录 **jingcai 库**已确认的数据表设计与数据来源映射，供开发、分析与后续建模参考。
> 当前定稿范围：**竞彩源库全部定稿** —— 8 张表（jingcai_matches / jingcai_votes / jingcai_odds_spf / jingcai_odds_rqspf / jingcai_odds_ttg / jingcai_odds_hafu / jingcai_odds_crs / jingcai_pools）。
> 旧设计中的 standings / h2h / recent_results / fixtures / injuries / players / season_features / teams / leagues / import_files **确认不建表**（详见"十、不落库清单"）。
> 所有表均采用**软关联（无 FOREIGN KEY）**，字段来源与转化方式见各表"字段来源与转化"小节。

---

## 〇、设计全局原则

1. **软关联（无 FOREIGN KEY）**：所有表之间只存对方主键 `match_id`，不建 FK 约束。查询用 `LEFT JOIN`。
2. **只存 `match_id`**：home/away/league 的**所有 ID 一律不存**（sporttery ID、uniform ID、内部 DB ID 均不落库），只保留 3 个名称字段 `home_team` / `away_team` / `league`。
   - 依据：竞彩详情文件内 `matchInfo.matchId`（如 2471925）是内部库键，与 `daily.matchId`（= `sportteryMatchId` = 文件名，如 100000）**不同**，混用易错；uniform 系列 ID 系跨源对齐用，不在竞彩源库职责内。
3. **语义单一来源**：字段语义（如 psy_error 分档、error 定义、各池 goalLine 恒空等）在本文档说明；人类读文档、SQL 查数据。
4. **字符串数值一律转数值存储**：赔率 `"1.90"` → `NUMERIC`；支持率 `"27%"` → `0.27`；百分比 `"26%"` → `0.26`；`error` 可为负（`"-31%"` → `-0.31`）。
5. **赔率快照打平（不做母表）**：SPF/RQSPF/TTG/HAFU/CRS 五个池各自一张平铺表，列名用官方字段名，不建 `jingcai_odds` 汇总母表。
6. **恒值/可推导字段不落库**：
   - `*f` 系列字段（如 `hf`/`df`/`af`、`sNf`、`sXXsYYf`）：相对上一快照的赔率变动方向（-1 下调 / +1 上调 / 0 首条或未变），可由快照按时间排序推导，不落库。
   - `oddsType`（恒 `"F"`）、`lineStatus` / `oddsGoalLine`（恒空串）、`refundStatus`（恒 `"0"`，且 Refund 比赛 matchResultList 为空数组）：均不落库（详见各表说明与"十"）。
   - HAD/TTG/HAFU/CRS 四池的 `goalLine` 经核验恒空，仅 RQSPF 有实际意义，故 `goal_line` 只出现在 `jingcai_odds_rqspf` 与 `jingcai_pools`。
7. **自增主键**：需要自增的列用 `SERIAL`，删除行后序列值不复用、后续值不变化。已有天然主键（match_id 等）的列直接用业务键。

---

## 一、数据来源文件

竞彩爬虫数据位于 `scrapers/data/jingcai/`，共两类文件：

### 1.1 `daily/*.json` — 赛程/开售快照（3,778 个文件）

按销售日存储，覆盖 **2015-06-01 ~ 2026-08-03**，全量 **77,018 场唯一 matchId**（matchId 无重复）。每文件结构：

```json
{
  "businessDate": "2017-10-28",
  "matches": [
    {
      "matchId": 100000,       // = sportteryMatchId = 详情文件名
      "businessDate": "2017-10-27",
      "matchDate": "2017-10-28",
      "matchNum": "周六012",
      "homeTeam": "雷根斯堡",
      "awayTeam": "凯泽",
      "league": "德国乙级联赛",
      "handicap": { "goalLine": 0, "odds": "2.22", "supportRate": "27%", "probability": "26%",
                    "error": "1%", "result": "home", "voters": 417, "psyError": 1 },
      "matchResult": { "homeScore": 3, "awayScore": 1 },
      "had":     { "odds": "1.90", "supportRate": "27%", "probability": "26%",
                    "error": "1%", "result": "home", "voters": 417, "psyError": 1 },
      "poolStatus": "Payout"
    }
  ]
}
```

- `handicap` 与 `had` 结构一致（均含 goalLine 等 8 键），仅 `had` 恒无 goalLine 内容（该键存在但为空串）。
- 极少数（13 个文件，2026 新格式）额外带 `homeTeamId` / `awayTeamId` / `leagueId`（= sporttery ID），其余 3,765 个旧文件无此键；按"只存 match_id"原则这些 ID 均不落库。
- **恒 11 键结构 2015 → 2026 全稳定**。

### 1.2 `matches/{matchId}.json` — 比赛详情（68,845 个文件）

一场一个文件，顶层结构（13 个区块，2015 → 2026 全稳定）：

```json
{
  "matchId": 100000, "scrapedAt": "2026-07-24T06:59:30.271Z",
  "matchInfo": { ... }, "recentResults": { ... }, "seasonFeatures": { ... },
  "injuries": { ... }, "standings": { ... }, "players": { ... },
  "fixtures": { ... }, "headToHead": { ... }, "oddsHistory": { ... }
}
```

本定稿仅使用 `oddsHistory` 与 `matchInfo` 的少数字段，其余区块见"十、不落库清单"。

### 1.3 两类文件的 ID 对应关系（已核验）

| 概念 | daily | matches 详情 |
|---|---|---|
| 竞彩比赛号 | `matchId` (100000) | `sportteryMatchId` = 文件名；`matchInfo.matchId` 是**内部库键**（2471925） |
| 主队 sporttery ID | `homeTeamId`（新格式） | `matchInfo.sportteryHomeTeamId`（相等已核验，如 604=604、352=352） |
| 联赛 sporttery ID | `leagueId`（新格式） | `matchInfo.sportteryTournamentId`（相等已核验） |
| 联赛名 | `league` | `matchInfo.tournamentCnName`（相等已核验，76/76 + 7/7 零差异） |

> ⚠️ 统一用 `daily.matchId` = 详情文件名作为全库 `match_id`。`matchInfo.matchId`（内部键）与各类 uniform/sporttery ID 均不落库。

---

## 二、jingcai_matches — 竞彩比赛主表

> 约 7.7 万行（77,018 场）。来源：`daily/*.json` 为主，补 `matches/{matchId}.json` 的 `matchInfo` 与 `oddsHistory.singleList`。

```sql
CREATE TABLE jingcai_matches (
    match_id       INTEGER PRIMARY KEY,   -- daily.matchId = 详情文件名（sportteryMatchId）
    business_date  DATE NOT NULL,         -- daily.businessDate 销售日（开售日期）
    match_date     DATE NOT NULL,         -- daily.matchDate 比赛日期
    match_num      TEXT NOT NULL,         -- daily.matchNum（如 "周六012"）
    home_team      TEXT NOT NULL,         -- daily.homeTeam
    away_team      TEXT NOT NULL,         -- daily.awayTeam
    league         TEXT,                  -- daily.league（= matchInfo.tournamentCnName）
    home_score     INTEGER,               -- daily.matchResult.homeScore
    away_score     INTEGER,               -- daily.matchResult.awayScore
    pool_status    TEXT,                  -- daily.poolStatus（Payout / Refund）
    kickoff_time   TIMESTAMP,             -- matchInfo.matchDateTime（"2017-10-28 19:00"）
    single_spf     INTEGER,               -- oddsHistory.singleList 中 HAD 的 single
    single_rqspf   INTEGER,               -- oddsHistory.singleList 中 HHAD 的 single
    single_ttg     INTEGER,               -- oddsHistory.singleList 中 TTG 的 single
    single_hafu    INTEGER,               -- oddsHistory.singleList 中 HAFU 的 single
    single_crs     INTEGER,               -- oddsHistory.singleList 中 CRS 的 single
    scraped_at     TIMESTAMP              -- matches 详情顶层 scrapedAt
);

CREATE INDEX idx_jingcai_matches_business_date ON jingcai_matches (business_date);
CREATE INDEX idx_jingcai_matches_match_date   ON jingcai_matches (match_date);
CREATE INDEX idx_jingcai_matches_league       ON jingcai_matches (league);
CREATE INDEX idx_jingcai_matches_team_pair    ON jingcai_matches (home_team, away_team);
```

**说明**：
- 单关标记 `single_*`（0/1）来自 `oddsHistory.oddsHistory.singleList`，按比赛固定（非时间序列），5 个池各一值；列表项 `code` 为 HHAD/HAFU/CRS/TTG/HAD。
- `home_score` / `away_score` 从 `daily.matchResult` 拆分（matchResult 仅含这两个键）。

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| match_id | `daily.matchId` | 原样 | 主键；= 详情文件名 |
| business_date | `daily.businessDate` | 字符串 → DATE | 开售日 |
| match_date | `daily.matchDate` | 字符串 → DATE | 比赛日 |
| match_num | `daily.matchNum` | 原样 | |
| home_team | `daily.homeTeam` | 原样 | |
| away_team | `daily.awayTeam` | 原样 | |
| league | `daily.league` | 原样 | 已验证 = `matchInfo.tournamentCnName` |
| home_score | `daily.matchResult.homeScore` | 原样 | |
| away_score | `daily.matchResult.awayScore` | 原样 | |
| pool_status | `daily.poolStatus` | 原样 | 取最近一次抓取值 |
| kickoff_time | `matchInfo.matchDateTime` | "2017-10-28 19:00" → TIMESTAMP | 未开赛场次才存在 |
| single_spf | `oddsHistory.oddsHistory.singleList[] code=HAD` | 0/1 原样 | 缺失按 0 |
| single_rqspf | `... code=HHAD` | 0/1 原样 | |
| single_ttg | `... code=TTG` | 0/1 原样 | |
| single_hafu | `... code=HAFU` | 0/1 原样 | |
| single_crs | `... code=CRS` | 0/1 原样 | |
| scraped_at | `matches 顶层 scrapedAt` | ISO 字符串 → TIMESTAMPTZ | |

---

## 三、jingcai_votes — 竞彩投票横表

> 约 15.4 万行（77,018 场 × 2 池）。来源：`daily/*.json` 的 `had`（SPF）与 `handicap`（RQSPF）。**横表**：一行 = 一场一池。

```sql
CREATE TABLE jingcai_votes (
    match_id          INTEGER NOT NULL,    -- daily.matchId
    pool              TEXT NOT NULL,       -- 'HAD' | 'RQSPF'
    goal_line         INTEGER,             -- 仅 RQSPF 有值（-2..+2）；HAD 恒空
    odds_home         NUMERIC,             -- had.odds / handicap.odds（主胜）
    odds_draw         NUMERIC,             -- 平
    odds_away         NUMERIC,             -- 客胜
    support_rate_home NUMERIC,             -- supportRate "27%" → 0.27
    support_rate_draw NUMERIC,             -- "27%" → 0.27
    support_rate_away NUMERIC,             -- "46%" → 0.46
    probability_home  NUMERIC,             -- probability "26%" → 0.26
    probability_draw  NUMERIC,             -- "26%" → 0.26
    probability_away  NUMERIC,             -- "48%" → 0.48
    error_home        NUMERIC,             -- error "1%" → 0.01（可为负）
    error_draw        NUMERIC,             -- 可为负
    error_away        NUMERIC,             -- 可为负
    voters_home       INTEGER,             -- voters（支持率对应池的投票数）
    voters_draw       INTEGER,
    voters_away       INTEGER,
    psy_error         INTEGER,             -- 心理误差档位 0/1/2（见下）
    result            TEXT,                -- had.result / handicap.result（home/draw/away）
    PRIMARY KEY (match_id, pool)
);

CREATE INDEX idx_jingcai_votes_match_id ON jingcai_votes (match_id);
```

**error 定义（已核验 240/240）**：`error = supportRate − probability`（支持率减命中概率），可为负。示例 `"27%" - "26%" = 1%`。

**psy_error 语义表**（实测 240 场分布，与最大 |error| 单调分层）：

| psy_error | 含义 | 实测 max\|error\| 范围 | 实测 avg \|error\| |
|---|---|---|---|
| 0 | 无心理误差 | 1% ~ 14% | 7.8% |
| 1 | 轻度心理误差 | 11% ~ 25% | 15.2% |
| 2 | 重度心理误差 | 21% ~ 41% | 27.4% |

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| match_id | `daily.matchId` | 原样 | |
| pool | 来源区块 | `had` → 'HAD'；`handicap` → 'RQSPF' | |
| goal_line | `handicap.goalLine` | 字符串 → INTEGER | 仅 RQSPF 有值 |
| odds_* | `had.odds` / `handicap.odds` | "1.90" → 0.27 形式见注 | NUMERIC |
| support_rate_* | `supportRate` | "27%" → 0.27 | 百分比字符串去 `%` ÷ 100 |
| probability_* | `probability` | "26%" → 0.26 | |
| error_* | `error` | "1%" → 0.01；"-31%" → -0.31 | 可为负 |
| voters_* | `voters` | 原样 | INTEGER |
| psy_error | `psyError` | 原样 | 0/1/2 |
| result | `result` | 原样 | home/draw/away |

---

## 四、jingcai_odds_spf — 胜平负赔率快照

> 约 26.1 万行。来源：`oddsHistory.oddsHistory.hadList[]`。**无 goal_line**（HAD 池 goalLine 经核验恒空串）。

```sql
CREATE TABLE jingcai_odds_spf (
    match_id     INTEGER NOT NULL,    -- 详情文件 sportteryMatchId
    snapshot_at  TIMESTAMP NOT NULL,  -- updateDate + updateTime 拼接
    odds_home    NUMERIC,             -- hf 对应值，取官方 h
    odds_draw    NUMERIC,             -- d
    odds_away    NUMERIC,             -- a
    PRIMARY KEY (match_id, snapshot_at)
);

CREATE INDEX idx_jingcai_odds_spf_match_id ON jingcai_odds_spf (match_id);
```

**说明**：每场平均 3.38 个快照。`hadList` 数组每一项是同一池在某一更新时点的全量赔率；`snapshot_at = 官方 updateDate + updateTime`（如 "2026-07-24" + "10:00:00"）。`*f` 字段（hf/df/af）为相对上一快照的变动方向，**不落库**。

---

## 五、jingcai_odds_rqspf — 让球胜平负赔率快照

> 约 26.1 万行。来源：`oddsHistory.oddsHistory.hhadList[]`。**唯一含 goal_line 的赔率快照表**（RQSPF 让球盘唯一有实际意义，已核验 -2..+2）。

```sql
CREATE TABLE jingcai_odds_rqspf (
    match_id     INTEGER NOT NULL,
    snapshot_at  TIMESTAMP NOT NULL,
    goal_line    INTEGER,             -- hhadList.goalLine（-2..+2）
    odds_home    NUMERIC,
    odds_draw    NUMERIC,
    odds_away    NUMERIC,
    PRIMARY KEY (match_id, snapshot_at)
);

CREATE INDEX idx_jingcai_odds_rqspf_match_id ON jingcai_odds_rqspf (match_id);
```

**说明**：每场平均 3.39 个快照。

---

## 六、jingcai_odds_ttg — 总进球赔率快照

> 约 14.5 万行。来源：`oddsHistory.oddsHistory.ttgList[]`。`goalLine` 恒空串，不建列。

```sql
CREATE TABLE jingcai_odds_ttg (
    match_id     INTEGER NOT NULL,
    snapshot_at  TIMESTAMP NOT NULL,
    odds_0       NUMERIC,             -- s0（0 球）
    odds_1       NUMERIC,             -- s1
    odds_2       NUMERIC,             -- s2
    odds_3       NUMERIC,             -- s3
    odds_4       NUMERIC,             -- s4
    odds_5       NUMERIC,             -- s5
    odds_6       NUMERIC,             -- s6
    odds_7       NUMERIC,             -- s7（7+ 球）
    PRIMARY KEY (match_id, snapshot_at)
);

CREATE INDEX idx_jingcai_odds_ttg_match_id ON jingcai_odds_ttg (match_id);
```

**说明**：每场平均 1.88 个快照；总进球 0-7+ 共 8 档，恒齐。

---

## 七、jingcai_odds_hafu — 半全场赔率快照

> 约 14.2 万行。来源：`oddsHistory.oddsHistory.hafuList[]`。`goalLine` 恒空串，不建列。

```sql
CREATE TABLE jingcai_odds_hafu (
    match_id     INTEGER NOT NULL,
    snapshot_at  TIMESTAMP NOT NULL,
    odds_hh      NUMERIC,             -- 胜/胜
    odds_hd      NUMERIC,             -- 胜/平
    odds_ha      NUMERIC,             -- 胜/负
    odds_dh      NUMERIC,             -- 平/胜
    odds_dd      NUMERIC,             -- 平/平
    odds_da      NUMERIC,             -- 平/负
    odds_ah      NUMERIC,             -- 负/胜
    odds_ad      NUMERIC,             -- 负/平
    odds_aa      NUMERIC,             -- 负/负
    PRIMARY KEY (match_id, snapshot_at)
);

CREATE INDEX idx_jingcai_odds_hafu_match_id ON jingcai_odds_hafu (match_id);
```

**说明**：每场平均 1.84 个快照；半全场 9 种组合恒齐。

---

## 八、jingcai_odds_crs — 比分赔率快照

> 约 12.8 万行。来源：`oddsHistory.oddsHistory.crsList[]`。**31 列平铺**（28 个具体比分 + 胜其他/平其他/负其他），官方 key 名保留。`goalLine` 恒空串，不建列。

```sql
CREATE TABLE jingcai_odds_crs (
    match_id      INTEGER NOT NULL,
    snapshot_at   TIMESTAMP NOT NULL,
    odds_s00s00   NUMERIC,             -- 0:0
    odds_s00s01   NUMERIC,             -- 0:1
    odds_s00s02   NUMERIC,             -- 0:2
    odds_s00s03   NUMERIC,             -- 0:3
    odds_s00s04   NUMERIC,             -- 0:4
    odds_s00s05   NUMERIC,             -- 0:5
    odds_s01s00   NUMERIC,             -- 1:0
    odds_s01s01   NUMERIC,             -- 1:1
    odds_s01s02   NUMERIC,             -- 1:2
    odds_s01s03   NUMERIC,             -- 1:3
    odds_s01s04   NUMERIC,             -- 1:4
    odds_s01s05   NUMERIC,             -- 1:5
    odds_s02s00   NUMERIC,             -- 2:0
    odds_s02s01   NUMERIC,             -- 2:1
    odds_s02s02   NUMERIC,             -- 2:2
    odds_s02s03   NUMERIC,             -- 2:3
    odds_s02s04   NUMERIC,             -- 2:4
    odds_s02s05   NUMERIC,             -- 2:5
    odds_s03s00   NUMERIC,             -- 3:0
    odds_s03s01   NUMERIC,             -- 3:1
    odds_s03s02   NUMERIC,             -- 3:2
    odds_s03s03   NUMERIC,             -- 3:3
    odds_s03s04   NUMERIC,             -- 3:4
    odds_s03s05   NUMERIC,             -- 3:5
    odds_s04s00   NUMERIC,             -- 4:0
    odds_s04s01   NUMERIC,             -- 4:1
    odds_s04s02   NUMERIC,             -- 4:2
    odds_s04s03   NUMERIC,             -- 4:3
    odds_s04s04   NUMERIC,             -- 4:4
    odds_s04s05   NUMERIC,             -- 4:5
    odds_s05s05   NUMERIC,             -- 5:5
    odds_s-1sh     NUMERIC,             -- 胜其他
    odds_s-1sd     NUMERIC,             -- 平其他
    odds_s-1sa     NUMERIC,             -- 负其他
    PRIMARY KEY (match_id, snapshot_at)
);

CREATE INDEX idx_jingcai_odds_crs_match_id ON jingcai_odds_crs (match_id);
```

**说明**：每场平均 1.66 个快照；31 个 key 经 519 快照 100% 覆盖核验，无缺列，故平铺 31 列无 NULL 浪费。官方 key 命名 `s{主比分}{客比分}`，`s-1sh/s-1sd/s-1sa` 为胜其他/平其他/负其他。

---

## 九、jingcai_pools — 奖池表

> 约 38.3 万行（77,018 场 × ~4.98 行）。来源：`oddsHistory.matchResultList[]`。

```sql
CREATE TABLE jingcai_pools (
    match_id          INTEGER NOT NULL,   -- 详情文件 sportteryMatchId
    pool              TEXT NOT NULL,      -- code（HAD / HHAD / CRS / TTG / HAFU）
    combination       TEXT,               -- combination（"H" / "3:1" / "4" / "H:H"）
    combination_desc  TEXT,               -- combinationDesc（组合中文描述）
    goal_line         INTEGER,            -- goalLine（仅 HHAD 有值 -2..+2，其余恒空）
    odds              NUMERIC,            -- odds（最终赔率 "4.05"）
    pool_id           INTEGER,            -- poolId（奖池 ID）
    pool_totals       BIGINT,             -- poolTotals（奖池总额，0=未结算/无总额）
    PRIMARY KEY (match_id, pool)
);

CREATE INDEX idx_jingcai_pools_match_id ON jingcai_pools (match_id);
```

**说明**：
- `poolTotals` 非恒 0：3000 文件 14,891 行中 850 行有真实总额（最大约 3,731 万），未结算场次为 0。用 BIGINT 防溢出。
- `refundStatus` / `oddsType` / `lineStatus` / `oddsGoalLine` **不落库**：
  - `oddsType` 恒 `"F"`（14,891/14,891）；
  - `lineStatus`、`oddsGoalLine` 恒空串（14,891/14,891）；
  - `refundStatus` 恒 `"0"`，且 **Refund 比赛（437 场）的 matchResultList 全部为空数组**（407 场有详情，100% 空），退款 = 无奖池行，该字段零信息量。
- `goal_line` 在 pools 表中保留（HHAD 池有价值，与 `jingcai_odds_rqspf` 同源不同语义：这里指该组合的让球线）。

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| match_id | 详情文件 sportteryMatchId | 原样 | |
| pool | `code` | 原样 | HAD/HHAD/CRS/TTG/HAFU 五池各一行 |
| combination | `combination` | 原样 | |
| combination_desc | `combinationDesc` | 原样 | |
| goal_line | `goalLine` | 字符串 → INTEGER | 仅 HHAD |
| odds | `odds` | 字符串 → NUMERIC | |
| pool_id | `poolId` | 原样 | |
| pool_totals | `poolTotals` | 字符串 → BIGINT | 0=无总额 |

---

## 十、不落库清单

| 区块/字段 | 来源 | 不落库原因 |
|---|---|---|
| `matchInfo` 余量（gameweek / phaseName / seasonName / groupName / wbsjStats 等） | matches 详情 | 与赛程主体价值重复；wbsjStats 与 standings 重叠，价值低；余量字段经评审确认不建 |
| `recentResults`（近期战绩，主客各 10 场） | matches 详情 | 属衍生分析数据，评审确认不存 |
| `headToHead`（历史交锋，约 6.8 场） | matches 详情 | 同上 |
| `fixtures`（未来赛程，约 7.7 场） | matches 详情 | 属衍生数据，且快照仅含比赛时点信息 |
| `players`（球员数据，约 5.9 行/场） | matches 详情 | 属衍生数据 |
| `injuries`（伤停，均 0.77 行/场，多为空） | matches 详情 | 同上 |
| `standings`（积分榜，主客 × 总/主/客） | matches 详情 | 属衍生数据 |
| `seasonFeatures`（赛季特征） | matches 详情 | 属衍生数据 |
| 各类 ID（sporttery / uniform / 内部 matchInfo.matchId / seasonId / phaseId / tournamentId） | daily + matches | 见"〇、2"只存 match_id 原则 |
| `*f` 字段（hf/df/af/sNf/sXXsYYf） | oddsHistory | 可由快照排序推导（-1/0/+1） |
| `oddsType`（恒 "F"） | matchResultList | 恒值，零信息量 |
| `lineStatus` / `oddsGoalLine`（恒空串） | matchResultList | 恒值 |
| `refundStatus`（恒 "0"） | matchResultList | 恒值，且 Refund 比赛无奖池行 |

---

## 十一、行数估算（10 万场规模）

基于 800 文件实测每场行数均值：

| 表 | 行/场 | 10 万场行数 |
|---|---|---|
| jingcai_matches | 1 | 100,000 |
| jingcai_votes | 2 | 200,000 |
| jingcai_odds_spf | 3.38 | 338,000 |
| jingcai_odds_rqspf | 3.39 | 339,000 |
| jingcai_odds_ttg | 1.88 | 188,000 |
| jingcai_odds_hafu | 1.84 | 184,000 |
| jingcai_odds_crs | 1.66 | 166,000 |
| jingcai_pools | 4.98 | 498,000 |
| **合计** | | **≈ 201 万行** |

**查询效率**：全部走 `match_id` 主键或日期/联赛索引，SQLite/PG 百万级无压力；宽表仅 odds_crs（34 列）与 odds_ttg（10 列），行数 ≤ 34 万，无性能瓶颈。若未来将 recentResults+h2h 并入（约 27 行/场），总行数将增至约 470 万行。
