import dotenv from "dotenv";
dotenv.config();

import { BrowserPool } from "../engine/browser-pool.js";
import { gotoHome, fetchFixedBonus } from "../sources/jingcai/api.js";
import { getPool, endPool, upsertMatchDetail } from "../db/writer.js";

// ============================================================
// 存量修复：对 business_date >= 2026-08-01 已入库的比赛，
// 重抓 getFixedBonusV1（累计全量）重新 upsert 赔率表，
// 补上修复前 T 点轮询丢失的"开赛前最后一次赔率更新"。
// 幂等，可重复跑。
// 运行：npx tsx src/scripts/repair-final-odds.ts
// ============================================================

const START_DATE = "2026-08-01";
const DELAY = 300 + 200; // 每次抓取间隔

async function main() {
  const { rows } = await getPool().query(
    `SELECT match_id, business_date FROM jingcai_schedules
     WHERE business_date >= $1 ORDER BY business_date, match_id`,
    [START_DATE],
  );
  console.log(`待修复比赛数: ${rows.length}（${START_DATE} 起）`);

  const pool = new BrowserPool({ headless: process.env.BROWSER_HEADLESS !== "false", maxPages: 1 });
  const page = await pool.getPage();
  page.setDefaultTimeout(60000);
  await gotoHome(page);

  let ok = 0, fail = 0;
  for (let i = 0; i < rows.length; i++) {
    const { match_id: mid, business_date: bd } = rows[i];
    try {
      const value = await fetchFixedBonus(page, mid);
      if (!value) {
        console.log(`[${i + 1}/${rows.length}] #${mid} (${bd}) 无返回`);
        fail++;
        continue;
      }
      await upsertMatchDetail(mid, { oddsHistory: value });
      const n = value?.oddsHistory?.hadList?.length ?? 0;
      ok++;
      if (ok % 20 === 0 || i === rows.length - 1) {
        console.log(`[${i + 1}/${rows.length}] 已修复 ${ok} 失败 ${fail}（最近 #${mid} hadList=${n}）`);
      }
    } catch (err) {
      fail++;
      console.error(`[${i + 1}/${rows.length}] #${mid} ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((r) => setTimeout(r, DELAY));
  }

  await pool.closeAll();
  await endPool();
  console.log(`完成: 成功 ${ok} 失败 ${fail}`);
}

main().catch(async (err) => {
  console.error("FATAL:", err);
  try { await endPool(); } catch {}
  process.exit(1);
});
