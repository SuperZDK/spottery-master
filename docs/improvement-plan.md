# Spottery 待优化改进计划（Backlog）

> 版本：v0.1
> 日期：2026-08-09
> 状态：记录中，按优先级逐步实施
> 原则：**JSON 是无损归档层，永不删除**；PG 数据库是有损投影，只存分析子集。两层各丢一次数据（爬取层白名单裁剪 + 导入层再次筛选），本文档记录由此产生的缺口与改进方式。

---

## 目录

1. [Sofascore schedule 采集层问题](#一sofascore-schedule-采集层问题)
2. [Sofascore 导入层数据丢失（JSON→DB）](#二sofascore-导入层数据丢失jsondb)
3. [mapping 跨源管线问题](#三mapping-跨源管线问题)
4. [其他 / 待定决策](#四其他--待定决策)
5. [附录：参考文件清单](#五附录参考文件清单)

---

## 一、Sofascore schedule 采集层问题

> 采集层在 `services/crawler-sofascore/src/scrapers/sofascore/fetch-schedules.ts` 的 `toMatchRecord`（:69-110）对 API 原始 event 做**白名单裁剪**，只保存 `MatchRecord` 类型（`src/types/index.ts`:95-113）定义的字段，其余丢弃。以下问题均因此产生。

### 1.1 `isAwarded` 判胜标记缺失 ★ 最高优先级

**现状**

- 爬虫从未读取 `ev.isAwarded`，schedules JSON 无该字段。
- PG `schedules` 表无 `is_awarded` 列（db/init/sofascore/01-schema.sql:56-92 仅 10 个比分列 + 3 个 has_* 标记）。
- 入库 27 列（import-to-pg.ts:416-426）同样不含。

**isAwarded 是什么**

- Sofascore 对"判胜"（awarded win）场次的标记，值恒为 `true`，且**只在判胜场输出**（正常完场无该键，条件字段）。
- 判胜场比分为**事后编的默认值**，不是真实赛果；`status.code` 仍为正常完场码（100/Ended），无法从状态码反推。

**为什么必须补（分析影响）**

1. **脏数据污染**：判胜场比分是编的，不补标记则胜平负统计、进球分布、赔率校验被这类场次污染且无法定位。
2. **实例**：Al-Faisaly vs Abha（2026-01-21，沙特甲 R18），sofascore 判胜 `3-0`（isAwarded:true，incidents 无任何进球、HT 0-0），球探保留中止前比分 `0-2`，Forebet 记 `3-0 (0-1)`。跨源比分冲突直接源于此。
3. **无法替代**：`status_codes.final_result_only`（import-to-pg.ts:137-147）语义是"延期/取消/中止"（code 60/70/90），**不是判胜**；`team_season_stats.awarded_matches` 是球队赛季聚合计数，非逐场标记。

**改动方式（4 文件 + 重爬 + 重导）**

| 步骤 | 文件 | 改动 |
|---|---|---|
| 1 | `services/crawler-sofascore/src/types/index.ts` | `MatchRecord` 加 `isAwarded: boolean` |
| 2 | `services/crawler-sofascore/src/scrapers/sofascore/fetch-schedules.ts` | `toMatchRecord` 加 `isAwarded: ev.isAwarded ?? false` |
| 3 | `db/init/sofascore/01-schema.sql` | `schedules` 加 `is_awarded BOOLEAN NOT NULL DEFAULT FALSE` |
| 4 | `services/crawler-sofascore/scripts/import-to-pg.ts` | matchRows 加值 + INSERT 列清单 + `ON CONFLICT DO UPDATE` 集 |
| 5 | 重爬 | `npx tsx src/scrapers/sofascore/fetch-schedules.ts --force`（31 联赛 ~300 文件全量） |
| 6 | 重导 | `npx tsx services/crawler-sofascore/scripts/import-to-pg.ts`（schedules 全量 upsert 幂等） |

**风险 / 注意事项**

- 重爬 300+ 文件耗时较长；可先只重抓关注的联赛验证，再铺开。
- 判胜标记**赛后才知道**（Al-Faisaly 例滞后近 2 个月，changes.changeTimestamp=2026-03-16），增量爬取后需周期性重导旧场次才能补上。

### 1.2 `changes` / `changeTimestamp` 缺失（事后改判追踪）

**现状**：爬虫未抓 `ev.changes`；PG 无对应列。

**影响**：`changes.changes[]` 记录被修改的字段路径，`changeTimestamp` 记录修改时间。判胜/改判场次会**事后修改比分**（Al-Faisaly 例改 `homeScore.period2/normaltime`，滞后 2 个月）。缺失则无法追溯"哪些场次结果事后被推翻/修正"，历史分析可能用错数据版本。

**改动方式**：同 1.1 的 4 处，`schedules` 加 `changes JSONB` + `change_timestamp TIMESTAMPTZ`；`toMatchRecord` 加
`changes: ev.changes ? { changes: ev.changes.changes ?? [], changeTimestamp: ev.changes.changeTimestamp ?? null } : null`。

### 1.3 `time.injuryTime1 / injuryTime2` 缺失（补时信息）

**现状**：爬虫未抓 `ev.time`。

**影响**：`injuryTime1/2` 为上下半场伤停补时分钟数，可支撑"补时绝杀占比"、"补时进球 vs 常规时间进球分布"等比赛进程分析；`time.currentPeriodStartTimestamp` 可算比赛进度。

**改动方式**：同 1.1 的 4 处，`schedules` 加 `injury_time1 INTEGER` + `injury_time2 INTEGER`；`toMatchRecord` 加
`injuryTime1: ev.time?.injuryTime1 ?? null`、`injuryTime2: ev.time?.injuryTime2 ?? null`。

### 1.4 认知纠正：`finalResultOnly` ≠ `isAwarded`

- `finalResultOnly` 已抓（fetch-schedules.ts:109）但语义是"该场只有最终结果、无比赛明细"（对应 status_codes 词典 60/70/90 的 `final_result_only=true`，是按状态码硬编码的词典值）。
- 判胜场可能 `isAwarded:true` 而 `finalResultOnly:false`（Al-Faisaly 例同场两个字段值不同）。**不可拿 finalResultOnly 当判胜依据**，二者是独立字段。

### 1.5 未爬联赛覆盖缺口

**现状**：`src/config/sofascore.ts` 配置 31 个联赛/杯赛，沙特甲（Saudi 1st Division，uniqueTournament id 2120）等不在其中。Al-Faisaly 那场的 match_id 15392894 因此不在库里（库 82,288 场）。

**影响**：跨源比对（竞彩/球探覆盖的赛事）若 sofascore 侧未爬，则该源缺失对齐依据。

**改动方式**：按需在 config 增加联赛条目（含 seasonIds、rounds/seasonRounds），再跑 fetch-schedules。

### 1.6 无增量爬取机制

**现状**：fetch-schedules.ts 仅文件级幂等（文件存在且 matches>0 即 SKIP），无基于游标的增量抓取；fetch-details.ts 依赖详情文件存在与否 + `import-progress.json` 断点续传。

**影响**：判胜/改判场次需全量重爬才能刷新；新增联赛需全量。

**改动方式**：引入增量游标（如按 season 最新一场 startTimestamp 或 kickoff_time 之后补抓），或周期性 `--force` 重爬 + 幂等 upsert。

---

## 二、Sofascore 导入层数据丢失（JSON→DB）

> 导入层在 `services/crawler-sofascore/scripts/import-to-pg.ts`。details 层只写 6 张表（match_details/players/match_players/match_votes/match_missing_players/match_statistics），team_season_stats 按 `TEAM_STAT_COL` 115 键白名单映射。JSON 有但未入库的数据如下。

### 2.1 `incidents` 整块丢失

**现状**：details JSON 均含 `incidents`（30 场抽样 500 条：goal 84 / card 138 / substitution 175 / injuryTime 43 / period 60），但 PG **无 incidents 表**——`match_incidents` 已确认不建表（docs/sofascore-database.md:5/80/960、docs/architecture.md:398：事件级分析价值与投入不成比例，进球/红牌从比分与统计推断）。

**影响**：进球/红黄牌/换人等**比赛过程数据**仅在 JSON 层，DB 无法做事件级分析；如需"任意进球时间分布/红牌触发比赛走向"等分析必须读 JSON。

**改动方式（前瞻）**：若未来需要事件级分析，新增 `match_incidents` 表（match_id, time, incidentType, incidentClass, is_home, player_id, home_score, away_score, reason, text, assist1, replacement_player）+ import-to-pg 导入逻辑。**注意**：sofascore-database.md:960 已列明不建表理由（substitution 无球员信息、penaltyShootout 无 time、无 id 事件多），需先确认分析价值再推翻该决策。

### 2.2 `slug` / `status` / `startTimestamp` 未入库（details 层）

**现状**：match_details 表（01-schema.sql:157-177）无 slug/status/startTimestamp 列；startTimestamp 仅用于 match_votes 的 snapshot_at。

**影响**：详情层查询无法按 slug/状态过滤；可 JOIN schedules 表补齐（schedules 表已存 status_code/status_type/kickoff_time/slug），影响低。

**改动方式**：如需直接按详情过滤，给 match_details 加列并回填；否则维持 JOIN schedules。

### 2.3 `STAT_COL` 映射缺 `Total saves` 指标

**现状**：details JSON 的比赛统计含 `Total saves`，但 import-to-pg.ts `STAT_COL`（:163-214）无此项，match_statistics 未入库该指标。

**影响**：守门员"总扑救"与现有 `goalkeeper_saves`（Goalkeeper saves）不同（一为全队、一为门将），缺失则该指标仅 JSON 可查。

**改动方式**：`STAT_COL` 加 `"Total saves": "total_saves"`，schema 加列，重导 details。

### 2.4 其他零散字段未入库（按需取舍）

| 数据 | JSON 有无 | 入库现状 | 影响 |
|---|---|---|---|
| lineups 球员 `jerseyNumber` / `teamId` | ✅ | ❌ | 球衣号码展示需求低 |
| missingPlayers `reason` / `externalType` | ✅ | ❌ | 缺阵原因编码，描述已有 |
| votes `whoShouldHaveWonVote` | ✅ | ❌ | 赛后"谁该赢"投票，可评估预期 |
| pregameForm `label` | ✅ | ❌ | 积分/评分单位标签，恒 Pts |
| schedules `finalResultOnly` | ✅ | ❌ | 见 1.4，非判胜标记 |

### 2.5 关键提醒：JSON 是唯一无损层，导入不可逆

- 数据流：API →（爬取层白名单）→ JSON（无损）→（导入层再筛选）→ PG（有损）。
- **删除 JSON = 永久丢失 incidents 等未入库数据**，且导入脚本有 `DELETE FROM status_codes` 等全量重写字典表逻辑，若误把 JSON 当中间产物清理则不可恢复。
- **决策：JSON 永久归档保留，DB 按需补齐。** 本次不删除任何 JSON。

---

## 三、mapping 跨源管线问题

> 管线：阶段一 `mapping/scripts/build-team-map.ts`（sofascore+titan 建 team_map），阶段二 `mapping/scripts/fill-jc-name.ts`（titan×竞彩 join 反填 jingcainame）。

### 3.1 kickoff 过滤已移除的教训

**现状**：阶段二最初加了 kickoff±15min 过滤，导致 joined=69462 / unmatched=875（误杀 849 场：335 场候选 kickoff 为空 + 514 场偏差>15min）。已按用户指示删除（对齐原版 `titan007_pro/pipelines/jc_daily.py` 的 `(businessDate, matchNum)` 精确匹配语义），恢复为 joined=70311 / unmatched=26（与原版完全一致）。

**教训**：跨源 join 应**对齐原版语义**，球探与竞彩的 kickoff 记录方式不同（偏差 30-50 分钟），擅自加过滤条件会误杀真实匹配。

### 3.2 阶段一 25 条冲突记录在日志拆分后丢失

**现状**：旧 `conflict.log` 含阶段一 25 条 + 阶段二 66 条，拆分时旧文件已删除；新 `conflict-team-map.log`/`conflict-jc.log` 均 run 前 `truncate()` 重建。因 team-map-cursor.json 游标已全部 ok，**重跑阶段一不会重现那 25 条冲突**，记录已永久丢失。

**影响**：25 个 sofascore/titan 球队映射冲突的明细无从查证。

**改动方式**：日志策略改为"truncate 前先归档带时间戳副本"，或至少保留一份合并归档。

### 3.3 33 个多候选冲突队 jingcainame 留空

**现状**：33 队存在多个竞彩候选（西汉姆联/比利亚雷亚尔、U23 亚足/国奥/U23 变体、鹿岛/神户等），`jingcainame` 留空、记 `conflict-jc.log`。

**影响**：这些队无法在跨源对齐时提供竞彩名，需人工裁决。

**改动方式**：人工核对 conflict-jc.log 后手动补 mapping；或按联赛+球队名相似度加权自动消歧（低优先级）。

### 3.4 判胜场跨源比分冲突的统一处理策略（前瞻）

**现状**：跨源对齐规则（docs/architecture.md:739）为"任一源 FINISHED 即取 FINISHED + 比分"，未处理判胜/取消场次。

**问题**：Al-Faisaly 例中球探保留 0-2（中止前比分）、sofascore 为 3-0（判胜编造分），简单取"完场源"会得到互相矛盾的结果。

**改动方式（待定）**：跨源合并时对判胜场（`is_awarded`=true 或球探侧取消/中止状态）**标记异常**（如 `result_anomaly` 列），不静默覆盖；比分冲突时以显式规则裁决（如竞彩结算分优先）而非按来源取新。

---

## 四、其他 / 待定决策

1. **是否新增 `match_incidents` 表**：推翻既有"不建表"决策需先确认事件级分析价值（见 2.1）。
2. **是否加沙特甲等未爬联赛配置**：取决于跨源比对覆盖需求（见 1.5）。
3. **日志保留策略**：truncate 前归档带时间戳副本，避免重跑后历史记录丢失（见 3.2）。
4. **`Total saves` 是否补列**：若守门员表现分析需要则补（见 2.3）。
5. **判胜场异常标记是否入 unified_matches**：跨源合并时如何标记（见 3.4）。

---

## 五、附录：参考文件清单

| 文件 | 位置 | 备注 |
|---|---|---|
| schedule 爬虫（白名单裁剪） | `services/crawler-sofascore/src/scrapers/sofascore/fetch-schedules.ts` | toMatchRecord :36-111；isAwarded 未读 :69-110 |
| schedule 类型 | `services/crawler-sofascore/src/types/index.ts` | MatchRecord :95-113 |
| 联赛配置 | `services/crawler-sofascore/src/config/sofascore.ts` | 31 联赛，英超 id=17（uniqueTournament.id） |
| sofascore schema | `db/init/sofascore/01-schema.sql` | schedules :56-92；无 is_awarded/changes |
| JSON→PG 导入 | `services/crawler-sofascore/scripts/import-to-pg.ts` | matchRows :416-426；STAT_COL :163-214；status 词典 :137-147 |
| 导入进度断点 | `services/crawler-sofascore/scripts/import-progress.json` | 断点续传，重导 schedules 安全 |
| 原版 join 语义参照 | `D:\data\VSCode_file\vscode_file\titan007_pro\pipelines\jc_daily.py` | (businessDate, matchNum) 精确匹配，无 kickoff |
| 映射管线 | `mapping/scripts/build-team-map.ts` / `fill-jc-name.ts` | 日志 conflict-team-map.log / conflict-jc.log |
| 映射中间数据 | `mapping/data/jc/` | team_map.json(1727) / match_map.json(70311) / unmatched.json(26) / cursor.json |
| 事件级数据决策 | `docs/sofascore-database.md` :5/80/960 | match_incidents 确认不建表 |
| 对齐规则 | `docs/architecture.md` :739 | 任一源 FINISHED 即取 FINISHED |
| 数据源实例 | Al-Faisaly vs Abha 2026-01-21 | sofascore match_id 15392894（isAwarded）vs 球探 analysis/2923458cn.htm（0-2） |

---

## 六、已确认的阶段性结论

- **JSON 永久归档**：schedule/详情 JSON 是无损层，不删除（本次确认）。
- **本次改动范围**：仅补 schedules 5 字段（is_awarded / changes / change_timestamp / injury_time1 / injury_time2），暂不含 incidents 表与 Total saves（记录于 backlog）。
- 判胜识别标记（isAwarded）为最高优先级，理由见 1.1。
