import { readFileSync, existsSync, readdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { sofascoreConfig } from "../src/config/index.js"

const SCHEDULES_DIR = join(dirname(dirname(fileURLToPath(import.meta.url))), "data", "schedules")

type RoundEntry = { round: number; slug?: string }

function getValidRounds(league: typeof sofascoreConfig.source.leagues[0], seasonKey: string): number[] {
  let list: RoundEntry[] = []
  if (seasonKey && league.seasonRounds?.[seasonKey]) {
    list = league.seasonRounds[seasonKey]
  } else if (league.rounds && league.rounds.length > 0) {
    list = league.rounds
  }
  return list.map(r => r.round)
}

function main() {
  const leagues = sofascoreConfig.source.leagues

  for (const league of leagues) {
    const dirPath = join(SCHEDULES_DIR, league.shortName)
    if (!existsSync(dirPath)) continue

    const files = readdirSync(dirPath).filter(f => f.endsWith(".json"))
    for (const file of files) {
      const seasonKey = file.replace("_", "/").replace(".json", "")
      const filePath = join(dirPath, file)
      let raw = readFileSync(filePath, "utf-8")
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1)
      const data = JSON.parse(raw)
      const matches: any[] = data.matches ?? []

      if (matches.length === 0) continue

      const validRounds = getValidRounds(league, seasonKey)
      const validSet = new Set(validRounds)

      const bad = matches.filter(m => m.round != null && !validSet.has(m.round))
      if (bad.length > 0) {
        const roundCounts: Record<number, number> = {}
        for (const m of bad) {
          roundCounts[m.round] = (roundCounts[m.round] || 0) + 1
        }
        const summary = Object.entries(roundCounts)
          .map(([r, c]) => `round=${r}:${c}场`)
          .join(" ")
        console.log(`[MISMATCH] ${league.shortName} ${seasonKey}: ${bad.length}/${matches.length} matches | valid=[${validRounds.join(",")}] | bad=${summary}`)
      }
    }
  }
  console.log("=== Done ===")
}

main()
