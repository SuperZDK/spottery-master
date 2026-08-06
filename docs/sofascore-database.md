# Sofascore 源库数据库设计（已定稿部分）

> 本文档记录 **sofascore 库**已确认的数据表设计与数据来源映射，供开发、分析与后续建模参考。
> 当前定稿范围：**Sofascore 源库全部定稿** —— schedules + 4 张维度表（leagues/seasons/teams/countries）+ 3 张字典表（status_codes/cup_round_types/round_prefixes）+ details 相关表（players/match_players/match_details/match_votes/match_missing_players/match_statistics/team_season_stats）。
> `match_incidents` **确认不建表**（详见"十九"）。
> 所有表均采用**软关联（无 FOREIGN KEY）**，字段来源与转化方式见各表"字段来源与转化"小节。

---

## 〇、设计全局原则

1. **软关联（无 FOREIGN KEY）**：所有表之间只存对方主键 ID，不建 FK 约束。查询用 `LEFT JOIN`。
   - 原因：批量导入时 FK 校验有开销；Sofascore 未来若新增未知编码，软关联不会阻塞数据入库（字典表缺行时 JOIN 结果为 NULL，可事后补字典）。
2. **语义单一来源**：字段的语义（如比分 current/display/normaltime 差异、status 各编码含义、cupRoundType 含义）在本文档**以及库内字典表**中说明，人类读文档、SQL 查字典表。
3. **尽量满足 3NF**：国家/州际信息统一收敛到 countries 表，不在 leagues/teams 重复冗余国家多列。
4. **明细表冗余赛事维度**：以 match_id 软关联 schedules 的明细表（match_players/match_votes/match_missing_players/match_statistics 等），统一冗余 `league_id`/`season_id` 两列作**查询入口**。原因：按赛事/赛季过滤是分析高频，冗余后免 JOIN schedules 即可直接走 `(league_id, season_id, match_id)` 复合索引；扩充赛事不增加额外成本。冗余值复用同一 details 文件顶层的 `league.id`/`seasonId`（与 schedules 表同值）。
5. **自增主键**：需要自增的列用 `SERIAL`，删除行后序列值**不复用、后续值不变化**。
6. **爬虫快照字段**（如 teams.user_count）：同一实体在不同抓取时点可能变化，后续 CRUD 用 `INSERT ... ON CONFLICT ... DO UPDATE` upsert 刷新。
7. **比分语义**（重要）：Sofascore 比分对象有 4 个语义不同的字段，不能混用：
   - `normaltime`：**90 分钟常规比分**（竞彩分析首要展示、联赛积分/胜负统计用）；
   - `display`：Sofascore 显示的足球比分（AET=含加时最终比分；点球决胜=120 分钟比分，不含点球）；
   - `current`：实时比分；**点球决胜场次里是点球命中数（不是足球比分）**，不可当最终比分；
   - `period1/period2`：上下半场比分。
   - 页面展示默认用 normaltime，120 分钟/点球比分以附注小字呈现。

---

## 一、业务需求与设计依据

> 本章汇总 Sofascore 库各表**支撑的业务需求**（页面功能 / 分析场景），作为建表、建索引、冗余字段的依据。每个需求标注支撑的表与关键索引，保证"需求 → 结构"可追溯。

### 1.1 赛程浏览与导航（schedules）

| 需求 | 说明 | 支撑结构 |
|---|---|---|
| 构建各轮次赛程 | 按联赛+赛季过滤、按轮次分组展示赛程（联赛按 round 分组、杯赛按阶段） | `idx_schedules_league_season_round (league_id, season_id, round_num)` |
| 赛程项 → 详情页跳转 | 赛程列表每行"详情"按钮跳转对应比赛详情页 | schedules.match_id 主键 + match_details/match_players 等软关联 |
| 跨源找比赛 | 用其他源（竞彩/球探）的比赛 ID、日期、主客队找到对应 Sofascore 比赛 | `match_id` 主键；`(league_id, season_id)` 前缀；`idx_schedules_kickoff` |
| 近期赛程 / 按日期查 | 今日/某日比赛列表、未来几天赛程 | `idx_schedules_kickoff (kickoff_time)` |
| 某队全部比赛 | 主客两侧都要查（"主队=甲 OR 客队=甲"），复合索引无法加速 OR 查询 | `idx_schedules_home_team` / `idx_schedules_away_team` 单列索引 |

### 1.2 比赛详情页（match_details + match_players + match_statistics）

| 需求 | 说明 | 支撑结构 |
|---|---|---|
| 按 match_id 查详情 | 裁判/球场/上座/阵容确认/双方阵型/赛前排位等基本信息 | match_details PK(match_id) |
| 按比赛查球队技术统计 | 双方射门/控球/角球/黄牌等对比（ALL/1ST/2ND 各期） | match_statistics PK(match_id, is_home, period) |
| 阵容展示 | 详情页显示双方首发/替补名单、阵型、球衣号码 | match_players PK(match_id, player_id) |
| 球队赛季聚合对比 | 展示球队本赛季整体表现（进球/控球/评分等） | team_season_stats PK(team_id, season_id) |

### 1.3 球员维度（players + match_players）

| 需求 | 说明 | 支撑结构 |
|---|---|---|
| 球员详情页 | 点阵容球员跳转球员页，展示位置、参赛历史 | players（position 主流位置快照） |
| 球员比赛历史 | 按时间倒序列出参赛记录、比分、评分 | match_players JOIN schedules，按 player_id 过滤 |
| 按赛季筛选参赛 | 某球员某赛季的出场列表、出场次数 | `idx_match_players_player_season (player_id, season_id)` |
| 时间范围参赛 | 某时间窗内出场（如近 10 场、本赛季） | 上索引 JOIN schedules.kickoff_time |
| 评分统计 | 平均评分、按位置聚合的评分/出场统计 | match_players.rating（现算，见"十三"） |

### 1.4 球迷投票（match_votes）

| 需求 | 说明 | 支撑结构 |
|---|---|---|
| 按 match_id 查投票 | 详情页展示胜平负/两队进球/先进球投票 | match_votes 按 match_id 过滤 |
| 投票变化轨迹 | 竞彩服务核心：**每日 22/23 点投票 vs 开赛时点投票**对比，反映临场资金/情绪变化 | UNIQUE(match_id, snapshot_at) 时间序列；历史基线 snapshot_at=开赛时间，未来定时 append |
| 无票场次不占行 | votes 缺失的场次不插行 | 入库约定 |

### 1.5 伤停名单（match_missing_players）

| 需求 | 说明 | 支撑结构 |
|---|---|---|
| 按比赛查伤停 | 详情页展示双方缺阵球员及伤情/预计复出 | match_missing_players 按 match_id 过滤 |
| 按球员查伤病历史 | 球员详情页展示其历史伤病记录、缺阵场次 | `idx_match_missing_player (player_id)` |
| 球员历史中显示伤停状态 | 球员参赛历史里标注某场是否伤停 | 上索引 JOIN match_players |

