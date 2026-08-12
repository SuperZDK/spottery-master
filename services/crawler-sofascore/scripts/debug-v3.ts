import { readFileSync } from "fs"
import { curlJson } from "../src/utils/curl.js"
import config from "../src/config/sofascore.js"
import type { RoundInfo } from "../src/types/index.js"

const BASE = config.source.apiBaseUrl

interface ApiRound {
  round: number
  slug?: string
  prefix?: string
}

interface ConfigEntry extends RoundInfo {
  leagueSlug: string
  seasonKey: string
}

function matchConfigBySlugPrefix(api: ApiRound, entries: ConfigEntry[]): ConfigEntry | null {
  for (const e of entries) {
    if (e.round === api.round &&
        (e.slug || null) === (api.slug || null) &&
        (e.prefix || null) === (api.prefix || null)) {
      return e
    }
  }
  return null
}

async function main() {
  // Test: UEL 25/26, match 14572778
  const league = config.source.leagues.find(l => l.slug === "uefa-europa-league")!
  const sid = league.seasonIds["25/26"]
  const cfgEntries: ConfigEntry[] = league.seasonRounds!["25/26"].map(r => ({ ...r, leagueSlug: league.slug, seasonKey: "25/26" }))

  // Fetch API rounds
  const data = await curlJson(`${BASE}/unique-tournament/${league.id}/season/${sid}/rounds`)
  const apiRounds: ApiRound[] = data.rounds ?? []
  
  // For API round=8, find matching config entry
  const apiRound8 = apiRounds.find(r => r.round === 8)
  console.log("API round=8:", JSON.stringify(apiRound8))
  
  const matched = matchConfigBySlugPrefix(apiRound8!, cfgEntries)
  console.log("Config match:", matched ? `round=${matched.round} slug=${matched.slug || "-"}` : "null")
  
  // The match with id=14572778 currently has round=8. What would the script do?
  const mapKey = `8|${apiRound8?.slug || ""}|${apiRound8?.prefix || ""}`
  const cfgMatch = matchConfigBySlugPrefix({ round: 8, slug: apiRound8?.slug, prefix: apiRound8?.prefix }, cfgEntries)
  if (cfgMatch) {
    console.log("\nIf script ran on this match:")
    console.log("  Stored: round=8, roundSlug=null")
    console.log("  Config: round=" + cfgMatch.round + ", slug=" + (cfgMatch.slug ?? null))
    console.log("  Need fix:", (8 !== cfgMatch.round || null !== (cfgMatch.slug ?? null)) ? "YES" : "NO")
  }

  // Now check: are there API rounds whose config match has DIFFERENT round?
  console.log("\nScanning all API rounds for mismatches:")
  for (const ar of apiRounds) {
    const cfg = matchConfigBySlugPrefix(ar, cfgEntries)
    if (cfg && cfg.round !== ar.round) {
      console.log(`  ** MISMATCH ** API round=${ar.round} slug=${ar.slug || "-"} prefix=${ar.prefix || "-"} → Config round=${cfg.round}`)
    }
  }
  console.log("  Done scanning.")
}

main().catch(console.error)
