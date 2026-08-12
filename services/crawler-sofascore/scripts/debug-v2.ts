import { readFileSync } from "fs"
import { curlJson } from "../src/utils/curl.js"
import config from "../src/config/sofascore.js"
import type { RoundInfo, SeasonSchedule } from "../src/types/index.js"

const BASE = config.source.apiBaseUrl

async function debug() {
  const filePath = "D:/data/vscode_file/crawler/data/schedules/德乙/16_17.json"
  const league = config.source.leagues.find(l => l.slug === "2-bundesliga")
  if (!league) { console.log("league not found"); return }
  const sr = league.seasonRounds?.["16/17"]
  if (!sr) { console.log("seasonRounds not found"); return }

  const raw = readFileSync(filePath, "utf-8")
  const schedule: SeasonSchedule = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)

  // Fetch API rounds
  const sid = league.seasonIds["16/17"]
  console.log("league id:", league.id, "season id:", sid)
  const data = await curlJson(`${BASE}/unique-tournament/${league.id}/season/${sid}/rounds`)
  const apiRounds: any[] = data.rounds ?? []
  console.log("API rounds count:", apiRounds.length)

  // For each match, show stored vs API vs config
  let matchesWithDiff = 0
  for (const m of schedule.matches.slice(0, 10)) {
    if (m.round == null) continue

    // Find API round
    const api = apiRounds.find((r: any) => r.round === m.round && (r.slug || null) === m.roundSlug)
    // Find config entry by (slug, prefix) matching the API round
    let cfgEntry: any = null
    if (api) {
      cfgEntry = sr.find((r: any) => (r.slug || null) === (api.slug || null) && (r.prefix || null) === (api.prefix || null))
    }

    const storedKey = `round=${m.round} slug=${m.roundSlug}`
    const apiKey = api ? `round=${api.round} slug=${api.slug || "-"}` : "not found"
    const cfgKey = cfgEntry ? `round=${cfgEntry.round} slug=${cfgEntry.slug || "-"} prefix=${cfgEntry.prefix || "-"}` : "not found"

    const hasDiff = cfgEntry && (m.round !== cfgEntry.round || m.roundSlug !== (cfgEntry.slug ?? null))
    if (hasDiff) matchesWithDiff++

    console.log(`${storedKey} | api: ${apiKey} | cfg: ${cfgKey} ${hasDiff ? "*** DIFF ***" : ""}`)
  }
  console.log("\nMatches with diff in first 10:", matchesWithDiff)
}

debug().catch(console.error)