### 1.6 已确认的业务取舍

- **跨源映射**：三个源通过各自比赛 ID 映射，所有与比赛相关的表**必须有 match_id**（已落实：schedules/match_players/match_details/match_votes/match_missing_players/match_statistics 均含）。
- **match_incidents 不建表**（详见"十九"）：事件级分析价值与投入不成比例，进球/红牌从比分与统计推断。
- **players.position 保留**：球员页必须展示位置（详见"十一"说明）。

---

## 二、数据来源文件

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

**details 详情数据**位于 `data/details/{联赛}/{赛季}/{matchId}.json`，共 81,881 个文件（另有 `teams/{teamId}.json` 子目录，供 `team_season_stats` 建模）。每文件顶层结构：

```json
{
  "matchId", "slug", "startTimestamp", "status": "finished",   // status 是字符串！
  "league": { "id", "name", "shortName" },                      // 无 slug/country
  "season", "seasonId",
  "homeScore": 2, "awayScore": 1,                               // 比分是标量 int！
  "referee", "venue", "attendance",
  "pregameForm", "votes",
  "lineups":  { "confirmed", "home": { "formation", "players": [...] }, "away": {...} },
  "statistics": [ { "period": "ALL", "groups": [ { "groupName", "statisticsItems": [...] } ] } ],
  "incidents": [ ... ]
}
```

> ⚠️ 详情与赛程三处差异：`status` 是字符串（赛程是对象 code/type/description）、`homeScore/awayScore` 是标量 int（赛程是 current/display/... 对象）、`league` 仅 id/name/shortName。因此**比分/状态以 schedules_v3 为准**（已存 schedules 表），详情表不重复存储。

---

## 三、countries — 国家/洲际区域表

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

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| country_id | 自增 | SERIAL | 无外部值 |
| alpha2 | `team.country.alpha2` | 原样 | europe 等洲际实体为 NULL；UNIQUE |
| alpha3 | `team.country.alpha3` | 原样 | |
| name | `team.country.name` / `tournament.category.name` | 原样 | |
| slug | `team.country.slug` / `league.country`（字符串）/ `tournament.category.slug` | 原样 | leagues 侧主关联键；UNIQUE |

**入库简述**：扫描 `schedules_v3` 全部文件的 team.country 与 league.country，按 slug 去重插入；team 侧顺带补 alpha2/alpha3。

---

## 四、leagues — 联赛表（29 行）

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

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| league_id | 文件顶层 `league.id` | 原样（INTEGER） | 非自增，Sofascore 原始 ID |
| name | `league.name` | 原样 | 英文名 |
| short_name | `league.shortName` | 原样 | 中文简称（德乙） |
| slug | `league.slug` | 原样 | |
| country_slug | `league.country` | 原样（字符串） | 软关联 countries.slug（"germany"/"europe"） |

**入库简述**：按 `league_id` upsert（`ON CONFLICT (league_id) DO UPDATE`）。

---

## 五、seasons — 赛季表（309 行）

```sql
CREATE TABLE seasons (
    season_id  INTEGER PRIMARY KEY,     -- seasonId（全局唯一）
    league_id  INTEGER NOT NULL,        -- 软关联 leagues.league_id
    season_key TEXT NOT NULL,           -- "16/17" / "2024"
    UNIQUE (league_id, season_key)
);
```

**JSON 来源**：顶层 `seasonId` → season_id（已确认全局唯一）；顶层 `league.id` → league_id；顶层 `season`（字符串）→ season_key。

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| season_id | 文件顶层 `seasonId` | 原样（INTEGER） | 全局唯一 |
| league_id | 文件顶层 `league.id` | 原样 | 软关联 leagues |
| season_key | 文件顶层 `season`（字符串） | 原样 | "16/17" / "2024"；UNIQUE(league_id, season_key) |

**入库简述**：按 `season_id` upsert。

---

## 六、teams — 球队表（2,159 行）

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

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| team_id | `homeTeam/awayTeam.id` | 原样（INTEGER） | 非自增 |
| name | `homeTeam/awayTeam.name` | 原样 | 英文名 |
| slug | `homeTeam/awayTeam.slug` | 原样 | |
| short_name | `homeTeam/awayTeam.shortName` | 原样 | 331/2,159 队为空 |
| name_code | `homeTeam/awayTeam.nameCode` | 原样 | 全部有值 |
| user_count | `homeTeam/awayTeam.userCount` | INT | 爬虫快照，可变化，upsert 刷新 |
| country_id | `homeTeam/awayTeam.country.alpha2` | 按 alpha2 匹配 countries 得 country_id | 16 队 country 缺失为 NULL |
| team_colors | `homeTeam/awayTeam.teamColors` | JSONB 整体存 | {primary, secondary, text} |

**已核实事实**：
- user_count 在所有场次/赛季间对同一球队**完全一致**（当前数据静态），但它是爬虫快照，跨天可能变化，后续用 upsert 刷新。
- 331/2,159 队 short_name 为空；16 队 country 缺失（country_id 为 NULL）。

**入库简述**：按 `team_id` upsert（`ON CONFLICT (team_id) DO UPDATE SET name=..., user_count=..., country_id=...` 等）。

---

## 七、schedules — 赛程主表（82,288 行）

```sql
CREATE TABLE schedules (
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
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_schedules_league_season_round ON schedules (league_id, season_id, round_num);
CREATE INDEX idx_schedules_kickoff           ON schedules (kickoff_time);
CREATE INDEX idx_schedules_home_team         ON schedules (home_team_id);
CREATE INDEX idx_schedules_away_team         ON schedules (away_team_id);
```

> **索引设计说明**：
> - `match_id` 已是 PRIMARY KEY（全局唯一），不再建 `UNIQUE (league_id, season_id, match_id)` —— 该约束与主键重复，是冗余（白占索引、拖慢插入）。按"联赛+赛季"过滤的查询由新复合索引 `(league_id, season_id, round_num)` 的前两列前缀承接，同时第三列 `round_num` 支撑"构建某联赛某赛季各轮次赛程"的排序。
> - 主客队查询（"某队全部比赛"）拆成两个**单列**索引 `idx_schedules_home_team` / `idx_schedules_away_team`：复合索引 `(home_team_id, away_team_id)` 只能加速"主队=甲 AND 客队=乙"，无法加速"主队=甲 **OR** 客队=甲"，故不建复合而拆单列，各走各的索引。
> - `idx_schedules_kickoff` 支撑按开赛时间查询（近期赛程、跨源按日期找比赛）。

