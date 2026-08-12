import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { config as loadEnv } from "dotenv";
import pg from "pg";

const isTeamFile = (f: string) => f.split(sep).includes("teams");

// ============================================================
// sofascore JSON → PG 一次性导入脚本（全量 15 表）
// 数据源：config/paths.json sources.sofascore
//   schedules_v3/{联赛}/{赛季}.json            → schedules + countries/leagues/seasons/teams + 字典
//   details/{联赛}/{赛季}/{matchId}.json        → match_details/match_players/match_votes/
//                                                match_missing_players/match_statistics
//   details/{联赛}/{赛季}/teams/{teamId}.json   → team_season_stats
// 特性：幂等 upsert / 断点续传(import-progress.json) / 窗口事务批量写 / 崩溃重试(q)
// 运行：npx tsx services/crawler-sofascore/scripts/import-to-pg.ts（任意目录，自动定位 monorepo 根 + 根 .env）
// ============================================================

const MONOREPO = join(import.meta.dirname, "../../..");
loadEnv({ path: join(MONOREPO, ".env") });
const paths = JSON.parse(readFileSync(join(MONOREPO, "config/paths.json"), "utf8"));
const C = paths.sources.sofascore;

const APP_PASSWORD = process.env.PG_APP_PASSWORD ?? process.env.POSTGRES_PASSWORD;

const pool = new pg.Pool({
  host: "localhost",
  port: 5432,
  user: "crawler_sofascore",
  password: APP_PASSWORD,
  database: "sofascore",
  max: 4,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
pool.on("error", () => {});

const BATCH = 200;
const WINDOW = 500; // details/team_stats 每个事务窗口处理的文件数
const RETRYABLE = new Set([
  "ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE",
  "57P01", "57P02", "57P03", "08006", "08001", "53300",
]);
const EPOCH = new Date(0).toISOString();

function isRetryable(err: any): boolean {
  if (RETRYABLE.has(err?.code)) return true;
  return typeof err?.message === "string" && /connection terminated|terminated unexpectedly|socket hang up|ECONNRESET/i.test(err.message);
}

async function q(sql: string, params: unknown[] = [], attempt = 0): Promise<pg.QueryResult> {
  try {
    return await pool.query(sql, params);
  } catch (err: any) {
    if (isRetryable(err)) {
      if (attempt >= 60) throw err;
      const backoff = Math.min(5000 + attempt * 500, 30000);
      await new Promise((r) => setTimeout(r, backoff));
      return q(sql, params, attempt + 1);
    }
    throw err;
  }
}

// ── 值转换 ──────────────────────────────────────────────────
function ts(v: unknown): string | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isFinite(n)) return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  return String(v);
}
function json(v: unknown): string | null {
  return v == null ? null : JSON.stringify(v);
}

// ── 批量 upsert（单条 SQL 多行，占位符 j*rowLen+k+1）─────────
async function upsertManyOn(client: pg.PoolClient, sql: string, rows: unknown[][], tail = ""): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const rowLen = batch[0].length;
    const values = batch.map((r, j) => `(${r.map((_, k) => `$${j * rowLen + k + 1}`).join(",")})`).join(",");
    await client.query(`${sql} VALUES ${values} ${tail}`, batch.flat());
  }
}

// ── 窗口事务：提交成功才返回；连接级错误（含 connect 失败）重开客户端重试整个窗口 ──
async function flushWindow(ops: { sql: string; rows: unknown[][]; tail?: string }[], attempt = 0): Promise<void> {
  let client: pg.PoolClient | null = null;
  try {
    client = await pool.connect();
    client.on("error", () => {});
    await client.query("BEGIN");
    for (const op of ops) await upsertManyOn(client, op.sql, op.rows, op.tail ?? "");
    await client.query("COMMIT");
    client.release();
  } catch (err: any) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (client) client.release();
    if (isRetryable(err)) {
      if (attempt >= 60) throw err;
      const backoff = Math.min(5000 + attempt * 500, 30000);
      await new Promise((r) => setTimeout(r, backoff));
      return flushWindow(ops, attempt + 1);
    }
    throw err;
  }
}

// ── 进度文件（断点续传）─────────────────────────────────────
const PROGRESS_FILE = join(MONOREPO, "services", "crawler-sofascore", "scripts", "import-progress.json");
function loadProgress(): { dictionaryDone?: boolean; doneFiles?: string[] } {
  if (existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(readFileSync(PROGRESS_FILE, "utf8")); } catch {}
  }
  return {};
}
const saveProgress = (p: { dictionaryDone?: boolean; doneFiles?: string[] }) =>
  writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const fp = join(p, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.endsWith(".json")) out.push(fp);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

