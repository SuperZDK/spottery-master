# Sofascore 源库数据库设计（已定稿部分）

> 本文档记录 **sofascore 库**已确认的数据表设计与数据来源映射，供开发、分析与后续建模参考。
> 当前定稿范围：**matches + 4 张维度表（leagues/seasons/teams/countries）+ 3 张字典表（status_codes/cup_round_types/round_prefixes）**。
> details 相关表（match_details/match_players/match_statistics/match_incidents/team_season_stats）**尚未定稿**，待讨论后补充。

---

## 〇、设计全局原则

1. **软关联（无 FOREIGN KEY）**：所有表之间只存对方主键 ID，不建 FK 约束。查询用 `LEFT JOIN`。
   - 原因：批量导入时 FK 校验有开销；Sofascore 未来若新增未知编码，软关联不会阻塞数据入库（字典表缺行时 JOIN 结果为 NULL，可事后补字典）。
2. **语义单一来源**：字段的语义（如比分 current/display/normaltime 差异、status 各编码含义、cupRoundType 含义）在本文档**以及库内字典表**中说明，人类读文档、SQL 查字典表。
3. **尽量满足 3NF**：国家/州际信息统一收敛到 countries 表，不在 leagues/teams 重复冗余国家多列。
4. **自增主键**：需要自增的列用 `SERIAL`，删除行后序列值**不复用、后续值不变化**。
5. **爬虫快照字段**（如 teams.user_count）：同一实体在不同抓取时点可能变化，后续 CRUD 用 `INSERT ... ON CONFLICT ... DO UPDATE` upsert 刷新。
6. **比分语义**（重要）：Sofascore 比分对象有 4 个语义不同的字段，不能混用：
   - `normaltime`：**90 分钟常规比分**（竞彩分析首要展示、联赛积分/胜负统计用）；
   - `display`：Sofascore 显示的足球比分（AET=含加时最终比分；点球决胜=120 分钟比分，不含点球）；
   - `current`：实时比分；**点球决胜场次里是点球命中数（不是足球比分）**，不可当最终比分；
   - `period1/period2`：上下半场比分。
   - 页面展示默认用 normaltime，120 分钟/点球比分以附注小字呈现。

---

## 一、数据来源文件

Sofascore 爬虫赛程数据位于 `data/schedules_v3/{联赛}/{赛季}.json`，共 309 个文件、82,288 场比赛。每文件结构：

```json
{
  "league":   { "id", "name", "shortName", "slug", "country" },
  "season":   "16/17",          // 字符串
  "seasonId": 11819,            // int
  "matches":  [ { ... 约 300 场 ... } ]
}
```

每场比赛 match 关键字段：

```json
{
  "id", "slug",
  "tournament": { "name", "slug", "category": { "name", "slug" } },  // 无 id！
  "season":     { "name", "year", "id" },
  "roundInfo":  { "round", "name"?, "slug"?, "prefix"?, "cupRoundType"? },
  "status":     { "code", "description", "type" },
  "winnerCode",          // 1=主胜 2=平 3=客胜 0=无结果
  "homeTeam":  { "name", "slug", "shortName", "userCount", "nameCode",
                 "country": { "alpha2", "alpha3", "name", "slug" }, "id",
                 "teamColors": { "primary", "secondary", "text" } },
  "awayTeam":  同 homeTeam,
  "homeScore": { "current", "display", "period1", "period2", "normaltime" },
  "awayScore": 同 homeScore,
  "hasXg", "hasEventPlayerStatistics", "hasEventPlayerHeatMap",
  "startTimestamp", "date", "finalResultOnly"
}
```

---

## 二、countries — 国家/洲际区域表

```sql
CREATE TABLE countries (
    country_id  SERIAL PRIMARY KEY,     -- 自增
    alpha2      TEXT UNIQUE,            -- "DE"（europe 等洲际区域为 NULL）
    alpha3      TEXT,                   -- "DEU"
    name        TEXT NOT NULL,          -- "Germany"
    slug        TEXT UNIQUE NOT NULL,   -- "germany"（leagues 侧主关联键）
    updated_at  TIMESTAMPTZ DEFAULT now()
);
```

