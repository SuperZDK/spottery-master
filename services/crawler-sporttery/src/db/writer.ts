import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import pg from "pg";
import { stopTimeStr } from "../sources/jingcai/time.js";

// ============================================================
// 竞彩(sporttery) 双写层：爬虫边爬边把 JSON 同步落 PG（幂等 upsert）
// 与 scripts/import-to-pg.ts 共用列定义/SQL/窗口事务逻辑。
// 实时任务与历史爬虫都调用本模块；任何写库失败只记日志不致命，
// 保证爬取本身不受 PG 抖动影响（双写过渡期）。
// 运行环境：被 src/ 内任意模块 import（路径基于 monorepo 根解析）
// ============================================================

const MONOREPO = join(import.meta.dirname, "../../../..");
loadEnv({ path: join(MONOREPO, ".env") });
const paths = JSON.parse(readFileSync(join(MONOREPO, "config/paths.json"), "utf8"));
const C = paths.sources.sporttery;

const APP_PASSWORD = process.env.PG_APP_PASSWORD ?? process.env.POSTGRES_PASSWORD;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      host: "localhost",
      port: 5432,
      user: "crawler_sporttery",
      password: APP_PASSWORD,
      database: "sporttery",
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pool.on("error", () => {});
  }
  return pool;
}

export async function endPool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

export async function dbMatchComplete(matchId: number): Promise<boolean> {
  try {
    const { rows } = await getPool().query(
      `SELECT home_score IS NOT NULL AND away_score IS NOT NULL AS ok
       FROM jingcai_schedules s WHERE s.match_id = $1`,
      [matchId],
    );
    return !!(rows[0]?.ok);
  } catch {
    return false;
  }
}

// 数据库中最新的 business_date（completeDate 的权威来源）
export async function getLatestBusinessDate(): Promise<string | null> {
  try {
    const { rows } = await getPool().query(
      `SELECT max(business_date)::text AS d FROM jingcai_schedules`,
    );
    const d = rows[0]?.d;
    return d || null;
  } catch {
    return null;
  }
}

const BATCH = 200;
const RETRYABLE = new Set([
  "ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE",
  "57P01", "57P02", "57P03", "08006", "08001", "53300",
]);

function isRetryable(err: any): boolean {
  if (RETRYABLE.has(err?.code)) return true;
  return typeof err?.message === "string" && /connection terminated|terminated unexpectedly|socket hang up|ECONNRESET/i.test(err.message);
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function pct(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace("%", "").trim());
  return Number.isFinite(n) ? n / 100 : null;
}
function int(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}
function scorePair(s: unknown): [number | null, number | null] {
  if (s == null || s === "") return [null, null];
  const p = String(s).split(":");
  if (p.length !== 2) return [null, null];
  const h = parseInt(p[0], 10), a = parseInt(p[1], 10);
  return [Number.isFinite(h) ? h : null, Number.isFinite(a) ? a : null];
}
function snapAt(it: any): string | null {
  const s = `${it?.updateDate ?? ""} ${it?.updateTime ?? ""}`.trim();
  return s || null;
}

function dedupeRows(rows: unknown[][], keyIdx: number[]): unknown[][] {
  const m = new Map<string, unknown[]>();
  for (const r of rows) m.set(keyIdx.map((i) => r[i]).join("|"), r);
  return [...m.values()];
}

// votes 行去重：同 (match_id, pool, snapshot_at) 只保留一条，取投票总数最大的
// voters 位于 VOTE_COLS 索引 16/17/18（voters_home/draw/away）
function dedupeVoteRows(rows: unknown[][]): unknown[][] {
  const votersOf = (r: unknown[]): number =>
    (Number(r[16]) || 0) + (Number(r[17]) || 0) + (Number(r[18]) || 0);
  const m = new Map<string, unknown[]>();
  for (const r of rows) {
    const key = `${r[0]}|${r[1]}|${r[2]}`;
    const prev = m.get(key);
    if (!prev || votersOf(r) > votersOf(prev)) m.set(key, r);
  }
  return [...m.values()];
}