**JSON 来源与转化**（match 对象）：
| 列 | JSON | 转化方式 | 备注 |
|---|---|---|---|
| match_id | `id` | 原样 | |
| league_id | 顶层 `league.id` | 原样 | ⚠️ match.tournament **无 id**，league 只能取文件顶层 |
| season_id / season_key | 顶层 `seasonId` / `season` | 原样 | season_key 冗余字符串 |
| slug | `slug` | 原样 | |
| status_code / status_type | `status.code` / `status.type` | 原样 | 软关联 status_codes |
| winner_code | `winnerCode` | 原样 | 1=主胜 2=平 3=客胜 0=无结果 |
| home/away_team_id | `homeTeam.id` / `awayTeam.id` | 原样 | 软关联 teams |
| home/away_score_* | `homeScore.current/display/normaltime/period1/period2`（away 同） | 原样 | 延期/取消场次为空对象→NULL |
| round_num / round_name / round_slug / round_prefix / cup_round_type | `roundInfo.round/name/slug/prefix/cupRoundType` | 原样 | 轮次字段缺失的联赛场次为 NULL |
| has_xg / has_event_player_statistics / has_event_player_heat_map | `hasXg` / `hasEventPlayerStatistics` / `hasEventPlayerHeatMap` | 原样 | |
| kickoff_time | `startTimestamp` | unix 秒 → TIMESTAMPTZ | 已核实为秒级时间戳 |

**特别说明**：
- **延期/取消场次**（postponed/canceled，共约 1,609 场）的 `homeScore`/`awayScore` 是**空对象**，比分 10 列全部为 NULL，`winner_code=0`。
- **不存** `finalResultOnly`：该字段 true 的 10 场全部是 code 60/70（postponed/canceled），可由 status_code 推断，不冗余存储。
- **不存** `date` 字符串（与 startTimestamp 冗余）；**不存** `match.tournament.*`（无 id，仅展示信息，league 信息在维度表）。

**入库简述**：按 `match_id` upsert；若 JSON 中出现字典表未收录的 status_code / cup_round_type / round_prefix，先向对应字典表插入占位行（中文含义标 `待翻译`），再写 schedules，保证数据入库不阻塞。

---

## 八、status_codes — 状态码字典表（9 行）

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
- `description` 与 `code` 严格 1:1，因此 schedules 表只存 code+type，description 查此表。
- `final_result_only=true` 等价于"延期/取消/中止场次"，schedules 表不冗余该列，需要时 JOIN 此表。

**字段来源与转化**：

| 列 | 来源 | 口径 | 备注 |
|---|---|---|---|
| code | `match.status.code`（全量扫描去重） | 原样 | 当前 9 个值 |
| status_type | `match.status.type`（对应该 code） | 原样 | finished/postponed/canceled/notstarted |
| description | `match.status.description`（对应该 code） | 原样 | Ended/AET/AP 等；与 code 1:1 |
| meaning_cn | 人工翻译 | 中文含义 | 完场/加时完场/点球完场... |
| final_result_only | 人工标注 | 布尔 | code 60/70/90 为 true |

**入库简述**：入库时对每个未收录的 status_code 先插占位行（meaning_cn 标"待翻译"），再写 schedules，保证不阻塞。

---

## 九、cup_round_types — 杯赛轮次字典表（5 行）

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

**说明**：`cupRoundType` 是 Sofascore 的 2 的幂编码，值 = 该轮比赛场次数，可推导轮次名；`round_name`（原文）更可靠，两者都在 schedules 表保留。

**字段来源与转化**：

| 列 | 来源 | 口径 | 备注 |
|---|---|---|---|
| value | `match.roundInfo.cupRoundType`（全量扫描去重） | 原样（2 的幂） | 当前 5 个值 |
| matches_in_round | = value | 原样 | 该轮比赛场次数 |
| round_name_en | 人工翻译（或 Sofascore 页面轮次名） | 英文 | Round of 32 等 |
| round_name_cn | 人工翻译 | 中文 | 32强/16强/八强/半决赛/决赛 |

**入库简述**：对未收录的 cupRoundType 插占位行（中文标"待翻译"），再写 schedules。

---

## 十、round_prefixes — 阶段标签字典表（4 行）

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

**字段来源与转化**：

| 列 | 来源 | 口径 | 备注 |
|---|---|---|---|
| value | `match.roundInfo.prefix`（全量扫描去重） | 原样 | Qualification/Preliminary/Europa Playoffs/Relegation-Promotion |
| meaning_cn | 人工翻译 | 中文含义 | 资格赛/预选赛/欧联附加赛/升降级附加赛 |

**入库简述**：对未收录的 prefix 插占位行（中文标"待翻译"），再写 schedules。

---

## 十一、players — 球员维度表（薄表）

```sql
CREATE TABLE players (
    player_id     INTEGER PRIMARY KEY,   -- lineups.player.id（Sofascore 球员原始 ID）
    name          TEXT NOT NULL,         -- lineups.player.name（跨场一致，抽样 0 漂移）
    position      TEXT,                  -- 惯用位置：出场最多的 G/D/M/F 短码（聚合值）
    first_seen_at TIMESTAMPTZ,           -- 该球员在 match_players 中最早比赛的 kickoff_time
    last_seen_at  TIMESTAMPTZ,           -- 最近比赛的 kickoff_time
    updated_at    TIMESTAMPTZ DEFAULT now()
);
```

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| player_id | `lineups.home/away.players[].player.id` | 原样 | 软关联 match_players.player_id |
| name | `lineups.home/away.players[].player.name` | 原样 | 跨场一致，可直接聚合维护 |
| position | 各场 `lineups...players[].position` 聚合 | 取众数（COUNT 最大短码） | 仅 G/D/M/F 四码；Sofascore 细粒度位置（前腰/后腰等）当前数据不可得，留待未来扩展 |
| first_seen_at / last_seen_at | 该球员所有比赛的 `startTimestamp` | MIN/MAX(kickoff_time) | 从 match_players JOIN schedules 聚合 |

**入库简述**：扫描全部 details 文件的 lineups，按 `player_id` upsert；name 取最新、position 取众数、first/last_seen 用聚合结果刷新。

**说明**：
- **position 必须落库（不删）**：球员列表页/详情页要展示位置，故 `position` 列保留，语义为"**当前主流位置快照**"——该球员全部出场中的众数短码（COUNT 最大的 G/D/M/F），upsert 时随数据刷新。已核实 251/714（35%）球员跨场位置变化，聚合值正是"踢得最多的位置"，作展示字段够用。
- 薄表定位，仅存球员稳定身份 + 位置快照。下列"现算字段"**不落库**，见"十三、现算字段与查询口径"。

---

## 十二、match_players — 比赛阵容表

