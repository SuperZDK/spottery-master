import { Page } from "puppeteer";
import { BrowserPool } from "../../engine/browser-pool.js";
import { Workset, WorksetMatch } from "./workset.js";
import { fetchVotes, fetchFixedBonus, gotoHome, recoverPage } from "./api.js";
import { fetchMissingDetails } from "./details.js";
import { drainDate, advanceCompleteDate, reconcileCompleteDate, DEFAULT_COMPLETE_DATE } from "./drain.js";
import { isRefund, isSettled } from "./completeness.js";
import { MINUTE, formatDate, addDaysStr, parseDate, effectiveStop } from "./time.js";

const ODD_INTERVAL = 30 * MINUTE;
const VOTE_CONTINUE_INTERVAL = 60 * MINUTE;   // 赛后赛果续抓频率
const VOTE_MIN_INTERVAL = 10 * MINUTE;         // votes 最小间隔
const MIN_WAIT = 60 * 1000;
const MAX_WAIT = 2 * 60 * MINUTE;
const DISCOVERY_BURST_STEP = 5 * MINUTE;       // 11:00~11:30 每 5 分钟
const DISCOVERY_FALLBACK_STEP = 60 * MINUTE;   // 11:30 后每小时（防开市晚）

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// 每场赔率时间表（纯函数，锚定 firstOddsAt）：
//   常规 30 分钟点：firstOddsAt + 30m·k，取 ≤ T-1h
//   关键点：T-1h, T-30m, T-15m, T-5m, T（含 T 点，会真正执行）
// 返回 > prevAt（上次轮询）的最小下一格；走完返回 null。
function nextOddsPoint(prevAt: number, firstAt: number, t: number): number | null {
  const cands: number[] = [];
  const tMinus1h = t - 60 * MINUTE;
  let slot = firstAt;
  while (slot <= prevAt) slot += ODD_INTERVAL;
  while (slot <= tMinus1h) {
    cands.push(slot);
    slot += ODD_INTERVAL;
  }
  for (const off of [60 * MINUTE, 30 * MINUTE, 15 * MINUTE, 5 * MINUTE, 0]) {
    const p = t - off;
    if (p > prevAt) cands.push(p);
  }
  cands.sort((a, b) => a - b);
  return cands[0] ?? null;
}

export class JingcaiLiveService {
  private pool: BrowserPool;
  private ws = new Workset();
  private page: Page | null = null;
  private running = false;

  constructor(pool: BrowserPool) {
    this.pool = pool;
  }

