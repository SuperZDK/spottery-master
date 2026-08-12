import { writeFileSync, mkdirSync, existsSync, statSync } from "fs"
import { join, dirname } from "path"
import { execFile } from "child_process"
import { promisify } from "util"
import { sofascoreConfig } from "../config/index.js"
import type { LeagueConfig } from "../types/index.js"

const execFileAsync = promisify(execFile)

const BASE_URL = sofascoreConfig.source.apiBaseUrl
const OUTPUT_DIR = join(import.meta.dirname, "..", "..", "images")
const DELAY_MS = 1000
const MAX_RETRIES = 3

const CURL_PATH = "curl.exe"
const BASE_HEADERS = [
  "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "-H", "Referer: https://www.sofascore.com/",
  "-H", "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
]

async function curlJson(url: string): Promise<any> {
  const args = [
    "-s",
    ...BASE_HEADERS,
    "-H", "Accept: application/json",
    url,
  ]
  const { stdout } = await execFileAsync(CURL_PATH, args, {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  })
  return JSON.parse(stdout)
}

async function curlDownload(url: string, filePath: string): Promise<boolean> {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const args = [
    "-s",
    "-o", filePath,
    "-w", "%{http_code}",
    ...BASE_HEADERS,
    "-H", "Accept: image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    url,
  ]
  const { stdout } = await execFileAsync(CURL_PATH, args)
  const status = parseInt(stdout.trim(), 10)
  if (status === 200) return true
  if (status === 404) return false
  console.warn(`    curl status ${status} for ${url}`)
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function downloadImage(
  url: string,
  filePath: string,
  label: string,
): Promise<"skip" | "ok" | "empty"> {
  if (existsSync(filePath)) {
    return "skip"
  }

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const ok = await curlDownload(url, filePath)
      if (ok) {
        return "ok"
      }
      return "empty"
    } catch (err) {
      console.warn(`  [${i + 1}/${MAX_RETRIES}] ${label}: ${err}`)
      if (i < MAX_RETRIES - 1) await sleep(DELAY_MS)
    }
  }
  return "empty"
}

function buildCountryTasks(leagues: LeagueConfig[]): { url: string; filePath: string; label: string }[] {
  const seen = new Set<number>()
  const tasks: { url: string; filePath: string; label: string }[] = []
  for (const l of leagues) {
    if (seen.has(l.countryId)) continue
    seen.add(l.countryId)
    tasks.push({
      url: `${BASE_URL}/category/${l.countryId}/image`,
      filePath: join(OUTPUT_DIR, "countries", `${l.country}.png`),
      label: `country/${l.country}`,
    })
  }
  return tasks
}

function buildLeagueTasks(leagues: LeagueConfig[]): { url: string; filePath: string; label: string }[] {
  const seen = new Set<number>()
  const tasks: { url: string; filePath: string; label: string }[] = []
  for (const l of leagues) {
    if (seen.has(l.id)) continue
    seen.add(l.id)
    tasks.push({
      url: `${BASE_URL}/unique-tournament/${l.id}/image`,
      filePath: join(OUTPUT_DIR, "leagues", `${l.id}_${l.slug}.png`),
      label: `league/${l.shortName}`,
    })
  }
  return tasks
}

async function buildTeamTasks(
  leagues: LeagueConfig[],
): Promise<{ url: string; filePath: string; label: string }[]> {
  const seenTeams = new Set<number>()
  const tasks: { url: string; filePath: string; label: string }[] = []

  // Only fetch standings for leagues, not knockout cups
  const leagueOnly = leagues.filter((l) => l.type !== "cup")

  for (const league of leagueOnly) {
    const seasonKeys = Object.keys(league.seasonIds)
    for (const seasonKey of seasonKeys) {
      const seasonId = league.seasonIds[seasonKey]
      const url = `${BASE_URL}/unique-tournament/${league.id}/season/${seasonId}/standings/total`
      process.stdout.write(`[Standings] ${league.shortName} ${seasonKey}... `)

      try {
        const data = await curlJson(url)
        const rows = data.standings?.[0]?.rows ?? []
        let newTeams = 0
        for (const row of rows) {
          const team = row.team
          if (!team || seenTeams.has(team.id)) continue
          seenTeams.add(team.id)
          newTeams++
          tasks.push({
            url: `${BASE_URL}/team/${team.id}/image`,
            filePath: join(OUTPUT_DIR, "teams", `${team.id}_${team.slug}.png`),
            label: `team/${team.shortName}`,
          })
        }
        console.log(`${rows.length} teams (${newTeams} new)`)
      } catch (err) {
        console.log(`FAIL (${err})`)
      }

      await sleep(DELAY_MS)
    }
  }

  return tasks
}

async function downloadAll(
  tasks: { url: string; filePath: string; label: string }[],
  concurrency = 2,
): Promise<void> {
  let index = 0
  let success = 0
  let fail = 0
  let skip = 0

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const task = tasks[index++]
      const result = await downloadImage(task.url, task.filePath, task.label)
      const label = `[${index}/${tasks.length}] ${task.label}`
      if (result === "skip") {
        console.log(`  SKIP: ${task.label}`)
        skip++
      } else if (result === "ok") {
        const size = existsSync(task.filePath) ? statSync(task.filePath).size : 0
        console.log(`  OK: ${task.label} (${(size / 1024).toFixed(1)}KB)`)
        success++
      } else {
        console.log(`  EMPTY: ${task.label}`)
        fail++
      }
      // Rate-limit delay: skip delay for skips, apply for downloads
      if (result !== "skip") await sleep(DELAY_MS)
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)
  console.log(`\n>> ${success} success, ${fail} failed, ${skip} skipped, ${tasks.length} total`)
}

async function main() {
  console.log("=== Sofascore Image Downloader ===\n")
  console.log(`Output: ${OUTPUT_DIR}\n`)

  console.log("[1/3] Downloading country flags...")
  const countryTasks = buildCountryTasks(sofascoreConfig.source.leagues)
  await downloadAll(countryTasks, 2)
  console.log()

  console.log("[2/3] Downloading league icons...")
  const leagueTasks = buildLeagueTasks(sofascoreConfig.source.leagues)
  await downloadAll(leagueTasks, 2)
  console.log()

  console.log("[3/3] Fetching standings & downloading team logos...")
  const teamTasks = await buildTeamTasks(sofascoreConfig.source.leagues)
  if (teamTasks.length === 0) {
    console.log("  No new teams found")
  } else {
    console.log(`  Found ${teamTasks.length} unique teams, downloading...`)
    await downloadAll(teamTasks, 2)
  }
  console.log()

  console.log("=== All done ===")
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