```sql
CREATE TABLE match_players (
    match_id       INTEGER NOT NULL,      -- 软关联 schedules.match_id（details.matchId）
    player_id      INTEGER NOT NULL,     -- 软关联 players.player_id
    league_id      INTEGER,               -- 查询入口：与 schedules.league_id 同值（复用 details.league.id）
    season_id      INTEGER,               -- 查询入口：与 schedules.season_id 同值（复用 details 顶层 seasonId）
    is_home        BOOLEAN NOT NULL,     -- 主队球员?（home/away 侧）
    shirt_number   INTEGER,              -- shirtNumber
    position       TEXT,                 -- 本场实际位置（G/D/M/F 短码）
    substitute     BOOLEAN,              -- 是否替补
    -- ==== 球员比赛统计（statistics，仅 6 键，1:1 归入本表）====
    rating         NUMERIC(4,2),         -- statistics.rating（如 7.2）
    minutes_played INTEGER,              -- statistics.minutesPlayed
    total_pass     INTEGER,              -- statistics.totalPass
    accurate_pass  INTEGER,              -- statistics.accuratePass
    total_shots    INTEGER,              -- statistics.totalShots
    saves          INTEGER,              -- statistics.saves（仅门将有值）
    PRIMARY KEY (match_id, player_id)
);
CREATE INDEX idx_match_players_ls          ON match_players (league_id, season_id, match_id);
CREATE INDEX idx_match_players_player_season ON match_players (player_id, season_id);
```

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| match_id | 文件顶层 `matchId` | 原样 | 与 schedules.match_id 同值 |
| league_id / season_id | 复用同一 details 文件顶层的 `league.id` / `seasonId` | 原样 | 与 schedules.league_id/season_id 同值，查询入口（见"〇、4"） |
| player_id / is_home | `lineups.home/away.players[].player.id` | 原样；home 侧 true / away 侧 false | 从 home/away 两个数组各取 |
| shirt_number | `...players[].shirtNumber` | INT | 无则 NULL |
| position | `...players[].position` | 原样 | 短码 G/D/M/F 为主；旧数据罕见详细名（如 goalkeeper）原样保留 |
| substitute | `...players[].substitute` | 布尔 | |
| rating / minutes_played / total_pass / accurate_pass / total_shots / saves | `...players[].statistics.*` | 原样；无 statistics 对象留 NULL | 全库仅此 6 键；saves 仅门将 |

**已核实事实**：
- player.id 100% 完整；players 跨场 name 一致。
- statistics 全库仅 6 键；saves 仅守门员（577 例）。
- 无 stats 的球员（替补未上场/旧数据）：替补 1,100 + 首发 1,496，统计列 NULL。
- position 详细名（goalkeeper/right_back 等）全库仅 154 例且均无 stats，按原样保存不特殊处理。

**入库简述**：按 `(match_id, player_id)` upsert；同场一名球员只出现一次。

---

## 十三、现算字段与查询口径（不落库）

以下需求字段**不建列**，由 SQL 现算。文档记录口径，保证实现一致。

**1. current_team_id（球员当前/某时刻球队）**
```sql
SELECT m.away_team_id AS team_id        -- 该球员踢的是客队
FROM match_players mp
JOIN schedules m ON m.match_id = mp.match_id
WHERE mp.player_id = :X AND mp.is_home = FALSE
  AND m.kickoff_time <= :截止时间
ORDER BY m.kickoff_time DESC LIMIT 1;
```
（is_home=TRUE 时取 `home_team_id`。）即"该球员最近一场比赛所在队"。

**2. 球员参赛列表 / 赛季筛选**
`match_players JOIN schedules JOIN leagues/seasons`，`WHERE player_id=X`，`ORDER BY kickoff_time DESC`；按赛季看加 `AND schedules.season_id=..`。

**3. 球员位置总览（top N，按出场次数或平均评分）**
```sql
SELECT position, COUNT(*) AS games, AVG(rating) AS avg_rating
FROM match_players
WHERE player_id = :X
  [AND match_id IN (SELECT match_id FROM schedules WHERE season_id = :S)]  -- 可选按赛季
GROUP BY position
ORDER BY :排序列 DESC;
```

**4. 球员进球 / 黄红牌**：`match_incidents`（待定稿）`WHERE player_id=X`。

---

## 十四、match_details — 比赛详情表

```sql
CREATE TABLE match_details (
    match_id           INTEGER PRIMARY KEY,   -- 软关联 schedules.match_id
    league_id          INTEGER NOT NULL,     -- details.league.id（软关联 leagues，查询入口）
    season_id          INTEGER NOT NULL,     -- details.seasonId（软关联 seasons，查询入口）
    referee            TEXT,                 -- referee（裁判名）
    venue              TEXT,                 -- venue（球场名）
    attendance         INTEGER,              -- attendance（到场人数，仅部分场次有）
    lineups_confirmed  BOOLEAN,              -- lineups.confirmed
    home_formation     TEXT,                 -- lineups.home.formation（"3-4-3"）
    away_formation     TEXT,                 -- lineups.away.formation
    -- ==== pregameForm（1:1 归入本表，仅新数据有）====
    pregame_home_avg_rating  NUMERIC,        -- pregameForm.homeTeam.avgRating "6.84"
    pregame_home_position    INTEGER,        -- pregameForm.homeTeam.position
    pregame_home_value       INTEGER,        -- pregameForm.homeTeam.value（积分）
    pregame_home_form        JSONB,          -- pregameForm.homeTeam.form ["D","W","W","W","D"]
    pregame_away_avg_rating  NUMERIC,
    pregame_away_position    INTEGER,
    pregame_away_value       INTEGER,
    pregame_away_form        JSONB
);
CREATE INDEX idx_match_details_ls ON match_details (league_id, season_id);
```

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| match_id | 文件顶层 `matchId` | 原样 | 与 schedules.match_id 同值 |
| league_id | `league.id` | 原样 | 软关联 leagues（查询入口，免 JOIN schedules 即可按联赛筛详情） |
| season_id | 文件顶层 `seasonId` | 原样 | 软关联 seasons（同上，按赛季筛） |
| referee | `referee` | TEXT | 约 85% 场次有 |
| venue | `venue` | TEXT | 约 88% 场次有 |
| attendance | `attendance` | INT | 仅约 33% 场次有（int，已核实） |
| lineups_confirmed | `lineups.confirmed` | 布尔 | 375/400 场为 true |
| home/away_formation | `lineups.home/away.formation` | TEXT | "3-4-3" 等 |
| pregame_* | `pregameForm.homeTeam/awayTeam.*` | avgRating 数字、"value"积分、form 数组 | 仅约 55% 场次有（新数据），无则 NULL |

**说明**：
- **不存** score / status：比分与状态在 schedules_v3 可得、已存 schedules 表（且详情里 status 是字符串、比分是标量 int，语义不如 schedules 对象完整），避免冗余。
- league_id / season_id 为**查询入口冗余**：高频"按联赛+赛季筛详情"直接走复合索引，不 JOIN schedules；需比分/主客队时再 `JOIN schedules ON match_id`。
- pregameForm 一场一值、赛中不变，拆列入库不建独立表。

---

## 十五、match_votes — 球迷投票时间序列表