  async start(): Promise<void> {
    this.ws.load();
    await reconcileCompleteDate(this.ws);
    this.ws.save();
    const page = await this.pool.getPage();
    page.setDefaultTimeout(60000);
    this.page = await gotoHome(page);
    this.running = true;
    console.log("[Live] workset 驱动实时爬虫已启动");
    await this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const nextDue = await this.cycle();
        const wait = Math.min(MAX_WAIT, Math.max(MIN_WAIT, nextDue - Date.now()));
        await sleep(wait);
      } catch (err) {
        console.error(`[Live] 周期异常: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
        try {
          if (this.page) this.page = await recoverPage(this.pool, this.page);
        } catch {}
        await sleep(60 * 1000);
      }
    }
  }

  private async cycle(): Promise<number> {
    const now = new Date();
    this.ws.load();

    if (this.ws.totalMatches() === 0) {
      return this.discoveryCycle(now);
    }

    await this.normalCycle(now);

    if (this.ws.totalMatches() === 0) {
      return this.nextDiscoveryAt(new Date());
    }
    return this.nextWake(new Date());
  }

  // ─── NORMAL：赔率定节奏，votes 挂靠 ─────────────────────────
  private async normalCycle(now: Date): Promise<void> {
    const piggyDates = new Set<string>();

    // 1) 赔率：每场独立时间表
    for (const date of this.ws.dates) {
      for (const m of this.ws.matchesOf(date)) {
        if (isRefund(m) || isSettled(m)) continue;
        const due = this.nextOddsDue(m, now);
        if (due === null || due > now.getTime()) continue;
        try {
          await this.pollOdds(m, now);
          piggyDates.add(date);
        } catch (err) {
          console.error(`[Live] odds #${m.matchId} 失败: ${err instanceof Error ? err.message : String(err)}`);
          if (this.page) this.page = await recoverPage(this.pool, this.page);
        }
        await sleep(200 + Math.random() * 500);
      }
    }

    // 2) votes：跟随赔率（10 分钟最小间隔）+ 赛后续抓
    const votesDone = new Set<string>();
    for (const date of piggyDates) {
      await this.maybeVotes(date, now, votesDone);
    }
    for (const date of this.ws.dates) {
      if (this.ws.isDateReady(date) || this.ws.isEmpty(date)) continue;
      if (this.hasOddsActive(date, now)) continue;
      const lastMs = this.voteLastMs(date);
      if ((lastMs ?? 0) + VOTE_CONTINUE_INTERVAL <= now.getTime()) {
        await this.maybeVotes(date, now, votesDone);
      }
    }

    // 3) 详情：只抓一次（拿到 kickoff → T）
    if (this.page) this.page = await fetchMissingDetails(this.page, this.pool, this.ws, "Live");

    // 4) 排干就绪日
    const drained: string[] = [];
    for (const date of this.ws.dates) {
      if (!this.ws.isDateReady(date)) continue;
      const ok = await drainDate(this.ws, date);
      if (ok) {
        this.ws.deleteMatchFiles(date);
        this.ws.removeDate(date);
        drained.push(date);
        console.log(`[Live] ${date} 导入并排干`);
      } else {
        this.ws.incrementAttempts(date);
        console.log(`[Live] ${date} 导入失败保留重试`);
      }
      await sleep(200 + Math.random() * 500);
    }

    if (drained.length > 0) advanceCompleteDate(this.ws, now, drained);
    this.ws.save();
  }

  private async maybeVotes(date: string, now: Date, done: Set<string>): Promise<void> {
    if (done.has(date)) return;
    const lastMs = this.voteLastMs(date);
    if (lastMs !== null && now.getTime() - lastMs < VOTE_MIN_INTERVAL) return;
    done.add(date);
    try {
      await this.pollVotes(date, now);
    } catch (err) {
      console.error(`[Live] votes ${date} 失败: ${err instanceof Error ? err.message : String(err)}`);
      if (this.page) this.page = await recoverPage(this.pool, this.page);
    }
  }

  private voteLastMs(date: string): number | null {
    const last = this.ws.lastVoteAt(date);
    return last ? Date.parse(last) : null;
  }

  // 该日期是否还有未走完赔率时间表的场次
  private hasOddsActive(date: string, now: Date): boolean {
    return this.ws.matchesOf(date).some((m) => {
      if (isRefund(m) || isSettled(m)) return false;
      return this.nextOddsDue(m, now) !== null;
    });
  }

  // 每场独立赔率时间表的下一格
  private nextOddsDue(m: WorksetMatch, now: Date): number | null {
    if (isRefund(m) || isSettled(m)) return null;
    if (!m.firstOddsAt) return now.getTime();   // 未排程 → 立即首抓（pollOdds 会落 firstOddsAt）
    const firstAt = Date.parse(m.firstOddsAt);
    const t = effectiveStop(m.businessDate, m.kickoffTime).getTime();
    if (!m.lastOddsAt) return Math.min(firstAt, now.getTime());   // 首抓在进场时刻
    return nextOddsPoint(Date.parse(m.lastOddsAt), firstAt, t);
  }

  private nextWake(now: Date): number {
    let next = now.getTime() + MAX_WAIT;
    for (const date of this.ws.dates) {
      for (const m of this.ws.matchesOf(date)) {
        if (isRefund(m) || isSettled(m)) continue;
        const due = this.nextOddsDue(m, now);
        if (due !== null) next = Math.min(next, due);
      }
    }
    for (const date of this.ws.dates) {
      if (this.ws.isDateReady(date) || this.ws.isEmpty(date)) continue;
      if (this.hasOddsActive(date, now)) continue;
      const lastMs = this.voteLastMs(date);
      next = Math.min(next, (lastMs ?? 0) + VOTE_CONTINUE_INTERVAL);
    }
    return next;
  }

  private async pollVotes(date: string, now: Date): Promise<number> {
    const merged = await fetchVotes(this.page!, date);
    if (merged.length === 0) {
      if (this.ws.hasDate(date)) this.ws.setLastVoteAt(date, now.toISOString());
      return 0;
    }
    this.ws.upsertMatches(merged);
    if (this.ws.hasDate(date)) this.ws.setLastVoteAt(date, now.toISOString());
    let appended = 0;
    for (const m of merged) {
      if (this.ws.recordVoteSnapshot(m.matchId, m.businessDate, now.toISOString(), m.had, m.handicap)) appended++;
      const wm = this.ws.matchesOf(m.businessDate).find((x) => x.matchId === m.matchId);
      if (wm && !wm.firstOddsAt) wm.firstOddsAt = now.toISOString();
    }
    console.log(`[Live] votes ${date}: ${merged.length} 场, 新增 votes 快照 ${appended}`);

    // 结算兜底：新结算场次补一次最终赔率（入库 oddsHistory 永远完整）
    for (const m of merged) {
      if (!m.matchResult || m.poolStatus === "Refund") continue;
      const wm = this.ws.matchesOf(m.businessDate).find((x) => x.matchId === m.matchId);
      if (wm && !wm.finalOddsFetched) {
        try {
          await this.pollOdds(wm, now);
          wm.finalOddsFetched = true;
          console.log(`[Live] 结算兜底 #${m.matchId} 最终赔率已补`);
        } catch (err) {
          console.error(`[Live] 结算兜底 #${m.matchId} 失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    return merged.length;
  }

  private async pollOdds(m: WorksetMatch, now: Date): Promise<void> {
    if (!m.firstOddsAt) m.firstOddsAt = now.toISOString();
    const value = await fetchFixedBonus(this.page!, m.matchId);
    if (!value) {
      console.warn(`[Live] odds #${m.matchId} 无返回`);
      return;
    }
    let jf = this.ws.readMatch(m.matchId) ?? this.ws.newMatchFile(m.matchId, m.businessDate);
    jf.detail = { ...(jf.detail ?? {}), oddsHistory: value, scrapedAt: now.toISOString() };
    jf.lastOddsAt = now.toISOString();
    m.lastOddsAt = now.toISOString();
    this.ws.saveMatch(jf);
    console.log(`[Live] odds #${m.matchId}: ${(value?.oddsHistory?.hadList ?? []).length} 条快照`);
  }

  // ─── DISCOVERY：workset 无比赛时的开市发现 ─────────────────
  private async discoveryCycle(now: Date): Promise<number> {
    this.ws.pruneEmptyDates();
    const targets = this.discoveryTargets(now);
    if (targets.length === 0) {
      return this.nextDayOpenAt(now);
    }
    console.log(`[Live] 发现模式: 区间 ${targets[0]} ~ ${targets[targets.length - 1]}`);
    for (const date of [...targets].reverse()) {
      try {
        await this.pollVotes(date, now);
      } catch (err) {
        console.error(`[Live] 发现 ${date} 失败: ${err instanceof Error ? err.message : String(err)}`);
        if (this.page) this.page = await recoverPage(this.pool, this.page);
      }
      await sleep(200 + Math.random() * 500);
    }
    this.ws.save();
    return this.nextDiscoveryAt(new Date());
  }

  private discoveryTargets(now: Date): string[] {
    const today = formatDate(now);
    const base = this.ws.completeDate ?? DEFAULT_COMPLETE_DATE;
    const out: string[] = [];
    let cur = addDaysStr(base, 1);
    while (cur <= today) {
      out.push(cur);
      cur = addDaysStr(cur, 1);
    }
    return out;
  }

  private openTime(dateStr: string): Date {
    const d = parseDate(dateStr);
    d.setHours(11, 0, 0, 0);
    return d;
  }

  private nextDayOpenAt(now: Date): number {
    return this.openTime(addDaysStr(formatDate(now), 1)).getTime();
  }

  private nextDiscoveryAt(now: Date): number {
    if (this.discoveryTargets(now).length === 0) return this.nextDayOpenAt(now);
    const open = this.openTime(formatDate(now));
    const t = now.getTime();
    if (t < open.getTime()) return open.getTime();
    if (t - open.getTime() < 30 * MINUTE) return t + DISCOVERY_BURST_STEP;
    return t + DISCOVERY_FALLBACK_STEP;
  }
}
