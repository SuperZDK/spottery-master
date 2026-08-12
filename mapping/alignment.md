# 三源球队/赛事映射流程（sofascore ↔ titan ↔ jingcai）

> 本文件描述**当前重构后**的映射构建流程。旧的人工研究流程（标准译名检索、批次导出、
> worklist 等）已全部废弃删除，不再使用。

## 0. 设计原则

- 只存储 **两张最终表**：`cross_source_teams`（球队）+ `cross_source_leagues`（赛事）。
  所有中间产物一律以 JSON 文件存放，**不落 DB**。
- 主键锚点 = **sofascore id**（`sofaid`）。一行 = 一个真实球队。
- 某源字段为空 = 该源无此队数据。名字列只作展示/维护便利，**对齐只用 id**。
- 唯一实时网络请求：`tdl{id}.js`（titan 英文名）和 sofascore 搜索 API。其余全部读库。
- 冲突/异常一律写 `mapping/data/jc/` 下的外部日志，**不覆盖已有数据**。

## 1. 数据源（全部 DB，读 4 个 PG 库）

| 库 | 表 | 规模 | 说明 |
|---|---|---|---|
| `titan` | `titan_teams` | 1757 队（536 有 name_en） | 球探球队，含 name_cn/name_en |
| `titan` | `titan_jc_schedule` | 70,337 场 | titan 侧竞彩赛程镜像，sid 全局唯一 |
| `titan` | `titan_competitions` | 134 | 球探联赛 |
| `sofascore` | `teams` | 2159 队 | 含 name/slug/name_code |
| `sofascore` | `leagues` | 29 | 含 name/slug |
| `sporttery` | `jingcai_schedules` | 77,023 场 | 竞彩官方赛程，match_id 为主键 |
| `core` | `cross_source_teams` / `cross_source_leagues` | 空 → 由脚本写入 | 最终映射表 |

- 连接角色：`api_service`（titan/sofascore/sporttery 只读，core 读写）。
- 表数据由各 crawler 的 `import-to-pg.ts` 从爬虫输出灌入，mapping 脚本只读。
- **注意**：`titan_jc_schedule` 建表晚于初始化时对 `api_service` 的快照授权，需显式
  `GRANT SELECT ON titan_jc_schedule TO api_service;`（已补进 `db/init/titan/01-schema.sql`）。

## 2. 最终表结构（`db/init/core/01-schema.sql`）

```sql
CREATE TABLE cross_source_teams (
    sofaid       INTEGER PRIMARY KEY,   -- sofascore 球队 id（锚点）
    sofascoreen  TEXT NOT NULL,         -- sofascore entity.name（英文名）
    sofacode     TEXT,                  -- entity.nameCode（如 "VFB"）
    sofaslug     TEXT,                  -- entity.slug（如 "vfb-stuttgart"）
    sofanational BOOLEAN,               -- entity.national（国家队标记）
    titanid      INTEGER UNIQUE,        -- titan 球队 id（空=无此队）
    titancn      TEXT,                  -- titan 中文名（name_cn）
    titanen      TEXT,                  -- titan 英文名（tdl{id}.js 抓取）
    jingcainame  TEXT,                  -- 竞彩队名（竞彩无 id）
    updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE cross_source_leagues (
    titanid      INTEGER PRIMARY KEY,   -- titan 联赛 id（锚点，134 个全）
    titancn      TEXT,                  -- titan 中文名
    titanen      TEXT,                  -- titan 英文名
    sofaid       INTEGER UNIQUE,        -- 可空：sofascore 联赛 id（29 个有）
    sofascoreen  TEXT,                  -- 可空：sofascore 英文名
    jingcainame  TEXT,                  -- 竞彩联赛名（119 个有，15 个空）
    updated_at   TIMESTAMPTZ DEFAULT now()
);
```

## 3. 阶段一：球队映射（`mapping/scripts/build-team-map.ts`）

### 3.1 sofascore init
`SELECT team_id, name, name_code, slug FROM sofascore.teams`（2159 行）→ 逐行 UPSERT 进
`cross_source_teams`：填 `sofaid / sofascoreen / sofacode / sofaslug`，titan/竞彩字段留 NULL。
`sofanational` 此处 DB 表没有，留空，阶段一 B 由搜索 API 补齐。

