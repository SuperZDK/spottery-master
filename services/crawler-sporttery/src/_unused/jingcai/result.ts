import { BaseScraper, ScrapedData } from "../../engine/base-scraper.js";
import { BrowserPool } from "../../engine/browser-pool.js";
import { updateResults } from "../../db/writer.js";

interface MatchResult {
  matchId: number;
  matchNum: string;
  matchNumStr: string;
  matchDate: string;
  homeTeam: string;
  allHomeTeam: string;
  awayTeam: string;
  allAwayTeam: string;
  leagueName: string;
  leagueNameAbbr: string;
  leagueId: number;
  sectionsNo1: string;
  sectionsNo999: string;
  winFlag: string;
  matchResultStatus: string;
  poolStatus: string;
  h: string;
  d: string;
  a: string;
  goalLine: string;
}

interface ResultResponse {
  success: boolean;
  value: {
    matchResult: MatchResult[];
    total: number;
    pages: number;
    pageNo: number;
    pageSize: number;
    lastUpdateTime: string;
    resultCount: number;
  };
}

interface ResultEntry {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;
  matchNumStr: string;
  halfScore: string;
  fullScore: string;
  winFlag: string;
  spHome: number;
  spDraw: number;
  spAway: number;
  handicap: string;
  poolStatus: string;
}

export class JingcaiResultScraper extends BaseScraper {
  readonly name = "jingcai-result";
  readonly schedule = "0 * * * *";

  private pool: BrowserPool;
  private baseUrl = "https://www.sporttery.cn";
  private apiUrl = "https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry";

  constructor(pool: BrowserPool) {
    super();
    this.pool = pool;
  }

  async scrape(): Promise<ScrapedData[]> {
    console.log(`[${this.name}] Fetching 竞彩 match results...`);

    const page = await this.pool.getPage();

    try {
      await page.goto(`${this.baseUrl}/jc/zqsgkj/`, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      await new Promise((r) => setTimeout(r, 3000));

      const today = new Date();
      const threeDaysAgo = new Date(today);
      threeDaysAgo.setDate(today.getDate() - 3);

      const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      const rawJson = await page.evaluate(
        async (apiUrl: string, beginDate: string, endDate: string) => {
          const url = `${apiUrl}?matchBeginDate=${beginDate}&matchEndDate=${endDate}&leagueId=&pageSize=50&pageNo=`;
          const res = await fetch(url);
          return await res.text();
        },
        this.apiUrl,
        fmt(threeDaysAgo),
        fmt(today),
      );

      const parsed: ResultResponse = JSON.parse(rawJson);

      if (!parsed.success || !parsed.value?.matchResult) {
        console.log(`[${this.name}] No results available`);
        return [];
      }

      const results: ScrapedData[] = [];
      const resultRows = [];

      for (const match of parsed.value.matchResult) {
        if (!match.matchId) continue;

        const entry: ResultEntry = {
          matchId: String(match.matchId),
          homeTeam: match.allHomeTeam || match.homeTeam,
          awayTeam: match.allAwayTeam || match.awayTeam,
          league: match.leagueName || match.leagueNameAbbr || "",
          matchDate: match.matchDate || "",
          matchNumStr: match.matchNumStr || "",
          halfScore: match.sectionsNo1 || "",
          fullScore: match.sectionsNo999 || "",
          winFlag: match.winFlag || "",
          spHome: parseFloat(match.h ?? "0"),
          spDraw: parseFloat(match.d ?? "0"),
          spAway: parseFloat(match.a ?? "0"),
          handicap: match.goalLine || "",
          poolStatus: match.poolStatus || "",
        };

        results.push({
          source: this.name,
          timestamp: new Date().toISOString(),
          data: entry,
        });

        const [homeScore, awayScore] = (match.sectionsNo999 || "").split(":").map((v) => {
          const n = parseInt(v, 10);
          return Number.isFinite(n) ? n : null;
        });

        resultRows.push({
          matchId: match.matchId,
          homeScore,
          awayScore,
          poolStatus: match.poolStatus || null,
          matchNumStr: match.matchNumStr || null,
          matchDate: match.matchDate || null,
        });
      }

      try {
        await updateResults(resultRows);
      } catch (err) {
        console.error(`[${this.name}] 写库失败(不影响爬取): ${err instanceof Error ? err.message : String(err)}`);
      }

      console.log(`[${this.name}] Fetched ${results.length} result entries`);
      return results;
    } finally {
      this.pool.releasePage(page);
    }
  }
}
