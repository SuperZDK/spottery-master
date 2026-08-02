# 数据库表说明文档

> 本文档描述单 PG 实例（容器 `spottery-pg`，端口 5432）内 4 个数据库的全部表结构。
>
> **状态说明**：
> - **Sofascore 库模型尚未定稿**，本文档仅记录当前草案（与 architecture.md 7.1 一致），后续按定稿更新。
> - 字段的"JSON 来源"列标注数据取自原始 JSON 的哪个路径；尚未确认的标 `待补充`。
> - 竞彩库沿用现有 `spottery_pro/backend/app/models/jingcai.py` 的 18 张表结构（含 `jingcai_import_files`），与 architecture.md 7.2 列出的 17 张略有出入（后者未含导入文件表），以本表为准。

---

## 一、数据库总览

```
PostgreSQL 18（容器 spottery-pg，端口 5432）
├── spottery   ← 平台聚合库（api 读/写：聚合结果 + 跨源映射表 + 平台业务表）
├── sofascore  ← 源库（crawler-sofascore 写，api 只读）
├── jingcai    ← 源库（crawler-jingcai 写，api 只读）
└── titan007   ← 源库（crawler-titan007 写，api 只读）
```

| 角色                | 可访问库                       | 权限                                                        |
| ------------------- | ------------------------------ | ----------------------------------------------------------- |
| `crawler_sofascore` | sofascore                      | 读写                                                        |
| `crawler_jingcai`   | jingcai                        | 读写                                                        |
| `crawler_titan007`  | titan007                       | 读写                                                        |
| `api_service`       | spottery                       | 读写                                                        |
|                     | sofascore / jingcai / titan007 | **只读**（连接时 `SET default_transaction_read_only = on`） |
| `postgres`          | 全部                           | 超级管理员（初始化）                                        |

---

## 二、spottery 库（平台聚合库）

### 2.1 跨源映射表（对应 architecture.md 第八章）

#### `cross_source_leagues` — 联赛跨源映射

> JSON 来源：`mapping/league_mapping.json`，经 `POST /internal/mapping/upload` upsert 入库。

| 字段名            | 类型       | 中文说明                                     | JSON 来源 |
| ----------------- | ---------- | -------------------------------------------- | --------- |
| `id`              | SERIAL PK  | 自增主键                                     | —         |
| `standard_name`   | TEXT UNIQUE| 标准中文简称（如 "英超"）                    | `standard_name` |
| `standard_name_cn`| TEXT       | 标准中文全称                                 | `standard_name_cn` |
| `standard_name_en`| TEXT       | 标准英文名                                   | `standard_name_en` |
| `source_ids`      | JSONB      | 各源 ID，如 `{"sofascore":17,"titan007":36,"jingcai":142}` | `source_ids` |
| `source_names`    | JSONB      | 各源名称，如 `{"sofascore":"英超",...}`      | `source_names` |
| `maintained_by`   | TEXT       | 维护人（默认 `manual`）                      | 上传时指定 |
| `updated_at`      | TIMESTAMPTZ| 更新时间                                     | 系统写入 |

#### `cross_source_teams` — 球队跨源映射

> JSON 来源：`mapping/standard_names.json`。

| 字段名            | 类型       | 中文说明                                     | JSON 来源 |
| ----------------- | ---------- | -------------------------------------------- | --------- |
| `id`              | SERIAL PK  | 自增主键                                     | —         |
| `standard_name`   | TEXT UNIQUE| 标准英文名（如 "Liverpool"）                 | `standard_name` |
| `standard_name_cn`| TEXT       | 标准中文名（如 "利物浦"）                    | `standard_name_cn` |
| `source_names`    | JSONB      | 各源变体名数组，如 `{"sofascore":["Liverpool FC"],"jingcai":["利物浦"]}` | `source_names` |
| `source_ids`      | JSONB      | 各源 ID，如 `{"sofascore":44,"titan007":205,"jingcai":1234}` | `source_ids` |
| `maintained_by`   | TEXT       | 维护人（默认 `manual`）                      | 上传时指定 |
| `updated_at`      | TIMESTAMPTZ| 更新时间                                     | 系统写入 |

索引：`source_names` 上 GIN 索引（`cross_source_leagues` / `cross_source_teams` 各一个）。

### 2.2 平台业务表（沿用现有 `spottery_pro/backend/app/models/` 结构）

#### `leagues` — 平台联赛

| 字段名      | 类型   | 中文说明     | JSON 来源 |
| ----------- | ------ | ------------ | --------- |
| `id`        | INTEGER PK | 自增主键 | — |
| `name`      | TEXT NOT NULL | 联赛名 | 待补充 |
| `country`   | TEXT   | 国家         | 待补充 |
| `season`    | TEXT   | 赛季         | 待补充 |
| `logo_url`  | TEXT   | 图标 URL     | 待补充 |

