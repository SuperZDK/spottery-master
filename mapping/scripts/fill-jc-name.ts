import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import pg from "pg";

// ============================================================
// 阶段二：竞彩名 —— DB 版 jc join（重构自 titan007_pro 的
//   pipelines/jc_daily.py + core/jc_store.py，原逻辑读 JSON 文件，
//   此处改为读 DB：titan_jc_schedule ↔ jingcai_schedules）。
// 运行：npx tsx mapping/scripts/fill-jc-name.ts
// 产物（中间数据一律 JSON，不落 DB）：
//   mapping/data/jc/team_map.json / match_map.json / unmatched.json
//   mapping/data/jc/cursor.json（增量游标）
// 并反填 cross_source_teams.jingcainame（唯一候选填，多候选记冲突）。
// ============================================================

const MONOREPO = join(import.meta.dirname, "../..");
loadEnv({ path: join(MONOREPO, ".env") });
const APP_PASSWORD = process.env.PG_APP_PASSWORD ?? process.env.POSTGRES_PASSWORD;

const JC_DIR = join(MONOREPO, "mapping", "data", "jc");
const TEAM_MAP_PATH = join(JC_DIR, "team_map.json");
const MATCH_MAP_PATH = join(JC_DIR, "match_map.json");
const UNMATCHED_PATH = join(JC_DIR, "unmatched.json");
const CURSOR_PATH = join(JC_DIR, "cursor.json");
const CONFLICT_LOG = join(JC_DIR, "conflict-jc.log");

const START_DATE = "2016-01-01";          // sporttery 2015 / titan jc 2016，只处理 2016 起
const DATE_TOLERANCE_DAYS = 1;            // business_date 容差 ±1 天（对齐原版 jc_daily，不看 kickoff）

function pool(db: string): pg.Pool {
  return new pg.Pool({ host: "localhost", port: 5432, user: "api_service", password: APP_PASSWORD, database: db, max: 3 });
}

function logLine(file: string, text: string) {
  appendFileSync(file, `${new Date().toISOString()}  ${text}\n`, "utf8");
}

function truncate(file: string) {
  writeFileSync(file, "", "utf8");
}

// ─── 文件读写（原子写） ─────────────────────────────────────

function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function saveJson(path: string, data: unknown) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, path);
}

// ─── 日期/时间解析 ──────────────────────────────────────────

const toDateKey = (d: any): string => {
  if (d == null || d === "") return "";
  if (d instanceof Date && !isNaN(d.getTime())) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }
  return String(d).slice(0, 10);
};

// ─── 主流程 ─────────────────────────────────────────────────

