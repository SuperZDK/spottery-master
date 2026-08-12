# Data Contract: jc-workset（直写 DB）

Scope: `pipelines/jc_workset.py` — 竞彩每日自动化常驻 daemon。
titan 只做三件事：**获取赛程 / 获取详情 / 获取比赛开始前的赔率**，最终整日排干直写 titan 库。

> 不再落盘 analysis/odds JSON（`data/analysis|odds/` 目录仅存历史，不再写入）。
> 爬虫直写 DB；历史 JSON → PG 导入脚本（import-to-pg）已删除。

## 写库表

| 表 | 写入语义 | 写入方 |
|---|---|---|
| `titan_jc_schedule` | upsert（ON CONFLICT (sid) DO UPDATE） | `core/jc_db.upsert_jc_schedule` |
| `titan_analysis_matches` | upsert（ON CONFLICT (schedule_id) DO UPDATE） | `core/analysis_store.upsert_analysis` |
| `titan_analysis_h2h` | upsert（ON CONFLICT (schedule_id, match_date, home_team_id, away_team_id)） | 同上 |
| `titan_analysis_recent` | upsert（ON CONFLICT (schedule_id, side, match_date, home_team_id, away_team_id)） | 同上 |
| `titan_asian_odds` | append-only（ON CONFLICT DO NOTHING） | `core/jc_db.insert_odds` |
| `titan_over_under_odds` | append-only（ON CONFLICT DO NOTHING） | 同上 |
| `titan_euro_odds` | append-only（ON CONFLICT DO NOTHING） | 同上 |

> 爬取配置固定：亚盘+大小球 = 澳门（company 1）仅全场；欧赔 = 威廉希尔（company 115）。

## 赔率变化行（changes）

- `change_time`：由爬虫侧 `core/jc_db._infer_year(match_time, "M-d HH:MM")` 补全年份后转化
  （赔率月份 > 比赛月份 → 上一年；无法推断时丢弃该行）。落库即带完整时间。
- **亚盘/大小球赛前过滤**：存储前只保留 `change_time <= kickoff` 的变动
  （`pipelines/jc_workset._filter_prematch`）；转换失败保留；过滤后为空 → 保留全部 + log 容忍。
- **欧赔不过滤**（无滚球）。
- 重复行由唯一键（`schedule_id, company_id, change_time, line_raw, home/big, away/small`）去重，
  `ON CONFLICT DO NOTHING` 幂等。

## 亚盘盘口映射（`core/jc_db.asian_line_to_value`）

| 盘口中文 | 数值 |
|---|---|
| 平手 | 0 |
| 半球 | 0.5 |
| 球半 | 1.5 |
| 受让前缀 | 取负（受让半球 → -0.5） |
| X/Y 组合 | 取中点（平手/半球 → 0.25） |

## 排干 gate

`business_date <= sporttery.completeDate`（读 sporttery workset.json）且该日每场
analysis + odds 数据齐 → `core/drain.drain_date` 整日写库；成功后
`advance_complete_date` 逐日推进 completeDate（不回退、不 reconcile DB）。

## 赛果填充（排干前，`_fill_results_at_drain`）

| 情况 | status | 比分 |
|---|---|---|
| JcResult 有该场（正常完赛） | -1 | 全场 + 半场比分 + home/away_score |
| JcResult 无 + sporttery `Refund` | -10 | `-1:-1` |
| JcResult 无 + 其他 | 记 `data/jc/pending.json` 待核查 | — |

## 本地状态文件（data/）

| 文件 | 用途 |
|---|---|
| `data/jc/workset.json` | workset 状态机：completeDate + dates{business_date: matches{sid}} |
| `data/jc/matches/{sid}.json` | 每场 detail（analysis + 赛前 odds），排干后删除 |
| `data/jc/pending.json` | 人工核查清单（Refund 兜底 / 覆盖对齐缺场次） |
