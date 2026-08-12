import { BaseScraper, ScrapedData } from "../../engine/base-scraper.js";
import { BrowserPool } from "../../engine/browser-pool.js";
import { upsertLiveSchedule } from "../../db/writer.js";

interface MatchItem {
  matchId: number;
  businessDate: string;
  matchDate: string;
  matchTime: string;
  matchWeek: string;
  matchNumStr: string;
  matchStatus: string;
  homeTeamAllName: string;
  homeTeamAbbName: string;
  awayTeamAllName: string;
  awayTeamAbbName: string;
  leagueAllName: string;
  leagueAbbName: string;
  leagueId: number;
  sellStatus: number;
}

interface MatchDay {
  businessDate: string;
  subMatchList: MatchItem[];
}

interface CalculatorResponse {
  success: boolean;
  value: {
    matchInfoList: MatchDay[];
  };
}

interface ScheduleEntry {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;
  matchTime: string;
  matchNumStr: string;
  matchStatus: string;
}

export class JingcaiScheduleScraper extends BaseScraper {
  readonly name = "jingcai-schedule";
  readonly schedule = "*/30 * * * *";

  private pool: BrowserPool;
  private baseUrl = "https://www.sporttery.cn";
  private apiUrl = "https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry";

  constructor(pool: BrowserPool) {
    super();
    this.pool = pool;
  }

  async scrape(): Promise<ScrapedData[]> {
    console.log(`[${this.name}] Fetching 竞彩 match schedule...`);

    const page = await this.pool.getPage();

    try {
      await page.goto(this.baseUrl, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      await new Promise((r) => setTimeout(r, 2000));

      const rawJson = await page.evaluate(async (apiUrl: string) => {
        const url = `${apiUrl}?channel=c&poolCode=had`;
        const res = await fetch(url);
        return await res.text();
      }, this.apiUrl);

      const parsed: CalculatorResponse = JSON.parse(rawJson);

      if (!parsed.success || !parsed.value?.matchInfoList) {
        throw new Error(`API returned error: ${rawJson.substring(0, 200)}`);
      }

      const results: ScrapedData[] = [];
      const liveRows = [];

      for (const day of parsed.value.matchInfoList) {
        for (const match of day.subMatchList || []) {
          if (!match.matchId) continue;

          const entry: ScheduleEntry = {
            matchId: String(match.matchId),
            homeTeam: match.homeTeamAllName || match.homeTeamAbbName,
            awayTeam: match.awayTeamAllName || match.awayTeamAbbName,
            league: match.leagueAllName || match.leagueAbbName || "",
            matchDate: match.matchDate || "",
            matchTime: match.matchTime || "",
            matchNumStr: match.matchNumStr || "",
            matchStatus: match.matchStatus || "",
          };

          results.push({
            source: this.name,
            timestamp: new Date().toISOString(),
            data: entry,
          });

          liveRows.push({
            matchId: match.matchId,
            businessDate: day.businessDate || "",
            matchDate: match.matchDate || "",
            matchNumStr: match.matchNumStr || "",
            homeTeam: match.homeTeamAllName || match.homeTeamAbbName || "",
            awayTeam: match.awayTeamAllName || match.awayTeamAbbName || "",
            league: match.leagueAllName || match.leagueAbbName || "",
            kickoffTime: match.matchDate && match.matchTime ? `${match.matchDate} ${match.matchTime}` : null,
          });
        }
      }

      try {
        await upsertLiveSchedule(liveRows);
      } catch (err) {
        console.error(`[${this.name}] 写库失败(不影响爬取): ${err instanceof Error ? err.message : String(err)}`);
      }

      console.log(`[${this.name}] Fetched ${results.length} schedule entries`);
      return results;
    } finally {
      this.pool.releasePage(page);
    }
  }
}