### 3.2 titan 映射（断点续跑）
对 `titan_teams` 每支球队（按已填完 titan 字段的行跳过）：

1. **已有完整 titan 字段**（titanid+titancn+titanen 均非空）→ 跳过，游标推进。
2. **取英文名**：`GET https://zq.titan007.com/jsData/teamInfo/teamDetail/tdl{id}.js`
   - 返回 `var teamDetail = [id, cn, tw, en, ...]`，英文名在下标 3（已实测 tdl175.js）。
   - 失败重试 3 次，仍失败记 `mapping/data/jc/fetch-fail.log` 并跳过。
3. **搜 sofascore**：`GET https://api.sofascore.com/api/v1/search/teams?q={titanen}`
   - 过滤 `entity.sport.slug === "football" && entity.gender.slug === "M"`。
   - 取得分最高者得 `{id, name, nameCode, slug, national}`。
   - 限速 `sleep >= 200ms`；**无命中记 `no-search-hit.log`（titanid+中英文名），
     游标标 `no-hit` 并进入人工确认清单 `todo-manual.csv`**（见 3.3），不建半行。
     *注意：降级搜索（变体名/模糊匹配）已明确废弃，所有名字变体一律走人工确认，保证零错误。*
4. **落库**（按 `sofaid` 判定已有行）：
   - 已存在行：
     * titan 字段为 NULL → 填充 `titanid/titancn/titanen`；
     * 非 NULL 且与本次不一致 → 记 `conflict.log`（titanid、两侧 sofaid/名字），**不覆盖**；
     * 一致 → 跳过；
     * 同时若 `sofacode/sofaslug/sofanational` 为 NULL → 补齐。
   - 不存在 → 新建行填全。

输出统计：已映射 / 跳过 / 冲突 / 无命中 / 抓取失败。

### 3.3 人工确认回填（no-hit 队 → `todo-manual.csv` → `cross_source_teams`）

搜索无命中的队（如队名变体、改名、生僻译名）由人工在 sofascore 官网查证后回填，
保证零错误。全程只有人工可写 `sofaid`，脚本不做任何猜测。

#### 清单文件 `mapping/data/jc/todo-manual.csv`

11 列，UTF-8（带 BOM，Excel 可直接打开）：

```
titanid,titancn,titanen,sofaid,sofascoreen,sofacode,sofaslug,sofanational,jingcainame,期望gender,置信度
```

每次运行 `build-team-map.ts` 结束前自动重新生成：从游标收集全部 `no-hit` 队，
`titanen` 缺失时抓 `tdl{id}.js` 补全，`期望gender` 由 `titanen` 末尾 `(W)` 推断
（含 `(W)` → F，否则 M），`jingcainame` 从 `team_map.json` 的 `jc_names` 带入。

#### 人工操作（只填 2 列）

| 列 | 人工填什么 |
|---|---|
| `sofaid` | 在 sofascore 官网搜索该队，取 `/team/{id}` URL 中的数字 id |
| `置信度` | 填 `100` 表示确认 |

其余 9 列**不要动**：`titanid/titancn/titanen` 为 titan 侧标识，`sofascoreen/sofacode/
sofaslug/sofanational` 回填时由 `/api/v1/team/{id}` 自动补全并覆盖，
`jingcainame/期望gender` 由脚本预填。回填条件：`置信度=100` **且** `sofaid` 非空，缺一不可。

#### 回填校验（`backfillManual`，先于 titanLink 执行）

对每条满足条件的行：
1. `GET https://api.sofascore.com/api/v1/team/{id}` 精确取 `{name, nameCode, slug, national, gender}`
   —— 无搜索、无猜测，id 不存在则抛错。
2. **gender 校验**：期望（`期望gender` 列）与实际 `t.gender` 不符 → 拦截，记
   `conflict-team-map.log`，行保留在 CSV 待人工修正。
3. upsert `cross_source_teams`（`ON CONFLICT (sofaid) DO UPDATE`，填全 9 字段），
   **同时把游标该 titanid 标记为 `ok`** → 之后 `titanLink`/`buildTodoCsv` 不再处理它，
   已回填的行从 CSV 移除。
4. 校验/写入失败 → 记 `conflict-team-map.log`，行保留 CSV。

`backfillManual` 返回 `ok/fail/remaining` 三计数打印在控制台。

#### 运行

