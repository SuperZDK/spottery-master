import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import pg from "pg";

// ============================================================
// 三源比赛映射：sofascore ↔ titan ↔ 竞彩(sporttery)
// 驱动主表 = titan_jc_schedule.sid（70,337 场，titan 竞彩镜像）。
// 每场一行落 cross_source_matches，其余源 id 可空，不删行不猜。
// 全部读库、无网络请求。全部用 id + 时间锚定，不靠名字匹配。
//
// 运行：npx tsx mapping/scripts/build-match-map.ts
//        --leagues-only  只填 cross_source_leagues（跳过比赛映射）
//        --date YYYY-MM-DD  只重建指定业务日的比赛映射（增量，避免全量 70k 重扫）
// 产物：
//   core.cross_source_leagues（填表）+ core.cross_source_matches（新表，脚本自动建）
//   mapping/data/jc/conflict-league.log（联赛映射多候选/存疑）
//   mapping/data/jc/unmatched-match.log（比赛未命中/比分不一致明细）
// ============================================================

const MONOREPO = join(import.meta.dirname, "../..");
loadEnv({ path: join(MONOREPO, ".env") });
const APP_PASSWORD = process.env.PG_APP_PASSWORD ?? process.env.POSTGRES_PASSWORD;

const LEAGUES_ONLY = process.argv.includes("--leagues-only");

// 按日增量：--date YYYY-MM-DD（可选）。指定时只驱动该业务日的 titan_jc_schedule 行。
const DATE_ARG = process.argv.find((a) => a.startsWith("--date="));
const DATE_ONLY = DATE_ARG ? DATE_ARG.slice("--date=".length) : null;
if (DATE_ONLY && !/^\d{4}-\d{2}-\d{2}$/.test(DATE_ONLY)) {
  console.error(`[match] 非法 --date：${DATE_ONLY}（应为 YYYY-MM-DD）`);
  process.exit(1);
}

const JC_DIR = join(MONOREPO, "mapping", "data", "jc");
const LEAGUE_CONFLICT_LOG = join(JC_DIR, "conflict-league.log");
const UNMATCHED_MATCH_LOG = join(JC_DIR, "unmatched-match.log");

// 时间容差（决策：sofa±90min / titan内部±3天）
const TITAN_INNER_TOLERANCE_MS = 3 * 86400000;   // ±3 天（titan_jc ↔ titan_schedules）
const SOFA_TOLERANCE_MS = 90 * 60000;            // ±90 分钟（titan ↔ sofascore）

function pool(db: string): pg.Pool {
  return new pg.Pool({ host: "localhost", port: 5432, user: "api_service", password: APP_PASSWORD, database: db, max: 3 });
}

function logLine(file: string, text: string) {
  appendFileSync(file, `${new Date().toISOString()}  ${text}\n`, "utf8");
}

const runMark = () => `\n===== run ${new Date().toISOString()} =====\n`;

