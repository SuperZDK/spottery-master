# 球探源库数据库设计（已定稿部分）

> 本文档记录 **titan007 库**已确认的数据表设计与数据来源映射，供开发、分析与后续建模参考。
> 当前定稿范围：**球探源库全部定稿** —— 3 张维度表（titan_competitions / titan_teams / titan_companies）+ 5 张事实表（titan_schedules / titan_euro_odds / titan_asian_odds / titan_over_under_odds / titan_analysis），共 8 张表。
> 所有表均采用**软关联（无 FOREIGN KEY）**，字段来源与转化方式见各表"字段来源与转化"小节。
> 数据来源：`titan007_pro` 爬虫仓库 `data/` 目录下的 schedule / analysis / odds 三部分（实测约 51.5 万 JSON 文件，详见"二、数据来源文件"）。
> 各表支撑的业务需求见"一、业务需求与设计依据"。

---

## 〇、设计全局原则

1. **软关联（无 FOREIGN KEY）**：所有表之间只存对方主键 ID，不建 FK 约束。查询用 `LEFT JOIN`。
2. **ID 和名都存**：事实表（schedules / analysis）冗余球队、联赛的名称列与 ID 列并存，查询免 JOIN；维度表（titan_teams / titan_competitions）作为主数据与去重依据。
3. **赔率按类型分 3 张表**：欧赔 / 亚盘 / 大小球的 `changes[]` 结构完全不同，是三个逻辑实体 → 各自平铺一张表（类比竞彩库 SPF/RQSPF/CRS 分池）。**公司用 `company_id` 列区分，不拆表**。
4. **赔率打平 + append-only**：`changes[]` 拆成行（一行 = 一场 × 一家公司 × 一个时间点的一次赔率变动快照），不做 JSONB 母表，支撑跨公司 / 跨时间 SQL 分析。赔率表是**只增不改**的历史日志：每次抓取仅插入新变化，绝不 UPDATE/DELETE 旧行；幂等靠业务唯一键（`INSERT ... ON CONFLICT DO NOTHING`）。
5. **代理主键 + 业务唯一键**：赔率表用 `id BIGSERIAL` 作无业务含义的代理主键；真正管去重/幂等的是业务唯一键（= 球探 `change_key`：`change_time + 盘口 + 赔率值`）。`change_time` 同一时刻可能存在多条真实变动（实测 40.6% 文件），故不单独做主键。
6. **恒值字段不落库**：欧赔恒 `full` 无 subtype 列；`(初盘)` 后缀与 `is_initial` 语义重复，丢弃；亚盘/大小球 `subtype` 列预置（亚盘现在恒 full，为将来 half 预留）。
7. **字符串数值一律转数值存储**：赔率/概率/kelly/返还率 → `NUMERIC`；亚盘盘口中文 → `line_raw TEXT` 保真 + `line_value NUMERIC` 映射值双列。
8. **时间标准化**：赔率 `changes[].time` 是球探原生格式（`M-d HH:MM`，无年份），导入脚本统一推断年份转 `TIMESTAMPTZ`。
9. **衍生数据整存 JSONB**：analysis 的 recent/h2h/standings/lineup 是赛前简报快照（可推导数据），整存 JSONB 保留，不拆明细表；不可推导标量（preview/tip/weather/version）用 TEXT 列。
10. **自增主键**：需要自增的列用 `BIGSERIAL`，删除行后序列值不复用、后续值不变化。已有天然主键（schedule_id 等）的列直接用业务键。
11. **索引原则**：只为**过滤/排序/连接**列建索引（主键/UNIQUE 天然覆盖）；`schedule_id` 为赔率表 UNIQUE 最左列，不额外建 `idx_*_schedule_id`；纯展示列（比分、状态、轮次名）不建索引。球队按主/客单列索引（"某队全部比赛"跨主客两侧 OR 查询，复合索引无法加速）。

---

## 一、业务需求与设计依据

> 本章汇总球探库各表**支撑的业务需求**（页面功能 / 分析场景），作为建表、建索引、冗余字段的依据。每个需求标注支撑的表与关键索引，保证"需求 → 结构"可追溯。

### 1.1 赛事中心赛程浏览（titan_schedules）

| 需求 | 说明 | 支撑结构 |
|---|---|---|
| 按联赛+赛季浏览全量赛程 | 竞彩涉及赛事的 **2015-2026 全赛季**赛程（实测 **298,076 场**），按 联赛目录 × 赛季 组织，构建赛事中心 | `idx_titan_sched_comp_season (competition_id, season)` |
| 按轮次/阶段完整展示 | 联赛按轮次（round_name）、杯赛按阶段（sub_league）分组展示：轮次 + 比赛时间 + 主队名 + 客队名 | `group_name` / `round_name` / `sub_league_id` |
| 标记是否竞彩开设 | 赛程列表每行标记该场是否竞彩开设（有对应竞彩 match_id） | 跨库对齐（见 1.1.1 取数链路） |
| 展示竞彩终赔 | 列表展示竞彩**胜平负终赔** / **让球胜平负终赔** | 跨库对齐（见 1.1.1） |
| 展示是否单关 | 列表展示该场竞彩 SPF/RQSPF 是否单关 | 跨库对齐（见 1.1.1） |
| 非竞彩场次 | 竞彩未开设的比赛**不爬详情/赔率**，列表只展示 schedule 已有数据 | schedules 全字段 |
| 跨源找比赛 | 用其他源（竞彩/Sofascore）按比赛 ID、日期、主客队找到对应球探比赛 | `idx_titan_sched_time`、主/客队单列索引 |

#### 1.1.1 赛事中心竞彩终赔取数链路（跨库对齐，不冗余到球探库）

赛事中心列表需要展示竞彩开设标记、竞彩胜平负/让球胜平负终赔、单关标记，但**球探库不冗余竞彩数据**（保持源库纯净，符合"源库存原始、归一化在聚合层"原则）。取数链路：

```
赛事中心列表查询
  1. titan_schedules 按联赛+赛季+轮次取赛程（全量 298,076 场）
  2. 经 spottery.unified_matches.source_refs 对齐：
       source_refs.titan007.schedule_id → 找到对应行的 jingcai.match_id
  3. source_refs.jingcai 存在 → 该场为竞彩开设（① 标记）
  4. 竞彩 match_id → jingcai_odds_spf / jingcai_odds_rqspf 最后快照 → 终赔（②③）
  5. 竞彩 match_id → jingcai_schedules.single_spf / single_rqspf → 单关（④）
```

