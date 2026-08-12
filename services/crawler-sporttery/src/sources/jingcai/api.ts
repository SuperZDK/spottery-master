import { Page } from "puppeteer";
import { BrowserPool } from "../../engine/browser-pool.js";

export const API_BASE = "https://webapi.sporttery.cn/gateway/uniform/football";
export const HOME_URL = "https://www.sporttery.cn";

const DETAIL_APIS = [
  "getMatchHeadV1.qry?source=web&sportteryMatchId=%d",
  "getMatchResultV1.qry?sportteryMatchId=%d&termLimits=10&tournamentFlag=0&homeAwayFlag=0",
  "getMatchFeatureV1.qry?termLimits=10&sportteryMatchId=%d",
  "getInjurySuspensionV1.qry?sportteryMatchId=%d",
  "getMatchTablesV2.qry?gmMatchId=%d",
  "getMatchPlayerV1.qry?sportteryMatchId=%d&termLimits=3",
  "getFutureMatchesV1.qry?sportteryMatchId=%d&termLimits=4",
  "getResultHistoryV1.qry?sportteryMatchId=%d&termLimits=10&tournamentFlag=0&homeAwayFlag=0",
];

const DETAIL_FIELD_MAP: Record<string, string> = {
  "getMatchHeadV1.qry": "matchInfo",
  "getMatchResultV1.qry": "recentResults",
  "getMatchFeatureV1.qry": "seasonFeatures",
  "getInjurySuspensionV1.qry": "injuries",
  "getMatchTablesV2.qry": "standings",
  "getMatchPlayerV1.qry": "players",
  "getFutureMatchesV1.qry": "fixtures",
  "getResultHistoryV1.qry": "headToHead",
};

export async function gotoHome(page: Page): Promise<Page> {
  const attempts: Array<[number, number]> = [[1, 5000], [2, 15000], [3, 30000]];
  for (const [n, delay] of attempts) {
    try {
      await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 10000));
      return page;
    } catch (err) {
      console.log(`[Recovery] 第 ${n} 次重连失败 (${Math.round(delay / 1000)}s 退避): ${err instanceof Error ? err.message : String(err)}`);
      if (n < attempts.length) await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("浏览器会话恢复失败（3 次退避重连均失败）");
}

export async function recoverPage(pool: BrowserPool, page: Page): Promise<Page> {
  page = await pool.resetPage(page);
  return gotoHome(page);
}

// getVoteV1（HHAD+HAD）合并 → 比赛元数据数组
export async function fetchVotes(page: Page, dateStr: string): Promise<any[]> {
  const [hhadList, hadList] = await page.evaluate(
    async (apiBase: string, date: string) => {
      try {
        const r1 = await fetch(`${apiBase}/getVoteV1.qry?poolCode=HHAD&pageSize=200&pageNo=1&businessDate=${date}`, { signal: AbortSignal.timeout(20000) });
        const r2 = await fetch(`${apiBase}/getVoteV1.qry?poolCode=HAD&pageSize=200&pageNo=1&businessDate=${date}`, { signal: AbortSignal.timeout(20000) });
        const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
        return [d1?.value?.matches?.list || [], d2?.value?.matches?.list || []];
      } catch { return [[], []]; }
    },
    API_BASE,
    dateStr,
  );

  if (hhadList.length === 0 && hadList.length === 0) return [];

  const hadMap = new Map<number, any>();
  for (const m of hadList) hadMap.set(m.matchId, m);

  return hhadList.map((m: any) => {
    const had = hadMap.get(m.matchId);
    return {
      matchId: m.matchId,
      businessDate: m.businessDate,
      matchDate: m.matchDate,
      matchNum: m.matchNum,
      homeTeam: m.homeTeamAllName,
      homeTeamId: m.homeTeamId,
      awayTeam: m.awayTeamAllName,
      awayTeamId: m.awayTeamId,
      league: m.leagueAllName,
      leagueId: m.leagueId,
      handicap: {
        goalLine: m.goalLine,
        odds: { home: m.h, draw: m.d, away: m.a },
        supportRate: { home: m.hsupportRate, draw: m.dsupportRate, away: m.asupportRate },
        voters: { home: m.win, draw: m.draw, away: m.lose },
        probability: { home: m.hprobability, draw: m.dprobability, away: m.aprobability },
        error: { home: m.herror, draw: m.derror, away: m.aerror },
        psyError: m.psyError,
        result: m.result,
      },
      matchResult: m.matchResult,
      had: had ? {
        odds: { home: had.h, draw: had.d, away: had.a },
        supportRate: { home: had.hsupportRate, draw: had.dsupportRate, away: had.asupportRate },
        voters: { home: had.win, draw: had.draw, away: had.lose },
        probability: { home: had.hprobability, draw: had.dprobability, away: had.aprobability },
        error: { home: had.herror, draw: had.derror, away: had.aerror },
        psyError: had.psyError,
        result: had.result,
      } : null,
      poolStatus: m.poolStatus,
    };
  });
}

// getFixedBonusV1 → 赔率历史 value（含 hadList/hhadList/ttgList/hafuList/crsList/singleList/matchResultList）
export async function fetchFixedBonus(page: Page, matchId: number): Promise<any> {
  const res = await page.evaluate(
    async (apiBase: string, mid: number) => {
      try {
        const r = await fetch(`${apiBase}/getFixedBonusV1.qry?clientCode=3001&matchId=${mid}`, { signal: AbortSignal.timeout(20000) });
        const text = await r.text();
        if (!text) return null;
        const data = JSON.parse(text);
        return data?.success ? data.value : null;
      } catch { return null; }
    },
    API_BASE,
    matchId,
  );
  return res ?? null;
}

// 详情 8 API（matchInfo/recentResults/seasonFeatures/injuries/standings/players/fixtures/headToHead）
// + getFixedBonusV1（首次全量赔率历史）。只抓一次。
export async function fetchDetail(page: Page, matchId: number): Promise<any> {
  const results = await page.evaluate(
    async (apiBase: string, mid: number, apis: string[], fieldMap: Record<string, string>) => {
      const out: Record<string, any> = {};
      try {
        const fixedRes = await fetch(`${apiBase}/getFixedBonusV1.qry?clientCode=3001&matchId=${mid}`, { signal: AbortSignal.timeout(20000) });
        const fixedText = await fixedRes.text();
        if (fixedText) {
          const fixedData = JSON.parse(fixedText);
          if (fixedData.success) out.oddsHistory = fixedData.value;
        }
      } catch {}

      for (const api of apis) {
        try {
          const url = `${apiBase}/${api.replace("%d", String(mid))}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
          const text = await res.text();
          if (!text) continue;
          const data = JSON.parse(text);
          if (data.success) {
            const name = api.split("?")[0];
            out[fieldMap[name] || name] = data.value;
          }
        } catch {}
      }
      return out;
    },
    API_BASE,
    matchId,
    DETAIL_APIS,
    DETAIL_FIELD_MAP,
  );

  return { matchId, scrapedAt: new Date().toISOString(), ...results };
}