// ─── 字典表 ─────────────────────────────────────────────────
const STATUS_MAP: Record<number, [string, string, string, boolean]> = {
  0:   ["notstarted", "Not started", "未开始", false],
  60:  ["postponed", "Postponed", "延期", true],
  70:  ["canceled", "Canceled", "取消", true],
  90:  ["canceled", "Abandoned", "中止", true],
  91:  ["finished", "Walkover", "判负", false],
  92:  ["finished", "Retired", "弃赛", false],
  100: ["finished", "Ended", "完场", false],
  110: ["finished", "AET", "加时完场", false],
  120: ["finished", "AP", "点球完场", false],
};
const CUP_ROUND_TYPES: Record<number, [number, string, string]> = {
  1:   [1, "Final", "决赛"],
  2:   [2, "Semifinals", "半决赛"],
  4:   [4, "Quarterfinals", "八强/四分之一决赛"],
  8:   [8, "Round of 16", "16强"],
  16:  [16, "Round of 32", "32强"],
};
const ROUND_PREFIXES: Record<string, string> = {
  "Qualification": "资格赛",
  "Preliminary": "预选赛",
  "Europa Playoffs": "欧联附加赛",
  "Relegation-Promotion": "升降级附加赛",
};

// ─── match_statistics: 指标名 → 列名 ─────────────────────────
const STAT_COL: Record<string, string> = {
  "Ball possession": "ball_possession",
  "Total shots": "total_shots",
  "Corner kicks": "corner_kicks",
  "Shots on target": "shots_on_target",
  "Shots off target": "shots_off_target",
  "Free kicks": "free_kicks",
  "Fouls": "fouls",
  "Throw-ins": "throw_ins",
  "Goal kicks": "goal_kicks",
  "Goalkeeper saves": "goalkeeper_saves",
  "Yellow cards": "yellow_cards",
  "Blocked shots": "blocked_shots",
  "Shots inside box": "shots_inside_box",
  "Shots outside box": "shots_outside_box",
  "Hit woodwork": "hit_woodwork",
  "Duels": "duels",
  "Ground duels": "ground_duels",
  "Offsides": "offsides",
  "Passes": "passes",
  "Accurate passes": "accurate_passes",
  "Aerial duels": "aerial_duels",
  "Tackles": "tackles",
  "Total tackles": "total_tackles",
  "Tackles won": "tackles_won",
  "Long balls": "long_balls",
  "Crosses": "crosses",
  "Dribbles": "dribbles",
  "Interceptions": "interceptions",
  "Clearances": "clearances",
  "Dispossessed": "dispossessed",
  "Final third entries": "final_third_entries",
  "Fouled in final third": "fouled_in_final_third",
  "Big chances": "big_chances",
  "Big chances missed": "big_chances_missed",
  "Big chances scored": "big_chances_scored",
  "Expected goals": "expected_goals",
  "Red cards": "red_cards",
  "Through balls": "through_balls",
  "Recoveries": "recoveries",
  "Goals prevented": "goals_prevented",
  "Final third phase": "final_third_phase",
  "Touches in penalty area": "touches_in_penalty_area",
  "Distance covered": "distance_covered",
  "Number of sprints": "number_of_sprints",
  "High claims": "high_claims",
  "Big saves": "big_saves",
  "Errors lead to a shot": "errors_lead_to_shot",
  "Punches": "punches",
  "Errors lead to a goal": "errors_lead_to_goal",
  "Penalty saves": "penalty_saves",
};
const STAT_TEXT_COL: Record<string, string> = {
  "Ground duels": "ground_duels_text",
  "Aerial duels": "aerial_duels_text",
  "Long balls": "long_balls_text",
  "Crosses": "crosses_text",
  "Dribbles": "dribbles_text",
  "Final third phase": "final_third_phase_text",
};