```bash
npx tsx mapping/scripts/build-team-map.ts           # 完整流程（回填 + 重生成清单）
npx tsx mapping/scripts/build-team-map.ts --backfill-only   # 只回填，跳过 sofaInit/titanLink
```

### 3.4 断点游标（`mapping/data/jc/team-map-cursor.json`）

`{ [titanId]: "ok" | "no-hit" | "fetch-fail" }`，用于断点续跑与清单生成：
- `ok`：已映射（或已人工回填），跳过。
- `no-hit`：搜索无命中，跳过自动搜索、纳入 `todo-manual.csv` 清单。
- `fetch-fail`：tdl 抓取失败，跳过待下轮重试。
- 参数：`--retry-no-hit` 清除 no-hit 重跑搜索；`--revalidate` 连 ok 也重新搜索验证；
  `--backfill-only` 只做人工回填。

## 4. 阶段一.5：三源比赛映射（`mapping/scripts/build-match-map.ts`）

把 sofascore / titan / 竞彩三方的比赛相互关联，落 `cross_source_matches`。
全部读库、无网络请求；全部用 **id + 时间**锚定，不靠名字匹配。
联赛映射（`cross_source_leagues`）也由此脚本填充。

### 4.1 数据源与驱动主表

| 源 | 表 | 规模 | 关键 id |
|---|---|---|---|
| titan 竞彩镜像 | `titan_jc_schedule` | 70,337 | **sid（驱动主表/锚点）** |
| titan 完整赛程 | `titan_schedules` | 73,247 | schedule_id |
| sofascore | `schedules` | 82,288 | match_id |
| 竞彩官方 | `jingcai_schedules` | 77,066 | match_id |

### 4.2 联赛映射（填 `cross_source_leagues`）

输入：`titan_competitions`（134，竞彩实际用到）全量入表，主键 = `titanid`。
- **titan→sofascore**（补全列，29 个有）：中英文名双键 + 显式别名表（`LEAGUE_NAME_ALIAS`）。
  titan 无 `name_en` 的杯赛靠中文别名（欧冠杯→UEFA Champions League 等）。
- **titan→竞彩**（`jingcainame`，119 个有）：知识库映射表 `LEAGUE_JC_ALIAS`
  （titanid → 竞彩全称）。竞彩用全称（"英格兰超级联赛"）、titan 用简称（"英超"），
  **两套命名体系不同，不能用机械相等判断**，映射由知识库 + 人工逐条核对。
- 15 个竞彩无对应的 titan 联赛 `jingcainame` 留空（瑞典甲/挪甲/苏冠/葡甲/法丙/智利乙/
  韩K2联/巴超联杯/加拿冠/日新杯/亚洲杯U20/阿夏赛/酋长杯/奥迪杯/FIFA系列赛）。
- 表结构已由旧版（sofaid 主键，只放得下 29 个）重建为 titanid 主键（134 个全量），
  脚本首跑自动检测旧结构并迁移。
- 实测：inserted=134 withSofa=29 withJc=119。

### 4.3 比赛映射算法（四步，全 id+时间）

| 步 | 关联 | 键 | 容差 |
|---|---|---|---|
| 1 | titan 内部 | `(sclass_id, home_team_id, away_team_id, kickoff_time)` | ±3 天 |
| 2 | titan→sofascore | `(league 映射 + 主客 sofaid + kickoff_time)` | ±90 分钟 |
| 3 | titan→竞彩 | `(business_date, match_num)` | ±1 天 |
| 4 | 比分二次校验 | titan_jc.full_score vs titan_schedules.full_score | 不一致记日志照填 |

- 球队/联赛 id 转换依赖 `cross_source_teams` / `cross_source_leagues`（96.1% 队覆盖）。
- 未命中某源 → 对应列留空，**不删行不猜**；完全未命中记 `unmatched-match.log`。

### 4.4 产物 `cross_source_matches`（脚本首跑自动建表）

```sql
CREATE TABLE cross_source_matches (
    titan_jc_sid      INTEGER PRIMARY KEY,   -- 锚点 = titan_jc_schedule.sid
    titan_schedule_id INTEGER UNIQUE,        -- 可空
    sofa_match_id     INTEGER UNIQUE,        -- 可空
    jc_match_id       INTEGER UNIQUE,        -- 可空
    business_date     DATE,
    kickoff_time      TIMESTAMPTZ,
    sclass_id         INTEGER,               -- 冗余
    home_sofaid       INTEGER,               -- 冗余，供聚合
    away_sofaid       INTEGER,               -- 冗余，供聚合
    updated_at        TIMESTAMPTZ DEFAULT now()
);
```