- **对齐载体**：`spottery.unified_matches.source_refs`（JSONB，已含 `titan007.schedule_id` / `jingcai.match_id` 双引用），由聚合引擎生成（日期+联赛+主客队匹配），用户手动维护映射表补漏。
- **终赔口径**：`jingcai_odds_spf` / `jingcai_odds_rqspf` 中该 match_id 的 `snapshot_at` **最大**一行（临近开赛的最后赔率）。历史场次终赔固定；临赛场次随赔率更新。
- **落地方式**：终赔可经 `spottery.aggregated_odds_history`（source='jingcai'，odds_type='SPF/RQSPF'）落库，列表页直接读聚合库，避免每次跨 3 库实时取快照最大行。
- **不修改表设计**：titan007 / jingcai / spottery 三库现有表均满足，无需新增列。

### 1.2 比赛详情页（titan_schedules + titan_analysis）

| 需求 | 说明 | 支撑结构 |
|---|---|---|
| 详情覆盖范围 | **仅竞彩开设的比赛 + 指定主流联赛（五大联赛等）全赛季**完整爬取详情/赔率 | schedules PK(schedule_id) + analysis PK(schedule_id) |
| 赛前分析展示 | 赛前简报 preview、AI 分析 tip、天气 weather | analysis TEXT 列 |
| 主客近期战绩/交锋/积分榜/阵容 | 详情页展示 recent / h2h / standings / lineup | analysis JSONB 整存（衍生数据不拆表） |
| 联赛视角聚合 | 按联赛+赛季统计有分析场次 | `idx_titan_analysis_comp (competition_id, season)` |

### 1.3 欧赔走势（titan_euro_odds）

| 需求 | 说明 | 支撑结构 |
|---|---|---|
| 欧赔变化轨迹 | 每场每公司赔率/概率/返还率/凯利按时间排序展示 | UNIQUE(schedule_id, company_id, change_time, home_win, draw, away_win) |
| 跨公司对比 | 5 家公司（betfair/易胜博/Interwetten/威廉希尔/365）同场走势对比 | `idx_titan_euro_odds_comp (company_id)` |
| 时间区间筛选 | 按快照时间过滤走势段 | `idx_titan_euro_odds_time (change_time)` |
| 初盘识别 | 区分初盘与后续变动 | `is_initial` 列 |

### 1.4 亚盘走势（titan_asian_odds）

| 需求 | 说明 | 支撑结构 |
|---|---|---|
| 盘口变化轨迹 | 4 家公司（澳门/365/易胜博/明升）盘口 + 主客水位变化 | UNIQUE(schedule_id, company_id, subtype, change_time, line_raw, home_odds, away_odds) |
| 盘口双形态 | 中文盘口（line_raw 保真）+ 数值映射（line_value）双列 | `line_raw` / `line_value` |
| 即盘/早盘区分 | status（即/早） | `status` 列 |
| half 扩展预留 | 当前恒 full，列已预置 | `subtype` 列 |

### 1.5 大小球走势（titan_over_under_odds）

| 需求 | 说明 | 支撑结构 |
|---|---|---|
| 大小球变化轨迹 | 4 家公司 × full/half，盘口 + 大/小水 | UNIQUE(schedule_id, company_id, subtype, change_time, line_raw, over_odds, under_odds) |
| 即时盘口 | 比赛进行中即时盘口（score 多为空） | `score` / `status` 列 |

### 1.6 赛前分析展示（titan_analysis）

| 需求 | 说明 | 支撑结构 |
|---|---|---|
| 分析数据展示 | 按 schedule_id 查赛前简报、AI 分析、天气 | analysis PK(schedule_id) |
| 衍生数据保留 | recent/h2h/standings/lineup 原始快照 | JSONB 整存 |

### 1.7 跨源对齐

| 需求 | 说明 | 支撑结构 |
|---|---|---|
| 竞彩场次 ↔ 球探编号 | 竞彩开设比赛在 titan 的 schedule_id（用于取详情/亚盘/欧赔/大小球） | `unified_matches.source_refs`（聚合层） |
| 隐含概率对比 | 球探亚盘/欧赔隐含概率 ↔ 竞彩停售投票（核心研究点） | 聚合层归一化（源库存原始，归一化在聚合层） |
| 竞彩终赔展示 | 赛事中心列表的竞彩胜平负/让球胜平负终赔 | 竞彩源库（titan 不冗余，见 1.1.1） |

### 1.8 已确认的业务取舍

- **赛程全量、详情按需**：titan_schedules 存全量 29.8 万场（赛事中心）；analysis / 赔率仅爬竞彩开设场次 + 指定主流联赛全赛季。
- **竞彩数据不进球探库**：竞彩终赔/投票等从竞彩源库获取，球探库不冗余，保持源库纯净。
- **赔率按类型分 3 表**：欧赔/亚盘/大小球 changes 结构不同，各自平铺（公司用 company_id 区分，不拆表）。
- **append-only + 幂等**：赔率只增不改，业务唯一键 + `ON CONFLICT DO NOTHING`。
- **索引原则**：只为过滤/排序/连接列建索引（company_id / change_time / comp_season）；纯展示列不建索引；球队按主/客单列。
- **衍生数据 JSONB**：recent/h2h/standings/lineup 整存，不拆明细表。
- **schedule_id 主键 + 单一来源导入**：爬虫目录存在同名联赛改名（EFL Cup 双目录）致 956 场重复，导入时**指定单一来源目录** + 唯一键去重兜底（见"二、数据来源文件"）。

---

## 二、数据来源文件

球探爬虫数据位于 `titan007_pro/data/`，共三部分：

### 1.1 `schedule/leagues|cups/{联赛}/{赛季}.json` — 赛程

按 联赛目录 × 赛季 存储，一个文件含整赛季赛程（实测 **1,110 个文件**：leagues 422 + cups 688）。顶层：

```json
{
  "competition_id": 9, "competition_name_cn": "德乙", "competition_name_en": "2. Bundesliga",
  "season": "2015-2016", "total_matches": 310, "total_rounds": 34,
  "matches": [
    { "schedule_id": 1139085, "group_name": "R_1", "round_name": "Round 1",
      "match_time": "2015-07-25 02:30",
      "home_team_id": 493, "away_team_id": 175,
      "home_team": "杜伊斯堡", "away_team": "凯泽斯劳滕",
      "home_team_en": "MSV Duisburg", "away_team_en": "Kaiserslautern",
      "full_score": "1-3", "half_score": "0-3", "status": 0,
      "sub_league": "League", "sub_league_type": 1, "sub_league_id": 132 }
  ],
  "rounds": [ ... ]
}
```

