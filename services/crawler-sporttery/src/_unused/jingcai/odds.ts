import { BaseScraper, ScrapedData } from "../../engine/base-scraper.js";
import { BrowserPool } from "../../engine/browser-pool.js";
import { appendOddsSnapshots } from "../../db/writer.js";

interface MatchPool {
  h?: string; d?: string; a?: string;
  goalLine?: string; goalLineValue?: string;
  [key: string]: unknown;
}

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
  had: MatchPool;
  hhad: MatchPool;
  ttg: MatchPool;
  crs: MatchPool;
  hafu: MatchPool;
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

interface OddsEntry {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;
  matchTime: string;
  matchNumStr: string;
  matchStatus: string;
  spHome: number;
  spDraw: number;
  spAway: number;
  handicap: string;
  spLetHome: number;
  spLetDraw: number;
  spLetAway: number;
  ttg: Record<string, number>;
}

export class JingcaiOddsScraper extends BaseScraper {
  readonly name = "jingcai-odds";
  readonly schedule = "*/15 * * * *";

  private pool: BrowserPool;
  private baseUrl = "https://www.sporttery.cn";
  private apiUrl = "https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry";

  constructor(pool: BrowserPool) {
    super();
    this.pool = pool;
  }

  async scrape(): Promise<ScrapedData[]> {
    console.log(`[${this.name}] Launching browser to fetch 竞彩 odds...`);

    const page = await this.pool.getPage();

    try {
      await page.goto(this.baseUrl, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      await new Promise((r) => setTimeout(r, 2000));

      const poolCodes = ["had", "hhad", "ttg"];

      const rawJson = await page.evaluate(
        async (apiUrl: string, codes: string[]) => {
          const url = `${apiUrl}?channel=c&poolCode=${codes.join(",")}`;
          const res = await fetch(url);
          return await res.text();
        },
        this.apiUrl,
        poolCodes,
      );

      const parsed: CalculatorResponse = JSON.parse(rawJson);

      if (!parsed.success || !parsed.value?.matchInfoList) {
        throw new Error(`API returned error: ${rawJson.substring(0, 200)}`);
      }

      const results: ScrapedData[] = [];
      const snapshotRows = [];

      for (const day of parsed.value.matchInfoList) {
        for (const match of day.subMatchList || []) {
          if (!match.matchId || !match.had) continue;

          const entry = this.buildEntry(match);
          if (entry) {
            results.push({
              source: this.name,
              timestamp: new Date().toISOString(),
              data: entry,
            });
          }

          snapshotRows.push({
            matchId: match.matchId,
            had: match.had,
            hhad: match.hhad,
            ttg: match.ttg,
          });
        }
      }

      try {
        await appendOddsSnapshots(snapshotRows);
      } catch (err) {
        console.error(`[${this.name}] 写库失败(不影响爬取): ${err instanceof Error ? err.message : String(err)}`);
      }

      console.log(`[${this.name}] Fetched ${results.length} odds entries`);
      return results;
    } finally {
      this.pool.releasePage(page);
    }
  }

  private buildEntry(match: MatchItem): OddsEntry | null {
    const spHome = parseFloat(match.had?.h ?? "0");
    const spDraw = parseFloat(match.had?.d ?? "0");
    const spAway = parseFloat(match.had?.a ?? "0");
    if (!spHome && !spDraw && !spAway) return null;

    const ttg: Record<string, number> = {};
    if (match.ttg) {
      for (const [key, val] of Object.entries(match.ttg)) {
        if (key.startsWith("s") && /^s\d+$/.test(key)) {
          const num = parseFloat(String(val));
          if (!isNaN(num)) ttg[key] = num;
        }
      }
    }

    return {
      matchId: String(match.matchId),
      homeTeam: match.homeTeamAllName || match.homeTeamAbbName,
      awayTeam: match.awayTeamAllName || match.awayTeamAbbName,
      league: match.leagueAllName || match.leagueAbbName || "",
      matchDate: match.matchDate || "",
      matchTime: match.matchTime || "",
      matchNumStr: match.matchNumStr || "",
      matchStatus: match.matchStatus || "",
      spHome,
      spDraw,
      spAway,
      handicap: match.hhad?.goalLine ?? "",
      spLetHome: parseFloat(match.hhad?.h ?? "0"),
      spLetDraw: parseFloat(match.hhad?.d ?? "0"),
      spLetAway: parseFloat(match.hhad?.a ?? "0"),
      ttg,
    };
  }
}