// ─── team_season_stats: 源键 → 列名（来自 DDL 权威 115 条）───
const TEAM_STAT_COL: Record<string, string> = {
  matches: "matches",
  awardedMatches: "awarded_matches",
  goalsScored: "goals_scored",
  goalsConceded: "goals_conceded",
  ownGoals: "own_goals",
  assists: "assists",
  penaltyGoals: "penalty_goals",
  penaltiesTaken: "penalties_taken",
  freeKickGoals: "free_kick_goals",
  freeKickShots: "free_kick_shots",
  goalsFromInsideTheBox: "goals_from_inside_the_box",
  goalsFromOutsideTheBox: "goals_from_outside_the_box",
  headedGoals: "headed_goals",
  leftFootGoals: "left_foot_goals",
  rightFootGoals: "right_foot_goals",
  bigChancesCreated: "big_chances_created",
  shots: "shots",
  shotsOnTarget: "shots_on_target",
  shotsOffTarget: "shots_off_target",
  shotsFromInsideTheBox: "shots_from_inside_the_box",
  shotsFromOutsideTheBox: "shots_from_outside_the_box",
  blockedScoringAttempt: "blocked_scoring_attempt",
  hitWoodwork: "hit_woodwork",
  bigChances: "big_chances",
  bigChancesMissed: "big_chances_missed",
  successfulDribbles: "successful_dribbles",
  dribbleAttempts: "dribble_attempts",
  corners: "corners",
  freeKicks: "free_kicks",
  throwIns: "throw_ins",
  goalKicks: "goal_kicks",
  fastBreaks: "fast_breaks",
  fastBreakShots: "fast_break_shots",
  fastBreakGoals: "fast_break_goals",
  averageBallPossession: "average_ball_possession",
  totalPasses: "total_passes",
  accuratePasses: "accurate_passes",
  accuratePassesPercentage: "accurate_passes_percentage",
  totalOwnHalfPasses: "total_own_half_passes",
  accurateOwnHalfPasses: "accurate_own_half_passes",
  accurateOwnHalfPassesPercentage: "accurate_own_half_passes_percentage",
  totalOppositionHalfPasses: "total_opposition_half_passes",
  accurateOppositionHalfPasses: "accurate_opposition_half_passes",
  accurateOppositionHalfPassesPercentage: "accurate_opposition_half_passes_percentage",
  totalLongBalls: "total_long_balls",
  accurateLongBalls: "accurate_long_balls",
  accurateLongBallsPercentage: "accurate_long_balls_percentage",
  totalCrosses: "total_crosses",
  accurateCrosses: "accurate_crosses",
  accurateCrossesPercentage: "accurate_crosses_percentage",
  cleanSheets: "clean_sheets",
  tackles: "tackles",
  interceptions: "interceptions",
  saves: "saves",
  errorsLeadingToGoal: "errors_leading_to_goal",
  errorsLeadingToShot: "errors_leading_to_shot",
  penaltiesCommited: "penalties_commited",
  penaltyGoalsConceded: "penalty_goals_conceded",
  clearances: "clearances",
  clearancesOffLine: "clearances_off_line",
  lastManTackles: "last_man_tackles",
  totalDuels: "total_duels",
  duelsWon: "duels_won",
  duelsWonPercentage: "duels_won_percentage",
  totalGroundDuels: "total_ground_duels",
  groundDuelsWon: "ground_duels_won",
  groundDuelsWonPercentage: "ground_duels_won_percentage",
  totalAerialDuels: "total_aerial_duels",
  aerialDuelsWon: "aerial_duels_won",
  aerialDuelsWonPercentage: "aerial_duels_won_percentage",
  possessionLost: "possession_lost",
  ballRecovery: "ball_recovery",
  offsides: "offsides",
  fouls: "fouls",
  yellowCards: "yellow_cards",
  yellowRedCards: "yellow_red_cards",
  redCards: "red_cards",
  avgRating: "avg_rating",
  kilometersCovered: "kilometers_covered",
  numberOfSprints: "number_of_sprints",
  shotsAgainst: "shots_against",
  shotsOnTargetAgainst: "shots_on_target_against",
  shotsOffTargetAgainst: "shots_off_target_against",
  shotsBlockedAgainst: "shots_blocked_against",
  shotsFromInsideTheBoxAgainst: "shots_from_inside_the_box_against",
  shotsFromOutsideTheBoxAgainst: "shots_from_outside_the_box_against",
  cornersAgainst: "corners_against",
  hitWoodworkAgainst: "hit_woodwork_against",
  blockedScoringAttemptAgainst: "blocked_scoring_attempt_against",
  bigChancesAgainst: "big_chances_against",
  bigChancesCreatedAgainst: "big_chances_created_against",
  bigChancesMissedAgainst: "big_chances_missed_against",
  crossesSuccessfulAgainst: "crosses_successful_against",
  crossesTotalAgainst: "crosses_total_against",
  dribbleAttemptsTotalAgainst: "dribble_attempts_total_against",
  dribbleAttemptsWonAgainst: "dribble_attempts_won_against",
  longBallsSuccessfulAgainst: "long_balls_successful_against",
  longBallsTotalAgainst: "long_balls_total_against",
  offsidesAgainst: "offsides_against",
  redCardsAgainst: "red_cards_against",
  yellowCardsAgainst: "yellow_cards_against",
  tacklesAgainst: "tackles_against",
  interceptionsAgainst: "interceptions_against",
  clearancesAgainst: "clearances_against",
  errorsLeadingToGoalAgainst: "errors_leading_to_goal_against",
  errorsLeadingToShotAgainst: "errors_leading_to_shot_against",
  keyPassesAgainst: "key_passes_against",
  totalPassesAgainst: "total_passes_against",
  accuratePassesAgainst: "accurate_passes_against",
  accurateOwnHalfPassesAgainst: "accurate_own_half_passes_against",
  accurateOppositionHalfPassesAgainst: "accurate_opposition_half_passes_against",
  ownHalfPassesTotalAgainst: "own_half_passes_total_against",
  oppositionHalfPassesTotalAgainst: "opposition_half_passes_total_against",
  accurateFinalThirdPassesAgainst: "accurate_final_third_passes_against",
  totalFinalThirdPassesAgainst: "total_final_third_passes_against",
};