- **全量实测**：总计 **298,076 场**（leagues 120,939 + cups 177,169），赛季范围 **2015-2026**（105 个赛季串）。`total_matches` 字段与 `matches[]` 长度一致（1,110 文件 0 处不一致）。
- `status` 语义（全量 298,076 场）：`0`=已完赛（250,146，有 full_score）、`1`=未开赛（28,692）、`-1`=延期（10,798）、`2`=进行中（4,848）、`-2~-9`/`3~9` 等少数其他状态（合计少量）。完赛占比 84%。
- **⚠️ schedule_id 重复（956 场）**：`schedule_id` 唯一 297,120、重复 956。经查为**同名联赛目录改名**导致——`EFL_Cup_(Carabao_Cup)`（旧名，10 季）与 `EFL_Cup_Carabao_Cup`（新名，12 季）重叠赛季的同一批比赛被重复存储。处理原则：**导入时指定单一来源目录**（用新名目录），`INSERT ... ON CONFLICT DO NOTHING` 或导入前去重兜底，不改表结构。
- `sub_league_id` 全局唯一（110 个，无冲突），指联赛内阶段（`League`/`Playoffs`/`Relegation Play-Off` 等）。
- `competition_id` 全局唯一（98 个，无冲突）。

### 1.2 `analysis/leagues|cups/{联赛}/{赛季}/{sid}.json` — 赛前分析

一场一文件（实测 **55,314 个**）。顶层：

```json
{
  "version": "V3", "schedule_id": 2799713,
  "home_team_id": 151, "away_team_id": 139,
  "home_team": "沙尔克04", "away_team": "柏林赫塔",
  "home_team_en": "Schalke 04", "away_team_en": "Hertha Berlin",
  "match_time": "2025-08-02 02:30", "status": 0,
  "group_name": "R_1", "round_name": "Round 1",
  "full_score": "2-1", "half_score": "2-0",
  "match_info": { "hometeam": "沙尔克04", "guestteam": "柏林赫塔",
                  "match_time": "2025-08-02 02:30", "weather": "微雨 温度：18℃～19℃" },
  "recent_home": [ { "date": "25-07-26", "comp_type": 41, "comp_name": "球会友谊",
                     "home_team": "沙尔克04", "away_team": "塞维利亚",
                     "home_score": 2, "away_score": 4, "full_score": "0-2",
                     "handicap": "-0.5", "schedule_id": 2834415, "is_home_side": true } ],
  "recent_away": [ ... ], "recent_home_home": [ ... ], "recent_away_away": [ ... ],
  "h2h": [ ... ], "standings": { ... }, "lineup": { ... },
  "preview": "长文本赛前简报", "tip": "长文本 AI 分析"
}
```

- `version` 存在 5 种（V1.5/V2/V2.5/V3/V3.1），字段分布不完全一致（`lineup` 约 82% 文件有）。
- analysis 文件**不含 competition_id**，联赛信息需由目录路径（联赛目录名）反查 `titan_competitions`。

### 1.3 `odds/{european|asian|over_under}/leagues|cups/{联赛}/{赛季}/{sid}/{cid}.json` — 赔率

一场 × 一家公司一个文件（实测 **459,333 个**：european 253,440 / asian 179,624 / over_under 26,269）。`{cid}.json` 为 full，`{cid}_half.json` 为 half。三类 changes 结构不同：

| 类型 | 文件数 | 覆盖唯一 sid | 公司（company_id） | changes[].time 数量均值 | changes 字段 |
|---|---|---|---|---|---|
| european | 253,440 | 51,585 | 2 betfair / 90 易胜博 / 104 Interwetten / 115 威廉希尔 / 281 365 | 24.2 | `time, home_win, draw, away_win, home_win_rate, draw_rate, away_win_rate, payout_rate, kelly_home, kelly_draw, kelly_away, is_initial` |
| asian | 179,624 | 41,776 | 1 澳门 / 8 365 / 12 易胜博 / 17 明升 | 37.0 | `time, line(盘口中文), home(主水), away(客水), status(即/早)` |
| over_under | 26,269 | 3,662 | 1 澳门 / 8 365 / 12 易胜博 / 17 明升 | 23.6（× full/half 两表） | `time, score(多为空), line(盘口), over(大水), under(小水), status` |

- 欧赔恒 `full`，无 `_half` 文件（已核实）；亚盘当前恒 `full`（`_half`=0，为将来预留）；大小球有 `full`+`half` 两种。
- 老版本文件（2016 年前）顶层无 `competition_id/season/match_time/source/fetched_at` 字段，需从目录路径推导，**赔率表只存 `schedule_id` 关联，不冗余联赛信息**。

### 1.4 时间格式说明

`changes[].time` 实测 4,004 条样本全部匹配 `M-d HH:MM`，其中 148 条带 `(初盘)` 后缀（如 `"12-22 18:39(初盘)"`）。无年份，需结合 `match_time` 推断（详见 titan_euro_odds 表说明）。

---

## 三、titan_competitions — 联赛维度表

> 98 行。来源：`schedule/leagues|cups/{联赛}/{赛季}.json` 顶层 `competition_id / competition_name_cn / competition_name_en`，按 `leagues`/`cups` 目录推导 `is_cup`。

```sql
CREATE TABLE titan_competitions (
    competition_id   INTEGER PRIMARY KEY,   -- 球探联赛编码
    name_cn          TEXT,                  -- competition_name_cn（德乙）
    name_en          TEXT,                  -- competition_name_en（2. Bundesliga）
    is_cup           BOOLEAN NOT NULL,      -- leagues / cups 目录推导
    updated_at       TIMESTAMPTZ DEFAULT now()
);
```

**说明**：`competition_id` 全局唯一（98 个，无同名冲突），可直接做主键。`name_cn` 可能出现空（部分杯赛无中文名）。

---

## 四、titan_teams — 球队维度表

> 行数由全量赛程提取（估计数千行）。来源：`schedule` 文件 `matches[].home_team_id / away_team_id` 与对应中文/英文名。

