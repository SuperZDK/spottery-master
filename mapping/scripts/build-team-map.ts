import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import pg from "pg";
import { curlJson, curlText, sofaTeamById, shutdownBrowser } from "./lib/curl.ts";

// ============================================================
// 阶段一：三源球队映射 —— sofascore init + titan 关联
// 读取 DB（titan/sofascore 只读，core 读写），唯一网络请求：
//   tdl{id}.js（titan 英文名） + sofascore 搜索 API。
// 运行：npx tsx mapping/scripts/build-team-map.ts
//        --retry-no-hit  清除 no-hit 游标，重跑所有未命中队
//        --revalidate    全量重验：ok 队也重新搜索，命中不同实体则改绑
//        --backfill-only 只做人工确认回填（跳过 sofaInit/titanLink）
// 产物：core.cross_source_teams（最终表）+ mapping/data/jc/ 下的日志/游标
// ============================================================

const RETRY_NO_HIT = process.argv.includes("--retry-no-hit");
const REVALIDATE = process.argv.includes("--revalidate");
const BACKFILL_ONLY = process.argv.includes("--backfill-only");

const MONOREPO = join(import.meta.dirname, "../..");
loadEnv({ path: join(MONOREPO, ".env") });
const APP_PASSWORD = process.env.PG_APP_PASSWORD ?? process.env.POSTGRES_PASSWORD;

const JC_DIR = join(MONOREPO, "mapping", "data", "jc");
const CURSOR_FILE = join(JC_DIR, "team-map-cursor.json");
const CONFLICT_LOG = join(JC_DIR, "conflict-team-map.log");
const FETCH_FAIL_LOG = join(JC_DIR, "fetch-fail.log");
const NO_SEARCH_HIT_LOG = join(JC_DIR, "no-search-hit.log");
const TODO_MANUAL_CSV = join(JC_DIR, "todo-manual.csv");
const TEAM_MAP_JSON = join(JC_DIR, "team_map.json");

const MIN_INTERVAL_MS = 200;
const SEARCH_BASE = "https://api.sofascore.com/api/v1/search/teams";
const TDL_BASE = "https://zq.titan007.com/jsData/teamInfo/teamDetail/tdl";