const STAT_BASE_COLS = ["match_id", "league_id", "season_id", "is_home", "period"];
const STAT_COLS = [...STAT_BASE_COLS, ...Object.values(STAT_COL), ...Object.values(STAT_TEXT_COL)];
const TEAM_STAT_KEYS = Object.keys(TEAM_STAT_COL);

// ─── 字典表导入（DELETE + 重插）──────────────────────────────
async function importDictionaries() {
  log("导入字典表 (status_codes/cup_round_types/round_prefixes)...");
  await q("DELETE FROM status_codes");
  await q("DELETE FROM cup_round_types");
  await q("DELETE FROM round_prefixes");
  const client = await pool.connect();
  const swallowDictError = () => {};
  client.on("error", swallowDictError);
  try {
    await upsertManyOn(client, "INSERT INTO status_codes (code, status_type, description, meaning_cn, final_result_only)",
      Object.entries(STATUS_MAP).map(([c, v]) => [Number(c), v[0], v[1], v[2], v[3]]));
    await upsertManyOn(client, "INSERT INTO cup_round_types (value, matches_in_round, round_name_en, round_name_cn)",
      Object.entries(CUP_ROUND_TYPES).map(([v, d]) => [Number(v), d[0], d[1], d[2]]));
    await upsertManyOn(client, "INSERT INTO round_prefixes (value, meaning_cn)",
      Object.entries(ROUND_PREFIXES));
  } finally {
    client.off("error", swallowDictError);
    client.release();
  }
  log("字典表完成");
}