async function upsertManyOn(client: pg.PoolClient, sql: string, rows: unknown[][], tail = ""): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const rowLen = batch[0].length;
    const values = batch.map((r, j) => `(${r.map((_, k) => `$${j * rowLen + k + 1}`).join(",")})`).join(",");
    await client.query(`${sql} VALUES ${values} ${tail}`, batch.flat());
  }
}

async function updateMany(client: pg.PoolClient, table: string, key: string, setCols: string[], rows: unknown[][], keyType = "int", setTypes: string[] = []): Promise<void> {
  if (rows.length === 0) return;
  const types = [keyType, ...setTypes];
  const cols = [key, ...setCols];
  const setClause = setCols.map((c) => `${c} = v.${c}`).join(", ");
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const rowLen = cols.length;
    const values = batch.map((r, j) => `(${r.map((_, k) => (types[k] ? `$${j * rowLen + k + 1}::${types[k]}` : `$${j * rowLen + k + 1}`)).join(",")})`).join(",");
    await client.query(
      `UPDATE ${table} AS t SET ${setClause} FROM (VALUES ${values}) AS v(${cols.join(", ")}) WHERE t.${key} = v.${key}`,
      batch.flat(),
    );
  }
}

type FlushOp =
  | { kind: "upsert"; sql: string; rows: unknown[][]; tail?: string }
  | { kind: "update"; table: string; key: string; setCols: string[]; rows: unknown[][]; keyType?: string; setTypes?: string[] };

async function flushWindow(ops: FlushOp[], attempt = 0): Promise<void> {
  let client: pg.PoolClient | null = null;
  let shouldRetry = false;
  const swallowError = () => {};
  try {
    client = await getPool().connect();
    client.on("error", swallowError);
    await client.query("BEGIN");
    for (const op of ops) {
      if (op.kind === "update") await updateMany(client, op.table, op.key, op.setCols, op.rows, op.keyType, op.setTypes);
      else await upsertManyOn(client, op.sql, op.rows, op.tail ?? "");
    }
    await client.query("COMMIT");
  } catch (err: any) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (isRetryable(err) && attempt < 10) {
      shouldRetry = true;
      const backoff = Math.min(5000 + attempt * 500, 30000);
      await new Promise((r) => setTimeout(r, backoff));
    } else {
      throw err;
    }
  } finally {
    if (client) {
      client.off("error", swallowError);
      client.release();
    }
  }
  if (shouldRetry) return flushWindow(ops, attempt + 1);
}

// ─── 列定义（与 import-to-pg.ts 一致）────────────────────────
const SCHED_COLS = ["match_id", "business_date", "match_date", "match_num", "home_team", "away_team", "league", "home_score", "away_score", "pool_status"];
const SCHED_TAIL = `ON CONFLICT (match_id) DO UPDATE SET ${SCHED_COLS.slice(1).map((c) => `${c}=EXCLUDED.${c}`).join(", ")}`;

const VOTE_COLS = ["match_id", "pool", "snapshot_at", "goal_line", "odds_home", "odds_draw", "odds_away",
  "support_rate_home", "support_rate_draw", "support_rate_away",
  "probability_home", "probability_draw", "probability_away",
  "error_home", "error_draw", "error_away",
  "voters_home", "voters_draw", "voters_away", "psy_error", "result"];
const VOTE_TAIL = `ON CONFLICT (match_id, pool, snapshot_at) DO UPDATE SET ${VOTE_COLS.slice(4).map((c) => `${c}=EXCLUDED.${c}`).join(", ")}`;

