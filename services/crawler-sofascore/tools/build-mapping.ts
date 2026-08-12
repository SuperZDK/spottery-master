import { curlJson } from "../src/utils/curl.js"
import { sofascoreConfig } from "../src/config/index.js"

const BASE = "https://api.sofascore.com/api/v1"

const seen = new Set<string>()

async function main() {
  for (const league of sofascoreConfig.source.leagues) {
    if (!league.seasonRounds) continue

    for (const [seasonKey, rounds] of Object.entries(league.seasonRounds)) {
      const slugged = rounds.filter(r => r.slug)
      if (slugged.length === 0) continue

      for (const r of slugged) {
        const key = `${league.shortName}|${seasonKey}|${r.slug}`
        if (seen.has(key)) continue
        seen.add(key)

        try {
          const data = await curlJson(
            `${BASE}/unique-tournament/${league.id}/season/${league.seasonIds[seasonKey]}/events/round/${r.round}/slug/${r.slug}`
          )
          const ev = data.events?.[0]
          if (!ev?.roundInfo) continue

          const ri = ev.roundInfo
          if (ri.cupRoundType != null && ri.cupRoundType !== r.round) {
            console.log(`${league.shortName}|${seasonKey}|${r.slug}|configRound=${r.round}|eventRound=${ri.round}|cupRoundType=${ri.cupRoundType}`)
          }
        } catch {
          // skip
        }
      }
    }
  }
  console.log("=== DONE ===")
}
main().catch(e => console.error("FATAL:", e))