#### `teams` — 平台球队

| 字段名       | 类型   | 中文说明     | JSON 来源 |
| ------------ | ------ | ------------ | --------- |
| `id`         | INTEGER PK | 自增主键 | — |
| `name`       | TEXT NOT NULL | 球队名 | 待补充 |
| `short_name` | TEXT   | 简称         | 待补充 |
| `logo_url`   | TEXT   | 图标 URL     | 待补充 |
| `league_id`  | INTEGER FK→leagues | 所属联赛 | 待补充 |
| `country`    | TEXT   | 国家         | 待补充 |

#### `team_aliases` — 球队别名（源名→标准队）

| 字段名    | 类型   | 中文说明       | JSON 来源 |
| --------- | ------ | -------------- | --------- |
| `id`      | INTEGER PK | 自增主键   | — |
| `team_id` | INTEGER FK→teams NOT NULL | 标准球队 | 待补充 |
| `source`  | TEXT NOT NULL | 来源标识 | 待补充 |
| `name`    | TEXT NOT NULL | 源名     | 待补充 |

唯一约束 `(team_id, source, name)`。

#### `matches` — 平台比赛

| 字段名           | 类型   | 中文说明       | JSON 来源 |
| ---------------- | ------ | -------------- | --------- |
| `id`             | INTEGER PK | 自增主键   | — |
| `league_id`      | INTEGER FK→leagues | 联赛 | 待补充 |
| `home_team_id`   | INTEGER FK→teams NOT NULL | 主队 | 待补充 |
| `away_team_id`   | INTEGER FK→teams NOT NULL | 客队 | 待补充 |
| `match_time`     | DateTime NOT NULL | 开赛时间 | 待补充 |
| `status`         | String NOT NULL | 状态（默认 SCHEDULED） | 待补充 |
| `home_score`     | Integer | 主队比分 | 待补充 |
| `away_score`     | Integer | 客队比分 | 待补充 |
| `half_home_score`| Integer | 半场主队比分 | 待补充 |
| `half_away_score`| Integer | 半场客队比分 | 待补充 |
| `round`          | Integer | 轮次     | 待补充 |
| `created_at`     | DateTime NOT NULL | 创建时间 | 系统写入 |
| `updated_at`     | DateTime NOT NULL | 更新时间 | 系统写入 |

#### `match_source_mappings` — 平台比赛 ↔ 源比赛映射

| 字段名      | 类型   | 中文说明       | JSON 来源 |
| ----------- | ------ | -------------- | --------- |
| `id`        | INTEGER PK | 自增主键   | — |
| `match_id`  | INTEGER FK→matches NOT NULL | 平台比赛 | — |
| `source`    | String NOT NULL | 源标识 | — |
| `source_id` | String NOT NULL | 源比赛 ID | — |

唯一约束 `(source, source_id)`。

#### `odds_history` — 赔率历史（平台聚合）

| 字段名       | 类型   | 中文说明     | JSON 来源 |
| ------------ | ------ | ------------ | --------- |
| `id`         | INTEGER PK | 自增主键 | — |
| `match_id`   | INTEGER FK→matches NOT NULL | 比赛 | — |
| `bookmaker`  | String NOT NULL | 博彩公司 | — |
| `odds_type`  | String NOT NULL | 赔率类型 | — |
| `snapshot_at`| DateTime NOT NULL | 快照时间 | — |
| `home_odds`  | Float | 主胜赔 | — |
| `draw_odds`  | Float | 平局赔 | — |
| `away_odds`  | Float | 客胜赔 | — |
| `handicap`   | String | 让球盘 | — |
| `options`    | String | 其他选项（比分/总进球等） | — |
| `created_at` | DateTime NOT NULL | 创建时间 | 系统写入 |

#### `injuries` — 伤停（平台聚合）

| 字段名        | 类型   | 中文说明     | JSON 来源 |
| ------------- | ------ | ------------ | --------- |
| `id`          | INTEGER PK | 自增主键 | — |
| `match_id`    | INTEGER FK→matches NOT NULL | 比赛 | — |
| `team_type`   | String NOT NULL | home/away | — |
| `player_name` | String NOT NULL | 球员名 | — |
| `position`    | String | 位置     | — |
| `tag`         | String | 伤停标签 | — |
| `created_at`  | DateTime NOT NULL | 创建时间 | 系统写入 |

#### `predictions` — 预测（平台聚合）

