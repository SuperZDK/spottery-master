import { Page } from "puppeteer";
import { BrowserPool } from "../../engine/browser-pool.js";
import { dbMatchComplete } from "../../db/writer.js";
import { isRefund, isDetailIncomplete } from "./completeness.js";
import { Workset } from "./workset.js";
import { fetchDetail, recoverPage } from "./api.js";

// 详情只抓一次（在售/已结算都抓，原 bug 修复）：落 matches/{id}.json
export async function fetchMissingDetails(page: Page, pool: BrowserPool, ws: Workset, label = "Detail"): Promise<Page> {
  for (const date of ws.dates) {
    for (const m of ws.matchesOf(date)) {
      if (isRefund(m)) continue;
      const jf = ws.readMatch(m.matchId);
      if (jf?.detail && !isDetailIncomplete(jf.detail)) continue;
      let complete = false;
      try { complete = await dbMatchComplete(m.matchId); } catch { complete = false; }
      if (complete && !jf) continue;

      try {
        console.log(`\n[${label}] ${date} #${m.matchId} ${m.homeTeam ?? "?"} vs ${m.awayTeam ?? "?"}`);
        const detail = await fetchDetail(page, m.matchId);
        const next = ws.readMatch(m.matchId) ?? ws.newMatchFile(m.matchId, m.businessDate);
        next.detail = detail;
        next.kickoffTime = detail?.matchInfo?.matchDateTime ?? null;
        m.kickoffTime = next.kickoffTime;
        m.detailFetched = true;
        ws.saveMatch(next);
        if (isDetailIncomplete(detail)) {
          console.log(`[${label}] #${m.matchId} 抓取后仍不完整`);
        }
      } catch (err) {
        console.error(`\n[${label}] #${m.matchId} ERROR: ${err instanceof Error ? err.message : String(err)}`);
        page = await recoverPage(pool, page);
      }

      await new Promise((r) => setTimeout(r, 200 + Math.random() * 800));
    }
  }
  return page;
}
