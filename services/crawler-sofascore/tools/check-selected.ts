import { curlJson } from "../src/utils/curl.js"

async function check(leagueId: number, seasonId: number, configRound: number, slug: string) {
  try {
    const data = await curlJson(`https://api.sofascore.com/api/v1/unique-tournament/${leagueId}/season/${seasonId}/events/round/${configRound}/slug/${slug}`)
    const ev = data.events?.[0]
    if (!ev?.roundInfo) return
    const ri = ev.roundInfo
    if (ri.cupRoundType != null && ri.cupRoundType !== configRound) {
      console.log(`分歧: league=${leagueId} season=${seasonId} configRound=${configRound} slug=${slug} → eventRound=${ri.round} cupRoundType=${ri.cupRoundType}`)
    }
  } catch {}
}

async function main() {
  // 欧协联 22/23 (id=17015, season=42224) - 有 round=8 分歧
  await check(17015, 42224, 5, "round-of-16")
  await check(17015, 42224, 27, "quarterfinals")
  await check(17015, 42224, 28, "semifinals")
  await check(17015, 42224, 29, "final")

  // 法国杯 22/23 (id=335, season=47014)
  await check(335, 47014, 5, "round-of-16")
  await check(335, 47014, 27, "quarterfinals")
  await check(335, 47014, 28, "semifinals")
  await check(335, 47014, 29, "final")

  // 德国杯 22/23 (id=217, season=41962)
  await check(217, 41962, 5, "round-of-16")
  await check(217, 41962, 27, "quarterfinals")
  await check(217, 41962, 28, "semifinals")
  await check(217, 41962, 29, "final")

  // 西班牙国王杯 22/23 (id=329, season=46493)
  await check(329, 46493, 5, "round-of-16")
  await check(329, 46493, 27, "quarterfinals")
  await check(329, 46493, 28, "semifinals")
  await check(329, 46493, 29, "final")

  // 欧冠 22/23 (id=7, season=41897)
  await check(7, 41897, 5, "round-of-16")
  await check(7, 41897, 27, "quarterfinals")
  await check(7, 41897, 28, "semifinals")
  await check(7, 41897, 29, "final")
}
main().catch(e => console.log("ERR:", e.message))