| 字段名            | 类型   | 中文说明     | JSON 来源 |
| ----------------- | ------ | ------------ | --------- |
| `match_id`        | INTEGER PK FK→matches | 比赛 | — |
| `home_prob`       | INTEGER NOT NULL | 主胜概率 | — |
| `draw_prob`       | INTEGER NOT NULL | 平局概率 | — |
| `away_prob`       | INTEGER NOT NULL | 客胜概率 | — |
| `confidence`      | INTEGER NOT NULL | 置信度 | — |
| `model_version`   | String NOT NULL | 模型版本 | — |
| `predicted_result`| String NOT NULL | 预测结果 | — |
| `updated_at`      | DateTime NOT NULL | 更新时间 | 系统写入 |

#### `briefings` — 赛前简报（平台聚合）

| 字段名       | 类型   | 中文说明     | JSON 来源 |
| ------------ | ------ | ------------ | --------- |
| `match_id`   | INTEGER PK FK→matches | 比赛 | — |
| `content`    | String NOT NULL | 简报内容 | — |
| `updated_at` | DateTime NOT NULL | 更新时间 | 系统写入 |

#### `users` — 用户

| 字段名          | 类型   | 中文说明     | JSON 来源 |
| --------------- | ------ | ------------ | --------- |
| `id`            | INTEGER PK | 自增主键 | — |
| `email`         | String UNIQUE NOT NULL | 邮箱 | — |
| `password_hash` | String NOT NULL | 密码哈希 | — |
| `role`          | String NOT NULL | 角色（默认 FREE） | — |
| `created_at`    | DateTime NOT NULL | 创建时间 | 系统写入 |

---

## 三、sofascore 库 ⚠️ 未定稿

> 当前为 architecture.md 7.1 的**草案版本**（3 张表），模型讨论后按定稿更新。JSON 来源以爬虫实际数据为准。

#### `match_schedules` — 赛程表

| 字段名           | 类型        | 中文说明                              | JSON 来源 |
| ---------------- | ----------- | ------------------------------------- | --------- |
| `match_id`       | INTEGER PK  | Sofascore event ID                    | `matches[].id` |
| `league_id`      | INTEGER NOT NULL | unique-tournament ID              | `league.id` |
| `season_id`      | INTEGER NOT NULL | 赛季 ID                           | `seasonId` |
| `season_key`     | TEXT        | 赛季标识，如 "24/25" / "2024"         | `season` |
| `slug`           | TEXT        | 比赛 slug                             | `matches[].slug` |
| `home_team_id`   | INTEGER     | 主队 ID                               | `matches[].homeTeamId` |
| `away_team_id`   | INTEGER     | 客队 ID                               | `matches[].awayTeamId` |
| `home_score`     | INTEGER     | 主队比分                              | `matches[].homeScore` |
| `away_score`     | INTEGER     | 客队比分                              | `matches[].awayScore` |
| `round_num`      | INTEGER     | 轮次                                  | `matches[].round` |
| `round_slug`     | TEXT        | 轮次 slug                             | `matches[].roundSlug` |
| `round_prefix`   | TEXT        | 轮次前缀                              | `matches[].roundPrefix` |
| `kickoff_time`   | TIMESTAMPTZ NOT NULL | 开赛时间                       | `matches[].startTimestamp` |
| `status`         | TEXT NOT NULL | finished / postponed / inprogress... | `matches[].status` |
| `tournament_name`| TEXT        | 赛事名称                              | `matches[].tournamentName` |
| `data_raw`       | JSONB       | 原始 API 响应（灾备）                 | 整条 |
| `scraped_at`     | TIMESTAMPTZ | 抓取时间                              | 系统写入 |
| `updated_at`     | TIMESTAMPTZ | 更新时间                              | 系统写入 |

唯一约束 `(league_id, season_id, match_id)`；索引：`kickoff_time`、`(league_id, season_id)`。

#### `match_details` — 比赛详情表（1:1 match_schedules）

| 字段名        | 类型        | 中文说明              | JSON 来源 |
| ------------- | ----------- | --------------------- | --------- |
| `match_id`    | INTEGER PK FK | 比赛 ID            | 详情文件 matchId |
| `season_id`   | INTEGER     | 赛季 ID                | `seasonId` |
| `referee`     | TEXT        | 裁判                  | `referee` |
| `venue`       | TEXT        | 球场                  | `venue` |
| `attendance`  | INTEGER     | 上座人数              | `attendance` |
| `pregame_form`| JSONB       | 赛前排位 + 近期状态   | `pregameForm` |
| `votes`       | JSONB       | 赛前投票              | `votes` |
| `lineups`     | JSONB       | 首发/替补/伤病        | `lineups` |
| `statistics`  | JSONB       | 技术统计（按半场）    | `statistics` |
| `incidents`   | JSONB       | 比赛事件              | `incidents` |
| `data_raw`    | JSONB       | 原始 API 响应（灾备） | 整条 |
| `scraped_at`  | TIMESTAMPTZ | 抓取时间              | 系统写入 |