```sql
CREATE TABLE titan_teams (
    team_id      INTEGER PRIMARY KEY,       -- 球探球队编码
    name_cn      TEXT,                      -- home_team / away_team 中文名
    name_en      TEXT,                      -- home_team_en / away_team_en 英文名
    updated_at   TIMESTAMPTZ DEFAULT now()
);
```

**说明**：导入时遍历全量赛程收集 `home_team_id / away_team_id` 去重入库。同一 `team_id` 在不同赛季可能名称变化（如更名），`updated_at` 记录最后更新。

---

## 五、titan_companies — 公司维度表

> 9 行。来源：`odds/*/{联赛}/{赛季}/{sid}/{cid}.json` 的 `company_id / company_name`。

```sql
CREATE TABLE titan_companies (
    company_id       INTEGER PRIMARY KEY,   -- 球探公司编码
    name             TEXT,                  -- company_name（betfair / 澳门 / 365 / ...）
    odds_category    TEXT[] NOT NULL,       -- ['european'] / ['asian','over_under']（一家可属多类）
    updated_at       TIMESTAMPTZ DEFAULT now()
);
```

**说明**：
- 亚盘与大小球共用同一公司集（1/8/12/17），欧赔独立（2/90/104/115/281），无重叠。
- `odds_category` 用 `TEXT[]` 数组承载多值（数据仅 9 行，不拆关联表）。

| company_id | name | odds_category |
|---|---|---|
| 1 | 澳门 | ['asian','over_under'] |
| 8 | 365 | ['asian','over_under'] |
| 12 | 易胜博 | ['asian','over_under'] |
| 17 | 明升 | ['asian','over_under'] |
| 2 | betfair | ['european'] |
| 90 | 易胜博 | ['european'] |
| 104 | Interwetten | ['european'] |
| 115 | 威廉希尔 | ['european'] |
| 281 | 365 | ['european'] |

---

## 六、titan_schedules — 赛程主表

> 一场一行（实测 **297,120 行**，去重后；重复来源见"二、1.1"）。来源：`schedule/leagues|cups/{联赛}/{赛季}.json` 的 `matches[]`，联赛/赛季信息取文件顶层。

```sql
CREATE TABLE titan_schedules (
    schedule_id         INTEGER PRIMARY KEY,   -- matches[].schedule_id
    competition_id      INTEGER NOT NULL,      -- 顶层 competition_id（冗余，查询入口）
    competition_name_cn TEXT,                  -- 顶层 competition_name_cn（冗余）
    competition_name_en TEXT,                  -- 顶层 competition_name_en（冗余）
    season              TEXT NOT NULL,         -- 顶层 season
    is_cup              BOOLEAN NOT NULL,      -- leagues / cups 目录推导
    group_name          TEXT,                  -- matches[].group_name
    round_name          TEXT,                  -- matches[].round_name
    sub_league_id       INTEGER,               -- matches[].sub_league_id（阶段编码，110 值）
    match_time          TIMESTAMPTZ NOT NULL,  -- matches[].match_time（"2015-07-25 02:30"）
    home_team_id        INTEGER,               -- matches[].home_team_id
    away_team_id        INTEGER,
    home_team           TEXT,                  -- matches[].home_team（冗余中文名）
    away_team           TEXT,
    home_team_en        TEXT,                  -- matches[].home_team_en（冗余英文名）
    away_team_en        TEXT,
    full_score          TEXT,                  -- matches[].full_score（"1-3"）
    half_score          TEXT,                  -- matches[].half_score（"0-3"）
    status              INTEGER,               -- 0=已完赛 1=未开赛 -1=延期 2=进行中
    scraped_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_titan_sched_comp_season ON titan_schedules (competition_id, season);
CREATE INDEX idx_titan_sched_time        ON titan_schedules (match_time);
CREATE INDEX idx_titan_sched_home_team   ON titan_schedules (home_team_id);
CREATE INDEX idx_titan_sched_away_team   ON titan_schedules (away_team_id);
```

> **索引设计说明**（原则见"〇、11"）：
> - `idx_titan_sched_comp_season (competition_id, season)`：支撑赛事中心按联赛+赛季浏览（R1 核心）。
> - `idx_titan_sched_time (match_time)`：支撑按比赛日/时间区间筛选。
> - `idx_titan_sched_home_team` / `idx_titan_sched_away_team`（**单列拆分**）："某队全部比赛"需 `home_team_id = 甲 OR away_team_id = 甲` 跨主客两侧 OR 查询，复合索引 `(home_team_id, away_team_id)` 无法加速（前缀只能命中一列），故拆两个单列索引（与 Sofascore 库一致）。
> - **不建索引**：`full_score`/`half_score`/`status`/`group_name`/`round_name`/`competition_name_*`/`home_team`/`away_team` 等纯展示列。

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| schedule_id | `matches[].schedule_id` | 原样 | 主键 |
| competition_id | 顶层 `competition_id` | 原样 | 冗余 |
| competition_name_cn | 顶层 `competition_name_cn` | 原样 | 冗余 |
| competition_name_en | 顶层 `competition_name_en` | 原样 | 冗余 |
| season | 顶层 `season` | 原样 | 赛事赛季属性，非传递依赖 |
| is_cup | 目录 `leagues`/`cups` | 推导 | |
| group_name / round_name | `matches[]` | 原样 | |
| sub_league_id | `matches[].sub_league_id` | 原样 | 全局唯一阶段编码，不建维度表 |
| match_time | `matches[].match_time` | "2015-07-25 02:30" → TIMESTAMPTZ | 北京时间 naive |
| home_team_id / away_team_id | `matches[]` | 原样 | |
| home_team / away_team | `matches[]` | 原样 | 冗余中文名 |
| home_team_en / away_team_en | `matches[]` | 原样 | 冗余英文名 |
| full_score / half_score | `matches[]` | 原样 | 字符串保真 |
| status | `matches[].status` | 原样 | 语义见上 |

---

## 七、titan_euro_odds — 欧赔快照表

> 一行 = 一场 × 一家公司 × 一个时间点的一次赔率变动。来源：`odds/european/.../{sid}/{cid}.json` 的 `changes[]`。欧赔恒 `full`，**无 subtype 列**（已确认不存在半场赔率）。
> **append-only**：只插入新变动，不 UPDATE/DELETE 旧行；幂等靠业务唯一键。
> 行数估算：253,440 文件 × avg 24.2 ≈ 613 万行。

