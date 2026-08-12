export type ProxyStatus = "alive" | "dead" | "unknown";

export interface ProxyEntry {
  url: string;
  status: ProxyStatus;
  lastUsed: number | null;
  failCount: number;
}

export class ProxyPool {
  private proxies: ProxyEntry[] = [];
  private currentIndex = 0;

  constructor(proxyUrls?: string[]) {
    if (proxyUrls) {
      this.proxies = proxyUrls.map((url) => ({
        url,
        status: "unknown" as ProxyStatus,
        lastUsed: null,
        failCount: 0,
      }));
    }
  }

  getProxy(): string | null {
    const alive = this.proxies.filter((p) => p.status !== "dead");
    if (alive.length === 0) return null;

    const entry = alive[this.currentIndex % alive.length];
    this.currentIndex = (this.currentIndex + 1) % alive.length;
    entry.lastUsed = Date.now();
    return entry.url;
  }

  markDead(proxyUrl: string): void {
    const entry = this.proxies.find((p) => p.url === proxyUrl);
    if (entry) {
      entry.status = "dead";
      entry.failCount += 1;
      console.warn(`[ProxyPool] Marked proxy as dead: ${proxyUrl}`);
    }
  }

  markAlive(proxyUrl: string): void {
    const entry = this.proxies.find((p) => p.url === proxyUrl);
    if (entry) {
      entry.status = "alive";
      entry.failCount = 0;
    }
  }

  addProxy(url: string): void {
    this.proxies.push({ url, status: "unknown", lastUsed: null, failCount: 0 });
  }

  get aliveCount(): number {
    return this.proxies.filter((p) => p.status !== "dead").length;
  }

  get totalCount(): number {
    return this.proxies.length;
  }
}
