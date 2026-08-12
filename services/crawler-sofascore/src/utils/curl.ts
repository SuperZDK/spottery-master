import { chromium, type Browser, type Page } from "playwright"
import { writeFileSync } from "fs"

let _browser: Browser | null = null
let _page: Page | null = null

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1366, height: 768 },
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

async function getPage(): Promise<Page> {
  if (_page) return _page
  _browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  })
  const viewport = pick(VIEWPORTS)
  _page = await _browser.newPage({
    viewport,
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${Math.floor(120 + Math.random() * 15)}.0.0.0 Safari/537.36`,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "light",
  })
  await _page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined })
  })
  await _page.goto("about:blank")
  return _page
}

export async function curlJson(url: string): Promise<any> {
  const page = await getPage()
  const result = await page.evaluate(async (u) => {
    const res = await fetch(u, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Referer: "https://www.sofascore.com/",
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }, url)
  return result
}

export async function curlDownload(url: string, filePath: string): Promise<number> {
  const page = await getPage()
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 })
  const status = resp?.status() ?? 0
  if (status === 200) {
    const buf = await resp?.body()
    if (buf) writeFileSync(filePath, buf)
  }
  return status
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms + Math.random() * 300))
}

export async function shutdown(): Promise<void> {
  if (_page) await _page.close()
  if (_browser) await _browser.close()
  _page = null
  _browser = null
}