```sql
CREATE TABLE match_votes (
    id             BIGSERIAL PRIMARY KEY,
    match_id       INTEGER NOT NULL,        -- 软关联 schedules.match_id
    league_id      INTEGER,                 -- 查询入口：与 schedules.league_id 同值（复用 details.league.id）
    season_id      INTEGER,                 -- 查询入口：与 schedules.season_id 同值（复用 details 顶层 seasonId）
    snapshot_at    TIMESTAMPTZ NOT NULL,   -- 抓取时间点（历史回填=开赛时间，未来抓取=抓取端时间戳）
    vote_home      INTEGER,                -- votes.vote.vote1
    vote_draw      INTEGER,                -- votes.vote.vote2
    vote_away      INTEGER,                -- votes.vote.voteX
    both_yes       INTEGER,                -- votes.bothTeamsToScoreVote.voteYes
    both_no        INTEGER,                -- votes.bothTeamsToScoreVote.voteNo
    first_home     INTEGER,                -- votes.firstTeamToScoreVote.voteHome
    first_nogoal   INTEGER,                -- votes.firstTeamToScoreVote.voteNoGoal
    first_away     INTEGER,                -- votes.firstTeamToScoreVote.voteAway
    UNIQUE (match_id, snapshot_at)
);
CREATE INDEX idx_match_votes_ls ON match_votes (league_id, season_id, match_id);
```

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| match_id | 文件顶层 `matchId` | 原样 | |
| league_id / season_id | 复用同一 details 文件顶层的 `league.id` / `seasonId` | 原样 | 与 schedules.league_id/season_id 同值，查询入口（见"〇、4"） |
| snapshot_at | 历史回填=该场 `startTimestamp`（开赛时间）；未来定时抓取=抓取端时间戳 | TIMESTAMPTZ | 见"设计要点" |
| vote_home / vote_draw / vote_away | `votes.vote.vote1/vote2/voteX` | INT | 球迷投票（胜/平/负） |
| both_yes / both_no | `votes.bothTeamsToScoreVote.voteYes/voteNo` | INT | 两队都进球？ |
| first_home / first_nogoal / first_away | `votes.firstTeamToScoreVote.voteHome/voteNoGoal/voteAway` | INT | 先进球：主队/无进球/客队 |

**设计要点**：
- **时间序列设计**：一场比赛多行，每行是一次抓取快照，`UNIQUE(match_id, snapshot_at)` 防重。
- **历史回填（每场 1 行基线）**：从现有 details 每场比赛插 1 行，`snapshot_at = 开赛时间（kickoff_time）`，作为"终局快照"——代表该场开赛时点的球迷投票，是历史数据的基线锚点。
- **未来定时抓取（append）**：**独立 votes 接口**单独抓投票（不重爬 details——页面多数数据开赛后不再变化，为抓 votes 重爬 details 性价比太低），开赛前按周期（每天 22/23 点 + 开赛前）抓取并 append，`snapshot_at = 抓取端时间戳`。多次快照形成投票变化轨迹，支撑竞彩服务的核心对比——**"每天 22/23 点的投票" vs "开赛时点投票"**（两者差异反映临场资金/情绪变化）。
- votes 缺失率极低（3/800），无 votes 的场次不插行。

---

## 十六、match_missing_players — 伤停球员表

```sql
CREATE TABLE match_missing_players (
    id                BIGSERIAL PRIMARY KEY,
    match_id          INTEGER NOT NULL,      -- 软关联 schedules.match_id
    league_id         INTEGER,               -- 查询入口：与 schedules.league_id 同值（复用 details.league.id）
    season_id         INTEGER,               -- 查询入口：与 schedules.season_id 同值（复用 details 顶层 seasonId）
    is_home           BOOLEAN NOT NULL,     -- 主队缺阵?（lineups.home/away 下）
    player_id         INTEGER,              -- missingPlayers[].player.id
    player_name       TEXT NOT NULL,        -- missingPlayers[].player.name
    missing_type      TEXT,                 -- "missing"
    description       TEXT,                 -- "ACL Knee Injury" 等
    expected_end_date TIMESTAMPTZ           -- "2025-12-05T00:00:00+00:00"
);
CREATE INDEX idx_match_missing_ls     ON match_missing_players (league_id, season_id, match_id);
CREATE INDEX idx_match_missing_player ON match_missing_players (player_id);
```

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| match_id | 文件顶层 `matchId` | 原样 | |
| league_id / season_id | 复用同一 details 文件顶层的 `league.id` / `seasonId` | 原样 | 与 schedules.league_id/season_id 同值，查询入口（见"〇、4"） |
| is_home | 位于 `lineups.home` 还是 `lineups.away` | home=true / away=false | |
| player_id / player_name | `missingPlayers[].player.id/name` | 原样 | |
| missing_type | `missingPlayers[].type` | 原样 | 目前均为 "missing" |
| description | `missingPlayers[].description` | 原样 | "ACL Knee Injury" 等 |
| expected_end_date | `missingPlayers[].expectedEndDate` | ISO 时间串 → TIMESTAMPTZ | |

**说明**：伤停是独立于阵容的补充信息，单独建表（已确认）。一场比赛伤停球员为空则无行。

---

## 十七、match_statistics — 球队比赛统计表