const CRS_COLS = [
  "odds_s00s00", "odds_s00s01", "odds_s00s02", "odds_s00s03", "odds_s00s04", "odds_s00s05",
  "odds_s01s00", "odds_s01s01", "odds_s01s02", "odds_s01s03", "odds_s01s04", "odds_s01s05",
  "odds_s02s00", "odds_s02s01", "odds_s02s02", "odds_s02s03", "odds_s02s04", "odds_s02s05",
  "odds_s03s00", "odds_s03s01", "odds_s03s02", "odds_s03s03", "odds_s03s04", "odds_s03s05",
  "odds_s04s00", "odds_s04s01", "odds_s04s02", "odds_s04s03", "odds_s04s04", "odds_s04s05",
  "odds_s05s05",
  "odds_s-1sh", "odds_s-1sd", "odds_s-1sa",
];
const CRS_KEYS = CRS_COLS.map((c) => c.slice(5));
const CRS_COLS_SQL = CRS_COLS.map((c) => `"${c}"`);

const SPF_TAIL = "ON CONFLICT (match_id, snapshot_at) DO UPDATE SET odds_home=EXCLUDED.odds_home, odds_draw=EXCLUDED.odds_draw, odds_away=EXCLUDED.odds_away";
const RQSPF_TAIL = "ON CONFLICT (match_id, snapshot_at) DO UPDATE SET goal_line=EXCLUDED.goal_line, odds_home=EXCLUDED.odds_home, odds_draw=EXCLUDED.odds_draw, odds_away=EXCLUDED.odds_away";
const TTG_TAIL = "ON CONFLICT (match_id, snapshot_at) DO UPDATE SET odds_0=EXCLUDED.odds_0, odds_1=EXCLUDED.odds_1, odds_2=EXCLUDED.odds_2, odds_3=EXCLUDED.odds_3, odds_4=EXCLUDED.odds_4, odds_5=EXCLUDED.odds_5, odds_6=EXCLUDED.odds_6, odds_7=EXCLUDED.odds_7";
const HAFU_TAIL = "ON CONFLICT (match_id, snapshot_at) DO UPDATE SET odds_hh=EXCLUDED.odds_hh, odds_hd=EXCLUDED.odds_hd, odds_ha=EXCLUDED.odds_ha, odds_dh=EXCLUDED.odds_dh, odds_dd=EXCLUDED.odds_dd, odds_da=EXCLUDED.odds_da, odds_ah=EXCLUDED.odds_ah, odds_ad=EXCLUDED.odds_ad, odds_aa=EXCLUDED.odds_aa";
const CRS_TAIL = `ON CONFLICT (match_id, snapshot_at) DO UPDATE SET ${CRS_COLS.map((c) => `"${c}"=EXCLUDED."${c}"`).join(", ")}`;
const POOLS_TAIL = "ON CONFLICT (match_id, pool) DO UPDATE SET combination=EXCLUDED.combination, combination_desc=EXCLUDED.combination_desc, goal_line=EXCLUDED.goal_line, odds=EXCLUDED.odds, pool_id=EXCLUDED.pool_id, pool_totals=EXCLUDED.pool_totals";

const SCHED_SUP_COLS = ["single_spf", "single_rqspf", "single_ttg", "single_hafu", "single_crs", "kickoff_time", "scraped_at"];

// ─── 1) 整日 daily → jingcai_schedules + jingcai_votes ──────
// 入参：historical.ts fetchDaily 合并后的 matches 数组
function buildVoteRow(matchId: number, pool: string, snapshot: string, src: any, goalLine: number | null): unknown[] | null {
  if (!src || (!src.odds && !src.voters)) return null;
  return [
    matchId, pool, snapshot, goalLine,
    num(src.odds?.home), num(src.odds?.draw), num(src.odds?.away),
    pct(src.supportRate?.home), pct(src.supportRate?.draw), pct(src.supportRate?.away),
    pct(src.probability?.home), pct(src.probability?.draw), pct(src.probability?.away),
    pct(src.error?.home), pct(src.error?.draw), pct(src.error?.away),
    int(src.voters?.home), int(src.voters?.draw), int(src.voters?.away),
    int(src.psyError), src.result ?? null,
  ];
}

