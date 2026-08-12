import { readFileSync, existsSync, readdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { sofascoreConfig } from "../src/config/index.js"

const SCHEDULES_DIR = join(dirname(dirname(fileURLToPath(import.meta.url))), "data", "schedules")

function getConfigRounds(league: typeof sofascoreConfig.source.leagues[0], seasonKey: string): number[] {
  if (league.seasonRounds?.[seasonKey]) {
    return league.seasonRounds[seasonKey].map(r => r.round)
  }
  return league.rounds?.map(r => r.round) ?? []
}

function main() {
  for (const league of sofascoreConfig.source.leagues) {
    const dirPath = join(SCHEDULES_DIR, league.shortName)
    if (!existsSync(dirPath)) continue

    const files = readdirSync(dirPath).filter(f => f.endsWith(".json"))
    console.log(`\n===== ${league.shortName} (${league.slug}) [${league.type}] =====`)

    for (const file of files) {
      const seasonKey = file.replace("_", "/").replace(".json", "")
      const filePath = join(dirPath, file)
      let raw = readFileSync(filePath, "utf-8")
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1)
      const data = JSON.parse(raw)
      const matches: any[] = data.matches ?? []

      const configRounds = getConfigRounds(league, seasonKey)
      const scheduleRounds = [...new Set(matches.map(m => m.round))].sort((a, b) => a - b)
      const missing = scheduleRounds.filter(r => r !== null && !configRounds.includes(r))

      console.log(`  ${seasonKey}: config=[${configRounds.join(",")}]`)
      console.log(`    schedule rounds=[${scheduleRounds.join(",")}]`)
      if (missing.length > 0) {
        console.log(`    ❌ 不在config中的round: ${missing.join(",")}`)
      } else {
        console.log(`    ✅ 全部匹配`)
      }
    }
  }
  console.log("\n=== Done ===")
}
main()
