import { Page } from "puppeteer";
import { BrowserPool } from "../../engine/browser-pool.js";
import { Workset } from "./workset.js";
import { fetchVotes, gotoHome, recoverPage } from "./api.js";
import { fetchMissingDetails } from "./details.js";
import { drainDate, advanceCompleteDate, DEFAULT_COMPLETE_DATE } from "./drain.js";
import { formatDate, parseDate, addDaysStr } from "./time.js";

export class JingcaiHistoricalCrawler {
  private pool: BrowserPool;

  constructor(pool: BrowserPool) {
    this.pool = pool;
  }

  private async processDate(page: Page, dateStr: string, ws: Workset): Promise<Page> {
    process.stdout.write(`[Daily] ${dateStr}: `);
    let merged: any[];
    try {
      merged = await fetchVotes(page, dateStr);
    } catch (err) {
      console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
      return recoverPage(this.pool, page);
    }
    if (merged.length === 0) {
      console.log("no matches");
      return page;
    }
    ws.upsertMatches(merged);
    console.log(`${merged.length} matches`);
    return page;
  }

  // 详情只抓一次：在售场次同样抓（原 bug 修复），落 matches/{id}.json
  private async fetchMissingDetails(page: Page, ws: Workset): Promise<Page> {
    return fetchMissingDetails(page, this.pool, ws);
  }

  async runIncremental(ws: Workset, endDate: Date): Promise<void> {
    const endStr = formatDate(endDate);
    const drained: string[] = [];
    let page = await this.pool.getPage();
    page.setDefaultTimeout(60000);

    try {
      console.log(`[Daily] Navigating to https://www.sporttery.cn...`);
      page = await gotoHome(page);

      const base = ws.completeDate ?? DEFAULT_COMPLETE_DATE;
      const start = addDaysStr(base, 1);
      const current = parseDate(start);
      const end = parseDate(endStr);

      while (current <= end) {
        const dateStr = formatDate(current);
        page = await this.processDate(page, dateStr, ws);
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 2500));
        current.setDate(current.getDate() + 1);
      }

      ws.save();

      page = await this.fetchMissingDetails(page, ws);
      ws.save();

      for (const date of ws.dates) {
        if (!ws.isDateReady(date)) continue;
        const ok = await drainDate(ws, date);
        if (ok) {
          ws.deleteMatchFiles(date);
          ws.removeDate(date);
          drained.push(date);
          console.log(`[Drain] ${date} 导入并排干`);
        } else {
          ws.incrementAttempts(date);
          console.log(`[Drain] ${date} 未通过复核，保留重试`);
        }
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 500));
      }

      ws.save();
    } finally {
      this.pool.releasePage(page);
    }

    advanceCompleteDate(ws, endDate, drained);
    ws.save();
  }
}
