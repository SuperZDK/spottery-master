# Titan007 爬虫（jc-workset 单线）

titan（球探）侧只保留一条线：**竞彩每日自动化（jc-workset）常驻 daemon**。
titan 只做三件事：**获取赛程 / 获取详情 / 获取比赛开始前的赔率**。
**不在本侧查赛果**——赛果/延期/取消直接与 sporttery 对齐。

> 历史代码（批量 pipeline / live 增量 / jc-daily 回填 / import-to-pg）已全部删除。

## 数据源

| 源 | 内容 | 用途 |
|---|---|---|
| `jc.titan007.com/xml/bf_jc.txt` | **当日在售**赛程 | 每业务日**只读一次**（discovery 发现场次） |
| `jc.titan007.com/handle/JcResult.aspx?d={date}` | 该日赛程列表 | 历史日回填赛程（只读一次）+ 排干时填赛果 |
| sporttery workset.json + DB | 赛果/延期/取消 | **排干对齐**（status/比分/Refund） |

### 详情（analysis）

- **titan 页**（`zq.titan007.com/analysis/{sid}cn.htm`）：standings + 本场信息 + h2h/recent
- **nowscore 只补 media**（`live.nowscore.com/analysis/{sid}cn.html`）：心水推荐（趋势/盘路/信心指数/对赛成绩/正文）
- 每场只抓一次；野鸡赛按 `config/ignore_sclass.json` 黑名单过滤（逐条）+ 只保留本场开赛前 5 年内的 h2h/recent（按 match_date 年份过滤，基准=本场开赛年份，非今天）

### 赔率

- **亚盘 + 大小球**：只澳门（company 1），**仅全场**；nowscore 一次 `3in1Odds.aspx` 请求双盘，空则回退 titan（`vip.titan007.com`）
- **欧赔**：只威廉希尔（company 115），`1x2d.titan007.com/{sid}.js` + OddsHistory.aspx
- **每次 odds 轮询 = 2 次抓取**（亚大 1 请求 + 欧赔 JS/OddsHistory 2 请求 = 3 HTTP）
- **反爬间隔**：场与场之间 `sleep(random 1~3s)`（串行，不并行）

## 爬取配置（运行时固定，配置文件不改）

| 项 | 值 |
|---|---|
| 亚盘公司 | 澳门（company 1） |
| 大小球公司 | 澳门（company 1） |
| 欧赔公司 | 威廉希尔（company 115） |
| 盘型 | 仅全场（`full`） |

## 每场独立赔率时间表（锚定 first_odds_at）

- **首抓**：进场时刻（first_odds_at 锚定）。
- **常规 30 分钟**：first_odds_at + 30m·k，取 ≤ T-1h。
- **关键点**：T-1h / T-30m / T-15m / T-5m / **T（真正执行）**。
- **T = 开赛时间**（完全以开赛时间为基准，不再用停售时间）。
- **兜底**：每场 **开赛 + 1h** 抓一次终盘（补赛前赔率，`backup_done`）。
- **analysis 每场只抓一次**。

## 赛前赔率过滤（亚盘/大小球）

titan 的"即"标注不可靠（开赛后也标"即"），故**按时间过滤**：存储前只保留
`change_time <= kickoff` 的变动（`_infer_year` 补年份后比较）；转换失败保留；
过滤后为空 → 保留全部 + log 容忍（**赛前不缺失优先**）。**欧赔不过滤**（无滚球）。

## 排干 = sporttery 确认该日完赛

- 读 sporttery workset.json 的 **`completeDate`**：`business_date <= completeDate` 才算该日完赛（排干 gate）。
- 且每场 analysis + odds 齐 → 整日写 DB（titan_jc_schedule + 赔率三表 + analysis 三表）。
- 写库前**拉一次 titan 当日 JcResult** 填赛果（`_fill_results_at_drain`）：
  - 出现在 JcResult → `status=-1` + 全场比分 + **半场比分**（保留）+ home/away_score；
  - 未出现（无效/取消）→ 查 sporttery：`Refund` → `-10` + `-1:-1`；其他 → 记 pending。
- **覆盖对齐**：sporttery 有而 titan 无的场次记 `data/jc/pending.json`（可多不可少）。

## 常驻 daemon

- `loop()`：`nextDue = cycle(); sleep(clamp(nextDue-now, MIN_WAIT=60s, MAX_WAIT=2h))`，浏览器常驻。
- workset 空 → **DISCOVERY**：扫 `[completeDate+1..今天]`（每业务日只读一次）；11:00 开市，11:00~11:30 每 5 分钟突发，之后每小时。
- 否则 → **NORMAL**：odds 按时间表轮询 + analysis 一次 + 开赛+1h 兜底 + 排干。

## workset

- `data/jc/workset.json`：`{version, updatedAt, completeDate, dates: {business_date: {attempts, matches: {sid: {...}}}}}`
- `data/jc/matches/{sid}.json`：每场 detail（analysis + 赛前 odds），按 sid 存放。
- completeDate 默认 `2026-08-01`，随排干逐日推进。

> **权限**：crawler 只写自己的库；读权限已全放开（所有角色可 `SELECT` 所有库，见 `db/init/00-create-databases.sh`）。titan 经 `core/db.connect_ro("sporttery")` 跨库只读。

## 运行

```bash
python -m pipelines.jc_workset                 # 启动常驻 daemon
python -m pipelines.jc_workset --once          # 跑一个 cycle 后退出（测试）
python -m pipelines.jc_workset --once --dry-run --now "2026-08-10 15:00"   # 状态机测试
```

8/1→今天的历史回填由 daemon 增量消化（发现扫到即处理，逐日排干推进 completeDate），无需单独脚本。

## 野鸡赛/友谊赛过滤

`config/ignore_sclass.json`：25 个 SclassId 黑名单（41 球会友谊、1299 国际冠军杯 等）。
h2h/recent 每条记录按 `sclass_id` 过滤，黑名单记录剔除（逐条，不整场跳过）；h2h/recent 只保留本场开赛前 5 个年份内的记录（按 match_date 年份，基准=本场开赛年份）。

## 反爬措施

| 措施 | 说明 |
|---|---|
| **UA 轮换** | 146 条真实 UA，Chrome/Firefox/Edge/Safari/Opera 混用 |
| **中文 locale** | 模拟国内用户，上海时区 |
| **随机 viewport** | 1200~1400 × 800~900 |
| **Referer 校验** | OddsHistory.aspx 必须带正确 Referer |
| **随机延迟** | 每次请求后 1~2 秒（workset 场间 1~3s） |
| **缓存规避** | JS 数据文件 URL 带随机参数 |
| **自动重试** | 失败自动重试 2 次 |
| **直接抓 JS 数据** | 绕过动态渲染，直接请求数据源 |

## 测试

```bash
python -m pytest tests -v
```

覆盖：`test_jc_parser.py`（JcResult 报文解析）、`test_smoke.py`（模块导入冒烟）。