// ─── schedules + 维度（全量重处理，结尾 upsert 落库）──────────
async function importSchedules() {
  log("导入 schedules + 维度...");
  const files = walkFiles(C.schedules_dir);
  log(`schedules_v3 文件 ${files.length}`);

  const countries = new Map<string, { alpha2: string | null; alpha3: string | null; name: string }>();
  const leagues = new Map<number, [string, string | null, string | null, string | null]>();
  const seasons = new Map<string, number>(); // `${leagueId}:${seasonKey}` → seasonId
  const teamRows = new Map<number, unknown[]>();
  const teamsCountry = new Map<number, string>();
  const matchRows: unknown[][] = [];
  const skipped = { noLeague: 0, noTeams: 0 };

  const addCountry = (slug: string, alpha2: string | null, alpha3: string | null, name: string) => {
    if (!slug) return;
    const cur = countries.get(slug);
    if (!cur) countries.set(slug, { alpha2, alpha3, name });
    else {
      if (!cur.alpha2 && alpha2) cur.alpha2 = alpha2;
      if (!cur.alpha3 && alpha3) cur.alpha3 = alpha3;
      if (!cur.name && name) cur.name = name;
    }
  };

  for (const [i, file] of files.entries()) {
    let j: any;
    try { j = JSON.parse(readFileSync(file, "utf8")); }
    catch { continue; }
    const league = j.league ?? {};
    const leagueId = league.id;
    const seasonKey = String(j.season ?? "");
    const seasonId = j.seasonId;
    if (!leagueId || !seasonId) { skipped.noLeague++; continue; }

    addCountry(league.country, null, null, "");
    leagues.set(leagueId, [league.name ?? "", league.shortName ?? null, league.slug ?? null, league.country ?? null]);
    seasons.set(`${leagueId}:${seasonKey}`, seasonId);

    for (const m of Array.isArray(j.matches) ? j.matches : []) {
      if (!m?.id) continue;
      const st = m.status ?? {}, hs = m.homeScore ?? {}, as = m.awayScore ?? {};
      const ri = m.roundInfo ?? {}, ht = m.homeTeam ?? {}, at = m.awayTeam ?? {};
      if (!ht.id || !at.id) { skipped.noTeams++; continue; }
      const prefix = ri.prefix ?? ri.name ?? null;
      const cupType = ri.cupRoundType ?? (prefix && !isNaN(Number(ri.name)) ? Number(ri.name) : null);
      matchRows.push([
        m.id, leagueId, seasonId, seasonKey, m.slug ?? null,
        st.code ?? 0, st.type ?? "unknown", m.winnerCode ?? null,
        ht.id, at.id,
        hs.current ?? null, hs.display ?? null, hs.normaltime ?? null, hs.period1 ?? null, hs.period2 ?? null,
        as.current ?? null, as.display ?? null, as.normaltime ?? null, as.period1 ?? null, as.period2 ?? null,
        ri.round ?? null, ri.name ?? null, ri.slug ?? null,
        prefix, cupType,
        m.hasXg ?? null, m.hasEventPlayerStatistics ?? null, m.hasEventPlayerHeatMap ?? null,
        ts(m.startTimestamp) ?? EPOCH,
      ]);
      for (const t of [ht, at]) {
        if (!t?.id) continue;
        teamRows.set(t.id, [t.id, t.name ?? "", t.slug ?? null, t.shortName ?? null, t.nameCode ?? null, t.userCount ?? null, json(t.teamColors)]);
        if (t.country?.slug) {
          addCountry(t.country.slug, t.country.alpha2 ?? null, t.country.alpha3 ?? null, t.country.name ?? "");
          teamsCountry.set(t.id, t.country.slug);
        }
      }
    }
    if ((i + 1) % 50 === 0 || i === files.length - 1) log(`schedules 解析 ${i + 1}/${files.length}`);
  }

  // 维度落库（countries 用 ON CONFLICT 保 ID 稳定，其余 upsert）
  const client = await pool.connect();
  try {
    await upsertManyOn(client, "INSERT INTO countries (alpha2, alpha3, name, slug)",
      [...countries.entries()].map(([slug, c]) => [c.alpha2, c.alpha3, c.name, slug]),
      "ON CONFLICT (slug) DO NOTHING");
  } finally {
    client.release();
  }
  const countryIdBySlug = new Map<string, number>();
  for (const r of (await q("SELECT country_id, slug FROM countries")).rows) countryIdBySlug.set(r.slug, r.country_id);

  const client2 = await pool.connect();
  try {
    await upsertManyOn(client2, "INSERT INTO leagues (league_id, name, short_name, slug, country_slug)",
      [...leagues.entries()].map(([id, v]) => [id, ...v]),
      "ON CONFLICT (league_id) DO UPDATE SET name=EXCLUDED.name, short_name=EXCLUDED.short_name, slug=EXCLUDED.slug, country_slug=EXCLUDED.country_slug, updated_at=now()");
    await upsertManyOn(client2, "INSERT INTO seasons (season_id, league_id, season_key)",
      [...seasons.entries()].map(([k, id]) => [id, Number(k.split(":")[0]), k.split(":")[1]]),
      "ON CONFLICT (league_id, season_key) DO UPDATE SET season_id=EXCLUDED.season_id");
    await upsertManyOn(client2,
      "INSERT INTO teams (team_id, name, slug, short_name, name_code, user_count, country_id, team_colors)",
      [...teamRows.values()].map((t) => [t[0], t[1], t[2], t[3], t[4], t[5], countryIdBySlug.get(teamsCountry.get(t[0] as number) ?? "") ?? null, t[6]]),
      "ON CONFLICT (team_id) DO UPDATE SET name=EXCLUDED.name, slug=EXCLUDED.slug, short_name=EXCLUDED.short_name, name_code=EXCLUDED.name_code, user_count=EXCLUDED.user_count, country_id=EXCLUDED.country_id, team_colors=EXCLUDED.team_colors, updated_at=now()");
  } finally {
    client2.release();
  }

  // schedules 落库（全量 upsert，幂等）
  const client3 = await pool.connect();
  try {
    await upsertManyOn(client3,
      `INSERT INTO schedules (
        match_id, league_id, season_id, season_key, slug,
        status_code, status_type, winner_code, home_team_id, away_team_id,
        home_score_current, home_score_display, home_score_normaltime, home_score_period1, home_score_period2,
        away_score_current, away_score_display, away_score_normaltime, away_score_period1, away_score_period2,
        round_num, round_name, round_slug, round_prefix, cup_round_type,
        has_xg, has_event_player_statistics, has_event_player_heat_map, kickoff_time
      )`,
      matchRows,
      "ON CONFLICT (match_id) DO UPDATE SET status_code=EXCLUDED.status_code, status_type=EXCLUDED.status_type, winner_code=EXCLUDED.winner_code, home_score_current=EXCLUDED.home_score_current, home_score_display=EXCLUDED.home_score_display, home_score_normaltime=EXCLUDED.home_score_normaltime, home_score_period1=EXCLUDED.home_score_period1, home_score_period2=EXCLUDED.home_score_period2, away_score_current=EXCLUDED.away_score_current, away_score_display=EXCLUDED.away_score_display, away_score_normaltime=EXCLUDED.away_score_normaltime, away_score_period1=EXCLUDED.away_score_period1, away_score_period2=EXCLUDED.away_score_period2, kickoff_time=EXCLUDED.kickoff_time, updated_at=now()");
  } finally {
    client3.release();
  }
  log(`schedules 完成: matches=${matchRows.length} countries=${countries.size} leagues=${leagues.size} seasons=${seasons.size} teams=${teamRows.size} 跳过文件=${skipped.noLeague} 跳过无球队比赛=${skipped.noTeams}`);
}