```sql
CREATE TABLE titan_euro_odds (
    id             BIGSERIAL PRIMARY KEY,   -- 代理主键（无业务含义）
    schedule_id    INTEGER NOT NULL,        -- 关联 titan_schedules
    company_id     INTEGER NOT NULL,        -- 关联 titan_companies
    change_time    TIMESTAMPTZ NOT NULL,    -- changes[].time 推断年份后转化
    home_win       NUMERIC,                 -- 主胜赔率
    draw           NUMERIC,                 -- 平赔率
    away_win       NUMERIC,                 -- 客胜赔率
    home_win_rate  NUMERIC,                 -- 胜率（37.89 → 0.3789）
    draw_rate      NUMERIC,
    away_win_rate  NUMERIC,
    payout_rate    NUMERIC,                 -- 返还率
    kelly_home     NUMERIC,                 -- 凯利指数
    kelly_draw     NUMERIC,
    kelly_away     NUMERIC,
    is_initial     BOOLEAN,                 -- 初盘标记（changes[].is_initial 或 (初盘) 后缀）
    UNIQUE (schedule_id, company_id, change_time, home_win, draw, away_win)
);
CREATE INDEX idx_titan_euro_odds_comp  ON titan_euro_odds (company_id);
CREATE INDEX idx_titan_euro_odds_time  ON titan_euro_odds (change_time);
```

> **唯一键 = 球探 merge 去重键**（`odds_store.change_key`）：`(time, home_win, draw, away_win)` 已存在则跳过。同一 `change_time` 多条真实变动（赔率值不同）各自保留。
> 写入：`INSERT ... ON CONFLICT DO NOTHING`（批量，一次事务）。

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| id | 自增 | BIGSERIAL | 代理主键 |
| schedule_id | 顶层 `schedule_id` | 原样 | |
| company_id | 顶层 `company_id` | 原样 | |
| change_time | `changes[].time` | `M-d HH:MM` → TIMESTAMPTZ（年份推断，见下） | 同刻多条合法 |
| home_win / draw / away_win | `changes[]` | int/float 均接受 → NUMERIC | 唯一键一部分 |
| *_rate / payout_rate | `changes[]` | 百分比数值 → NUMERIC（0.3789） | 原值为 37.89 保留 |
| kelly_* | `changes[]` | → NUMERIC | |
| is_initial | `changes[].is_initial` | 布尔 | 旧数据无此键时按 `(初盘)` 后缀推导 |

**change_time 年份推断规则**（导入脚本 `migrator.py` 实现）：
1. 取该场 `match_time` 的年份 `Y` 与月份 `M0`。
2. 解析 `changes[].time` 为 `M-D HH:MM`（`M` 可为 1~2 位）。
3. 若 `M > M0`，说明跨年（如 1 月比赛记录到上一年 12 月），年份取 `Y-1`；否则取 `Y`。
4. 后缀 `(初盘)` 丢弃（语义由 `is_initial` 承载）。

---

## 八、titan_asian_odds — 亚盘快照表

> 一行 = 一场 × 一家公司 × 一个时间点的一次盘口变动。来源：`odds/asian/.../{sid}/{cid}.json`。4 家公司。
> 当前恒 `full`（实测 `_half` 文件 = 0），但**按需求预置 subtype 列**，为将来 half 预留。
> **append-only**：只插入新变动，不 UPDATE/DELETE 旧行；幂等靠业务唯一键。
> 行数估算：179,624 文件 × avg 37 ≈ 665 万行。

```sql
CREATE TABLE titan_asian_odds (
    id             BIGSERIAL PRIMARY KEY,   -- 代理主键（无业务含义）
    schedule_id    INTEGER NOT NULL,
    company_id     INTEGER NOT NULL,
    subtype        TEXT NOT NULL DEFAULT 'full',   -- 'full' 当前恒值，为 half 预留
    change_time    TIMESTAMPTZ NOT NULL,           -- changes[].time 推断年份后转化
    line_raw       TEXT NOT NULL,                  -- 盘口中文原串（"平手/半球"、"受让半球"）
    line_value     NUMERIC,                        -- 盘口映射数值（0.25 / -0.5 / ...）
    home_odds      NUMERIC,                        -- 主水
    away_odds      NUMERIC,                        -- 客水
    status         TEXT,                           -- changes[].status（"即" / "早"）
    UNIQUE (schedule_id, company_id, subtype, change_time, line_raw, home_odds, away_odds)
);
CREATE INDEX idx_titan_asian_odds_comp ON titan_asian_odds (company_id);
CREATE INDEX idx_titan_asian_odds_time ON titan_asian_odds (change_time);
```

> **唯一键 = 球探 merge 去重键**（`odds_store.change_key`）：`(time, line, home, away, status)` 已存在则跳过。同一 `change_time` 多条真实变动（赔率值不同）各自保留。
> 写入：`INSERT ... ON CONFLICT DO NOTHING`（批量，一次事务）。

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| id | 自增 | BIGSERIAL | 代理主键 |
| schedule_id / company_id | 顶层 | 原样 | |
| subtype | 文件 `{cid}.json` / `{cid}_half.json` | full / half | 当前恒 full |
| change_time | `changes[].time` | 年份推断 → TIMESTAMPTZ | 同欧赔规则 |
| line_raw | `changes[].line` | 原样 | 保真 |
| line_value | `changes[].line` | 映射表/规则 → NUMERIC | 见"十、亚盘盘口映射" |
| home_odds / away_odds | `changes[].home / away` | → NUMERIC | 主水/客水 |
| status | `changes[].status` | 原样 | 即盘/早盘 |

**line_value 映射失败处理**：未知盘口优先按规则解析，仍失败则置 NULL 并记 warning 日志，人工补入映射 dict 后重跑该场（详见"十"）。

---

## 九、titan_over_under_odds — 大小球快照表

> 一行 = 一场 × 一家公司 × full/half × 一个时间点的一次盘口变动。来源：`odds/over_under/.../{sid}/{cid}.json`（full）+ `{cid}_half.json`（half）。4 家公司。
> **append-only**：只插入新变动，不 UPDATE/DELETE 旧行；幂等靠业务唯一键。
> 行数估算：26,269 文件 × avg 23.6 ≈ 62 万行。

