import { BaseScraper, ScrapedData } from "../../engine/base-scraper.js";
import { BrowserPool } from "../../engine/browser-pool.js";

export class SofascoreOddsScraper extends BaseScraper {
  readonly name = "sofascore-odds";
  readonly schedule = "*/10 * * * *";

  private pool: BrowserPool;

  constructor(pool: BrowserPool) {
    super();
    this.pool = pool;
  }

  async scrape(): Promise<ScrapedData[]> {
    console.log(`[${this.name}] Would scrape SofaScore odds history...`);

    const results: ScrapedData[] = [
      {
        source: this.name,
        timestamp: new Date().toISOString(),
        data: {
          matchId: "sf-demo-001",
          bookmakers: [
            {
              name: "bet365",
              oddsHistory: [
                { time: "2026-07-20T10:00:00Z", home: 2.10, draw: 3.40, away: 3.50 },
                { time: "2026-07-20T12:00:00Z", home: 2.05, draw: 3.40, away: 3.60 },
                { time: "2026-07-20T14:00:00Z", home: 1.95, draw: 3.50, away: 3.80 },
              ],
            },
          ],
        },
      },
    ];

    console.log(`[${this.name}] Demo odds data:`, JSON.stringify(results, null, 2));
    return results;
  }
}
