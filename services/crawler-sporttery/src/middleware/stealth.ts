import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Browser } from "puppeteer";

puppeteer.use(StealthPlugin());

export async function createStealthBrowser(headless: boolean = true): Promise<Browser> {
  const browser = await puppeteer.launch({
    headless: headless ? true : false,
    protocolTimeout: 300000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  return browser;
}
