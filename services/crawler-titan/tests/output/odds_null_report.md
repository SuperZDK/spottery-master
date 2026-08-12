# Titan Odds 三表 NULL 分布报告（纯 DB 只读，未联网）

检查对象：`titan_asian_odds` / `titan_over_under_odds` / `titan_euro_odds`（titan 库）。
当前 jc-workset 尚未成功排干写库（analysis 三表 0 行、over_under 8/1 后 0 行佐证），
**表中全部数据为历史 import-to-pg.ts 导入的产物**。

## 汇总

| 表 | 总行数 | 关键 NULL 字段 | NULL 数 | NULL 占比 |
|---|---|---|---|---|
| titan_asian_odds | 8,866,406 | change_time/line_raw/home_odds/away_odds/line_value/status | **0** | **0%** ✅ |
| titan_over_under_odds | 430,859 | over_odds / under_odds | 430,173 | **99.8%** ❌ |
| titan_euro_odds | 6,805,880 | home_win / away_win | 2,145,453 | **31.5%** ❌ |

## 根因（已定位到历史 JSON 字段名不匹配）

历史 import 脚本（`import-to-pg.ts`，已删除）读源 JSON 的 `changes` 字段名，与目标表/插入列不一致：

| 类型 | 源 JSON 字段 | import 写入列 | 结果 |
|---|---|---|---|
| asian | `home` / `away` | home_odds / away_odds | 匹配 ✅ |
| over_under | `over` / `under` | over_odds / under_odds | **不匹配** → NULL |
| euro | `home` / `draw` / `away` | home_win / draw / away_win | **不匹配**（home/away）→ NULL |

实测验证（历史 JSON `.../european/.../2989327/104.json`）：
```json
{"time": "05-24 18:10", "home": 2.15, "draw": 3.7, "away": 3.1}
```
→ import 后 DB 行 `home_win=NULL, draw=3.7, away_win=NULL`（仅 draw 命中）。

## NULL 分布细节

### over_under（over_odds/under_odds 为 NULL）
- 按 subtype：full 282,043 / half 148,130 行全 NULL（只 line_raw 有值）
- 按公司：1→6551、8→134930、12→116002、17→172690（全部公司受影响）
- 按年份：2022 全 NULL、2023 全 NULL、2025 99.7%、2026 99.8%（2024 无 over_under 数据）

### euro（home_win/away_win 为 NULL）
- 按公司：2→645,176、90→647,407、104→276,689、115→315,694、281→260,487（177 无 NULL）
- 按年份占比：2021 起明显升高（2021 34%、2022 50%、2023 50%、2024 48%、2025 51%）
- NULL 行特征：`home_win=NULL, draw=有值, away_win=NULL`，且 rates/kelly 全 NULL

## 与当前 jc-workset 代码的关系（结论）

**当前代码不受此影响，不会产生这些 NULL。**

实测当前抓取路径产出字段，与 `core/jc_db.insert_odds` 写入列完全匹配：

| 路径 | 实测产出字段 | insert_odds 读取 |
|---|---|---|
| asian（nowscore/titan） | `line, home, away, status` | `line, home, away, status` ✅ |
| over_under（nowscore/titan） | `line, big, small, status` | `line, big, small, status` ✅ |
| euro（OddsHistory） | `home_win, draw, away_win, *_rate, kelly_*, is_initial` | 同名 ✅ |

- 当前 jc-workset 只写公司 1（亚盘+大小球）和 115（欧赔），且走 `scrape_dual_odds` /
  `scrape_euro_from_oddslist`，字段名匹配，不会产生历史那种 NULL。
- DB 存量 NULL 是历史 import 的遗留脏数据。若需清洗，可对现有行按源 JSON 重新映射
  （`over→over_odds, under→under_odds, home→home_win, away→away_win`），但当前代码无需改动。

## 建议（可选）

如需恢复历史数据质量，编写一次性清洗脚本：
1. over_under：`UPDATE titan_over_under_odds SET over_odds=x.over, under_odds=x.under ...` 需回源 JSON
2. euro：`home_win=home, away_win=away`（源 JSON 字段 `home/draw/away`）