| country_id | alpha2 | alpha3 | name | slug |
|---|---|---|---|---|
| 1 | DE | DEU | Germany | germany |
| 13 | NULL | NULL | Europe | europe |

**说明**：
- 统一承载"国家或洲际区域"。数据来自三处：`team.country`（含 alpha2/alpha3/name/slug，最全）、`league.country`（仅 slug 字符串）、`match.tournament.category`（name+slug）。
- **europe 洲际实体**：欧冠/欧联/欧协联（league_id 7/679/17015）的 `league.country='europe'`，不属于任何单一国家，作为一行入库，alpha2/alpha3 为 NULL。
- 按 slug 或 alpha2 匹配去重；新来源国家可随时追加。

**入库简述**：扫描 `schedules_v3` 全部文件的 team.country 与 league.country，按 slug 去重插入；team 侧顺带补 alpha2/alpha3。

---

## 三、leagues — 联赛表（29 行）

```sql
CREATE TABLE leagues (
    league_id    INTEGER PRIMARY KEY,   -- league.id（Sofascore 原始 ID，非自增）
    name         TEXT NOT NULL,         -- 英文名 "2. Bundesliga"
    short_name   TEXT,                  -- 中文简称（德乙）
    slug         TEXT,                  -- "2-bundesliga"
    country_slug TEXT,                  -- 软关联 countries.slug（"germany"/"europe"）
    scraped_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);
```

**JSON 来源**：`league.id` → league_id；`league.name` → name；`league.shortName` → short_name（中文）；`league.slug` → slug；`league.country` → country_slug。

**入库简述**：按 `league_id` upsert（`ON CONFLICT (league_id) DO UPDATE`）。

---

## 四、seasons — 赛季表（309 行）

```sql
CREATE TABLE seasons (
    season_id  INTEGER PRIMARY KEY,     -- seasonId（全局唯一）
    league_id  INTEGER NOT NULL,        -- 软关联 leagues.league_id
    season_key TEXT NOT NULL,           -- "16/17" / "2024"
    UNIQUE (league_id, season_key)
);
```

**JSON 来源**：顶层 `seasonId` → season_id（已确认全局唯一）；顶层 `league.id` → league_id；顶层 `season`（字符串）→ season_key。

**入库简述**：按 `season_id` upsert。

---

## 五、teams — 球队表（2,159 行）

```sql
CREATE TABLE teams (
    team_id     INTEGER PRIMARY KEY,    -- team.id（Sofascore 原始 ID）
    name        TEXT NOT NULL,          -- 英文名 "VfB Stuttgart"
    slug        TEXT,                   -- "vfb-stuttgart"
    short_name  TEXT,                   -- "Stuttgart"（部分队为空）
    name_code   TEXT,                   -- "VFB"（全部有值）
    user_count  INTEGER,                -- 关注人数（爬虫快照，可变化）
    country_id  INTEGER,                -- 软关联 countries.country_id（按 alpha2 匹配）
    team_colors JSONB,                  -- {primary,secondary,text}
    scraped_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);
```

**JSON 来源**：match 的 `homeTeam`/`awayTeam`（去重）：
- `id` → team_id；`name` → name；`slug` → slug；`shortName` → short_name；
- `nameCode` → name_code；`userCount` → user_count；`country.alpha2` → 匹配 countries 得 country_id；
- `teamColors` → team_colors（JSONB 整体存）。

**已核实事实**：
- user_count 在所有场次/赛季间对同一球队**完全一致**（当前数据静态），但它是爬虫快照，跨天可能变化，后续用 upsert 刷新。
- 331/2,159 队 short_name 为空；16 队 country 缺失（country_id 为 NULL）。

**入库简述**：按 `team_id` upsert（`ON CONFLICT (team_id) DO UPDATE SET name=..., user_count=..., country_id=...` 等）。

---

## 六、matches — 赛程主表（82,288 行）

