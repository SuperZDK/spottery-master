import { chromium, type Browser, type Page } from "playwright"

// ============================================================
// sofascore API 反爬绕过：直接用 fetch 会 403，
// 与 crawler-sofascore/src/utils/curl.ts 同款方案——
// 用无头浏览器发起真实浏览器指纹请求（credentials: include）。
// 供 build-team-map.ts / fill-jc-name.ts 复用。
// ============================================================

let _browser: Browser | null = null
let _page: Page | null = null

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
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
  _page = await _browser.newPage({
    viewport: pick(VIEWPORTS),
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

export async function curlText(url: string): Promise<string> {
  const page = await getPage()
  const text = await page.evaluate(async (u) => {
    const res = await fetch(u, {
      credentials: "include",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Referer: "https://www.sofascore.com/",
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  }, url)
  return text
}

export async function curlJson(url: string): Promise<any> {
  return JSON.parse(await curlText(url))
}

// sofascore 团队详情：按 id 精确取元数据（无搜索猜测）
// 返回 { name, nameCode, slug, national, gender }，取不到抛错
export async function sofaTeamById(id: number): Promise<{ name: string; nameCode: string; slug: string; national: boolean; gender: string }> {
  const d: any = await curlJson(`https://api.sofascore.com/api/v1/team/${id}`)
  const t = d?.team ?? d
  if (!t?.id) throw new Error(`team ${id} not found`)
  return {
    name: t.name ?? "",
    nameCode: t.nameCode ?? "",
    slug: t.slug ?? "",
    national: !!t.national,
    gender: t.gender ?? "",
  }
}

export async function shutdownBrowser(): Promise<void> {
  if (_page) await _page.close()
  if (_browser) await _browser.close()
  _page = null
  _browser = null
}