```sql
CREATE TABLE match_statistics (
    match_id   INTEGER NOT NULL,           -- 软关联 schedules.match_id
    league_id  INTEGER,                    -- 查询入口：与 schedules.league_id 同值（复用 details.league.id）
    season_id  INTEGER,                    -- 查询入口：与 schedules.season_id 同值（复用 details 顶层 seasonId）
    is_home    BOOLEAN NOT NULL,          -- TRUE=主队 / FALSE=客队
    period     TEXT NOT NULL,             -- ALL / 1ST / 2ND（ET1/ET2 加时舍弃，竞彩 90 分钟结算）
    -- ============ 51 指标 value 列（statisticsItems.homeValue/awayValue 按 is_home 取对应侧）============
    -- 【核心档 15】覆盖 >90%
    total_shots            INTEGER,       -- Total shots 总射门
    corner_kicks           INTEGER,       -- Corner kicks 角球
    shots_on_target        INTEGER,       -- Shots on target 射正
    shots_off_target       INTEGER,       -- Shots off target 射偏
    free_kicks             INTEGER,       -- Free kicks 任意球
    fouls                  INTEGER,       -- Fouls 犯规
    throw_ins              INTEGER,       -- Throw-ins 界外球
    goal_kicks             INTEGER,       -- Goal kicks 球门球
    goalkeeper_saves       INTEGER,       -- Goalkeeper saves 门将扑救
    ball_possession        NUMERIC,       -- Ball possession 控球率
    yellow_cards           INTEGER,       -- Yellow cards 黄牌
    blocked_shots          INTEGER,       -- Blocked shots 封堵射门
    shots_inside_box       INTEGER,       -- Shots inside box 禁区内射门
    shots_outside_box      INTEGER,       -- Shots outside box 禁区外射门
    hit_woodwork           INTEGER,       -- Hit woodwork 击中门框
    -- 【重要档 20】覆盖 60-90%
    duels                  INTEGER,       -- Duels 对抗
    ground_duels           INTEGER,       -- Ground duels 地面对抗
    offsides               INTEGER,       -- Offsides 越位
    passes                 INTEGER,       -- Passes 传球
    accurate_passes        INTEGER,       -- Accurate passes 传球成功
    aerial_duels           INTEGER,       -- Aerial duels 空中对抗
    tackles                INTEGER,       -- Tackles 抢断
    total_tackles          INTEGER,       -- Total tackles 总抢断
    tackles_won            INTEGER,       -- Tackles won 抢断成功
    long_balls             INTEGER,       -- Long balls 长传
    crosses                INTEGER,       -- Crosses 传中
    dribbles               INTEGER,       -- Dribbles 过人
    interceptions          INTEGER,       -- Interceptions 拦截
    clearances             INTEGER,       -- Clearances 解围
    dispossessed           INTEGER,       -- Dispossessed 被抢断
    final_third_entries    INTEGER,       -- Final third entries 进入进攻三区
    fouled_in_final_third  INTEGER,       -- Fouled in final third 进攻三区被犯规
    big_chances            INTEGER,       -- Big chances 大机会
    big_chances_missed     INTEGER,       -- Big chances missed 错失大机会
    big_chances_scored     INTEGER,       -- Big chances scored 大机会进球
    -- 【低覆盖有独特价值 2】
    expected_goals         NUMERIC,       -- Expected goals 期望进球 xG
    red_cards              INTEGER,       -- Red cards 红牌
    -- 【次要档 14】覆盖 <60%
    through_balls          INTEGER,       -- Through balls 直塞球
    recoveries             INTEGER,       -- Recoveries 夺回球权
    goals_prevented        NUMERIC,       -- Goals prevented 阻止进球
    final_third_phase      INTEGER,       -- Final third phase 进攻三区推进
    touches_in_penalty_area INTEGER,      -- Touches in penalty area 禁区内触球
    distance_covered       NUMERIC,       -- Distance covered 跑动距离(km)
    number_of_sprints      INTEGER,       -- Number of sprints 冲刺次数
    high_claims            INTEGER,       -- High claims 高空球接获
    big_saves              INTEGER,       -- Big saves 关键扑救
    errors_lead_to_shot    INTEGER,       -- Errors lead to a shot 失误致射
    punches                INTEGER,       -- Punches 拳击球
    errors_lead_to_goal    INTEGER,       -- Errors lead to a goal 失误致丢球
    penalty_saves          INTEGER,       -- Penalty saves 扑出点球
    -- ============ 6 个复合分数指标 text 列（保真原始文本，查询时解析分母/百分比）============
    ground_duels_text      TEXT,          -- 如 "37/65 (57%)"
    aerial_duels_text      TEXT,          -- 如 "16/28 (57%)"
    long_balls_text        TEXT,          -- 如 "22/71 (31%)"
    crosses_text           TEXT,          -- 如 "5/19 (26%)"
    dribbles_text          TEXT,          -- 如 "5/13 (38%)"
    final_third_phase_text TEXT,          -- 如 "60/108 (56%)"
    PRIMARY KEY (match_id, is_home, period)
);
CREATE INDEX idx_match_statistics_ls ON match_statistics (league_id, season_id, match_id);
```

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| match_id | 文件顶层 `matchId` | 原样 | 与 schedules.match_id 同值 |
| league_id / season_id | 复用同一 details 文件顶层的 `league.id` / `seasonId` | 原样 | 与 schedules.league_id/season_id 同值，查询入口（见"〇、4"） |
| is_home | statisticsItems 属于主队还是客队 | home=true / away=false | |
| period | `statistics[].period` | 原样 | ALL/1ST/2ND；ET1/ET2 舍弃 |
| 各 value 列 | `statistics[].groups[].statisticsItems[].homeValue/awayValue` | 按 is_home 取对应侧值 | 无该项则该列 NULL |
| 6 个 _text 列 | 同上 `.home/away` | 原始字符串 | 仅复合分数指标保留 |

**结构说明**（重要）：
- 实际结构为 `statistics[] → {period, groups[]} → groups[] = {groupName, statisticsItems[]}`，item = `{name, home, away, homeValue, awayValue}`。
- **51 个指标 name 全量核实**：40 个纯整数、2 个 float、1 个 km、4 个百分比（value 即百分比数值）、6 个复合分数（value 只含**分子**成功次数，分母/百分比仅在文本中）。
- **value 语义**：6 个复合指标（Ground duels/Aerial duels/Long balls/Crosses/Dribbles/Final third phase）的 `homeValue/awayValue` 只是成功次数（如 Long balls value=22），完整 `"22/71 (31%)"` 在文本列保真；百分比需查询时从 text 解析（文本是唯一分母来源）。
- 51 个指标与 group（Match overview/Shots/Passes/Goalkeeping/Attack/Duels/Defending）是稳定 1:1 映射，group 不存列，需要时按指标名所属组自行归类。

**已核实事实**（全量 81,874 场）：
- 有 statistics 的场次约 69,286 场（84.6%）；无 stats 场次 LEFT JOIN 为 NULL。
- period 组合：1ST+2ND+ALL 共 63,207 场（77.2%）；**仅 ALL 无半场 5,447 场（6.7%）**；含 ET 仅 598 场（0.7%）。
- 一场比赛 **6 行**（2 侧 × 3 期）；仅 ALL 的场次 2 行。总行数约 **39 万行**。
- 无 stats 原因：canceled/postponed 1,621 场未踢无统计（合理）；finished 无 stats 约 10,944 场主要为源站标记 `hasEventPlayerStatistics=false`（无球员统计），仅 35 场标记 true 却缺失（爬虫缺口，可忽略）。

**入库简述**：按 `(match_id, is_home, period)` upsert；遍历 statistics[] 每期生成主客 2 行，从 groups[].statisticsItems 按 name 映射到对应 value 列，复合指标同时填 text 列。

---

## 十八、team_season_stats — 球队赛季统计表

数据源：`data/details/{联赛}/{赛季}/teams/{teamId}.json` 的 `statistics` 对象（每队每赛季一个文件，全量 5,831 个）。`statistics` 为**扁平标量结构**：`{ 指标名: 数值 }`，共 **117 个键**（113 统计指标 + 4 元数据 id/matches/awardedMatches/statisticsType）。宽表 1:1 转列。

