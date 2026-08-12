import { curlJson } from "../src/utils/curl.js"

async function main() {
  // Get team events - check what roundInfo looks like from the team endpoint
  // Pick a Coppa Italia 22/23 team
  const teams = await curlJson("https://api.sofascore.com/api/v1/unique-tournament/328/season/42742/teams")
  const teamId = teams.teams?.[0]?.id
  if (!teamId) { console.log("no teams"); return }
  
  const data = await curlJson(`https://api.sofascore.com/api/v1/team/${teamId}/events/last/5`)
  for (const ev of data.events ?? []) {
    if (ev.tournament?.uniqueTournament?.id === 328) {
      console.log(`event ${ev.id}: roundInfo=${JSON.stringify(ev.roundInfo)}`)
    }
  }
}
main().catch(e => console.error("ERR:", e))
