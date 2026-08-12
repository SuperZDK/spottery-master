import { curlJson } from "../src/utils/curl.js";

async function main() {
  const d = await curlJson("https://api.sofascore.com/api/v1/event/10021238");
  console.log("detail roundInfo:", JSON.stringify(d.event?.roundInfo));

  const t = await curlJson("https://api.sofascore.com/api/v1/team/2686/events/last/5");
  for (const ev of t.events ?? []) {
    if (ev.id === 10021238) {
      console.log("team endpoint roundInfo:", JSON.stringify(ev.roundInfo));
    }
  }
}
main().catch(e => console.log("ERR:", e.message));