```sql
CREATE TABLE team_season_stats (
    team_id    INTEGER NOT NULL,       -- 原生 teamId，软关联 teams.team_id
    league_id  INTEGER NOT NULL,       -- 原生 leagueId，软关联 leagues（查询入口）
    season_id  INTEGER NOT NULL,       -- 原生 seasonId，软关联 seasons（查询入口）
    -- ==== 元数据（statistics.*）====
    matches         INTEGER,           -- statistics.matches 源站统计的场次数（可用于校验）
    awarded_matches INTEGER,           -- statistics.awardedMatches 判给场次
    -- ==== 进攻 ====
    goals_scored             INTEGER,  -- goalsScored 进球数
    goals_conceded           INTEGER,  -- goalsConceded 失球数
    own_goals                INTEGER,  -- ownGoals 乌龙球数
    assists                  INTEGER,  -- assists 助攻数
    penalty_goals            INTEGER,  -- penaltyGoals 点球进球
    penalties_taken          INTEGER,  -- penaltiesTaken 点球主罚次数
    free_kick_goals          INTEGER,  -- freeKickGoals 任意球进球
    free_kick_shots          INTEGER,  -- freeKickShots 任意球射门
    goals_from_inside_the_box    INTEGER,  -- goalsFromInsideTheBox 禁区内进球
    goals_from_outside_the_box   INTEGER,  -- goalsFromOutsideTheBox 禁区外进球
    headed_goals             INTEGER,  -- headedGoals 头球进球
    left_foot_goals          INTEGER,  -- leftFootGoals 左脚进球
    right_foot_goals         INTEGER,  -- rightFootGoals 右脚进球
    big_chances_created      INTEGER,  -- bigChancesCreated 创造的大机会
    -- ==== 射门 ====
    shots                    INTEGER,  -- shots 总射门
    shots_on_target          INTEGER,  -- shotsOnTarget 射正
    shots_off_target         INTEGER,  -- shotsOffTarget 射偏
    shots_from_inside_the_box    INTEGER,  -- shotsFromInsideTheBox 禁区内射门
    shots_from_outside_the_box   INTEGER,  -- shotsFromOutsideTheBox 禁区外射门
    blocked_scoring_attempt  INTEGER,  -- blockedScoringAttempt 被封堵的射门
    hit_woodwork             INTEGER,  -- hitWoodwork 击中门框
    big_chances              INTEGER,  -- bigChances 大机会
    big_chances_missed       INTEGER,  -- bigChancesMissed 错失大机会
    -- ==== 过人 / 定位球 ====
    successful_dribbles      INTEGER,  -- successfulDribbles 成功过人
    dribble_attempts         INTEGER,  -- dribbleAttempts 过人尝试次数
    corners                  INTEGER,  -- corners 角球数
    free_kicks               INTEGER,  -- freeKicks 获得的任意球
    throw_ins                INTEGER,  -- throwIns 界外球
    goal_kicks               INTEGER,  -- goalKicks 球门球
    -- ==== 快攻 ====
    fast_breaks              INTEGER,  -- fastBreaks 快攻次数
    fast_break_shots         INTEGER,  -- fastBreakShots 快攻射门
    fast_break_goals         INTEGER,  -- fastBreakGoals 快攻进球
    -- ==== 控球与传球 ====
    average_ball_possession  NUMERIC,  -- averageBallPossession 平均控球率(%)
    total_passes             INTEGER,  -- totalPasses 总传球
    accurate_passes          INTEGER,  -- accuratePasses 成功传球
    accurate_passes_percentage       NUMERIC,  -- accuratePassesPercentage 传球成功率(%)
    total_own_half_passes    INTEGER,  -- totalOwnHalfPasses 本方半场总传球
    accurate_own_half_passes INTEGER,  -- accurateOwnHalfPasses 本方半场成功传球
    accurate_own_half_passes_percentage  NUMERIC,  -- accurateOwnHalfPassesPercentage 本方半场传球成功率(%)
    total_opposition_half_passes INTEGER,  -- totalOppositionHalfPasses 对方半场总传球
    accurate_opposition_half_passes   INTEGER,  -- accurateOppositionHalfPasses 对方半场成功传球
    accurate_opposition_half_passes_percentage NUMERIC,  -- accurateOppositionHalfPassesPercentage 对方半场传球成功率(%)
    total_long_balls         INTEGER,  -- totalLongBalls 总长传
    accurate_long_balls      INTEGER,  -- accurateLongBalls 成功长传
    accurate_long_balls_percentage    NUMERIC,  -- accurateLongBallsPercentage 长传成功率(%)
    total_crosses            INTEGER,  -- totalCrosses 总传中
    accurate_crosses         INTEGER,  -- accurateCrosses 成功传中
    accurate_crosses_percentage       NUMERIC,  -- accurateCrossesPercentage 传中成功率(%)
    -- ==== 防守 ====
    clean_sheets             INTEGER,  -- cleanSheets 零封场次
    tackles                  INTEGER,  -- tackles 抢断
    interceptions            INTEGER,  -- interceptions 拦截
    saves                    INTEGER,  -- saves 扑救（门将）
    errors_leading_to_goal   INTEGER,  -- errorsLeadingToGoal 失误致丢球
    errors_leading_to_shot   INTEGER,  -- errorsLeadingToShot 失误致对方射门
    penalties_commited       INTEGER,  -- penaltiesCommited 被判点球次数
    penalty_goals_conceded   INTEGER,  -- penaltyGoalsConceded 点球失球
    clearances               INTEGER,  -- clearances 解围
    clearances_off_line      INTEGER,  -- clearancesOffLine 门线解围
    last_man_tackles         INTEGER,  -- lastManTackles 最后一人抢断
    total_duels              INTEGER,  -- totalDuels 总对抗
    duels_won                INTEGER,  -- duelsWon 对抗获胜
    duels_won_percentage     NUMERIC,  -- duelsWonPercentage 对抗胜率(%)
    total_ground_duels       INTEGER,  -- totalGroundDuels 总地面对抗
    ground_duels_won         INTEGER,  -- groundDuelsWon 地面对抗获胜
    ground_duels_won_percentage NUMERIC,  -- groundDuelsWonPercentage 地面对抗胜率(%)
    total_aerial_duels       INTEGER,  -- totalAerialDuels 总空中对抗
    aerial_duels_won         INTEGER,  -- aerialDuelsWon 空中对抗获胜
    aerial_duels_won_percentage      NUMERIC,  -- aerialDuelsWonPercentage 空中对抗胜率(%)
    possession_lost          INTEGER,  -- possessionLost 失去球权
    ball_recovery            INTEGER,  -- ballRecovery 夺回球权
    -- ==== 纪律 ====
    offsides                 INTEGER,  -- offsides 越位
    fouls                    INTEGER,  -- fouls 犯规
    yellow_cards             INTEGER,  -- yellowCards 黄牌
    yellow_red_cards         INTEGER,  -- yellowRedCards 两黄变一红
    red_cards                INTEGER,  -- redCards 红牌
    -- ==== 其他 ====
    avg_rating               NUMERIC,  -- avgRating 平均评分
    kilometers_covered       NUMERIC,  -- kilometersCovered 跑动距离(km)
    number_of_sprints        INTEGER,  -- numberOfSprints 冲刺次数
    -- ==== 对手视角（Against，指标名含 Against 前缀）====
    shots_against                    INTEGER,  -- shotsAgainst 对手总射门
    shots_on_target_against          INTEGER,  -- shotsOnTargetAgainst 对手射正
    shots_off_target_against         INTEGER,  -- shotsOffTargetAgainst 对手射偏
    shots_blocked_against            INTEGER,  -- shotsBlockedAgainst 对手被封堵射门
    shots_from_inside_the_box_against    INTEGER,  -- shotsFromInsideTheBoxAgainst 对手禁区内射门
    shots_from_outside_the_box_against   INTEGER,  -- shotsFromOutsideTheBoxAgainst 对手禁区外射门
    corners_against                  INTEGER,  -- cornersAgainst 对手角球
    hit_woodwork_against             INTEGER,  -- hitWoodworkAgainst 对手击中门框
    blocked_scoring_attempt_against  INTEGER,  -- blockedScoringAttemptAgainst 对手被封堵射门
    big_chances_against              INTEGER,  -- bigChancesAgainst 对手大机会
    big_chances_created_against      INTEGER,  -- bigChancesCreatedAgainst 对手创造大机会
    big_chances_missed_against       INTEGER,  -- bigChancesMissedAgainst 对手错失大机会
    crosses_successful_against       INTEGER,  -- crossesSuccessfulAgainst 对手成功传中
    crosses_total_against            INTEGER,  -- crossesTotalAgainst 对手总传中
    dribble_attempts_total_against   INTEGER,  -- dribbleAttemptsTotalAgainst 对手过人尝试
    dribble_attempts_won_against     INTEGER,  -- dribbleAttemptsWonAgainst 对手成功过人
    long_balls_successful_against    INTEGER,  -- longBallsSuccessfulAgainst 对手成功长传
    long_balls_total_against         INTEGER,  -- longBallsTotalAgainst 对手总长传
    offsides_against                 INTEGER,  -- offsidesAgainst 对手越位
    red_cards_against                INTEGER,  -- redCardsAgainst 对手红牌
    yellow_cards_against             INTEGER,  -- yellowCardsAgainst 对手黄牌
    tackles_against                  INTEGER,  -- tacklesAgainst 对手抢断
    interceptions_against            INTEGER,  -- interceptionsAgainst 对手拦截
    clearances_against               INTEGER,  -- clearancesAgainst 对手解围
    errors_leading_to_goal_against   INTEGER,  -- errorsLeadingToGoalAgainst 对手失误致丢球
    errors_leading_to_shot_against   INTEGER,  -- errorsLeadingToShotAgainst 对手失误致射门
    key_passes_against               INTEGER,  -- keyPassesAgainst 对手关键传球
    total_passes_against             INTEGER,  -- totalPassesAgainst 对手总传球
    accurate_passes_against          INTEGER,  -- accuratePassesAgainst 对手成功传球
    accurate_own_half_passes_against INTEGER,  -- accurateOwnHalfPassesAgainst 对手本方半场成功传球
    accurate_opposition_half_passes_against INTEGER,  -- accurateOppositionHalfPassesAgainst 对手对方半场成功传球
    own_half_passes_total_against    INTEGER,  -- ownHalfPassesTotalAgainst 对手本方半场总传球
    opposition_half_passes_total_against INTEGER,  -- oppositionHalfPassesTotalAgainst 对手对方半场总传球
    accurate_final_third_passes_against INTEGER,  -- accurateFinalThirdPassesAgainst 对手进攻三区成功传球
    total_final_third_passes_against INTEGER,  -- totalFinalThirdPassesAgainst 对手进攻三区总传球
    PRIMARY KEY (team_id, season_id)
);
CREATE INDEX idx_team_season_stats_ls ON team_season_stats (league_id, season_id);
```

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| team_id / league_id / season_id | 文件顶层 `teamId` / `leagueId` / `seasonId` | 原样 | 与 teams/leagues/seasons 表同值 |
| matches / awarded_matches | `statistics.matches` / `statistics.awardedMatches` | 原样 | 元数据，见"结构说明" |
| 各统计列 | `statistics.{指标名}`（camelCase → snake_case） | 百分比/评分/跑动距离为 NUMERIC，其余 INTEGER | 缺失键该列 NULL |