```sql
CREATE TABLE titan_over_under_odds (
    id             BIGSERIAL PRIMARY KEY,   -- 代理主键（无业务含义）
    schedule_id    INTEGER NOT NULL,
    company_id     INTEGER NOT NULL,
    subtype        TEXT NOT NULL,              -- 'full' / 'half'
    change_time    TIMESTAMPTZ NOT NULL,       -- changes[].time 推断年份后转化
    score          TEXT,                       -- changes[].score（多为空，即时段位）
    line_raw       TEXT NOT NULL,              -- 盘口（"2.5" / "2/2.5" / "1"）
    over_odds      NUMERIC,                    -- 大水
    under_odds     NUMERIC,                    -- 小水
    status         TEXT,                       -- changes[].status（"即" / "早"）
    UNIQUE (schedule_id, company_id, subtype, change_time, line_raw, over_odds, under_odds)
);
CREATE INDEX idx_titan_ou_odds_comp ON titan_over_under_odds (company_id);
CREATE INDEX idx_titan_ou_odds_time ON titan_over_under_odds (change_time);
```

> **唯一键 = 球探 merge 去重键**（`odds_store.change_key`）：`(time, line, big, small, status)` 已存在则跳过。同一 `change_time` 多条真实变动（赔率值不同）各自保留。
> 写入：`INSERT ... ON CONFLICT DO NOTHING`（批量，一次事务）。

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| id | 自增 | BIGSERIAL | 代理主键 |
| schedule_id / company_id | 顶层 | 原样 | |
| subtype | 文件 `{cid}.json` / `{cid}_half.json` | full / half | |
| change_time | `changes[].time` | 年份推断 → TIMESTAMPTZ | 同欧赔规则 |
| score | `changes[].score` | 原样 | 多为空 |
| line_raw | `changes[].line` | 原样 | |
| over_odds / under_odds | `changes[].over / under` | → NUMERIC | 大水/小水 |
| status | `changes[].status` | 原样 | |

---

## 十、亚盘盘口映射（line → line_value）

### 10.1 标准盘口表（0.25 步进，-7.0 ~ +7.0）

全量扫描 179,624 个亚盘文件得到 63 个唯一值，全部落在 **0.25 步进网格** 上。`受让 X` 表示主队受让 → **负值**；无前缀为主队让球 → **正值**。标准 57 值：

| line_raw | line_value | line_raw | line_value |
|---|---|---|---|
| 平手 | 0 | 受让平手/半球 | -0.25 |
| 平手/半球 | 0.25 | 受让半球 | -0.5 |
| 半球 | 0.5 | 受让半球/一球 | -0.75 |
| 半球/一球 | 0.75 | 受让一球 | -1 |
| 一球 | 1 | 受让一球/球半 | -1.25 |
| 一球/球半 | 1.25 | 受让球半 | -1.5 |
| 球半 | 1.5 | 受让球半/两球 | -1.75 |
| 球半/两球 | 1.75 | 受让两球 | -2 |
| 两球 | 2 | 受让两球/两球半 | -2.25 |
| 两球/两球半 | 2.25 | 受让两球半 | -2.5 |
| 两球半 | 2.5 | 受让两球半/三球 | -2.75 |
| 两球半/三球 | 2.75 | 受让三球 | -3 |
| 三球 | 3 | 受让三球/三球半 | -3.25 |
| 三球/三球半 | 3.25 | 受让三球半 | -3.5 |
| 三球半 | 3.5 | 受让三球半/四球 | -3.75 |
| 三球半/四球 | 3.75 | 受让四球 | -4 |
| 四球 | 4 | 受让四球/四球半 | -4.25 |
| 四球/四球半 | 4.25 | 受让四球半 | -4.5 |
| 四球半 | 4.5 | 受让四球半/五球 | -4.75 |
| 四球半/五球 | 4.75 | 受让五球 | -5 |
| 五球 | 5 | 受让五球/五球半 | -5.25 |
| 五球/五球半 | 5.25 | 受让五球半 | -5.5 |
| 五球半 | 5.5 | 受让五球半/六球 | -5.75 |
| 五球半/六球 | 5.75 | 受让六球 | -6 |
| 六球 | 6 | 受让六球/六球半 | -6.25 |
| 六球/六球半 | 6.25 | 受让六球半 | -6.5 |
| 六球半 | 6.5 | 受让六球半/七球 | -6.75 |
| 六球半/七球 | 6.75 | 受让七球 | -7 |
| 七球 | 7 | | |

### 10.2 简写变体（球探数据不规范写法，语义同标准值）

| line_raw | line_value | 等价标准盘口 |
|---|---|---|
| 平/半 | 0.25 | 平手/半球 |
| 半/一 | 0.75 | 半球/一球 |
| 一/球半 | 1.25 | 一球/球半 |
| 受平/半 | -0.25 | 受让平手/半球 |
| 受半球 | -0.5 | 受让半球 |
| 受半/一 | -0.75 | 受让半球/一球 |

### 10.3 映射实现（migrator.py 常量 dict + 规则兜底）

```python
# 1) 精确映射 dict：标准 57 值 + 简写 6 值，全量预置
LINE_VALUE_DICT = { ... }

def asian_line_to_value(line: str) -> float | None:
    # 2) 精确匹配
    if line in LINE_VALUE_DICT:
        return LINE_VALUE_DICT[line]
    # 3) 规则解析（提前量）：
    #    "受让" 前缀 → 去掉后按正值取负
    #    "X/Y" → 取 X 与 Y 的中间值（如 三球/三球半 → 3.25；两球半 → 2.5）
    #    "平手" → 0
    # 4) 仍失败 → 返回 None（记 warning，人工补 dict 后重跑）
```

**提前量设计**：dict 初始化即覆盖 `-7.0 ~ +7.0` 全网格（0.25 步进 57 值）+ 6 简写，而非仅列 63 个观测值。球探若出现网格内的新措辞，规则 3 能解析；超出网格（如 8 球）由规则推算；完全无法解析才 NULL + 告警。

---

## 十一、titan_analysis — 赛前分析表

> 一场一行（55,314 行）。来源：`analysis/leagues|cups/{联赛}/{赛季}/{sid}.json`。

