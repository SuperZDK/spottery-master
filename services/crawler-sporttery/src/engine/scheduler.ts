import cron from "node-cron";
import { BaseScraper } from "./base-scraper.js";

interface ScheduledTask {
  scraper: BaseScraper;
  task: cron.ScheduledTask;
}

export class Scheduler {
  private tasks: ScheduledTask[] = [];

  registerScraper(scraper: BaseScraper): void {
    if (this.tasks.some((t) => t.scraper.name === scraper.name)) {
      console.warn(`[Scheduler] Scraper "${scraper.name}" is already registered`);
      return;
    }

    const task = cron.schedule(scraper.schedule, () => {
      scraper.execute();
    });

    this.tasks.push({ scraper, task });
    console.log(`[Scheduler] Registered "${scraper.name}" with cron "${scraper.schedule}"`);
  }

  startAll(): void {
    if (this.tasks.length === 0) {
      console.warn("[Scheduler] No scrapers registered, nothing to start");
      return;
    }

    for (const { scraper, task } of this.tasks) {
      task.start();
      console.log(`[Scheduler] Started "${scraper.name}"`);
    }

    console.log(`[Scheduler] All ${this.tasks.length} scrapers started`);
  }

  stopAll(): void {
    for (const { scraper, task } of this.tasks) {
      task.stop();
      console.log(`[Scheduler] Stopped "${scraper.name}"`);
    }
  }
}