**结构说明**（重要）：
- `statistics` 为**扁平对象**：`{ goalsScored: 60, shots: 399, ... }`，每键一个标量。**无嵌套、无单位统一**（percent 键为百分数值、kilometersCovered 为 km），宽表 1:1 转列最直接。
- **117 键全集**：113 统计指标 + 4 元数据（id/matches/awardedMatches/statisticsType）。主流 111 键；低覆盖 6 项为 `ballRecovery`/`freeKicks`/`goalKicks`/`throwIns`/`kilometersCovered`/`numberOfSprints`（部分球队/赛事缺失）。全表 117 列，缺失键该列 NULL。
- **变体均为 117 键子集**：杯赛（欧冠/欧联/意大利杯/国王杯）球队场次少，只有 11~42 键，均为主流键的子集 → 一表全覆盖、缺失列 NULL，无需按赛事分表。
- **元数据取舍**：`matches`（源站统计场次数，可校验爬取完整性）、`awardedMatches`（判给场次）入库；`id`（源站内部记录 id，无分析价值）、`statisticsType`（全部固定 {football, team} 常量）**不存**。
- **对手视角（Against）列**：指标名含 `Against` 后缀者为"该队比赛中对手的数据"（如 shotsAgainst=对手总射门），与 match_statistics 的 is_home 反侧行对应，可用于攻防对称校验。
- **主键**：`(team_id, season_id)` 全库唯一（已核实无重复）；`league_id/season_id` 为查询入口（文件原生即有，非额外冗余）。

**已核实事实**（全量 5,831 文件）：
- 每队每赛季一个文件，`(team_id, season_id)` 无重复；顶层三 id 字段 100% 完整。
- 键集合变体：主流 111 键 / 115 键（多 4 低覆盖）/ 117 键（全）共 3 种，另杯赛 11~42 键变体，全部为 117 键子集。

**入库简述**：按 `(team_id, season_id)` upsert；读取 statistics 对象各键按映射写入对应列，缺失键留 NULL。

---

## 十九、已确认但暂不落库的语义（写入文档即可）

- **比分字段语义**（current/display/normaltime/period1/period2 差异）：见"〇、6"，页面默认展示 normaltime，120 分钟/点球比分附注小字。不建表。
- **status / cupRoundType / roundPrefix**：语义建表（七/八/九），同时本文档即为人类可读对照。
- **现算字段**（current_team_id / 参赛列表 / 位置总览 / 进球牌）：见"十三、现算字段与查询口径"，不建列、由 SQL 现算。
- **match_incidents 不建表**：比赛事件（进球/黄红牌/换人/阶段/VAR/点球）已确认不落库。理由：源站 substitution 事件无球员信息、penaltyShootout 无 time、无 id 事件多，分析价值与投入不成比例；进球/红牌等可从比分与统计推断。**如未来需要事件级分析再单独设计。**

---

## 二十、待讨论（后续补充）

- Sofascore 源库 15 张表已全部定稿，无待讨论项。
- 数据文件：赛程在 `schedules_v3`（本设计的数据源）；详情在 `data/details/`（结构已核实，见表十四/十五/十六/十七/十八）。
