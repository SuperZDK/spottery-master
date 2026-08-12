import { readFileSync } from "fs"
import cfg from "../src/config/sofascore.js"

const d = JSON.parse(readFileSync("D:/data/vscode_file/crawler/data/schedules/欧联/25_26.json", "utf-8"))
const match = d.matches.find((m: any) => m.id === 14572778)
console.log("Match found:", !!match)
console.log("Stored round:", match?.round, "roundSlug:", match?.roundSlug)
console.log("tournamentName:", match?.tournamentName)

const league = cfg.source.leagues.find((l: any) => l.id === d.league.id)
const sr = league?.seasonRounds?.[d.season]
if (sr) {
  const entry = sr.find(
    (r: any) => r.round === match?.round && (r.slug || null) === match?.roundSlug,
  )
  console.log("Config entry:", JSON.stringify(entry))
  if (!entry) {
    console.log("All config entries for round=" + match?.round + ":")
    sr.filter((r: any) => r.round === match?.round).forEach((r: any) =>
      console.log("  ", JSON.stringify(r)),
    )
  }
}