export async function upsertDailyMatches(matches: any[]): Promise<void> {
  if (!Array.isArray(matches) || matches.length === 0) return;
  const schedRows: unknown[][] = [];
  const voteRows: unknown[][] = [];

  for (const m of matches) {
    if (!m?.matchId) continue;
    const [hs, as] = scorePair(m.matchResult);
    schedRows.push([m.matchId, m.businessDate, m.matchDate, m.matchNum, m.homeTeam, m.awayTeam, m.league, hs, as, m.poolStatus ?? null]);
    const snapshot = stopTimeStr(m.businessDate);
    const had = buildVoteRow(m.matchId, "HAD", snapshot, m.had, null);
    if (had) voteRows.push(had);
    const rq = buildVoteRow(m.matchId, "RQSPF", snapshot, m.handicap, int(m.handicap?.goalLine));
    if (rq) voteRows.push(rq);
  }

  if (schedRows.length === 0 && voteRows.length === 0) return;
  const dedupedVotes = dedupeVoteRows(voteRows);
  await flushWindow([
    { kind: "upsert", sql: `INSERT INTO jingcai_schedules (${SCHED_COLS.join(",")})`, rows: schedRows, tail: SCHED_TAIL },
    { kind: "upsert", sql: `INSERT INTO jingcai_votes (${VOTE_COLS.join(",")})`, rows: dedupedVotes, tail: VOTE_TAIL },
  ]);
}

// ─── 2) 单场 detail → 5 张赔率表 + pools + 回补 schedules ────
export async function upsertMatchDetail(matchId: number, detail: any): Promise<void> {
  if (!detail) return;
  const ohl = detail.oddsHistory?.oddsHistory;

  const spf: unknown[][] = [], rqspf: unknown[][] = [], ttg: unknown[][] = [], hafu: unknown[][] = [], crs: unknown[][] = [], pools: unknown[][] = [], sup: unknown[][] = [];

  for (const it of ohl?.hadList ?? []) {
    const s = snapAt(it);
    if (!s) continue;
    spf.push([matchId, s, num(it.h), num(it.d), num(it.a)]);
  }
  for (const it of ohl?.hhadList ?? []) {
    const s = snapAt(it);
    if (!s) continue;
    rqspf.push([matchId, s, int(it.goalLine), num(it.h), num(it.d), num(it.a)]);
  }
  for (const it of ohl?.ttgList ?? []) {
    const s = snapAt(it);
    if (!s) continue;
    ttg.push([matchId, s, num(it.s0), num(it.s1), num(it.s2), num(it.s3), num(it.s4), num(it.s5), num(it.s6), num(it.s7)]);
  }
  for (const it of ohl?.hafuList ?? []) {
    const s = snapAt(it);
    if (!s) continue;
    hafu.push([matchId, s, num(it.hh), num(it.hd), num(it.ha), num(it.dh), num(it.dd), num(it.da), num(it.ah), num(it.ad), num(it.aa)]);
  }
  for (const it of ohl?.crsList ?? []) {
    const s = snapAt(it);
    if (!s) continue;
    crs.push([matchId, s, ...CRS_KEYS.map((k) => num(it[k]))]);
  }
  for (const p of detail.oddsHistory?.matchResultList ?? []) {
    pools.push([matchId, p.code, p.combination ?? null, p.combinationDesc ?? null, int(p.goalLine), num(p.odds), int(p.poolId), int(p.poolTotals)]);
  }
  const singles: Record<string, number> = {};
  for (const s of ohl?.singleList ?? []) if (s?.poolCode) singles[s.poolCode] = int(s.single) ?? 0;
  sup.push([
    matchId,
    singles.HAD ?? 0, singles.HHAD ?? 0, singles.TTG ?? 0, singles.HAFU ?? 0, singles.CRS ?? 0,
    detail.matchInfo?.matchDateTime ?? null,
    detail.scrapedAt ?? null,
  ]);

  const dSpf = dedupeRows(spf, [0, 1]);
  const dRqspf = dedupeRows(rqspf, [0, 1]);
  const dTtg = dedupeRows(ttg, [0, 1]);
  const dHafu = dedupeRows(hafu, [0, 1]);
  const dCrs = dedupeRows(crs, [0, 1]);
  const dPools = dedupeRows(pools, [0, 1]);

  await flushWindow([
    { kind: "upsert", sql: "INSERT INTO jingcai_odds_spf (match_id, snapshot_at, odds_home, odds_draw, odds_away)", rows: dSpf, tail: SPF_TAIL },
    { kind: "upsert", sql: "INSERT INTO jingcai_odds_rqspf (match_id, snapshot_at, goal_line, odds_home, odds_draw, odds_away)", rows: dRqspf, tail: RQSPF_TAIL },
    { kind: "upsert", sql: "INSERT INTO jingcai_odds_ttg (match_id, snapshot_at, odds_0, odds_1, odds_2, odds_3, odds_4, odds_5, odds_6, odds_7)", rows: dTtg, tail: TTG_TAIL },
    { kind: "upsert", sql: "INSERT INTO jingcai_odds_hafu (match_id, snapshot_at, odds_hh, odds_hd, odds_ha, odds_dh, odds_dd, odds_da, odds_ah, odds_ad, odds_aa)", rows: dHafu, tail: HAFU_TAIL },
    { kind: "upsert", sql: `INSERT INTO jingcai_odds_crs (match_id, snapshot_at, ${CRS_COLS_SQL.join(",")})`, rows: dCrs, tail: CRS_TAIL },
    { kind: "upsert", sql: "INSERT INTO jingcai_pools (match_id, pool, combination, combination_desc, goal_line, odds, pool_id, pool_totals)", rows: dPools, tail: POOLS_TAIL },
    { kind: "update", table: "jingcai_schedules", key: "match_id", setCols: SCHED_SUP_COLS, rows: sup, keyType: "int", setTypes: ["int", "int", "int", "int", "int", "timestamp", "timestamp"] },
  ]);
}