function toEpoch(v: any): number | null {
  if (v == null || v === "") return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

// ─── 联赛映射（titan_competitions ↔ sofascore.leagues） ──────
// 中英文名双键自动匹配：name_cn↔short_name、name_en↔name（小写归一）。
// 唯一候选直接填；多候选/无候选 → 记 conflict-league.log 人工抽查。

const LEAGUE_NAME_ALIAS: Record<string, string> = {
  // titan name_en（小写） -> sofascore name（小写）
  "efl championship": "championship",
  "english premier league": "premier league",
  "j2 league": "j2 league",
  "j1 league": "j1 league",
  "major league soccer": "major league soccer",
  "eerste divisie": "eerste divisie",
  "la liga": "laliga ea sports",
  "serie a": "serie a",
  "eredivisie": "eredivisie",
  "eliteserien": "eliteserien",
  "primeira liga": "liga portugal",
  "veikkausliiga": "veikkausliiga",
  "k league 1": "k league 1",
  "bundesliga": "bundesliga",
  "ligue 1": "ligue 1",
  "a-league": "a-league men",
  "ligue 2": "ligue 2",
  "allsvenskan": "allsvenskan",
  "2. bundesliga": "2. bundesliga",
  "saudi professional league": "saudi professional league",
  // titan name_cn（中文名） -> sofascore name（小写）
  // 20 大联赛多已有 name_en，无需中文键；此处补 titan 无 name_en 的杯赛
  "欧冠杯": "uefa champions league",
  "欧罗巴杯": "uefa europa league",
  "英联杯": "efl cup",
  "西杯": "copa del rey",
  "意杯": "coppa italia",
  "日联杯": "j. league cup",
  "英社盾": "community shield",
};

// ─── titan 联赛 → 竞彩联赛名（知识库人工核对，120 条有值 + 14 条留空） ──
// 竞彩用全称（"英格兰超级联赛"），titan 用简称（"英超"）；两套命名体系不同，
// 不能用机械相等判断。14 个竞彩无对应的联赛不在表内（titanid 缺省即留空）。
// 已确认置空：122瑞典甲 123挪甲 150苏冠 157葡甲 203法丙 611智利乙 1292韩K2联
//             1441巴超联杯 664加拿冠 1731日新杯 2402亚洲杯U20 340阿夏赛
//             498酋长杯 834奥迪杯 2824FIFA系列赛
const LEAGUE_JC_ALIAS: Record<number, string> = {
  // A. 联赛类
  2: "阿根廷甲级联赛", 4: "巴西甲级联赛", 5: "比利时甲级联赛", 8: "德国甲级联赛",
  9: "德国乙级联赛", 10: "俄罗斯超级联赛", 11: "法国甲级联赛", 12: "法国乙级联赛",
  13: "芬兰超级联赛", 15: "韩国职业联赛", 16: "荷兰甲级联赛", 17: "荷兰乙级联赛",
  21: "美国职业大联盟", 22: "挪威超级联赛", 23: "葡萄牙超级联赛", 25: "日本职业联赛",
  26: "瑞典超级联赛", 29: "苏格兰超级联赛", 31: "西班牙甲级联赛", 34: "意大利甲级联赛",
  35: "英格兰乙级联赛", 36: "英格兰超级联赛", 37: "英格兰冠军联赛", 39: "英格兰甲级联赛",
  140: "墨西哥超级联赛", 273: "澳大利亚超级联赛", 284: "日本乙级联赛",
  292: "沙特职业联赛", 415: "智利甲级联赛",
  // B. 欧战/国家队大赛
  67: "欧洲杯", 75: "世界杯", 88: "俱乐部世界杯", 89: "南美解放者杯",
  93: "非洲杯", 95: "亚洲杯", 103: "欧洲冠军联赛", 109: "欧洲超级杯",
  113: "欧罗巴联赛", 224: "美洲杯", 263: "南美俱乐部杯", 270: "南美优胜者杯",
  304: "俱乐部世界杯", 388: "女足世界杯", 1299: "国际冠军杯", 1864: "欧洲国家联赛",
  2187: "欧洲协会联赛", 2595: "俱乐部世界杯",
  // C. 各国杯赛/超级杯
  51: "德国杯", 54: "法国杯", 55: "法国联赛杯", 59: "荷兰杯", 64: "挪威杯",
  70: "葡萄牙杯", 72: "日本联赛杯", 73: "瑞典杯", 77: "苏格兰联赛杯", 78: "苏格兰足总杯",
  81: "西班牙国王杯", 83: "意大利杯", 84: "英格兰联赛杯", 90: "英格兰足总杯",
  108: "比利时杯", 144: "英格兰锦标赛", 153: "俄罗斯杯", 162: "日本天皇杯",
  173: "墨西哥杯", 178: "巴西圣保罗州锦赛", 186: "巴西杯", 264: "意大利超级杯",
  385: "英格兰社区盾杯", 468: "韩国杯", 483: "美国公开赛杯", 505: "葡萄牙联赛杯",
  704: "西班牙超级杯", 714: "智利杯", 842: "德国超级杯", 1183: "阿根廷杯",
  1356: "澳大利亚杯",
  // D. 其他超级杯
  58: "荷兰超级杯", 69: "葡萄牙超级杯", 110: "比利时超级杯", 191: "俄罗斯超级杯",
  698: "法国超级杯", 775: "挪威超级杯", 1309: "智利超级杯", 1350: "墨西哥超级杯",
  1277: "阿根廷超级杯", 71: "日本超级杯",
  // E. 亚冠/中北美
  192: "亚洲冠军精英联赛", 232: "中北美金杯赛", 344: "中北美冠军杯",
  350: "亚洲冠军乙级联赛", 1807: "墨西哥冠军杯",
  // F. 预选赛/国家队
  44: "奥运会男足", 76: "U20世界杯", 114: "欧洲U21锦标赛", 185: "奥运会女足",
  223: "女足欧洲杯", 401: "亚运会男足", 405: "亚运会女足", 629: "女足亚洲杯",
  648: "亚洲杯预选赛", 650: "欧洲杯预选赛",
  651: "非洲杯预选赛", 652: "世界杯预选赛", 653: "世界杯预选赛", 892: "世界杯预选赛",
  1164: "欧洲U21锦标赛", 1366: "国际赛", 1385: "U23亚洲杯",
  // G. 地区/友谊赛事
  41: "俱乐部友谊赛", 53: "东亚锦标赛", 220: "麒麟杯", 424: "中美洲杯",
  564: "女足东亚锦标赛", 668: "欧洲波罗的海杯", 1124: "东南亚锦标赛",
  1726: "中国杯", 1964: "CONCACAF Nations League",
};

async function fillLeagues(titan: pg.Pool, sofascore: pg.Pool, core: pg.Pool) {
  mkdirSync(JC_DIR, { recursive: true });
  appendFileSync(LEAGUE_CONFLICT_LOG, runMark(), "utf8");

  // 0) 表迁移自举：旧版以 sofaid 为主键（只放得下 29 个 sofa 联赛），
  //    新版以 titanid 为主键（134 个全量）。检测主键在 sofaid 上则重建并迁移。
  const pk = await core.query(
    `SELECT a.attname
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = 'cross_source_leagues'::regclass AND i.indisprimary`
  );
  const pkCol = pk.rows[0]?.attname;
  const isOld = pkCol === "sofaid";
  if (isOld) {
    console.log("[league] 检测到旧表结构（sofaid 主键），重建为 titanid 主键并迁移…");
    await core.query("ALTER TABLE cross_source_leagues RENAME TO cross_source_leagues_old");
    await core.query(`
      CREATE TABLE cross_source_leagues (
        titanid      INTEGER PRIMARY KEY,
        titancn      TEXT,
        titanen      TEXT,
        sofaid       INTEGER UNIQUE,
        sofascoreen  TEXT,
        jingcainame  TEXT,
        updated_at   TIMESTAMPTZ DEFAULT now()
      )`);
    await core.query(
      `INSERT INTO cross_source_leagues (titanid, titancn, titanen, sofaid, sofascoreen, jingcainame)
       SELECT titanid, titancn, titanen, sofaid, sofascoreen, jingcainame
       FROM cross_source_leagues_old WHERE titanid IS NOT NULL`);
    await core.query("DROP TABLE cross_source_leagues_old");
    console.log("[league] 迁移完成");
  } else {
    await core.query(`
      CREATE TABLE IF NOT EXISTS cross_source_leagues (
        titanid      INTEGER PRIMARY KEY,
        titancn      TEXT,
        titanen      TEXT,
        sofaid       INTEGER UNIQUE,
        sofascoreen  TEXT,
        jingcainame  TEXT,
        updated_at   TIMESTAMPTZ DEFAULT now()
      )`);
  }

  // titan 侧：竞彩实际用到的全部 134 联赛（sclass_id 有 jc 比赛）
  const titanRes = await titan.query(
    `SELECT DISTINCT c.competition_id, c.name_cn, c.name_en
     FROM titan_competitions c
     JOIN titan_jc_schedule j ON c.competition_id = j.sclass_id`
  );
  // sofascore 侧：全部 29 联赛
  const sofaRes = await sofascore.query("SELECT league_id, name, short_name, slug FROM leagues");

  const sofaByName = new Map<string, any>();   // name 小写 -> league
  const sofaByShort = new Map<string, any>();  // short_name -> league
  for (const s of sofaRes.rows) {
    if (s.name) sofaByName.set(String(s.name).trim().toLowerCase(), s);
    if (s.short_name) sofaByShort.set(String(s.short_name).trim(), s);
  }

  let inserted = 0, withSofa = 0, withJc = 0;
  for (const t of titanRes.rows) {
    const tid = t.competition_id;
    const cn = t.name_cn ?? "";
    const en = t.name_en ?? "";

    // sofa 匹配：显式别名(英/中) > sofa name == titan_en > titan_cn == short_name
    // 仅作补全列，不决定是否插入（所有 titan 联赛都入表）
    let sofaId: number | null = null, sofaEn: string | null = null;
    const enKey = String(en).trim().toLowerCase();
    const cnKey = String(cn).trim();
    const aliasEn = LEAGUE_NAME_ALIAS[enKey];
    const aliasCn = LEAGUE_NAME_ALIAS[cnKey];
    let sofaCand: any = undefined;
    if (aliasEn) sofaCand = sofaByName.get(aliasEn);
    if (!sofaCand && aliasCn) sofaCand = sofaByName.get(aliasCn);
    if (!sofaCand) sofaCand = sofaByName.get(enKey);
    if (!sofaCand) sofaCand = sofaByShort.get(cnKey);
    if (sofaCand) { sofaId = sofaCand.league_id; sofaEn = sofaCand.name; withSofa++; }

    // 竞彩名：知识库映射表（LEAGUE_JC_ALIAS），空 = 竞彩无对应
    const jcName = LEAGUE_JC_ALIAS[tid] ?? null;
    if (jcName) withJc++;

    await core.query(
      `INSERT INTO cross_source_leagues (titanid, titancn, titanen, sofaid, sofascoreen, jingcainame)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (titanid) DO UPDATE SET
         titancn     = EXCLUDED.titancn,
         titanen     = EXCLUDED.titanen,
         sofaid      = EXCLUDED.sofaid,
         sofascoreen = EXCLUDED.sofascoreen,
         jingcainame = EXCLUDED.jingcainame,
         updated_at  = now()`,
      [tid, cn || null, en || null, sofaId, sofaEn, jcName]
    );
    inserted++;
  }
  console.log(`[league] inserted=${inserted} withSofa=${withSofa} withJc=${withJc} total=${titanRes.rows.length}`);
}

// ─── 比赛映射 ────────────────────────────────────────────────

async function buildMatches(titan: pg.Pool, sofascore: pg.Pool, sporttery: pg.Pool, core: pg.Pool) {
  mkdirSync(JC_DIR, { recursive: true });
  appendFileSync(UNMATCHED_MATCH_LOG, runMark(), "utf8");

  // 0) 建表自举
  await core.query(`
    CREATE TABLE IF NOT EXISTS cross_source_matches (
      titan_jc_sid      INTEGER PRIMARY KEY,
      titan_schedule_id INTEGER UNIQUE,
      sofa_match_id     INTEGER UNIQUE,
      jc_match_id       INTEGER UNIQUE,
      business_date     DATE,
      kickoff_time      TIMESTAMPTZ,
      sclass_id         INTEGER,
      home_sofaid       INTEGER,
      away_sofaid       INTEGER,
      updated_at        TIMESTAMPTZ DEFAULT now()
    )`);

  // 1) 加载依赖映射
  const teamRows = (await core.query("SELECT titanid, sofaid FROM cross_source_teams WHERE titanid IS NOT NULL")).rows;
  const titanToSofaId = new Map<number, number>();
  for (const r of teamRows) titanToSofaId.set(r.titanid, r.sofaid);

  const leagueRows = (await core.query("SELECT titanid, sofaid FROM cross_source_leagues WHERE titanid IS NOT NULL")).rows;
  const titanLeagueToSofaId = new Map<number, number>();
  for (const r of leagueRows) titanLeagueToSofaId.set(r.titanid, r.sofaid);

  // 2) titan_schedules → 索引 (sclass_id|home|away) -> schedule[]
  const schedRes = await titan.query(
    `SELECT schedule_id, competition_id, home_team_id, away_team_id, match_time, full_score
     FROM titan_schedules`
  );
  const schedByKey = new Map<string, any[]>();
  for (const s of schedRes.rows) {
    const key = `${s.competition_id}|${s.home_team_id}|${s.away_team_id}`;
    if (!schedByKey.has(key)) schedByKey.set(key, []);
    schedByKey.get(key)!.push(s);
  }
  console.log(`[match] titan_schedules loaded: ${schedRes.rows.length}, keys=${schedByKey.size}`);

  // 3) sofascore.schedules → 索引 (league_id|home|away) -> schedule[]
  const sofaRes = await sofascore.query(
    `SELECT match_id, league_id, home_team_id, away_team_id, kickoff_time,
            home_score_normaltime, away_score_normaltime FROM schedules`
  );
  const sofaByKey = new Map<string, any[]>();
  for (const s of sofaRes.rows) {
    const key = `${s.league_id}|${s.home_team_id}|${s.away_team_id}`;
    if (!sofaByKey.has(key)) sofaByKey.set(key, []);
    sofaByKey.get(key)!.push(s);
  }
  console.log(`[match] sofascore.schedules loaded: ${sofaRes.rows.length}, keys=${sofaByKey.size}`);

  // 4) jingcai_schedules → 按 match_num 索引（business_date 与 titan 有 D±1 漂移）
  const jcRes = await sporttery.query(
    `SELECT match_id, business_date, match_num, home_score, away_score FROM jingcai_schedules WHERE match_num IS NOT NULL`
  );
  const jcByNum = new Map<string, any[]>();
  for (const j of jcRes.rows) {
    const key = String(j.match_num);
    if (!jcByNum.has(key)) jcByNum.set(key, []);
    jcByNum.get(key)!.push(j);
  }
  console.log(`[match] jingcai_schedules loaded: ${jcRes.rows.length}, match_num keys=${jcByNum.size}`);

  // 5) titan_jc_schedule 驱动（--date 指定时只处理该业务日）
  const jcRows = (await titan.query(
    `SELECT sid, business_date, kickoff_time, match_num, sclass_id,
            home_team_id, away_team_id, home_team, away_team, full_score
     FROM titan_jc_schedule
     ${DATE_ONLY ? "WHERE business_date = $1" : ""}`,
    DATE_ONLY ? [DATE_ONLY] : []
  )).rows;
  console.log(`[match] titan_jc_schedule driving: ${jcRows.length}${DATE_ONLY ? ` (date=${DATE_ONLY})` : ""}`);

  let tSchedHit = 0, sofaHit = 0, jcHit = 0, scoreMismatch = 0;

  for (const j of jcRows) {
    const sid = j.sid;
    const kickoffEpoch = toEpoch(j.kickoff_time);

    // 5a) titan 内部：titan_jc ↔ titan_schedules
    let titanScheduleId: number | null = null;
    if (kickoffEpoch != null) {
      const cands = schedByKey.get(`${j.sclass_id}|${j.home_team_id}|${j.away_team_id}`) ?? [];
      let bestDiff = TITAN_INNER_TOLERANCE_MS;
      for (const s of cands) {
        const t = toEpoch(s.match_time);
        if (t == null) continue;
        const diff = Math.abs(t - kickoffEpoch);
        if (diff <= bestDiff) { bestDiff = diff; titanScheduleId = s.schedule_id; }
      }
    }
    if (titanScheduleId != null) tSchedHit++;

    // 5b) sofa 关联：league 映射 + 主客 sofaid + kickoff±90min
    let sofaMatchId: number | null = null;
    const homeSofa = j.home_team_id != null ? titanToSofaId.get(j.home_team_id) : undefined;
    const awaySofa = j.away_team_id != null ? titanToSofaId.get(j.away_team_id) : undefined;
    const leagueSofa = j.sclass_id != null ? titanLeagueToSofaId.get(j.sclass_id) : undefined;
    if (kickoffEpoch != null && homeSofa != null && awaySofa != null && leagueSofa != null) {
      const cands = sofaByKey.get(`${leagueSofa}|${homeSofa}|${awaySofa}`) ?? [];
      let bestDiff = SOFA_TOLERANCE_MS;
      for (const s of cands) {
        const t = toEpoch(s.kickoff_time);
        if (t == null) continue;
        const diff = Math.abs(t - kickoffEpoch);
        if (diff <= bestDiff) { bestDiff = diff; sofaMatchId = s.match_id; }
      }
    }
    if (sofaMatchId != null) sofaHit++;

    // 5c) sporttery：business_date + match_num（容差 ±1 天）
    let jcMatchId: number | null = null;
    const num = String(j.match_num ?? "");
    const jDate = j.business_date instanceof Date ? j.business_date : j.business_date ? new Date(j.business_date) : null;
    if (num && jDate && !isNaN(jDate.getTime())) {
      let bestDiff = 2 * 86400000;  // ±1 天 = 2天窗口
      for (const c of jcByNum.get(num) ?? []) {
        const cd = c.business_date instanceof Date ? c.business_date : c.business_date ? new Date(c.business_date) : null;
        if (!cd || isNaN(cd.getTime())) continue;
        const diff = Math.abs(cd.getTime() - jDate.getTime());
        if (diff <= bestDiff) { bestDiff = diff; jcMatchId = c.match_id; }
      }
    }
    if (jcMatchId != null) jcHit++;

    // 5d) 比分二次校验（titan_schedules 或 sofa 侧命中时）
    if (titanScheduleId != null || sofaMatchId != null) {
      const full = String(j.full_score ?? "").trim();
      if (full) {
        if (titanScheduleId != null) {
          const sched = schedByKey.get(`${j.sclass_id}|${j.home_team_id}|${j.away_team_id}`)!.find((x) => x.schedule_id === titanScheduleId);
          if (sched && sched.full_score && String(sched.full_score).trim() !== full) {
            logLine(UNMATCHED_MATCH_LOG, `sid=${sid} | titan_schedules 比分不一致: jc=${full} sched=${sched.full_score}`);
            scoreMismatch++;
          }
        }
      }
    }

    await core.query(
      `INSERT INTO cross_source_matches
         (titan_jc_sid, titan_schedule_id, sofa_match_id, jc_match_id,
          business_date, kickoff_time, sclass_id, home_sofaid, away_sofaid)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (titan_jc_sid) DO UPDATE SET
         titan_schedule_id = EXCLUDED.titan_schedule_id,
         sofa_match_id     = EXCLUDED.sofa_match_id,
         jc_match_id       = EXCLUDED.jc_match_id,
         business_date     = EXCLUDED.business_date,
         kickoff_time      = EXCLUDED.kickoff_time,
         sclass_id         = EXCLUDED.sclass_id,
         home_sofaid       = EXCLUDED.home_sofaid,
         away_sofaid       = EXCLUDED.away_sofaid,
         updated_at        = now()`,
      [sid, titanScheduleId, sofaMatchId, jcMatchId,
       j.business_date ?? null, j.kickoff_time ?? null, j.sclass_id ?? null,
       homeSofa ?? null, awaySofa ?? null]
    );
  }

  console.log(`[match] done: total=${jcRows.length} titan_schedule=${tSchedHit} sofa=${sofaHit} sporttery=${jcHit} scoreMismatch=${scoreMismatch}`);
}

// ─── 主流程 ─────────────────────────────────────────────────

async function main() {
  const titan = pool("titan");
  const sofascore = pool("sofascore");
  const sporttery = pool("sporttery");
  const core = pool("core");
  try {
    await fillLeagues(titan, sofascore, core);
    if (!LEAGUES_ONLY) {
      await buildMatches(titan, sofascore, sporttery, core);
    }
  } finally {
    await titan.end();
    await sofascore.end();
    await sporttery.end();
    await core.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