#### `team_season_stats` — 球队赛季统计

| 字段名       | 类型        | 中文说明           | JSON 来源 |
| ------------ | ----------- | ------------------ | --------- |
| `team_id`    | INTEGER NOT NULL | 球队 ID        | `teamId` |
| `league_id`  | INTEGER NOT NULL | 联赛 ID        | `leagueId` |
| `season_id`  | INTEGER NOT NULL | 赛季 ID        | `seasonId` |
| `statistics` | JSONB NOT NULL | 统计指标（约 111/115 项） | `statistics` |
| `data_raw`   | JSONB       | 原始 API 响应（灾备） | 整条 |
| `scraped_at` | TIMESTAMPTZ | 抓取时间              | 系统写入 |

主键 `(team_id, league_id, season_id)`。

---

## 四、jingcai 库（沿用现有模型）

> 结构来源：`spottery_pro/backend/app/models/jingcai.py`（18 张表）。字段中文说明为模型字段名的直译；**JSON 来源待补充**（对应竞彩官网接口字段）。

### 4.1 `jingcai_matches` — 竞彩比赛主体（约 7.7 万行）

| 字段名               | 类型    | 中文说明                       | JSON 来源 |
| -------------------- | ------- | ------------------------------ | --------- |
| `match_id`           | Integer PK | 竞彩比赛 ID                | 待补充 |
| `business_date`      | Date NOT NULL | 销售日（开售日期）      | 待补充 |
| `match_date`         | Date NOT NULL | 比赛日期                  | 待补充 |
| `kickoff_time`       | DateTime | 开赛时间                       | 待补充 |
| `match_num`          | String NOT NULL | 比赛编号（如 周日001）  | 待补充 |
| `home_team`          | String NOT NULL | 主队名                | 待补充 |
| `away_team`          | String NOT NULL | 客队名                | 待补充 |
| `league`             | String   | 联赛名                          | 待补充 |
| `sporttery_home_id`  | Integer  | 体彩主队 ID                     | 待补充 |
| `sporttery_away_id`  | Integer  | 体彩客队 ID                     | 待补充 |
| `uniform_home_id`    | Integer  | 统一主队 ID                     | 待补充 |
| `uniform_away_id`    | Integer  | 统一客队 ID                     | 待补充 |
| `sporttery_league_id`| Integer  | 体彩联赛 ID                     | 待补充 |
| `uniform_league_id`  | Integer  | 统一联赛 ID                     | 待补充 |
| `tournament_id`      | Integer  | 赛事 ID                         | 待补充 |
| `season_id`          | Integer  | 赛季 ID                         | 待补充 |
| `season_name`        | String   | 赛季名                          | 待补充 |
| `phase_name`         | String   | 阶段名（如 常规赛/附加赛）      | 待补充 |
| `home_score`         | Integer  | 主队比分                        | 待补充 |
| `away_score`         | Integer  | 客队比分                        | 待补充 |
| `status`             | String NOT NULL | 状态（默认 FINISHED）    | 待补充 |
| `pool_status`        | String   | 奖池状态                        | 待补充 |
| `scraped_at`         | DateTime | 抓取时间                        | 系统写入 |

索引：`business_date`、`match_date`、`status`。

### 4.2 `jingcai_teams` — 球队映射（约 0.3 万行）

| 字段名        | 类型    | 中文说明          | JSON 来源 |
| ------------- | ------- | ----------------- | --------- |
| `id`          | Integer PK | 自增主键      | — |
| `name`        | String NOT NULL | 球队名    | 待补充 |
| `short_name`  | String   | 简称              | 待补充 |
| `sporttery_id`| Integer UNIQUE | 体彩 ID    | 待补充 |
| `uniform_id`  | Integer  | 统一 ID            | 待补充 |

### 4.3 `jingcai_leagues` — 联赛映射（约 134 行）

| 字段名        | 类型    | 中文说明          | JSON 来源 |
| ------------- | ------- | ----------------- | --------- |
| `id`          | Integer PK | 自增主键      | — |
| `name`        | String NOT NULL | 联赛名    | 待补充 |
| `short_name`  | String   | 简称              | 待补充 |
| `sporttery_id`| Integer UNIQUE | 体彩 ID    | 待补充 |
| `uniform_id`  | Integer  | 统一 ID            | 待补充 |
| `season_id`   | Integer  | 赛季 ID            | 待补充 |
| `season_name` | String   | 赛季名            | 待补充 |

