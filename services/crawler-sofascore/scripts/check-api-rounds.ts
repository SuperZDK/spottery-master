import { curlJson } from "../src/utils/curl.js"

const BASE = "https://api.sofascore.com/api/v1"

async function main() {
  // Fetch the match details to see its roundInfo
  const match = await curlJson(`${BASE}/event/14572778`)
  console.log("Match FCSB vs Fenerbahce:")
  console.log("  roundInfo:", JSON.stringify(match.event?.roundInfo || match.roundInfo))
  console.log("  startTimestamp:", match.event?.startTimestamp)
  console.log("  tournament:", match.event?.tournament?.name)
  console.log("  season:", match.event?.season?.id)
  console.log("  status:", match.event?.status?.type)
  
  // Also check the raw event data
  const raw = await curlJson(`${BASE}/unique-tournament/679/season/76984/events/round/8`)
  const found = raw.events?.find((e: any) => e.id === 14572778)
  console.log("\nFound in round 8:", !!found)
  if (found) {
    console.log("  roundInfo:", JSON.stringify(found.roundInfo))
    console.log("  tournament:", JSON.stringify(found.tournament?.name))
  }
  
  // Check round 636
  const raw636 = await curlJson(`${BASE}/unique-tournament/679/season/76984/events/round/636`)
  const found636 = raw636.events?.find((e: any) => e.id === 14572778)
  console.log("\nFound in round 636:", !!found636)
  if (found636) {
    console.log("  roundInfo:", JSON.stringify(found636.roundInfo))
    console.log("  tournament:", JSON.stringify(found636.tournament?.name))
  }
  
  // Check round 636 with slug
  const raw636s = await curlJson(`${BASE}/unique-tournament/679/season/76984/events/round/636/slug/playoff-round`)
  const found636s = raw636s.events?.find((e: any) => e.id === 14572778)
  console.log("\nFound in round 636 slug playoff-round:", !!found636s)
  if (found636s) {
    console.log("  roundInfo:", JSON.stringify(found636s.roundInfo))
  }
}

main().catch(console.error)