```sql
CREATE TABLE titan_analysis (
    schedule_id     INTEGER PRIMARY KEY,       -- 文件名 = schedule_id
    competition_id  INTEGER,                   -- 目录联赛名反查 titan_competitions（冗余）
    competition_name_en TEXT,                  -- 目录联赛名（冗余）
    season          TEXT,                      -- 目录赛季（冗余）
    home_team_id    INTEGER,                   -- 顶层 home_team_id（冗余）
    away_team_id    INTEGER,
    home_team       TEXT,                      -- 顶层 home_team（冗余）
    away_team       TEXT,
    match_time      TIMESTAMPTZ,               -- 顶层 match_time（冗余）
    version         TEXT,                      -- 顶层 version
    weather         TEXT,                      -- match_info.weather
    preview         TEXT,                      -- 顶层 preview 赛前简报
    tip             TEXT,                      -- 顶层 tip AI 分析
    recent_home     JSONB,                     -- 主队近期战绩数组（衍生，整存）
    recent_away     JSONB,                     -- 客队近期战绩数组
    h2h             JSONB,                     -- 交锋记录数组
    standings       JSONB,                     -- 主客队积分榜快照
    lineup          JSONB,                     -- 伤停阵容（82% 文件有）
    scraped_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_titan_analysis_comp ON titan_analysis (competition_id, season);
```

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| schedule_id | 文件名 | 原样 | 主键 |
| competition_id | 目录联赛名 → titan_competitions | 反查 | 文件本身无 |
| competition_name_en | 目录联赛名 | 原样 | 冗余 |
| season | 目录赛季 | 原样 | 冗余 |
| home_team_id / away_team_id | 顶层 | 原样 | 冗余 |
| home_team / away_team | 顶层 | 原样 | 冗余 |
| match_time | 顶层 | → TIMESTAMPTZ | 冗余 |
| version | 顶层 `version` | 原样 | V1.5~V3.1 |
| weather | `match_info.weather` | 去 HTML 实体（&nbsp;） | |
| preview | 顶层 `preview` | 原样 | |
| tip | 顶层 `tip` | 原样 | |
| recent_home / recent_away / h2h / standings / lineup | 顶层对应区块 | 整存 JSONB | 衍生数据 |

**为什么衍生数据整存 JSONB 而不拆明细表**：
- `recent_*` / `h2h` 引用的比赛在 `titan_schedules` 已有，可自算，落库属冗余。
- `standings` 可由积分计算，`lineup` 是伤停快照（信息可能滞后于实际，保留原始快照价值有限）。
- 五种 version 字段分布不同（lineup 仅 82% 有），拆表需大量 NULL 列。
- 与竞彩库"recentResults/headToHead/standings 确认不建明细表"先例一致。

---

## 十二、不落库/不建表清单

| 区块/字段 | 来源 | 不落库原因 |
|---|---|---|
| `changes[].time` 原生串与 `(初盘)` 后缀 | odds | 已转 TIMESTAMPTZ；后缀与 is_initial 语义重复 |
| `changes[]` 数组下标 seq | odds | 由抓取顺序决定非数据属性，跨抓取漂移；不建列，排序用 change_time |
| 欧赔 `odds_subtype` | odds/european | 恒 full，无半场赔率 |
| 亚盘 `odds_subtype` | odds/asian | 当前恒 full（列已预置，将来 half 写入） |
| `rounds[]` | schedule | 与 `matches[]` 冗余（group/round 已入 schedules） |
| `total_matches` / `total_rounds` | schedule | 可推导 |
| `titan_sub_leagues` 维度表 | schedule | 仅 110 行 × 2 属性，schedules 存 sub_league_id 即可 |
| `titan_seasons` 维度表 | schedule | season 是赛事赛季直接属性，非传递依赖 |
| analysis 的 `recent_home_home` / `recent_away_away` | analysis | 与 recent_home/away 重复（仅过滤主/客场），整存 JSONB 内保留 |
| analysis 的 `full_score` / `half_score` / `status` / `group_name` 等 | analysis | 已入 titan_schedules，analysis 表不重复存 |
| 赔率表冗余联赛/球队信息 | odds | 赔率查询总走 schedule_id 入口，冗余无益 |

---

## 十三、行数估算

基于实测文件数（459,333 个 odds / 55,314 个 analysis / 1,110 个 schedule）与"详情/赔率仅爬竞彩开设场次 + 指定主流联赛"口径：

| 表 | 计算依据 | 行数（实测） |
|---|---|---|
| titan_schedules | 全量赛程去重（298,076 − 956 重复） | 297,120 |
| titan_analysis | 有分析文件数 | 55,314 |
| titan_euro_odds | 253,440 文件 × 24.2 快照 | ≈ 6,133,000 |
| titan_asian_odds | 179,624 文件 × 37.0 | ≈ 6,646,000 |
| titan_over_under_odds | 26,269 文件 × 23.6 | ≈ 620,000 |
| titan_competitions | 联赛 | 98 |
| titan_companies | 公司 | 9 |
| titan_teams | 全量赛程球队去重 | 数千 |
| **合计** | | **≈ 1,410 万行** |

> **规模说明**：
> - 赛程 29.8 万场为**全量**（赛事中心展示用）；但详情/赔率只覆盖竞彩开设场次 + 主流联赛（欧赔 51,585 场 / 亚盘 41,776 场 / 大小球 3,662 场），故赔率三表以实际文件数为准，而非"全量赛程 × 公司数"。
> - 若未来补全竞彩全部 7 万场 + 五大联赛全量，欧赔/亚盘行数会增长（约 1.5~2 倍）；大小球覆盖基数小，增长有限。

**查询效率**：赔率表用 `id` 主键 + 业务唯一键（含 `schedule_id` 前缀），按场次过滤命中唯一键前缀索引，毫秒级；`company_id` / `change_time` 单列索引支撑跨公司对比与时间区间筛选。PG 千万级 append-only 表无压力，**第一版不做表分区**（详见"十四、增量写入与一致性设计"）。

---

## 十四、增量写入与一致性设计

> 球探爬虫对赔率是**高频赛前更新**：live 管道每 5 分钟 tick 一次（P0 近赛 3 分钟），每场每公司多次抓取。本节说明表设计如何支撑这种模式。

### 14.1 写入模式：append-only + 幂等

赔率三表（titan_euro_odds / titan_asian_odds / titan_over_under_odds）是**只增不改的历史日志**：

| 阶段 | 方式 | 说明 |
|---|---|---|
| 历史回填 | `COPY` 批量插入，一次事务 | 一次性导入 51.5 万 JSON |
| live 增量 | `INSERT ... ON CONFLICT DO NOTHING`，批量一次事务 | 每场每公司每次抓取 |

**关键**：爬虫抓到的 `changes[]` 是**全量快照**（从初盘到当前的所有变动），每次只有末尾 1~3 条是"未见过"的新变动。靠业务唯一键去重：