// ─── 2.5) 累积 votes 快照 → jingcai_votes（snapshot_at = 各轮抓取时间）──
// 入参：matches/{id}.json 累积的 voteSnapshots
export async function upsertVoteSnapshots(rows: Array<{ matchId: number; at: string; had?: any; handicap?: any }>): Promise<void> {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const voteRows: unknown[][] = [];
  for (const r of rows) {
    if (!r?.matchId) continue;
    if (r.had) {
      const v = buildVoteRow(r.matchId, "HAD", r.at, r.had, null);
      if (v) voteRows.push(v);
    }
    if (r.handicap) {
      const v = buildVoteRow(r.matchId, "RQSPF", r.at, r.handicap, int(r.handicap?.goalLine));
      if (v) voteRows.push(v);
    }
  }
  if (voteRows.length === 0) return;

  // 去重：同 (match_id, pool, snapshot_at) 只保留一条，取投票总数最大的（防止 ON CONFLICT 重复键报错）
  const deduped = dedupeVoteRows(voteRows);
  if (deduped.length === 0) return;

  await flushWindow([
    { kind: "upsert", sql: `INSERT INTO jingcai_votes (${VOTE_COLS.join(",")})`, rows: deduped, tail: VOTE_TAIL },
  ]);
}

// ─── 3) 实时在售场次 → jingcai_schedules（只刷新基础列）──────
export interface LiveScheduleRow {
  matchId: number;
  businessDate: string;
  matchDate: string;
  matchNumStr: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffTime?: string | null;
}

export async function upsertLiveSchedule(rows: LiveScheduleRow[]): Promise<void> {
  const sched: unknown[][] = [];
  for (const r of rows) {
    if (!r.matchId) continue;
    sched.push([r.matchId, r.businessDate ?? null, r.matchDate ?? null, r.matchNumStr ?? null, r.homeTeam ?? null, r.awayTeam ?? null, r.league ?? null, r.kickoffTime ?? null]);
  }
  if (sched.length === 0) return;

  const cols = ["match_id", "business_date", "match_date", "match_num", "home_team", "away_team", "league", "kickoff_time"];
  const tail = `ON CONFLICT (match_id) DO UPDATE SET ${cols.slice(1).map((c) => `${c}=EXCLUDED.${c}`).join(", ")}`;
  await flushWindow([
    { kind: "upsert", sql: `INSERT INTO jingcai_schedules (${cols.join(",")})`, rows: sched, tail },
  ]);
}

