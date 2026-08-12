# Titan 竞彩（jc）定时任务策略与流程

> 版本：2026-08
> 模块：`services/crawler-titan/pipelines/jc_workset.py`（常驻 daemon）
> 关联：`core/workset.py` / `core/drain.py` / `core/sporttery_ref.py` / `core/jc_db.py`

---

## 一、角色定位

titan 竞彩爬虫**只做三件事**：

1. **获取赛程**（每业务日只读一次）
2. **获取详情**（analysis，每场一次）
3. **获取比赛开始前的赔率**（亚盘/大小球 + 欧赔）

**不在本侧查赛果/比分/完赛**——赛果/延期/取消与 **sporttery**（workset + DB）对齐；排干以 sporttery 的 `completeDate` 为准。

## 二、运行形态

**常驻 daemon**（非 cron tick）：

```bash
python -m pipelines.jc_workset                 # 启动常驻 daemon（前台，Ctrl+C 停止）
python -m pipelines.jc_workset --once          # 跑一个 cycle 后退出（测试）
python -m pipelines.jc_workset --once --dry-run --now "2026-08-10 15:00"   # 状态机测试（不联网不落盘）
```

循环逻辑：

```
loop():
    next_due = cycle()                          # 跑一遍状态机
    wait = clamp(next_due - now, MIN_WAIT=60s, MAX_WAIT=2h)
    sleep(wait)                                 # 精确睡到下一个该干活的时间点
```

- 浏览器常驻（playwright thread-local），出错 `close()` 重置重建
- 请求间隔：**场与场之间 `sleep(random 1~3s)`**，串行不并行

## 三、配置参数

| 参数 | 值 |
|---|---|
| ODD_INTERVAL | 30 分钟（常规轮询格） |
| T | **开赛时间**（不再 min 停售） |
| BACKUP_AFTER_KICKOFF_H | 1（兜底 = 开赛 +1h） |
| MIN_WAIT / MAX_WAIT | 60s / 2h |
| DISCOVERY | 11:00 开市，11:00~11:30 每 5min，之后每小时 |
| 亚盘+大小球 | 澳门 company 1，仅全场（1 请求） |
| 欧赔 | 威廉希尔 company 115（JS + OddsHistory = 2 请求） |
| 每次轮询 | 2 次抓取 = 3 HTTP |

## 四、数据源

| 源 | 内容 | 用途 |
|---|---|---|
| `jc.titan007.com/xml/bf_jc.txt` | **当日在售**赛程 | 每业务日**只读一次**（discovery 发现场次） |
| `jc.titan007.com/handle/JcResult.aspx?d={date}` | 该日赛程列表 | 历史日回填赛程（只读一次，不轮询赛果） |
| sporttery workset.json + DB | 赛果/延期/取消 | **排干对齐**（status/比分/Refund） |

## 五、完整 cycle 流程（状态机）

```
cycle():
  加载 workset（含旧格式迁移、completeDate 默认 2026-08-01）
  if workset 总场数 == 0:
      → DISCOVERY
  else:
      → NORMAL
      排空后 → 下次发现时间；否则 → nextWake（最短唤醒）
```

### ① DISCOVERY（workset 空）

```
扫 [completeDate+1 .. 今天]，每业务日只读一次：
  今天  → bf_jc.txt（当日在售，business_date 取 field[21]）
  历史日 → JcResult?d={date}（赛程列表，拿 sid）
每场 upsert 进 workset（首次进场的场次记录 first_odds_at = 发现时刻）
返回下次发现时间：11:00 开市 / 11:00~11:30 每5min / 之后每小时 / 次日11:00
```

### ② NORMAL（4 步，按顺序）

