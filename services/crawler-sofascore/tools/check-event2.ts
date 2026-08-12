import { curlJson } from "../src/utils/curl.js"

async function main() {
  // Coppa Italia 22/23 - check multiple rounds
  const rounds = [
    { round: 1, slug: "qualification-round-1", label: "Qualification" },
    { round: 32, slug: "round-of-64", label: "R64" },
    { round: 6, slug: "round-of-32", label: "R32" },
    { round: 5, slug: "round-of-16", label: "R16" },
    { round: 27, slug: "quarterfinals", label: "QF" },
    { round: 28, slug: "semifinals", label: "SF" },
    { round: 29, slug: "final", label: "F" },
  ]
  for (const r of rounds) {
    const data = await curlJson(`https://api.sofascore.com/api/v1/unique-tournament/328/season/42742/events/round/${r.round}/slug/${r.slug}`)
    const ev = data.events?.[0]
    if (ev) {
      console.log(`${r.label} (config=${r.round} slug=${r.slug}): roundInfo.round=${ev.roundInfo?.round}, cupRoundType=${ev.roundInfo?.cupRoundType}`)
    } else {
      console.log(`${r.label} (config=${r.round} slug=${r.slug}): no events`)
    }
  }
}
main().catch(e => console.error("ERR:", e))
