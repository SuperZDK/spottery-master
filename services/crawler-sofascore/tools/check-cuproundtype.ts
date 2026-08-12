import { curlJson } from "../src/utils/curl.js"
import { sofascoreConfig } from "../src/config/index.js"

const BASE = "https://api.sofascore.com/api/v1"

interface RoundEntry {
  round: number
  name?: string
  slug?: string
  cupRoundType?: number
}

async function main() {
  for (const league of sofascoreConfig.source.leagues) {
    const { id, name, shortName, seasonIds } = league
    console.log(`\n===== ${shortName} (${name}) =====`)

    for (const [seasonKey, seasonId] of Object.entries(seasonIds)) {
      try {
        const data = await curlJson(`${BASE}/unique-tournament/${id}/season/${seasonId}/rounds`)
        const rounds: RoundEntry[] = data.rounds ?? []
        
        const hasCupRoundType = rounds.some(r => r.cupRoundType != null)
        if (!hasCupRoundType) {
          console.log(`  ${seasonKey}: 全部无 cupRoundType`)
          continue
        }

        const lines: string[] = []
        for (const r of rounds) {
          if (r.cupRoundType != null && r.cupRoundType !== r.round) {
            lines.push(`    round=${r.round} slug=${r.slug ?? "-"} name="${r.name ?? ""}" → cupRoundType=${r.cupRoundType} **分歧**`)
          } else if (r.cupRoundType != null) {
            lines.push(`    round=${r.round} slug=${r.slug ?? "-"} → cupRoundType=${r.cupRoundType} (一致)`)
          }
        }
        console.log(`  ${seasonKey}: ${rounds.length} rounds, ${lines.length} 有 cupRoundType`)
        for (const l of lines) {
          console.log(l)
        }
      } catch {
        console.log(`  ${seasonKey}: FAILED`)
      }
    }
  }
  console.log("\n=== Done ===")
}

main().catch(e => console.error("FATAL:", e))