// ─── details 窗口导入 ────────────────────────────────────────
interface DetailBuf {
  details: unknown[][];
  players: Map<number, string>;
  matchPlayers: unknown[][];
  votes: unknown[][];
  missing: unknown[][];
  stats: unknown[][];
}

const DETAIL_OPS = (b: DetailBuf) => [
  {
    sql: `INSERT INTO match_details (
      match_id, league_id, season_id, referee, venue, attendance,
      lineups_confirmed, home_formation, away_formation,
      pregame_home_avg_rating, pregame_home_position, pregame_home_value, pregame_home_form,
      pregame_away_avg_rating, pregame_away_position, pregame_away_value, pregame_away_form
    )`,
    rows: b.details,
    tail: "ON CONFLICT (match_id) DO UPDATE SET league_id=EXCLUDED.league_id, season_id=EXCLUDED.season_id, referee=EXCLUDED.referee, venue=EXCLUDED.venue, attendance=EXCLUDED.attendance",
  },
  {
    sql: "INSERT INTO players (player_id, name)",
    rows: [...b.players.entries()].map(([id, name]) => [id, name]),
    tail: "ON CONFLICT (player_id) DO UPDATE SET name=EXCLUDED.name",
  },
  {
    sql: `INSERT INTO match_players (
      match_id, player_id, league_id, season_id, is_home, shirt_number, position, substitute,
      rating, minutes_played, total_pass, accurate_pass, total_shots, saves
    )`,
    rows: b.matchPlayers,
    tail: "ON CONFLICT (match_id, player_id) DO UPDATE SET is_home=EXCLUDED.is_home, shirt_number=EXCLUDED.shirt_number, position=EXCLUDED.position, substitute=EXCLUDED.substitute, rating=EXCLUDED.rating, minutes_played=EXCLUDED.minutes_played",
  },
  {
    sql: `INSERT INTO match_votes (
      match_id, league_id, season_id, snapshot_at,
      vote_home, vote_draw, vote_away, both_yes, both_no, first_home, first_nogoal, first_away
    )`,
    rows: b.votes,
    tail: "ON CONFLICT (match_id, snapshot_at) DO NOTHING",
  },
  {
    sql: `INSERT INTO match_missing_players (
      match_id, league_id, season_id, is_home, player_id, player_name, missing_type, description, expected_end_date
    )`,
    rows: b.missing,
  },
  {
    sql: `INSERT INTO match_statistics (${STAT_COLS.join(",")})`,
    rows: b.stats,
    tail: "ON CONFLICT (match_id, is_home, period) DO UPDATE SET league_id=EXCLUDED.league_id, season_id=EXCLUDED.season_id",
  },
];