### 4.5 实测结果（2026-08-10 全量跑）

```
total=70337  titan_schedule=43991(62.5%)  sofa=40945(58.2%)  sporttery=70311(99.96%)
三源全对齐=33845  完全未命中=5  比分不一致=2（均为"取消|取消|Cancel"异常状态）
```

- sofa 未命中全部为 sofascore 爬虫未覆盖的联赛（美职联/巴西甲/韩K/俄超/阿甲/墨超
  及各类杯赛/国家队），是数据覆盖边界，非算法问题。
- 抽查 8 场三源对齐，主客队与比分（titan vs sofa）全部一致。

### 4.6 运行

```bash
npx tsx mapping/scripts/build-match-map.ts            # 联赛 + 比赛全流程
npx tsx mapping/scripts/build-match-map.ts --leagues-only  # 只填联赛表
```

## 5. 阶段二：竞彩名（`mapping/scripts/fill-jc-name.ts`）

重构自 titan007_pro 的 `pipelines/jc_daily.py` + `core/jc_store.py`（原逻辑读 JSON 文件），
改造成 **DB join 版**。中间产物（原 team_map/match_map/unmatched）以 JSON 存
`mapping/data/jc/`，不落 DB。

### 5.1 连接键
titan 侧 `titan_jc_schedule` ↔ 竞彩侧 `jingcai_schedules`：
- `match_num` 相等；
- `business_date` 容差 ±1 天（竞彩销售日有 D±1 漂移）；
- `kickoff_time` 容差 ±15 分钟。

### 5.2 中间产物（JSON 文件，`mapping/data/jc/`）
- `team_map.json`：`titan_team_id → {titan_team_cn, titan_team_en, jc_names[], jc_team_ids[], updated_at}`
  （每场 join 后累积观测到的竞彩队名/队 id）。
- `match_map.json`：`titan_sid → {jc_match_id, business_date, match_date, match_num, sclass_id,
  home_team_id, away_team_id, full_score, half_score, updated_at}`。
- `unmatched.json`：join 失败明细（按日期，仅日志）。
- `cursor.json`：已检索的最大 `business_date`（增量游标，2016 起）。

### 5.3 反填 `jingcainame`
对 `cross_source_teams` 中已有 `titanid` 的行，查 `team_map` 的观测候选：
- 唯一候选 → 填 `jingcainame`；
- ≥2 个不同候选 → 记 `conflict.log`（titanid + 候选名列表），不填。

### 5.4 增量
维护 `cursor.json`，只处理大于已检索日期的 `business_date`，避免全量重扫。

## 6. 目录结构

```
mapping/
├── .gitignore
├── alignment.md              # 本文件
├── scripts/
│   ├── package.json / package-lock.json / tsconfig.json / node_modules/
│   ├── build-team-map.ts     # 阶段一：sofascore + titan 球队映射
│   ├── build-match-map.ts    # 阶段一.5：三源比赛映射（联赛+比赛，落库）
│   └── fill-jc-name.ts       # 阶段二：竞彩名（DB join）
└── data/jc/                  # 运行时生成（gitignored）
    ├── team_map.json         # titan_team_id → 观测到的竞彩队名[]
    ├── match_map.json        # titan_sid → 竞彩 match_id 映射
    ├── unmatched.json        # join 失败日志
    ├── cursor.json           # 增量游标（已检索最大 business_date，阶段二）
    ├── team-map-cursor.json  # 阶段一断点游标（ok/no-hit/fetch-fail）
    ├── todo-manual.csv       # 人工确认清单（no-hit 队，人工填 sofaid+置信度）
    ├── fetch-fail.log        # tdl{id}.js 抓取失败
    ├── no-search-hit.log     # sofascore 搜索无命中（待人工）
    ├── conflict.log          # 冲突记录（不覆盖）
    ├── conflict-team-map.log # 阶段一冲突/人工回填校验失败明细
    ├── conflict-league.log   # 联赛映射多候选/无候选（人工抽查）
    └── unmatched-match.log   # 比赛未命中/比分不一致明细
```