```
1) 赔率轮询：对每个未结束场次，按每场独立时间表
   _next_odds_due() 算下一轮询点 → 到了就 poll_odds（3 HTTP）→ sleep 1~3s

2) analysis：每场只抓一次（titan 页 + nowscore 补 media）→ sleep 1~3s

3) 兜底：每场 kickoff + 1h 且未兜底 → 再抓一次终盘（补赛前赔率）→ 标记 backup_done

4) 排干：对 business_date <= sporttery.completeDate 且每场 analysis+odds 齐的日期：
   a. 按 sporttery 赛果填 status/比分（Refund→-10/-1:-1；Payout→-1+真实比分）
   b. 整日写 DB（titan_jc_schedule + 赔率三表 + analysis 三表）
   c. 删 matches/{sid}.json → removeDate → 推进 titan.completeDate
   d. 覆盖对齐：sporttery 有而 titan 无的场次 → 记 data/jc/pending.json
```

### ③ nextWake（下一次该醒的时间）

```
min(所有场次的下一 odds 轮询点, 各场 kickoff+1h 兜底点, now+2h)
```

## 六、每场赔率时间表（锚定 first_odds_at）

```
首抓：进场时刻（first_odds_at）
常规：first_odds_at + 30m·k，取 ≤ T-1h
关键点：T-1h / T-30m / T-15m / T-5m / T（T 真正执行）
T = 开赛时间
```

- 每场次数取决于"进场→开赛"时长，实测周末约 17~43 次/场（晚场不截断后更多）

## 七、赛前赔率过滤（亚盘/大小球）

- 存储前只保留 `change_time <= kickoff`（用 `_infer_year` 把 `M-d HH:MM` 补全年份再比）
- **转换失败 → 保留**（不冒"少"的风险）
- **过滤后为空 → 保留全部 + log 容忍**（赛前不缺失优先）
- **欧赔不过滤**（无滚球）；titan 的"即"标注不可靠，不依赖

## 八、排干 = sporttery 确认该日完赛

| 条件 | 说明 |
|---|---|
| `business_date <= sporttery.completeDate` | sporttery 说该日都完赛 |
| 每场 analysis + odds 数据齐 | titan 侧采集完成 |

写库时：status/比分**从 sporttery DB 读**（`get_day_results`），覆盖对齐缺场次记 pending。

## 九、数据流总结

```
bf_jc/JcResult ──发现──▶ workset.json（调度状态）
                          │  每场
                          ▼
                matches/{sid}.json（analysis + 赛前 odds 暂存）
                          │  排干（sporttery 确认完赛）
                          ▼
        titan 库：titan_jc_schedule + 亚/大/欧赔三表 + analysis 三表
                          ▲
        sporttery workset/DB ──对齐──▶ status/比分/Refund
```

## 十、权限（跨库只读）

- crawler **只写自己的库**；读权限已全放开（所有角色可 `SELECT` 所有库，见 `db/init/00-create-databases.sh`）
- titan 经 `core/db.connect_ro("sporttery")` 跨库只读

## 十一、请求量（估算，周末两天）

| 项 | 数量 |
|---|---|
| odds 时间表轮询（T=开赛，晚场不截断） | ~1,400 次 × 3 ≈ 4,200 |
| analysis | 49 场 ≈ 147 |
| 兜底（开赛+1h） | 49 场 ≈ 147 |
| （已移除 JcResult 赛果轮询，省 ~170） | — |
| **合计** | **≈ 4,500 请求/两天** |

峰值（临赛同点多场）约几十请求/分钟，靠场间 1~3s 间隔 + 页面加载自然摊开。

## 十二、手动运行命令

```bash
# 在 services/crawler-titan 目录下
python -m pipelines.jc_workset                        # 前台启动常驻 daemon
python -m pipelines.jc_workset --once                 # 单 cycle 测试
python -m pipelines.jc_workset --once --dry-run       # 状态机测试（不联网不落盘）
```

> 前置：PostgreSQL 容器已起（`docker compose up -d db`），`services/crawler-titan` 下 `pip install -r requirements.txt`。