```sql
-- 例：亚盘每次抓取批量写入
INSERT INTO titan_asian_odds (schedule_id, company_id, subtype, change_time, line_raw, line_value, home_odds, away_odds, status)
VALUES (…), (…), (…)                                    -- 仅最新未见过的行
ON CONFLICT (schedule_id, company_id, subtype, change_time, line_raw, home_odds, away_odds)
DO NOTHING;
```

- 唯一键 = 球探 merge 去重键（`odds_store.change_key`），与现有 `merge_odds_changes` 语义**完全等价**
- 已存在的行自动跳过，**写入量从全量 37 行降到实际新增行数**
- 同一 `change_time` 多条真实变动（赔率值不同）各自保留，不误合并

### 14.2 为什么不做全量重写

| 对比 | 全量重写（DELETE + INSERT） | 增量 append |
|---|---|---|
| 单次写入量 | 删 37 + 插 37 | 只插实际新增 1~3 行 |
| MVCC 死元组 | 海量 | 几乎为零 |
| autovacuum | 追不上 → 表膨胀、索引退化 | 压力极小 |
| 一致性 | 删旧插新有半更新窗口 | 无删除，天然无半更新 |
| 索引 | 反复重排 | B-tree 尾部追加 O(log n) |

### 14.3 一致性保证

| 问题 | 解法 |
|---|---|
| 重复行 | 业务唯一键 + `ON CONFLICT DO NOTHING`，幂等 |
| 半更新状态 | 一次抓取的全部新行放**一个事务** |
| live 与回填并发 | 双方都幂等 append，无互斥需求 |
| 读一致性 | 聚合引擎连源库用只读事务（架构已定） |

### 14.4 更新协议（live.py 改造）

`_process_match_odds` 从「load → merge → save 整文件」改为「对新 changes 批量 INSERT」：

```
旧: merged = merge_odds_changes(existing, new) → save_record(整文件)
新: INSERT ... ON CONFLICT DO NOTHING（新 changes 全部行，一个事务）
```

> 双写过渡期（PG + JSON 并行）：JSON 侧保留原 merge 语义，PG 侧走增量 INSERT，全量对比验证后关 JSON。

### 14.5 分区说明

**第一版不做表分区**。赔率查询总走 `schedule_id` 唯一键索引（看某场走势），与表大小无关；3000 万行 append-only 表 PG 完全撑得住。将来若出现"按比赛时间大范围分析"慢查询或表过亿，再 `ALTER TABLE ... PARTITION BY RANGE (change_time)` 按赛季分区，并预创建下赛季分区。

---

## 十五、titan_jc_schedule — 竞彩开设赛程镜像

> **定位**：竞彩（sporttery/jingcai）在球探侧的赛程镜像，用 **titan `sid`** 标识同一场比赛，支撑 §1.1"标记该场是否竞彩开设"。与 §1.8"竞彩赔率不进球探库"**不冲突**：本表存的是赛程与比分（titan sid 视角），非竞彩赔率/投票（后者仍从竞彩源库取）。
> **来源**：`jc/history/{date}.json`（3,869 个文件，70,337 场，`sid` 全局唯一）。该目录为爬虫新爬的竞彩历史赛程（titan 格式），`match_map.json`（titan_sid ↔ jc_match_id）与 `team_map.json` 是**派生产物，不落库**；跨源对齐可用 `(business_date, match_num)` 与 `jingcai_schedules` JOIN（实测 300 抽样命中 297）。
> **软关联**：`sclass_id` → titan_competitions；`home_team_id / away_team_id` → titan_teams；`(business_date, match_num)` → jingcai_schedules（跨库）。

```sql
CREATE TABLE titan_jc_schedule (
    sid             INTEGER PRIMARY KEY,   -- titan 比赛 id（history 全局唯一）
    business_date   DATE NOT NULL,         -- 竞彩销售日
    kickoff_time    TIMESTAMP,             -- kickoff（"2026-08-01 18:30"）
    status          SMALLINT,              -- -1 完场；-10 异常（12 场）
    match_num       TEXT,                  -- "周六001"（= 竞彩编号）
    sclass_id       INTEGER,               -- 软关联 titan_competitions（134 个）
    sub_id          INTEGER,               -- 阶段/子联赛
    home_team_id    INTEGER,               -- 软关联 titan_teams
    away_team_id    INTEGER,
    home_team       TEXT,                  -- 简体名
    away_team       TEXT,
    home_team_en    TEXT,                  -- 英文名
    away_team_en    TEXT,
    full_score      TEXT,                  -- "0-3"
    half_score      TEXT,                  -- "0-1"
    home_score      INTEGER,               -- 由 full_score "0-3" 拆出
    away_score      INTEGER,
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_titan_jc_schedule_business_date ON titan_jc_schedule (business_date);
CREATE INDEX idx_titan_jc_schedule_sclass ON titan_jc_schedule (sclass_id);
```

**字段来源与转化**：

| 列 | JSON 来源 | 类型转换/口径 | 备注 |
|---|---|---|---|
| sid | `matches[].sid` | 原样 | 主键，全局唯一 |
| business_date | `matches[].business_date`（= 文件日期） | 字符串 → DATE | 销售日 |
| kickoff_time | `matches[].kickoff` | "2026-08-01 18:30" → TIMESTAMP | 开赛时间 |
| status | `matches[].status` | 原样 | -1 完场 / -10 异常 |
| match_num | `matches[].match_num` | 原样 | 竞彩编号，跨源键 |
| sclass_id | `matches[].sclass_id` | 原样 | 软关联赛事 |
| sub_id | `matches[].sub_id` | 原样 | |
| home_team_id / away_team_id | `matches[].home_team_id / away_team_id` | 原样 | |
| home_team / away_team | `matches[].home_team / away_team` | 原样 | 简体 |
| home_team_en / away_team_en | `matches[].home_team_en / away_team_en` | 原样 | 英文（繁体 tw 不落库） |
| full_score / half_score | `matches[].full_score / half_score` | 原样 | 字符串保真 |
| home_score / away_score | `matches[].full_score` | "0-3" → 0 / 3 | 拆出整型 |

**说明**：`status` 语义为竞彩侧（-1 完场、-10 异常），与 §六 titan_schedules 的 status（0/1/-1/2）**不同**，两表各自独立，勿混用。`updated_at` 记录导入/刷新时间。
