import dotenv from "dotenv";
dotenv.config();

import { BrowserPool } from "./engine/browser-pool.js";
import { JingcaiLiveService } from "./sources/jingcai/live.js";

async function main() {
  const headless = process.env.BROWSER_HEADLESS !== "false";
  const browserPool = new BrowserPool({ headless });
  const live = new JingcaiLiveService(browserPool);

  console.log("[Main] Starting workset-driven live service...");
  live.start().catch((err) => {
    console.error("[Main] Fatal error:", err);
    process.exit(1);
  });

  async function shutdown() {
    console.log("\n[Main] Shutting down gracefully...");
    live.stop();
    await browserPool.closeAll();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[Main] Fatal error:", err);
  process.exit(1);
});