// ─── 4) 实时赔率 → 赔率表追加快照（snapshot_at = 抓取时间）───
// 入参：getMatchCalculatorV1 的 MatchItem（odds scraper）
export async function appendOddsSnapshots(rows: Array<{ matchId: number; had?: any; hhad?: any; ttg?: any; snapshotAt?: string }>): Promise<void> {
  const now = new Date().toISOString();
  const spf: unknown[][] = [], rqspf: unknown[][] = [], ttg: unknown[][] = [];

  for (const r of rows) {
    if (!r.matchId) continue;
    const at = r.snapshotAt ?? now;
    if (r.had) spf.push([r.matchId, at, num(r.had.h), num(r.had.d), num(r.had.a)]);
    if (r.hhad) rqspf.push([r.matchId, at, int(r.hhad.goalLine), num(r.hhad.h), num(r.hhad.d), num(r.hhad.a)]);
    if (r.ttg) ttg.push([r.matchId, at, num(r.ttg.s0), num(r.ttg.s1), num(r.ttg.s2), num(r.ttg.s3), num(r.ttg.s4), num(r.ttg.s5), num(r.ttg.s6), num(r.ttg.s7)]);
  }
  if (spf.length === 0 && rqspf.length === 0 && ttg.length === 0) return;

  await flushWindow([
    { kind: "upsert", sql: "INSERT INTO jingcai_odds_spf (match_id, snapshot_at, odds_home, odds_draw, odds_away)", rows: spf, tail: SPF_TAIL },
    { kind: "upsert", sql: "INSERT INTO jingcai_odds_rqspf (match_id, snapshot_at, goal_line, odds_home, odds_draw, odds_away)", rows: rqspf, tail: RQSPF_TAIL },
    { kind: "upsert", sql: "INSERT INTO jingcai_odds_ttg (match_id, snapshot_at, odds_0, odds_1, odds_2, odds_3, odds_4, odds_5, odds_6, odds_7)", rows: ttg, tail: TTG_TAIL },
  ]);
}

// ─── 5) 实时赛果 → 更新 schedules 比分/状态 ──────────────────
// 入参：getUniformMatchResultV1 的 MatchResult（result scraper）
export interface LiveResultRow {
  matchId: number;
  homeScore?: number | null;
  awayScore?: number | null;
  poolStatus?: string | null;
  matchNumStr?: string | null;
  matchDate?: string | null;
}

export async function updateResults(rows: LiveResultRow[]): Promise<void> {
  const scoreRows: unknown[][] = [];
  const metaRows: unknown[][] = [];
  for (const r of rows) {
    if (!r.matchId) continue;
    const hasScore = r.homeScore != null || r.awayScore != null || r.poolStatus != null;
    if (hasScore) scoreRows.push([r.matchId, r.homeScore ?? null, r.awayScore ?? null, r.poolStatus ?? null]);
    if (r.matchDate != null || r.matchNumStr != null) metaRows.push([r.matchId, r.matchDate ?? null, r.matchNumStr ?? null]);
  }
  if (scoreRows.length > 0) {
    await flushWindow([
      { kind: "update", table: "jingcai_schedules", key: "match_id", setCols: ["home_score", "away_score", "pool_status"], rows: scoreRows, keyType: "int", setTypes: ["int", "int", "text"] },
    ]);
  }
  if (metaRows.length > 0) {
    await flushWindow([
      { kind: "update", table: "jingcai_schedules", key: "match_id", setCols: ["match_date", "match_num"], rows: metaRows, keyType: "int", setTypes: ["timestamp", "text"] },
    ]);
  }
}