### 4.4 `jingcai_odds` — 赔率汇总（约 34.9 万行）

| 字段名         | 类型    | 中文说明          | JSON 来源 |
| -------------- | ------- | ----------------- | --------- |
| `id`           | Integer PK | 自增主键      | — |
| `match_id`     | Integer NOT NULL | 比赛 ID    | 待补充 |
| `odds_type`    | String NOT NULL | 赔率类型（SPF/RQSPF/CRS/TTG/HAFU） | 待补充 |
| `snapshot_at`  | DateTime | 快照时间          | 待补充 |
| `home`         | Float    | 主胜赔            | 待补充 |
| `draw`         | Float    | 平局赔            | 待补充 |
| `away`         | Float    | 客胜赔            | 待补充 |
| `handicap`     | String   | 让球盘            | 待补充 |
| `options`      | Text     | 选项明细（比分/总进球等） | 待补充 |

唯一约束 `(match_id, odds_type)`。

### 4.5 `jingcai_odds_spf` — 胜平负明细快照（约 26.1 万行）

| 字段名         | 类型    | 中文说明          | JSON 来源 |
| -------------- | ------- | ----------------- | --------- |
| `id`           | Integer PK | 自增主键      | — |
| `match_id`     | Integer NOT NULL | 比赛 ID    | 待补充 |
| `snapshot_at`  | DateTime NOT NULL | 快照时间    | 待补充 |
| `update_date`  | String   | 更新日期          | 待补充 |
| `update_time`  | String   | 更新时间          | 待补充 |
| `home`         | Float    | 主胜赔            | 待补充 |
| `draw`         | Float    | 平局赔            | 待补充 |
| `away`         | Float    | 客胜赔            | 待补充 |

唯一约束 `(match_id, snapshot_at)`。

### 4.6 `jingcai_odds_rqspf` — 让球胜平负明细快照（约 26.8 万行）

| 字段名         | 类型    | 中文说明          | JSON 来源 |
| -------------- | ------- | ----------------- | --------- |
| `id`           | Integer PK | 自增主键      | — |
| `match_id`     | Integer NOT NULL | 比赛 ID    | 待补充 |
| `snapshot_at`  | DateTime NOT NULL | 快照时间    | 待补充 |
| `update_date`  | String   | 更新日期          | 待补充 |
| `update_time`  | String   | 更新时间          | 待补充 |
| `home`         | Float    | 主胜赔            | 待补充 |
| `draw`         | Float    | 平局赔            | 待补充 |
| `away`         | Float    | 客胜赔            | 待补充 |
| `handicap`     | String   | 让球盘            | 待补充 |

唯一约束 `(match_id, snapshot_at)`。

### 4.7 `jingcai_odds_crs` — 比分明细快照（约 13.9 万行）

| 字段名        | 类型    | 中文说明          | JSON 来源 |
| ------------- | ------- | ----------------- | --------- |
| `id`          | Integer PK | 自增主键      | — |
| `match_id`    | Integer NOT NULL | 比赛 ID    | 待补充 |
| `snapshot_at` | DateTime NOT NULL | 快照时间    | 待补充 |
| `options`     | Text     | 比分选项及赔率    | 待补充 |

唯一约束 `(match_id, snapshot_at)`。

### 4.8 `jingcai_odds_ttg` — 总进球明细快照（约 14.5 万行）

| 字段名        | 类型    | 中文说明          | JSON 来源 |
| ------------- | ------- | ----------------- | --------- |
| `id`          | Integer PK | 自增主键      | — |
| `match_id`    | Integer NOT NULL | 比赛 ID    | 待补充 |
| `snapshot_at` | DateTime NOT NULL | 快照时间    | 待补充 |
| `options`     | Text     | 进球数选项及赔率  | 待补充 |

唯一约束 `(match_id, snapshot_at)`。

### 4.9 `jingcai_odds_hafu` — 半全场明细快照（约 15.8 万行）

| 字段名        | 类型    | 中文说明          | JSON 来源 |
| ------------- | ------- | ----------------- | --------- |
| `id`          | Integer PK | 自增主键      | — |
| `match_id`    | Integer NOT NULL | 比赛 ID    | 待补充 |
| `snapshot_at` | DateTime NOT NULL | 快照时间    | 待补充 |
| `options`     | Text     | 半全场选项及赔率  | 待补充 |

唯一约束 `(match_id, snapshot_at)`。

### 4.10 `jingcai_pools` — 奖池（约 32.6 万行）