```sql
CREATE TABLE matches (
    match_id      INTEGER PRIMARY KEY,  -- match.id
    league_id     INTEGER NOT NULL,     -- 顶层 league.id（match.tournament 无 id）
    season_id     INTEGER NOT NULL,     -- 软关联 seasons.season_id
    season_key    TEXT NOT NULL,        -- 冗余顶层 season 字符串
    slug          TEXT,                 -- 比赛 slug
    status_code   INTEGER NOT NULL,     -- 软关联 status_codes.code
    status_type   TEXT NOT NULL,        -- finished/postponed/canceled/notstarted
    winner_code   INTEGER,              -- 1=主胜 2=平 3=客胜 0=无结果
    home_team_id  INTEGER NOT NULL,     -- 软关联 teams.team_id
    away_team_id  INTEGER NOT NULL,
    -- ==== 比分（10 列全保留，语义见"〇、设计全局原则·6"）====
    home_score_current     INTEGER,     -- 实时/含加时或点球数
    home_score_display     INTEGER,     -- 显示的足球比分（含加时，点球场=120分钟比分）
    home_score_normaltime  INTEGER,     -- 90 分钟常规比分 ★竞彩首要展示
    home_score_period1     INTEGER,     -- 上半场
    home_score_period2     INTEGER,     -- 下半场
    away_score_current     INTEGER,
    away_score_display     INTEGER,
    away_score_normaltime  INTEGER,
    away_score_period1     INTEGER,
    away_score_period2     INTEGER,
    -- ==== 轮次（roundInfo）====
    round_num       INTEGER,            -- roundInfo.round
    round_name      TEXT,               -- 杯赛轮次名（Final/Quarterfinals...），联赛为 NULL
    round_slug      TEXT,
    round_prefix    TEXT,               -- Qualification/Preliminary/Europa Playoffs/Relegation-Promotion
    cup_round_type  INTEGER,            -- 2 的幂=该轮场次数（16=32强...1=决赛）
    -- ==== 标记 ====
    has_xg                      BOOLEAN,
    has_event_player_statistics BOOLEAN,
    has_event_player_heat_map    BOOLEAN,
    -- ==== 时间 ====
    kickoff_time    TIMESTAMPTZ NOT NULL,  -- startTimestamp
    scraped_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (league_id, season_id, match_id)
);
CREATE INDEX idx_matches_kickoff        ON matches (kickoff_time);
CREATE INDEX idx_matches_league_season  ON matches (league_id, season_id);
CREATE INDEX idx_matches_team           ON matches (home_team_id, away_team_id);
```

**JSON 来源**（match 对象）：
| 列 | JSON |
|---|---|
| match_id | `id` |
| league_id | 顶层 `league.id`（⚠️ match.tournament **无 id**，league 只能取文件顶层） |
| season_id / season_key | 顶层 `seasonId` / `season` |
| slug | `slug` |
| status_code / status_type | `status.code` / `status.type` |
| winner_code | `winnerCode` |
| home/away_team_id | `homeTeam.id` / `awayTeam.id` |
| home/away_score_* | `homeScore.current/display/normaltime/period1/period2`（away 同） |
| round_num / round_name / round_slug / round_prefix / cup_round_type | `roundInfo.round/name/slug/prefix/cupRoundType` |
| has_xg / has_event_player_statistics / has_event_player_heat_map | `hasXg` / `hasEventPlayerStatistics` / `hasEventPlayerHeatMap` |
| kickoff_time | `startTimestamp`（unix → TIMESTAMPTZ） |

**特别说明**：
- **延期/取消场次**（postponed/canceled，共约 1,609 场）的 `homeScore`/`awayScore` 是**空对象**，比分 10 列全部为 NULL，`winner_code=0`。
- **不存** `finalResultOnly`：该字段 true 的 10 场全部是 code 60/70（postponed/canceled），可由 status_code 推断，不冗余存储。
- **不存** `date` 字符串（与 startTimestamp 冗余）；**不存** `match.tournament.*`（无 id，仅展示信息，league 信息在维度表）。

**入库简述**：按 `match_id` upsert；若 JSON 中出现字典表未收录的 status_code / cup_round_type / round_prefix，先向对应字典表插入占位行（中文含义标 `待翻译`），再写 matches，保证数据入库不阻塞。

---

## 七、status_codes — 状态码字典表（9 行）