function pool(db: string): pg.Pool {
  return new pg.Pool({ host: "localhost", port: 5432, user: "api_service", password: APP_PASSWORD, database: db, max: 3 });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function logLine(file: string, text: string) {
  appendFileSync(file, `${new Date().toISOString()}  ${text}\n`, "utf8");
}

// ─── 人工确认清单 CSV（todo-manual.csv） ─────────────────────
// 列：titanid,titancn,titanen,sofaid,sofascoreen,sofacode,sofaslug,sofanational,jingcainame,期望gender,置信度
// 人工只填 sofaid（查证后的 sofascore id）与置信度（100=确认），
// 其余列由脚本自动生成/回填时自动补全。置信度=100 且 sofaid 非空才回填。

const TODO_CSV_HEADER = "titanid,titancn,titanen,sofaid,sofascoreen,sofacode,sofaslug,sofanational,jingcainame,期望gender,置信度";

function csvEsc(v: string | number | boolean | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

interface TodoRow {
  titanid: number;
  titancn: string;
  titanen: string;
  sofaid: string;
  sofascoreen: string;
  sofacode: string;
  sofaslug: string;
  sofanational: string;
  jingcainame: string;
  gender: string;
  confidence: string;
}

function parseTodoCsv(): TodoRow[] {
  if (!existsSync(TODO_MANUAL_CSV)) return [];
  const text = readFileSync(TODO_MANUAL_CSV, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  if (!lines[0].startsWith("titanid")) return [];
  const rows: TodoRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    // 简易 CSV 解析（本项目字段不含逗号/引号，用 split 足够）
    const c = lines[i].split(",").map((s) => s.trim());
    if (c.length < 11) continue;
    const tid = Number(c[0]);
    if (!Number.isFinite(tid)) continue;
    rows.push({
      titanid: tid,
      titancn: c[1],
      titanen: c[2],
      sofaid: c[3],
      sofascoreen: c[4],
      sofacode: c[5],
      sofaslug: c[6],
      sofanational: c[7],
      jingcainame: c[8],
      gender: c[9],
      confidence: c[10],
    });
  }
  return rows;
}

function writeTodoCsv(rows: TodoRow[]) {
  const lines = [TODO_CSV_HEADER];
  for (const r of rows) {
    lines.push([r.titanid, r.titancn, r.titanen, r.sofaid, r.sofascoreen, r.sofacode, r.sofaslug, r.sofanational, r.jingcainame, r.gender, r.confidence].map(csvEsc).join(","));
  }
  writeFileSync(TODO_MANUAL_CSV, `\uFEFF${lines.join("\n")}\n`, "utf8");
}

function expectedGender(titanen: string): string {
  return /\(W\)$/i.test(titanen.trim()) ? "F" : "M";
}

// ─── 回填：置信度=100 且 sofaid 非空 → 校验后 upsert ──────────
// 返回 [已回填数, 校验失败数]；失败的行保留在 CSV 供人工修正。

async function backfillManual(core: pg.Pool): Promise<[number, number]> {
  const rows = parseTodoCsv();
  if (rows.length === 0) return [0, 0];
  const pending: TodoRow[] = [];
  let ok = 0, fail = 0;

  const cursor = loadCursor();

  for (const r of rows) {
    if (r.confidence !== "100" || !r.sofaid) { pending.push(r); continue; }
    const sofaId = Number(r.sofaid);
    if (!Number.isFinite(sofaId)) { pending.push(r); continue; }
    try {
      const t = await sofaTeamById(sofaId);
      if (r.gender && t.gender && t.gender !== r.gender) {
        logLine(CONFLICT_LOG, `manual titanid=${r.titanid} cn=${r.titancn} sofaid=${sofaId} | gender 不符：期望=${r.gender} 实际=${t.gender}`);
        fail++;
        pending.push(r);
        continue;
      }
      await core.query(
        `INSERT INTO cross_source_teams
           (sofaid, sofascoreen, sofacode, sofaslug, sofanational, titanid, titancn, titanen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (sofaid) DO UPDATE SET
           sofascoreen = EXCLUDED.sofascoreen,
           sofacode    = EXCLUDED.sofacode,
           sofaslug    = EXCLUDED.sofaslug,
           sofanational = EXCLUDED.sofanational,
           titanid     = EXCLUDED.titanid,
           titancn     = EXCLUDED.titancn,
           titanen     = EXCLUDED.titanen,
           updated_at  = now()`,
        [sofaId, t.name, t.nameCode || null, t.slug || null, t.national, r.titanid, r.titancn || null, r.titanen || null]
      );
      console.log(`[manual] 回填 titanid=${r.titanid} cn=${r.titancn} → sofaid=${sofaId} name=${t.name}`);
      // 更新游标为 ok，避免 buildTodoCsv 再次把该队加回清单
      cursor[String(r.titanid)] = "ok";
      saveCursor(cursor);
      ok++;
    } catch (e) {
      logLine(CONFLICT_LOG, `manual titanid=${r.titanid} cn=${r.titancn} sofaid=${r.sofaid} | 校验/写入失败：${e}`);
      fail++;
      pending.push(r);
    }
  }

  if (pending.length !== rows.length) writeTodoCsv(pending);
  console.log(`[manual] backfill: ok=${ok} fail=${fail} remaining=${pending.length}`);
  return [ok, fail];
}

// ─── 生成清单：no-hit 队 + team_map.json 带入 jingcainame ─────
// noHitRows：本次实际跑过且未命中的队（含 cn/en）；游标里还有
// 未跑到的 no-hit（本次被游标跳过），需从 titan 侧补 cn/en。

async function buildTodoCsv(core: pg.Pool, cursor: Record<string, string>, noHitRows: { tid: number; cn: string; en: string }[]) {
  const noHitIds = new Set(Object.entries(cursor).filter(([, v]) => v === "no-hit").map(([k]) => Number(k)).filter((n) => Number.isFinite(n)));
  for (const r of noHitRows) noHitIds.add(r.tid);
  if (noHitIds.size === 0) return;

  // 本次跑过的 no-hit 优先用其实时 cn/en；未跑到的从 titan_teams 查
  const byTid = new Map(noHitRows.map((r) => [r.tid, r]));
  const missIds = [...noHitIds].filter((n) => !byTid.has(n));
  let titanRows: Record<string, any>[] = [];
  if (missIds.length > 0) {
    const t = pool("titan");
    titanRows = (await t.query("SELECT team_id, name_cn, name_en FROM titan_teams WHERE team_id = ANY($1)", [missIds])).rows;
    await t.end();
  }
  const titanById = new Map(titanRows.map((r) => [r.team_id, r]));

  let teamMap: Record<string, any> = {};
  if (existsSync(TEAM_MAP_JSON)) {
    try { teamMap = JSON.parse(readFileSync(TEAM_MAP_JSON, "utf8")); } catch { teamMap = {}; }
  }
  const existing = parseTodoCsv();
  const prevByTid = new Map(existing.map((r) => [r.titanid, r]));
  const rows: TodoRow[] = [];
  for (const tid of noHitIds) {
    // 已确认但未回填成功（置信度=100 或已填 sofaid），保留人工输入
    const prev = prevByTid.get(tid);
    if (prev && (prev.confidence === "100" || prev.sofaid)) { rows.push(prev); continue; }
    const live = byTid.get(tid);
    const tt = titanById.get(tid);
    const tm = teamMap[String(tid)] ?? {};
    const jcNames: string[] = Array.isArray(tm.jc_names) ? tm.jc_names : [];
    let titanen = (live?.en ?? tt?.name_en ?? "").trim();
    if (!titanen) {
      // name_en 为 null 的队（多数女足/未回填），从 tdl 抓取英文名
      try {
        titanen = (await fetchTitanEnWithRetry(tid)).trim();
        await sleep(MIN_INTERVAL_MS);
      } catch (e) {
        logLine(FETCH_FAIL_LOG, `titanid=${tid} cn=${tt?.name_cn ?? ""} buildTodoCsv tdl err=${e}`);
      }
    }
    rows.push({
      titanid: tid,
      titancn: live?.cn ?? tt?.name_cn ?? "",
      titanen,
      sofaid: "",
      sofascoreen: "",
      sofacode: "",
      sofaslug: "",
      sofanational: "",
      jingcainame: jcNames.length ? jcNames.join("/") : "",
      gender: titanen ? expectedGender(titanen) : "",
      confidence: "",
    });
  }
  writeTodoCsv(rows);
  console.log(`[manual] todo-manual.csv 生成：${rows.length} 行 no-hit 待确认`);
}

// ─── Cursor（断点续跑） ─────────────────────────────────────
// { [titanId]: "ok" | "no-hit" | "fetch-fail" }

function loadCursor(): Record<string, string> {
  if (!existsSync(CURSOR_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CURSOR_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveCursor(cursor: Record<string, string>) {
  writeFileSync(CURSOR_FILE, JSON.stringify(cursor, null, 2), "utf8");
}

// ─── tdl{id}.js 抓取 ────────────────────────────────────────
// var teamDetail = [175,'凯泽斯劳滕','凱沙羅頓','Kaiserslautern',...];  en = 下标 3

async function fetchTitanEn(teamId: number): Promise<string> {
  const url = `${TDL_BASE}${teamId}.js`;
  const text = await curlText(url);
  const m = text.match(/var\s+teamDetail\s*=\s*\[([^\]]*)\]/);
  if (!m) return "";
  const parts = m[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
  return parts[3] ?? "";
}

async function fetchTitanEnWithRetry(teamId: number): Promise<string> {
  let lastErr = "";
  for (let i = 0; i < 3; i++) {
    try {
      return await fetchTitanEn(teamId);
    } catch (e) {
      lastErr = String(e);
      await sleep(500 * (i + 1));
    }
  }
  throw new Error(lastErr || "unknown");
}

// ─── sofascore 搜索 ──────────────────────────────────────────
// 过滤 sport=football，取最高分。en 带 "(W)" 后缀视为女足：
// 搜索词去掉后缀，按 gender=F 过滤；否则按 gender=M 过滤。

interface SofaHit {
  id: number;
  name: string;
  nameCode: string;
  slug: string;
  national: boolean;
  score: number;
}

async function searchSofa(en: string): Promise<SofaHit | null> {
  const women = /\(W\)$/i.test(en.trim());
  const q = women ? en.trim().replace(/\s*\(W\)\s*$/i, "") : en;
  const url = `${SEARCH_BASE}?q=${encodeURIComponent(q)}`;
  const data: any = await curlJson(url);
  const hits = (data.results ?? []).filter((r: any) => {
    const e = r?.entity;
    return e && e.sport?.slug === "football" && (women ? e.gender === "F" : e.gender === "M");
  });
  if (hits.length === 0) return null;
  // 女足：优先国家队，避免 score 更高的同名俱乐部（如 FK Austria Wien）误选
  const pool = women && hits.some((r: any) => r?.entity?.national)
    ? hits.filter((r: any) => r?.entity?.national)
    : hits;
  const best = pool.sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))[0];
  const e = best.entity;
  return { id: e.id, name: e.name, nameCode: e.nameCode ?? "", slug: e.slug ?? "", national: !!e.national, score: best.score ?? 0 };
}

// ─── 阶段一 A：sofascore init ────────────────────────────────

async function sofaInit(core: pg.Pool) {
  const s = pool("sofascore");
  const res = await s.query("SELECT team_id, name, name_code, slug FROM teams");
  await s.end();
  console.log(`[A] sofascore teams: ${res.rows.length}`);

  let done = 0;
  for (const r of res.rows) {
    const q = `
      INSERT INTO cross_source_teams (sofaid, sofascoreen, sofacode, sofaslug)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (sofaid) DO UPDATE SET
        sofascoreen = EXCLUDED.sofascoreen,
        sofacode    = EXCLUDED.sofacode,
        sofaslug    = EXCLUDED.sofaslug,
        updated_at  = now()
    `;
    await core.query(q, [r.team_id, r.name, r.name_code ?? null, r.slug ?? null]);
    done++;
  }
  console.log(`[A] done: upserted=${done}`);
}

// ─── 阶段一 B：titan 关联 ────────────────────────────────────

async function titanLink(core: pg.Pool) {
  const t = pool("titan");
  const teams = (await t.query("SELECT team_id, name_cn, name_en FROM titan_teams")).rows;
  await t.end();
  console.log(`[B] titan teams: ${teams.length}`);

  const cursor = loadCursor();
  const existing = (await core.query("SELECT sofaid, sofascoreen, titanid, titancn, titanen, sofacode, sofaslug, sofanational FROM cross_source_teams")).rows;
  const byTitanId = new Map<number, any>();
  const bySofaId = new Map<number, any>();
  for (const row of existing) {
    if (row.titanid != null) byTitanId.set(row.titanid, row);
    bySofaId.set(row.sofaid, row);
  }

  let mapped = 0, skipped = 0, conflict = 0, noHit = 0, fetchFail = 0;
  const noHitRows: { tid: number; cn: string; en: string }[] = [];

  for (const t1 of teams) {
    const tid: number = t1.team_id;
    const key = String(tid);

    // --retry-no-hit：清除 no-hit 游标，允许重跑
    if (RETRY_NO_HIT && cursor[key] === "no-hit") {
      delete cursor[key];
    }
    // 统一游标规则：ok/no-hit/fetch-fail 均跳过（--revalidate 时 ok 也重验）
    if (cursor[key] === "ok" && !REVALIDATE) { skipped++; continue; }
    if (cursor[key] === "no-hit") { skipped++; continue; }
    if (cursor[key] === "fetch-fail") { skipped++; continue; }

    const row = byTitanId.get(tid);
    if (row && row.titanen && row.titancn && !REVALIDATE) { cursor[key] = "ok"; saveCursor(cursor); skipped++; continue; }

    // 1) 英文名
    let en = t1.name_en ?? "";
    if (!en) {
      try {
        en = await fetchTitanEnWithRetry(tid);
        await sleep(MIN_INTERVAL_MS);
      } catch (e) {
        logLine(FETCH_FAIL_LOG, `titanid=${tid} cn=${t1.name_cn} err=${e}`);
        cursor[key] = "fetch-fail";
        saveCursor(cursor);
        fetchFail++;
        continue;
      }
    }

    // 2) sofascore 搜索
    let hit: SofaHit | null = null;
    if (en) {
      try {
        hit = await searchSofa(en);
        await sleep(MIN_INTERVAL_MS);
      } catch (e) {
        logLine(FETCH_FAIL_LOG, `titanid=${tid} en=${en} search err=${e}`);
        // 搜索失败视为可重试，不落游标（下次再试）
        fetchFail++;
        continue;
      }
    }

    if (!hit) {
      logLine(NO_SEARCH_HIT_LOG, `titanid=${tid} cn=${t1.name_cn} en=${en || "(none)"}`);
      cursor[key] = "no-hit";
      saveCursor(cursor);
      noHit++;
      noHitRows.push({ tid, cn: t1.name_cn ?? "", en });
      continue;
    }

    // 3) 落库
    let target = byTitanId.get(tid);
    let sofaRow = bySofaId.get(hit!.id);
    const cn = t1.name_cn ?? "";

    if (target && target.titanen && target.titancn) {
      if (hit!.id === target.sofaid) {
        // 绑定一致：确认 ok
        cursor[key] = "ok"; saveCursor(cursor); skipped++;
        continue;
      }
      // 已映射但命中不同实体（--revalidate 全量重验时才会走到）：
      // 解绑旧行，改绑新命中实体
      await core.query(
        `UPDATE cross_source_teams SET titanid = NULL, titancn = NULL, titanen = NULL, updated_at = now() WHERE sofaid = $1`,
        [target.sofaid]
      );
      bySofaId.set(target.sofaid, { ...target, titanid: null, titancn: null, titanen: null });
      byTitanId.delete(tid);
      target = byTitanId.get(tid);
      sofaRow = bySofaId.get(hit!.id);
    }

    if (sofaRow) {
      // sofaid 已有行：空则填 titan 字段，不一致则冲突
      const fill: string[] = [];
      const params: any[] = [];
      const add = (col: string, val: any) => { fill.push(`${col} = $${fill.length + 1}`); params.push(val); };

      if (!sofaRow.titanid) add("titanid", tid);
      else if (sofaRow.titanid !== tid) {
        logLine(CONFLICT_LOG, `titanid=${tid} cn=${cn} en=${en} sofaid=${hit!.id} name=${hit!.name} | 该 sofaid 已绑定 titanid=${sofaRow.titanid}`);
        conflict++;
        continue;
      }
      if (!sofaRow.titancn) add("titancn", cn);
      else if (sofaRow.titancn !== cn) {
        logLine(CONFLICT_LOG, `titanid=${tid} cn=${cn} en=${en} sofaid=${hit!.id} name=${hit!.name} | 库中 titancn=${sofaRow.titancn} 不一致`);
        conflict++;
        continue;
      }
      if (!sofaRow.titanen) add("titanen", en);
      else if (sofaRow.titanen !== en) {
        logLine(CONFLICT_LOG, `titanid=${tid} cn=${cn} en=${en} sofaid=${hit!.id} name=${hit!.name} | 库中 titanen=${sofaRow.titanen} 不一致`);
        conflict++;
        continue;
      }
      if (!sofaRow.sofacode && hit!.nameCode) add("sofacode", hit!.nameCode);
      if (!sofaRow.sofaslug && hit!.slug) add("sofaslug", hit!.slug);
      if (sofaRow.sofanational == null) add("sofanational", hit!.national);

      if (fill.length > 0) {
        await core.query(
          `UPDATE cross_source_teams SET ${fill.join(", ")}, updated_at = now() WHERE sofaid = $${fill.length + 1}`,
          [...params, hit!.id]
        );
        // 更新内存态，保证后续同名冲突检测用最新数据
        const updated = { ...sofaRow, titanid: fill.some(f => f.startsWith("titanid")) ? tid : sofaRow.titanid, titancn: fill.some(f => f.startsWith("titancn")) ? cn : sofaRow.titancn, titanen: fill.some(f => f.startsWith("titanen")) ? en : sofaRow.titanen };
        bySofaId.set(hit!.id, updated);
        byTitanId.set(tid, updated);
      }
    } else {
      // 无 sofaid 行：新建
      await core.query(
        `INSERT INTO cross_source_teams
           (sofaid, sofascoreen, sofacode, sofaslug, sofanational, titanid, titancn, titanen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [hit!.id, hit!.name, hit!.nameCode || null, hit!.slug || null, hit!.national, tid, cn, en]
      );
      const created = { sofaid: hit!.id, sofascoreen: hit!.name, sofacode: hit!.nameCode || null, sofaslug: hit!.slug || null, sofanational: hit!.national, titanid: tid, titancn: cn, titanen: en };
      bySofaId.set(hit!.id, created);
      byTitanId.set(tid, created);
    }

    cursor[key] = "ok";
    saveCursor(cursor);
    mapped++;
  }

  console.log(`[B] done: mapped=${mapped} skipped=${skipped} conflict=${conflict} noHit=${noHit} fetchFail=${fetchFail}`);

  // 生成待人工确认清单（no-hit 队 → todo-manual.csv）
  await buildTodoCsv(core, cursor, noHitRows);
}

async function main() {
  mkdirSync(JC_DIR, { recursive: true });
  // 日志为累计记录（append），每次运行写分隔行
  const runMark = `\n===== run ${new Date().toISOString()} =====\n`;
  appendFileSync(CONFLICT_LOG, runMark, "utf8");
  appendFileSync(FETCH_FAIL_LOG, runMark, "utf8");
  appendFileSync(NO_SEARCH_HIT_LOG, runMark, "utf8");
  const core = pool("core");
  try {
    if (BACKFILL_ONLY) {
      await backfillManual(core);
    } else {
      await sofaInit(core);
      await backfillManual(core);
      await titanLink(core);
    }
  } finally {
    await core.end();
    await shutdownBrowser();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
