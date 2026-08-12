import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import dotenv from "dotenv";

dotenv.config();

interface RetryConfig {
  retries: number;
  backoffMs: number;
}

export class ApiClient {
  private client: AxiosInstance;
  private retryConfig: RetryConfig;
  private baseURL: string;

  constructor(baseURL?: string, retryConfig?: Partial<RetryConfig>) {
    this.baseURL = baseURL ?? process.env.BACKEND_API_URL ?? "http://localhost:8000";
    this.retryConfig = {
      retries: retryConfig?.retries ?? 3,
      backoffMs: retryConfig?.backoffMs ?? 1000,
    };

    const apiKey = process.env.SCRAPER_API_KEY ?? "scraper-secret-key";

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
    });
  }

  async pushMatches(matches: unknown[]): Promise<void> {
    await this.withRetry(() => this.client.post("/scraper/matches", { matches }));
    console.log(`[ApiClient] Pushed ${matches.length} matches to ${this.baseURL}/scraper/matches`);
  }

  async pushOdds(odds: unknown[]): Promise<void> {
    await this.withRetry(() => this.client.post("/scraper/odds", { odds }));
    console.log(`[ApiClient] Pushed ${odds.length} odds to ${this.baseURL}/scraper/odds`);
  }

  private async withRetry(fn: () => Promise<unknown>, attempt = 1): Promise<void> {
    try {
      await fn();
    } catch (err) {
      if (attempt <= this.retryConfig.retries) {
        const delay = this.retryConfig.backoffMs * Math.pow(2, attempt - 1);
        console.warn(
          `[ApiClient] Request failed (attempt ${attempt}/${this.retryConfig.retries}), retrying in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.withRetry(fn, attempt + 1);
      }
      throw err;
    }
  }
}
