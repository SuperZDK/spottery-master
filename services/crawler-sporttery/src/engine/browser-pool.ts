import puppeteer, { Browser, Page } from "puppeteer";
import { createStealthBrowser } from "../middleware/stealth.js";

interface PoolConfig {
  maxPages: number;
  headless: boolean;
}

interface PageEntry {
  page: Page;
  browser: Browser;
  inUse: boolean;
}

export class BrowserPool {
  private browsers: Browser[] = [];
  private pages: PageEntry[] = [];
  private config: PoolConfig;

  constructor(config?: Partial<PoolConfig>) {
    this.config = {
      maxPages: config?.maxPages ?? 5,
      headless: config?.headless ?? true,
    };
  }

  async getPage(): Promise<Page> {
    const free = this.pages.find((p) => !p.inUse);
    if (free) {
      free.inUse = true;
      return free.page;
    }

    if (this.pages.length >= this.config.maxPages) {
      throw new Error("Browser pool exhausted: all pages are in use");
    }

    const browser = await createStealthBrowser(this.config.headless);
    this.browsers.push(browser);

    const page = await browser.newPage();
    await page.setViewport({
      width: 1280 + Math.floor(Math.random() * 200),
      height: 720 + Math.floor(Math.random() * 200),
    });

    const userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    ];
    await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);

    const entry: PageEntry = { page, browser, inUse: true };
    this.pages.push(entry);
    return page;
  }

  releasePage(page: Page): void {
    const entry = this.pages.find((p) => p.page === page);
    if (entry) {
      entry.inUse = false;
    }
  }

  async resetPage(page: Page): Promise<Page> {
    const idx = this.pages.findIndex((p) => p.page === page);
    if (idx === -1) return this.getPage();
    const entry = this.pages[idx];
    try { await entry.page.close(); } catch { }
    try { await entry.browser.close(); } catch { }
    this.pages.splice(idx, 1);
    const bi = this.browsers.indexOf(entry.browser);
    if (bi !== -1) this.browsers.splice(bi, 1);
    return this.getPage();
  }

  async closeAll(): Promise<void> {
    for (const entry of this.pages) {
      try {
        await entry.page.close();
      } catch { }
    }
    this.pages = [];

    for (const browser of this.browsers) {
      try {
        await browser.close();
      } catch { }
    }
    this.browsers = [];
  }
}