async function main() {
  mkdirSync(JC_DIR, { recursive: true });
  const titan = pool("titan");
  const sporttery = pool("sporttery");
  const core = pool("core");

  try {
    const cursor = loadJson(CURSOR_PATH, { last_business_date: null as string | null });
    const from = cursor.last_business_date ?? START_DATE;
    console.log(`[jc] start from business_date >= ${from}`);

    // 1) titan 侧赛程（增量：business_date > from）
    const titanRes = await titan.query(
      `SELECT sid, business_date, kickoff_time, match_num, sclass_id,
              home_team_id, away_team_id, home_team, away_team,
              home_team_en, away_team_en, full_score, half_score
       FROM titan_jc_schedule
       WHERE business_date >= $1
       ORDER BY business_date`,
      [from]
    );
    const titanRows = titanRes.rows;
    console.log(`[jc] titan_jc_schedule rows: ${titanRows.length}`);

    // 2) 竞彩侧赛程 → 按 match_num 建索引（business_date 与 titan 有 D±1 漂移，容差内匹配）
    const jcRes = await sporttery.query(
      `SELECT match_id, business_date, match_date, match_num, home_team, away_team, kickoff_time
       FROM jingcai_schedules
       WHERE business_date >= $1`,
      [from]
    );
    const jcByNum = new Map<string, any[]>();
    for (const j of jcRes.rows) {
      if (!j.match_num) continue;
      const key = String(j.match_num);
      if (!jcByNum.has(key)) jcByNum.set(key, []);
      jcByNum.get(key)!.push(j);
    }
    console.log(`[jc] jingcai_schedules rows: ${jcRes.rows.length}, match_num keys: ${jcByNum.size}`);

    // 3) 加载既有中间产物（增量累积）
    const teamMap = loadJson<Record<string, any>>(TEAM_MAP_PATH, {});
    const matchMap = loadJson<Record<string, any>>(MATCH_MAP_PATH, {});
    const unmatched = loadJson<Record<string, any[]>>(UNMATCHED_PATH, {});

    let joined = 0, unmatchedN = 0, maxDate = cursor.last_business_date ?? from;

    for (const t of titanRows) {
      const num = String(t.match_num ?? "");
      const tDate = toDateKey(t.business_date);
      if (tDate > (maxDate ?? "")) maxDate = tDate;

      // 匹配候选：match_num 相等 + business_date 容差（对齐原版 jc_daily，不看 kickoff）
      let best: any = null;
      for (const j of jcByNum.get(num) ?? []) {
        const jDate = toDateKey(j.business_date);
        const dayDiff = Math.abs(new Date(jDate + "T00:00:00").getTime() - new Date(tDate + "T00:00:00").getTime()) / 86400000;
        if (dayDiff > DATE_TOLERANCE_DAYS) continue;
        if (best == null) best = j;
      }

      if (!best) {
        unmatchedN++;
        const entry = unmatched[tDate] ??= [];
        if (!entry.some((u) => u.sid === t.sid)) {
          entry.push({ sid: t.sid, match_num: num, sclass_id: t.sclass_id, reason: "no_spottery" });
        }
        continue;
      }

      joined++;

      // match_map：titan_sid → 竞彩 match_id（等效原 match_map.json）
      const mmKey = String(t.sid);
      matchMap[mmKey] = {
        titan_sid: t.sid,
        jc_match_id: best.match_id,
        business_date: toDateKey(best.business_date),
        match_date: toDateKey(best.match_date ?? best.business_date),
        match_num: num,
        sclass_id: t.sclass_id,
        home_team_id: t.home_team_id,
        away_team_id: t.away_team_id,
        full_score: t.full_score,
        half_score: t.half_score,
        updated_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      };

      // team_map：titan_team_id → 观测到的竞彩队名（等效原 update_team_map 累积）
      updateTeamMap(teamMap, t.home_team_id, t.home_team, t.home_team_en, best.home_team, "home");
      updateTeamMap(teamMap, t.away_team_id, t.away_team, t.away_team_en, best.away_team, "away");
    }

    // 4) 落盘中间产物
    saveJson(TEAM_MAP_PATH, teamMap);
    saveJson(MATCH_MAP_PATH, matchMap);
    saveJson(UNMATCHED_PATH, Object.fromEntries(Object.entries(unmatched).filter(([, v]) => v.length > 0)));
    saveJson(CURSOR_PATH, { last_business_date: maxDate });

    console.log(`[jc] joined=${joined} unmatched=${unmatchedN} cursor=${maxDate} teamMap=${Object.keys(teamMap).length} matchMap=${Object.keys(matchMap).length}`);

    // 5) 反填 cross_source_teams.jingcainame
    truncate(CONFLICT_LOG);
    await backfillJingcaiName(core, teamMap);

  } finally {
    await titan.end();
    await sporttery.end();
    await core.end();
  }
}

function updateTeamMap(teamMap: Record<string, any>, tid: number | null, titanName: string | null,
                       titanEn: string | null, jcName: string | null, _side: string) {
  if (tid == null) return;
  const key = String(tid);
  const entry = teamMap[key] ?? { titan_team_id: tid };
  if (titanName) entry.titan_team_cn = titanName;
  if (titanEn) entry.titan_team_en = titanEn;
  if (jcName) {
    const names = (entry.jc_names ??= []);
    if (!names.includes(jcName)) names.push(jcName);
  }
  entry.updated_at = new Date().toISOString().slice(0, 19).replace("T", " ");
  teamMap[key] = entry;
}

async function backfillJingcaiName(core: pg.Pool, teamMap: Record<string, any>) {
  const teams = (await core.query("SELECT sofaid, titanid, titancn, jingcainame FROM cross_source_teams WHERE titanid IS NOT NULL")).rows;
  const byTitanId = new Map<number, any>();
  for (const r of teams) byTitanId.set(r.titanid, r);

  let filled = 0, conflict = 0, skipped = 0;
  for (const [tidStr, entry] of Object.entries(teamMap)) {
    const row = byTitanId.get(Number(tidStr));
    if (!row) { skipped++; continue; }
    const jcNames: string[] = entry.jc_names ?? [];
    const uniq = Array.from(new Set(jcNames));
    if (uniq.length === 1) {
      const name = uniq[0];
      if (row.jingcainame !== name) {
        await core.query("UPDATE cross_source_teams SET jingcainame = $1, updated_at = now() WHERE sofaid = $2", [name, row.sofaid]);
        filled++;
      }
    } else if (uniq.length > 1) {
      logLine(CONFLICT_LOG, `titanid=${tidStr} titancn=${row.titancn} | 竞彩名候选 >1: ${uniq.join(" / ")}`);
      conflict++;
    }
  }
  console.log(`[jc] backfill jingcainame: filled=${filled} conflict=${conflict} skipped(无映射行)=${skipped}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
