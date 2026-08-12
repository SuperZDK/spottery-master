import { readFileSync } from "fs"

const matchId = 14572778

function check(path: string, label: string) {
  try {
    const d = JSON.parse(readFileSync(path, "utf-8"))
    const m = d.matches.find((x: any) => x.id === matchId)
    console.log(label + ": round=" + m?.round + " slug=" + m?.roundSlug)
  } catch (e: any) {
    console.log(label + ": " + e.message)
  }
}

check("D:/data/vscode_file/crawler/data/schedules_bak/欧联/25_26.json", "Bak1 (before v1)")
check("D:/data/vscode_file/crawler/data/schedules_bak2/欧联/25_26.json", "Bak2 (before v2)")
check("D:/data/vscode_file/crawler/data/schedules/欧联/25_26.json", "Current (after v2)")
