import { curlJson } from "../src/utils/curl.js"
import { sofascoreConfig } from "../src/config/index.js"

const BASE = "https://api.sofascore.com/api/v1"

interface CupRoundMap {
  league: string
  seasonKey: string
  configRound: number
  slug: string
  eventRound: number
  cupRoundType: number | undefined
  hasDivergence: boolean
}

async function main() {
  const results: CupRoundMap[] = []

  for (const league of sofascoreConfig.source.leagues) {
    if (!league.seasonRounds) continue

    for (const [seasonKey, rounds] of Object.entries(league.seasonRounds)) {
      for (const r of rounds) {
        if (!r.slug) {
          // No slug means group stage / regular round, no cupRoundType issue
          continue
        }

        try {
          const url = `${BASE}/unique-tournament/${league.id}/season/${league.seasonIds[seasonKey]}/events/round/${r.round}/slug/${r.slug}`
          const data = await curlJson(url)
          const ev = data.events?.[0]
          if (!ev?.roundInfo) continue

          const ri = ev.roundInfo
          const cupType = ri.cupRoundType
          const hasDiv = cupType != null && cupType !== r.round

          if (hasDiv) {
            results.push({
              league: league.shortName,
              seasonKey,
              configRound: r.round,
              slug: r.slug!,
              eventRound: ri.round,
              cupRoundType: cupType,
              hasDivergence: true,
            })
          }
        } catch {
          // skip failed rounds
        }
      }
    }
  }

  // Group and print
  let lastLeague = ""
  console.log("===== cupRoundType 分歧汇总 =====\n")
  for (const r of results) {
    if (r.league !== lastLeague) {
      console.log(`\n--- ${r.league} ---`)
      lastLeague = r.league
    }
    console.log(`  ${r.seasonKey}: ${r.slug}`)
    console.log(`    config round=${r.configRound} | event round=${r.eventRound} | cupRoundType=${r.cupRoundType}`)
    console.log(`    修复: round=${r.eventRound} → ${r.configRound}`)
  }
  console.log(`\n共 ${results.length} 个轮次有分歧`)
}
main().catch(e => console.error("FATAL:", e))