| 字段名             | 类型    | 中文说明          | JSON 来源 |
| ------------------ | ------- | ----------------- | --------- |
| `id`               | Integer PK | 自增主键      | — |
| `match_id`         | Integer NOT NULL | 比赛 ID    | 待补充 |
| `code`             | String NOT NULL | 玩法代码    | 待补充 |
| `combination`      | String   | 组合             | 待补充 |
| `combination_desc` | String   | 组合描述         | 待补充 |
| `odds`             | Float    | 赔率             | 待补充 |
| `goal_line`        | String   | 进球线           | 待补充 |
| `pool_id`          | Integer  | 奖池 ID          | 待补充 |
| `pool_totals`      | String   | 奖池总额         | 待补充 |
| `refund_status`    | String   | 退款状态         | 待补充 |

唯一约束 `(match_id, code)`。

### 4.11 `jingcai_standings` — 积分榜（约 35.4 万行）

| 字段名          | 类型    | 中文说明          | JSON 来源 |
| --------------- | ------- | ----------------- | --------- |
| `id`            | Integer PK | 自增主键      | — |
| `match_id`      | Integer NOT NULL | 比赛 ID    | 待补充 |
| `team_type`     | String NOT NULL | home/away   | 待补充 |
| `view`          | String NOT NULL | 榜单视图（总/主/客） | 待补充 |
| `team_name`     | String   | 队名             | 待补充 |
| `team_id`       | Integer  | 队 ID            | 待补充 |
| `ranking`       | Integer  | 排名             | 待补充 |
| `points`        | Integer  | 积分             | 待补充 |
| `played`        | Integer  | 已赛场次         | 待补充 |
| `wins`          | Integer  | 胜               | 待补充 |
| `draws`         | Integer  | 平               | 待补充 |
| `losses`        | Integer  | 负               | 待补充 |
| `goals_for`     | Integer  | 进球             | 待补充 |
| `goals_against` | Integer  | 失球             | 待补充 |
| `goal_diff`     | Integer  | 净胜球           | 待补充 |
| `win_probability`| String  | 获胜概率         | 待补充 |
| `phase_name`    | String   | 阶段名           | 待补充 |

唯一约束 `(match_id, team_type, view)`。

### 4.12 `jingcai_h2h` — 历史交锋（约 42.1 万行）

| 字段名           | 类型    | 中文说明          | JSON 来源 |
| ---------------- | ------- | ----------------- | --------- |
| `id`             | Integer PK | 自增主键      | — |
| `match_id`       | Integer NOT NULL | 比赛 ID    | 待补充 |
| `match_date`     | Date     | 比赛日期          | 待补充 |
| `home_team_id`   | Integer  | 主队 ID           | 待补充 |
| `away_team_id`   | Integer  | 客队 ID           | 待补充 |
| `home_score`     | Integer  | 主队比分          | 待补充 |
| `away_score`     | Integer  | 客队比分          | 待补充 |
| `half_home_score`| Integer  | 半场主队比分      | 待补充 |
| `half_away_score`| Integer  | 半场客队比分      | 待补充 |
| `season_id`      | Integer  | 赛季 ID           | 待补充 |
| `tournament_id`  | Integer  | 赛事 ID           | 待补充 |
| `winning_team`   | String   | 获胜方            | 待补充 |

唯一约束 `(match_id, match_date, home_team_id, away_team_id)`。

### 4.13 `jingcai_recent_results` — 近期赛果（约 24.3 万行）

| 字段名              | 类型    | 中文说明          | JSON 来源 |
| ------------------- | ------- | ----------------- | --------- |
| `id`                | Integer PK | 自增主键      | — |
| `team_uniform_id`   | Integer NOT NULL | 球队统一 ID | 待补充 |
| `match_date`        | Date     | 比赛日期          | 待补充 |
| `opponent_uniform_id`| Integer | 对手统一 ID       | 待补充 |
| `home_score`        | Integer  | 主队比分          | 待补充 |
| `away_score`        | Integer  | 客队比分          | 待补充 |
| `half_home_score`   | Integer  | 半场主队比分      | 待补充 |
| `half_away_score`   | Integer  | 半场客队比分      | 待补充 |
| `result`            | String   | 结果（胜/平/负）  | 待补充 |
| `season_id`         | Integer  | 赛季 ID           | 待补充 |
| `tournament_id`     | Integer  | 赛事 ID           | 待补充 |
| `source_match_id`   | Integer  | 源比赛 ID         | 待补充 |

唯一约束 `(team_uniform_id, match_date, source_match_id)`。

### 4.14 `jingcai_fixtures` — 未来赛程（约 0.5 万行）