async function importDetails() {
  log("导入 details...");
  const files = walkFiles(C.details_dir).filter((f) => !isTeamFile(f));
  const progress = loadProgress();
  const done = new Set(progress.doneFiles ?? []);
  log(`details 文件 ${files.length}, 已完成 ${done.size}`);

  const buf: DetailBuf = { details: [], players: new Map(), matchPlayers: [], votes: [], missing: [], stats: [] };
  const pending: string[] = [];
  let bad = 0;
  let totalDetails = 0, totalPlayers = 0, totalMatchPlayers = 0, totalVotes = 0, totalMissing = 0, totalStats = 0;

  const flush = async () => {
    totalDetails += buf.details.length;
    totalPlayers += buf.players.size;
    totalMatchPlayers += buf.matchPlayers.length;
    totalVotes += buf.votes.length;
    totalMissing += buf.missing.length;
    totalStats += buf.stats.length;
    await flushWindow(DETAIL_OPS(buf));
    for (const f of pending) done.add(f);
    saveProgress({ dictionaryDone: true, doneFiles: [...done] });
    pending.length = 0;
    buf.details = []; buf.players = new Map(); buf.matchPlayers = []; buf.votes = []; buf.missing = []; buf.stats = [];
  };

  for (const [i, file] of files.entries()) {
    if (done.has(file)) continue;
    let j: any;
    try { j = JSON.parse(readFileSync(file, "utf8")); }
    catch { bad++; continue; }

    const matchId = j.matchId;
    const leagueId = j.league?.id;
    const seasonId = j.seasonId;
    if (!matchId || !leagueId || !seasonId) { bad++; continue; }

    const lh = j.lineups?.home, la = j.lineups?.away;
    const pgf = j.pregameForm ?? {};
    buf.details.push([
      matchId, leagueId, seasonId,
      j.referee ?? null, j.venue ?? null, j.attendance ?? null,
      j.lineups?.confirmed ?? null,
      lh?.formation ?? null, la?.formation ?? null,
      pgf.homeTeam?.avgRating ?? null, pgf.homeTeam?.position ?? null, pgf.homeTeam?.value ?? null, json(pgf.homeTeam?.form),
      pgf.awayTeam?.avgRating ?? null, pgf.awayTeam?.position ?? null, pgf.awayTeam?.value ?? null, json(pgf.awayTeam?.form),
    ]);

    for (const side of [{ isHome: true, l: lh }, { isHome: false, l: la }]) {
      if (!side.l) continue;
      for (const p of side.l.players ?? []) {
        const pid = p.player?.id;
        if (!pid) continue;
        buf.players.set(pid, p.player?.name ?? "");
        const s = p.statistics ?? {};
        buf.matchPlayers.push([
          matchId, pid, leagueId, seasonId, side.isHome,
          p.shirtNumber ?? null, p.position ?? null, p.substitute ?? null,
          s.rating ?? null, s.minutesPlayed ?? null, s.totalPass ?? null,
          s.accuratePass ?? null, s.totalShots ?? null, s.saves ?? null,
        ]);
      }
      for (const mp of side.l.missingPlayers ?? []) {
        buf.missing.push([
          matchId, leagueId, seasonId, side.isHome,
          mp.player?.id ?? null, mp.player?.name ?? "", mp.type ?? null,
          mp.description ?? null, ts(mp.expectedEndDate),
        ]);
      }
    }

    const v = j.votes ?? {};
    buf.votes.push([
      matchId, leagueId, seasonId, ts(j.startTimestamp) ?? EPOCH,
      v.vote?.vote1 ?? null, v.vote?.vote2 ?? null, v.vote?.voteX ?? null,
      v.bothTeamsToScoreVote?.voteYes ?? null, v.bothTeamsToScoreVote?.voteNo ?? null,
      v.firstTeamToScoreVote?.voteHome ?? null, v.firstTeamToScoreVote?.voteNoGoal ?? null, v.firstTeamToScoreVote?.voteAway ?? null,
    ]);

    for (const period of Array.isArray(j.statistics) ? j.statistics : []) {
      const pKey = period.period ?? "ALL";
      if (pKey === "ET1" || pKey === "ET2") continue; // schema 设计：加时周期舍弃（竞彩 90 分钟结算）
      const itemMap = new Map<string, any>();
      for (const g of period.groups ?? []) for (const it of g.statisticsItems ?? []) if (it?.name) itemMap.set(it.name, it);
      for (const isHome of [true, false]) {
        const col = isHome ? "home" : "away";
        const row: unknown[] = [matchId, leagueId, seasonId, isHome, pKey];
        for (const [name] of Object.entries(STAT_COL)) {
          const it = itemMap.get(name);
          row.push(it ? it[`${col}Value`] ?? null : null);
        }
        for (const [name] of Object.entries(STAT_TEXT_COL)) {
          const it = itemMap.get(name);
          row.push(it ? it[col] ?? null : null);
        }
        buf.stats.push(row);
      }
    }

    pending.push(file);
    if (pending.length >= WINDOW) {
      await flush();
      log(`details 处理 ${i + 1}/${files.length}`);
    }
  }
  if (pending.length > 0) await flush();
  log(`details 完成: details=${totalDetails} players=${totalPlayers} match_players=${totalMatchPlayers} votes=${totalVotes} missing=${totalMissing} statistics=${totalStats} 失败/跳过=${bad}`);
}