```sql
CREATE TABLE status_codes (
    code              INTEGER PRIMARY KEY,
    status_type       TEXT NOT NULL,      -- finished/postponed/canceled/notstarted
    description       TEXT NOT NULL,      -- Ended/AET/AP/Postponed/Canceled/Abandoned/Walkover/Retired
    meaning_cn        TEXT NOT NULL,      -- 完场/加时完场/点球完场/延期/取消/中止/判负/弃赛
    final_result_only BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at        TIMESTAMPTZ DEFAULT now()
);
```

| code | type | description | meaning_cn | final_result_only | 场次 |
|---|---|---|---|---|---|
| 0 | notstarted | Not started | 未开始 | false | 5,018 |
| 100 | finished | Ended | 完场 | false | 73,714 |
| 110 | finished | AET | 加时完场 | false | 687 |
| 120 | finished | AP | 点球完场 | false | 1,258 |
| 60 | postponed | Postponed | 延期 | true | 760 |
| 70 | canceled | Canceled | 取消 | true | 839 |
| 90 | canceled | Abandoned | 中止 | true | 10 |
| 91 | finished | Walkover | 判负 | false | 1 |
| 92 | finished | Retired | 弃赛 | false | 1 |

**说明**：
- `description` 与 `code` 严格 1:1，因此 matches 表只存 code+type，description 查此表。
- `final_result_only=true` 等价于"延期/取消/中止场次"，matches 表不冗余该列，需要时 JOIN 此表。

---

## 八、cup_round_types — 杯赛轮次字典表（5 行）

```sql
CREATE TABLE cup_round_types (
    value            INTEGER PRIMARY KEY,   -- 2 的幂
    matches_in_round INTEGER NOT NULL,      -- = value（该轮比赛场次数）
    round_name_en    TEXT NOT NULL,
    round_name_cn    TEXT NOT NULL,
    updated_at       TIMESTAMPTZ DEFAULT now()
);
```

| value | matches_in_round | round_name_en | round_name_cn | 对应轮次 | 场次 |
|---|---|---|---|---|---|
| 16 | 16 | Round of 32 | 32强 | 三十二强 | 578 |
| 8 | 8 | Round of 16 | 16强 | 十六强 | 775 |
| 4 | 4 | Quarterfinals | 八强/四分之一决赛 | 四分之一 | 540 |
| 2 | 2 | Semifinals | 半决赛 | 半决赛 | 496 |
| 1 | 1 | Final | 决赛 | 决赛 | 294 |

**说明**：`cupRoundType` 是 Sofascore 的 2 的幂编码，值 = 该轮比赛场次数，可推导轮次名；`round_name`（原文）更可靠，两者都在 matches 表保留。

---

## 九、round_prefixes — 阶段标签字典表（4 行）

```sql
CREATE TABLE round_prefixes (
    value      TEXT PRIMARY KEY,      -- Qualification/Preliminary/Europa Playoffs/Relegation-Promotion
    meaning_cn TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

| value | meaning_cn | 出现的赛事 |
|---|---|---|
| Qualification | 资格赛 | 欧冠/欧联/欧协联 |
| Preliminary | 预选赛 | 欧冠 |
| Europa Playoffs | 欧联附加赛 | 荷甲 |
| Relegation-Promotion | 升降级附加赛 | 荷甲 |

**说明**：`roundPrefix` 是阶段标签，配合 `round_name` 使用。只出现在 UEFA 欧战资格赛与荷甲附加赛（422 场），标注"该轮属于资格赛/附加赛阶段"。

---

## 十、已确认但暂不落库的语义（写入文档即可）

- **比分字段语义**（current/display/normaltime/period1/period2 差异）：见"〇、6"，页面默认展示 normaltime，120 分钟/点球比分附注小字。不建表。
- **status / cupRoundType / roundPrefix**：语义建表（七/八/九），同时本文档即为人类可读对照。

---

## 十一、待讨论（后续补充）

- details 相关表：`match_details` / `match_players` / `match_statistics` / `match_incidents` / `team_season_stats`。
- 当前已核实：`data/details/{联赛}/{赛季}/teams/{teamId}.json` 的 `team_season_stats` 含 **111 个键**（107 统计指标 + 4 元数据 id/matches/awardedMatches/statisticsType），全部标量，适合宽表建模。
- 数据文件：赛程在 `schedules_v3`（本设计的数据源）；详情在 `data/details/`（结构待进一步核实后建模）。
