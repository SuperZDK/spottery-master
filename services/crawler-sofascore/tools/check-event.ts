import { curlJson } from "../src/utils/curl.js"

async function main() {
  // Coppa Italia 22/23, round 5 slug round-of-16
  const data = await curlJson("https://api.sofascore.com/api/v1/unique-tournament/328/season/42742/events/round/5/slug/round-of-16")
  for (const ev of (data.events ?? []).slice(0, 3)) {
    console.log("event id:", ev.id)
    console.log("roundInfo:", JSON.stringify(ev.roundInfo))
    console.log("---")
  }
}
main().catch(e => console.error("ERR:", e))