| 字段名              | 类型    | 中文说明          | JSON 来源 |
| ------------------- | ------- | ----------------- | --------- |
| `id`                | Integer PK | 自增主键      | — |
| `team_uniform_id`   | Integer NOT NULL | 球队统一 ID | 待补充 |
| `match_date`        | DateTime | 开赛时间          | 待补充 |
| `opponent_uniform_id`| Integer | 对手统一 ID       | 待补充 |
| `gameweek`          | String   | 轮次              | 待补充 |
| `season_id`         | Integer  | 赛季 ID           | 待补充 |
| `tournament_id`     | Integer  | 赛事 ID           | 待补充 |
| `source_match_id`   | Integer  | 源比赛 ID         | 待补充 |

唯一约束 `(team_uniform_id, match_date, source_match_id)`。

### 4.15 `jingcai_injuries` — 伤病名单（约 13.9 万行）

| 字段名          | 类型    | 中文说明          | JSON 来源 |
| --------------- | ------- | ----------------- | --------- |
| `id`            | Integer PK | 自增主键      | — |
| `match_id`      | Integer NOT NULL | 比赛 ID    | 待补充 |
| `team_type`     | String NOT NULL | home/away   | 待补充 |
| `person_id`     | Integer  | 人员 ID           | 待补充 |
| `person_name`   | String   | 姓名             | 待补充 |
| `position_code` | String   | 位置代码         | 待补充 |
| `position_desc` | String   | 位置描述         | 待补充 |
| `injury_flag`   | Integer  | 伤病标记         | 待补充 |
| `suspension_flag`| Integer | 停赛标记         | 待补充 |
| `appearance_cnt`| Integer  | 出场次数         | 待补充 |
| `started_cnt`   | Integer  | 首发次数         | 待补充 |
| `uniform_no`    | String   | 球衣号           | 待补充 |

唯一约束 `(match_id, team_type, person_id)`。

### 4.16 `jingcai_players` — 球员数据（约 38.2 万行）

| 字段名          | 类型    | 中文说明          | JSON 来源 |
| --------------- | ------- | ----------------- | --------- |
| `id`            | Integer PK | 自增主键      | — |
| `match_id`      | Integer NOT NULL | 比赛 ID    | 待补充 |
| `team_type`     | String NOT NULL | home/away   | 待补充 |
| `person_id`     | Integer  | 人员 ID           | 待补充 |
| `person_name`   | String   | 姓名             | 待补充 |
| `position_code` | String   | 位置代码         | 待补充 |
| `position_desc` | String   | 位置描述         | 待补充 |
| `goal_cnt`      | Integer  | 进球数           | 待补充 |
| `assist_cnt`    | Integer  | 助攻数           | 待补充 |
| `appearance_cnt`| Integer  | 出场次数         | 待补充 |
| `started_cnt`   | Integer  | 首发次数         | 待补充 |
| `injury_flag`   | Integer  | 伤病标记         | 待补充 |
| `suspension_flag`| Integer | 停赛标记         | 待补充 |
| `uniform_no`    | String   | 球衣号           | 待补充 |

唯一约束 `(match_id, team_type, person_id)`。

### 4.17 `jingcai_season_features` — 赛季特征（约 6.6 万行）

| 字段名            | 类型    | 中文说明          | JSON 来源 |
| ----------------- | ------- | ----------------- | --------- |
| `id`              | Integer PK | 自增主键      | — |
| `match_id`        | Integer UNIQUE | 比赛 ID    | 待补充 |
| `home_team`       | String   | 主队名           | 待补充 |
| `away_team`       | String   | 客队名           | 待补充 |
| `goal_avg_home`   | Float    | 主队场均进球     | 待补充 |
| `goal_avg_away`   | Float    | 客队场均进球     | 待补充 |
| `loss_goal_avg_home` | Float | 主队场均失球   | 待补充 |
| `loss_goal_avg_away` | Float | 客队场均失球   | 待补充 |
| `recent_home_wins`| Integer  | 主队近期胜       | 待补充 |
| `recent_home_draws`| Integer | 主队近期平       | 待补充 |
| `recent_home_losses`| Integer | 主队近期负     | 待补充 |
| `recent_away_wins`| Integer  | 客队近期胜       | 待补充 |
| `recent_away_draws`| Integer | 客队近期平       | 待补充 |
| `recent_away_losses`| Integer | 客队近期负     | 待补充 |
| `data`             | Text     | 原始数据         | 待补充 |

### 4.18 `jingcai_import_files` — 导入文件记录

| 字段名        | 类型    | 中文说明          | JSON 来源 |
| ------------- | ------- | ----------------- | --------- |
| `id`          | Integer PK | 自增主键      | — |
| `file_path`   | String UNIQUE NOT NULL | 源文件路径 | 系统写入 |
| `size`        | Integer  | 文件大小          | 系统写入 |
| `mtime`       | Float    | 修改时间戳        | 系统写入 |
| `status`      | String NOT NULL | 状态（默认 ok）| 系统写入 |
| `imported_at` | DateTime NOT NULL | 导入时间     | 系统写入 |

