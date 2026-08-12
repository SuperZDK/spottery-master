import { readFileSync } from "fs"
import config from "../src/config/sofascore.js"

const dataPath = "D:/data/vscode_file/crawler/data/schedules"
const samples = ["德乙/16_17.json", "欧冠/24_25.json", "法甲/24_25.json", "欧联/24_25.json"]

for (const sample of samples) {
  const d = JSON.parse(readFileSync(dataPath + "/" + sample, "utf-8"))
  const league = config.source.leagues.find((l) => l.id === d.league.id)
  const sr = league?.seasonRounds?.[d.season] || league?.rounds
  if (!sr) { console.log(sample + ": no config"); continue }

  let diffs = 0
  for (const m of d.matches) {
    if (m.round == null) continue
    const cfg = sr.find((r: any) => r.round === m.round && (r.slug || null) === m.roundSlug)
    if (!cfg) continue
    if (m.round !== cfg.round || m.roundSlug !== (cfg.slug ?? null)) {
      diffs++
      if (diffs <= 5) {
        console.log(sample + " DIFF: round=" + m.round + " slug=" + m.roundSlug + " | cfg round=" + cfg.round + " slug=" + (cfg.slug ?? null))
      }
    }
  }
  console.log(sample + ": total=" + d.matches.length + " diffs=" + diffs)
}
