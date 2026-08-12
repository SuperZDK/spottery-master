import dotenv from "dotenv";
dotenv.config();

import { BrowserPool } from "../../engine/browser-pool.js";
import { JingcaiHistoricalCrawler } from "./historical.js";
import { formatDate } from "./time.js";
import { Workset } from "./workset.js";
import { reconcileCompleteDate } from "./drain.js";
import { endPool } from "../../db/writer.js";

async function main() {
  const pool = new BrowserPool({ headless: process.env.BROWSER_HEADLESS !== "false", maxPages: 1 });
  const crawler = new JingcaiHistoricalCrawler(pool);
  const ws = new Workset();
  ws.load();
  await reconcileCompleteDate(ws);
  ws.save();

  const today = new Date();
  const todayStr = formatDate(today);

  console.log("====================================");
  console.log("竞彩增量爬取+排干任务");
  console.log(`最新完整日期: ${ws.completeDate ?? "(未初始化)"}  今天: ${todayStr}`);
  console.log("====================================\n");

  await crawler.runIncremental(ws, today);

  console.log(`\n最新完整日期: ${ws.completeDate}`);
  console.log("全部完成！");
  await pool.closeAll();
  await endPool();
}

main().catch(async (err) => {
  console.error("FATAL:", err);
  try { await endPool(); } catch {}
  process.exit(1);
});