## 7. 运行方式

```bash
npx tsx mapping/scripts/build-team-map.ts                  # 阶段一：球队映射（含人工回填+清单生成）
npx tsx mapping/scripts/build-team-map.ts --backfill-only  # 只回填 todo-manual.csv 已确认行
npx tsx mapping/scripts/build-team-map.ts --retry-no-hit   # 重跑所有 no-hit 队（清游标）
npx tsx mapping/scripts/build-team-map.ts --revalidate     # 全量重验（ok 队也重搜）
npx tsx mapping/scripts/build-match-map.ts                 # 阶段一.5：三源比赛映射（联赛+比赛）
npx tsx mapping/scripts/build-match-map.ts --leagues-only  # 只填联赛映射表
npx tsx mapping/scripts/fill-jc-name.ts                    # 阶段二：竞彩名
```

## 8. titan 爬虫改造（2026-08 重构）

### 8.1 analysis 三表（替代旧 titan_analysis 单表）

旧 `titan_analysis` 单表拆为三表，均由爬虫经 `core/analysis_store.py` 直写 DB：

| 表 | 内容 |
|---|---|
| `titan_analysis_matches` | 每场一行：比赛信息 + 赛前情报（briefing/media 心水重点）+ standings/lineup JSONB |
| `titan_analysis_h2h` | 交锋每条一行（v_data），带 sclass_id |
| `titan_analysis_recent` | 近期每条一行（h_data/a_data），带 sclass_id |

- `id` = 自增主键；`schedule_id` = 本场 sid；`ref_schedule_id` = 历史记录场次自己的 sid。
- 历史数据迁移：`scripts/migrate-analysis.ts`（旧 44251 条 → 三表，已执行）。
- `import-to-pg.ts` 不再导入旧 analysis（改由爬虫直写三表）。

### 8.2 数据源切换

| 数据 | 新源（优先） | 回退 |
|---|---|---|
| analysis 页面 | `live.nowscore.com/analysis/{sid}cn.html` | titan `zq.titan007.com/analysis/{sid}cn.htm` |
| analysis 数据 | `live.nowscore.com/analysisJs/data{sid}.js`（v_data/h_data/a_data） | 老完赛无数据 → titan |
| 亚盘+大小球 | `live.nowscore.com/odds/3in1Odds.aspx`（nowscore 优先，一次双盘） | titan `vip.titan007.com` |
| 欧赔 | 不变（`1x2d.titan007.com/{sid}.js`） | — |

### 8.3 野鸡赛/友谊赛过滤

- `config/ignore_sclass.json`：25 个 SclassId 黑名单（41 球会友谊等）。
- h2h/recent 每条记录按 `sclass_id` 过滤，黑名单记录剔除（逐条，不整场跳过）。
- h2h 只保留近 3 年（`ns_parser.filter_records`）。

### 8.4 赔率年份补全（爬虫侧）

- `core/odds_store.build_record` 对每条 `change.time` 用 `match_time` 推断年份（`_infer_year`），
  落盘 JSON 直接带完整时间，不再依赖导库推断。
- 跨年规则：赔率月份 > 比赛月份 → 上一年。

### 8.5 每日自动化（workset）

`pipelines/jc_workset.py` 对齐竞彩 workset 机制：

- **每日数据源**：`bf_jc.txt`（当日在售）+ `JcResult.aspx?d={date}`（历史完赛）。
- **analysis**：只爬一次（写三表）。
- **odds（亚+大小+欧）**：轮询爬取，**直接替换**（非增量）。截止 T = min(开赛, 禁售)；
  常规 60min → T-1h 每 10min → T-10min 每 5min → 开赛后 5min 最后一次。
- **赛果**：odds 停后只轮询赛果（JcResult 判定完场）。
- **排干**：按日批量导入（当天全部完场 → 清理 workset，由 import-to-pg 导 titan_jc_schedule）。
- 运行：`python -m pipelines.jc_workset --tick`（cron 每 5 分钟）。

### 8.6 已知边界

- nowscore `data{sid}.js` 只对**近期/未开赛**比赛有效，老完赛（多年前）无数据 → 回退 titan。
- `titan_euro_odds` 680 万行业务查询毫秒级（走索引）；PGAdmin 打开慢是 GUI 全表加载，非索引问题。