---

## 五、titan007 库（球探库）

> 结构来源：architecture.md 7.3（3 张表）。JSON 来源以球探爬虫实际数据为准。

#### `schedules` — 赛程

| 字段名               | 类型        | 中文说明                              | JSON 来源 |
| -------------------- | ----------- | ------------------------------------- | --------- |
| `schedule_id`        | INTEGER NOT NULL | 球探比赛 ID                    | 待补充 |
| `competition_id`     | INTEGER NOT NULL | 赛事 ID                     | 待补充 |
| `competition_name_cn`| TEXT        | 赛事中文名                            | 待补充 |
| `competition_name_en`| TEXT        | 赛事英文名                            | 待补充 |
| `season`             | TEXT NOT NULL | 赛季                               | 待补充 |
| `is_cup`             | BOOLEAN     | 是否杯赛                              | 待补充 |
| `group_name`         | TEXT        | 分组                                  | 待补充 |
| `round_name`         | TEXT        | 轮次名                                | 待补充 |
| `match_time`         | TIMESTAMPTZ | 开赛时间                              | 待补充 |
| `home_team_id`       | INTEGER     | 主队 ID                               | 待补充 |
| `away_team_id`       | INTEGER     | 客队 ID                               | 待补充 |
| `home_team`          | TEXT        | 主队名（中文）                        | 待补充 |
| `away_team`          | TEXT        | 客队名（中文）                        | 待补充 |
| `home_team_en`       | TEXT        | 主队名（英文）                        | 待补充 |
| `away_team_en`       | TEXT        | 客队名（英文）                        | 待补充 |
| `full_score`         | TEXT        | 全场比分                              | 待补充 |
| `half_score`         | TEXT        | 半场比分                              | 待补充 |
| `status`             | INTEGER     | 状态码                                | 待补充 |
| `data_raw`           | JSONB       | 原始数据（灾备）                      | 整条 |
| `scraped_at`         | TIMESTAMPTZ | 抓取时间                              | 系统写入 |
| `updated_at`         | TIMESTAMPTZ | 更新时间                              | 系统写入 |

主键 `(schedule_id, competition_id, season)`；索引：`match_time`、`(competition_id, season)`。

#### `analysis` — 分析数据（赛前简报/阵容/伤停/积分榜等）

| 字段名          | 类型        | 中文说明              | JSON 来源 |
| --------------- | ----------- | --------------------- | --------- |
| `schedule_id`   | INTEGER PK  | 球探比赛 ID           | 待补充 |
| `competition_id`| INTEGER     | 赛事 ID               | 待补充 |
| `season`        | TEXT        | 赛季                  | 待补充 |
| `data`          | JSONB NOT NULL | 分析数据整体 JSONB | 整条 |
| `scraped_at`    | TIMESTAMPTZ | 抓取时间              | 系统写入 |

#### `odds` — 赔率（亚盘 / 大小球 / 欧赔统一表）

| 字段名        | 类型        | 中文说明                              | JSON 来源 |
| ------------- | ----------- | ------------------------------------- | --------- |
| `schedule_id` | INTEGER NOT NULL | 球探比赛 ID                    | 待补充 |
| `company_id`  | INTEGER NOT NULL | 公司 ID                     | 待补充 |
| `company_name`| TEXT        | 公司名                                | 待补充 |
| `odds_type`   | TEXT NOT NULL | asian / over_under / european    | 待补充 |
| `odds_subtype`| TEXT        | full / half（欧赔为 NULL）            | 待补充 |
| `source`      | TEXT NOT NULL | titan / nowscore                 | 待补充 |
| `changes`     | JSONB NOT NULL | 赔率变化序列                      | 待补充 |
| `data_raw`    | JSONB       | 原始数据（灾备）                      | 整条 |
| `fetched_at`  | TIMESTAMPTZ | 抓取时间                              | 系统写入 |
| `updated_at`  | TIMESTAMPTZ | 更新时间                              | 系统写入 |

主键 `(schedule_id, company_id, odds_type, odds_subtype)`。

---

## 六、待补充清单

- [ ] Sofascore 库模型定稿（当前为草案）
- [ ] 竞彩库各表字段的"JSON 来源"映射（取自竞彩官网接口字段）
- [ ] 球探库各表字段的"JSON 来源"映射
- [ ] 平台业务表各字段的"JSON 来源"（来源聚合引擎产出）
- [ ] 聚合引擎产出表（存聚合/计算结果）的具体结构
