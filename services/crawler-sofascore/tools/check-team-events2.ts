import { curlJson } from "../src/utils/curl.js"

async function main() {
  const teams = await curlJson("https://api.sofascore.com/api/v1/unique-tournament/328/season/42742/teams")
  let found = 0
  for (const team of teams.teams ?? []) {
    if (found >= 3) break
    const data = await curlJson(`https://api.sofascore.com/api/v1/team/${team.id}/events/last/10`)
    for (const ev of data.events ?? []) {
      if (ev.tournament?.uniqueTournament?.id === 328 && found < 3) {
        if (ev.roundInfo?.cupRoundType != null) {
          console.log(`team=${team.id} event=${ev.id}: roundInfo=${JSON.stringify(ev.roundInfo)}`)
          found++
        }
      }
    }
  }
  if (found === 0) console.log("No cupRoundType found in any team events")
}
main().catch(e => console.error("ERR:", e))
