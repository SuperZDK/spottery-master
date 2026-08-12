import { BaseScraper, ScrapedData } from "../../engine/base-scraper.js";
import { BrowserPool } from "../../engine/browser-pool.js";

export class SofascoreMatchesScraper extends BaseScraper {
  readonly name = "sofascore-matches";
  readonly schedule = "*/15 * * * *";

  private pool: BrowserPool;

  constructor(pool: BrowserPool) {
    super();
    this.pool = pool;
  }

  async scrape(): Promise<ScrapedData[]> {
    console.log(`[${this.name}] Would scrape SofaScore live match data...`);

    const results: ScrapedData[] = [
      {
        source: this.name,
        timestamp: new Date().toISOString(),
        data: {
          matchId: "sf-demo-001",
          homeTeam: "Barcelona",
          awayTeam: "Real Madrid",
          league: "LaLiga",
          status: "live",
          homeScore: 2,
          awayScore: 1,
          elapsed: 72,
          events: [
            { type: "goal", minute: 23, team: "home", player: "Lewandowski" },
            { type: "goal", minute: 45, team: "away", player: "Vinicius" },
            { type: "goal", minute: 67, team: "home", player: "Pedri" },
          ],
        },
      },
    ];

    console.log(`[${this.name}] Demo match data:`, JSON.stringify(results, null, 2));
    return results;
  }
}