// ─── players 聚合回填（position 众数 + first/last_seen_at）────
async function finalizePlayers() {
  log("回填 players 聚合列（position 众数 + first/last_seen_at）...");
  await q(`
    WITH mode_pos AS (
      SELECT DISTINCT ON (player_id) player_id, position
      FROM (
        SELECT player_id, position, COUNT(*) AS c
        FROM match_players WHERE position IS NOT NULL
        GROUP BY player_id, position
      ) t
      ORDER BY player_id, c DESC, position
    ),
    seen AS (
      SELECT mp.player_id, MIN(s.kickoff_time) AS first_seen_at, MAX(s.kickoff_time) AS last_seen_at
      FROM match_players mp JOIN schedules s ON s.match_id = mp.match_id
      GROUP BY mp.player_id
    )
    UPDATE players p
    SET position      = COALESCE(m.position, p.position),
        first_seen_at = COALESCE(se.first_seen_at, p.first_seen_at),
        last_seen_at  = COALESCE(se.last_seen_at, p.last_seen_at),
        updated_at    = now()
    FROM mode_pos m LEFT JOIN seen se ON se.player_id = m.player_id
    WHERE p.player_id = m.player_id
  `);
  const r = await q("SELECT count(position) AS pos, count(first_seen_at) AS first, count(last_seen_at) AS last FROM players");
  log(`players 回填完成: position=${r.rows[0].pos} first=${r.rows[0].first} last=${r.rows[0].last}`);
}

// ─── team_season_stats 窗口导入 ──────────────────────────────
async function importTeamSeasonStats() {
  log("导入 team_season_stats...");
  const files = walkFiles(C.details_dir).filter((f) => isTeamFile(f));
  const progress = loadProgress();
  const done = new Set(progress.doneFiles ?? []);
  log(`team stats 文件 ${files.length}, 已完成 ${done.size}`);

  const rows: unknown[][] = [];
  const pending: string[] = [];
  let bad = 0;
  let totalRows = 0;

  const flush = async () => {
    totalRows += rows.length;
    await flushWindow([{
      sql: `INSERT INTO team_season_stats (team_id, league_id, season_id, ${Object.values(TEAM_STAT_COL).join(",")})`,
      rows,
      tail: "ON CONFLICT (team_id, season_id) DO UPDATE SET league_id=EXCLUDED.league_id",
    }]);
    for (const f of pending) done.add(f);
    saveProgress({ dictionaryDone: true, doneFiles: [...done] });
    pending.length = 0;
    rows.length = 0;
  };

  for (const [i, file] of files.entries()) {
    if (done.has(file)) continue;
    let j: any;
    try { j = JSON.parse(readFileSync(file, "utf8")); }
    catch { bad++; continue; }
    const s = j.statistics ?? {};
    const row: unknown[] = [j.teamId ?? null, j.leagueId ?? null, j.seasonId ?? null];
    for (const k of TEAM_STAT_KEYS) row.push(s[k] ?? null);
    if (row[0] == null || row[1] == null || row[2] == null) { bad++; continue; }
    rows.push(row);
    pending.push(file);
    if (pending.length >= WINDOW) {
      await flush();
      log(`team stats 处理 ${i + 1}/${files.length}`);
    }
  }
  if (pending.length > 0) await flush();
  log(`team_season_stats 完成: rows=${totalRows} 失败/跳过=${bad}`);
}

async function main() {
  log("=== sofascore 导入开始 ===");
  await importDictionaries();
  await importSchedules();
  await importDetails();
  await finalizePlayers();
  await importTeamSeasonStats();
  log("=== sofascore 导入完成 ===");
  await pool.end();
}

main().catch(async (err) => {
  console.error("导入失败:", err);
  await pool.end();
  process.exit(1);
});
