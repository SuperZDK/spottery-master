import * as fs from "fs";
import * as path from "path";

export interface ScrapedData {
  source: string;
  timestamp: string;
  data: unknown;
}

export abstract class BaseScraper {
  abstract readonly name: string;
  abstract readonly schedule: string;

  abstract scrape(): Promise<ScrapedData | ScrapedData[]>;

  async execute(): Promise<void> {
    const start = Date.now();
    console.log(`[${this.name}] Starting scrape at ${new Date().toISOString()}`);

    try {
      const result = await this.scrape();
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      const items = Array.isArray(result) ? result : [result];
      console.log(`[${this.name}] Scrape completed in ${elapsed}s, got ${items.length} items`);

      const outputDir = path.resolve("data", this.name);
      fs.mkdirSync(outputDir, { recursive: true });

      const now = new Date();
      const filename = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}.json`;
      const filePath = path.join(outputDir, filename);

      fs.writeFileSync(filePath, JSON.stringify({ meta: { source: this.name, scrapedAt: new Date().toISOString(), count: items.length }, data: items.map((i) => i.data) }, null, 2), "utf-8");
      console.log(`[${this.name}] Saved ${items.length} items to ${filePath}`);

      // Remove files older than 7 days
      this.cleanOldFiles(outputDir, 7);
    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      console.error(`[${this.name}] Scrape failed after ${elapsed}s:`, err instanceof Error ? err.message : String(err));
    }
  }

  private cleanOldFiles(dir: string, maxDays: number): void {
    try {
      const files = fs.readdirSync(dir);
      const now = Date.now();
      for (const f of files) {
        const fp = path.join(dir, f);
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > maxDays * 86400000) {
          fs.unlinkSync(fp);
        }
      }
    } catch {
      // ignore cleanup errors
    }
  }
}
