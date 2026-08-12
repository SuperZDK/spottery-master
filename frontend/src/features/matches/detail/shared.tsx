export function fmtOdds(v: number | null | undefined): string {
  return v != null ? v.toFixed(2) : "-"
}

export function matchResult(home: number | null, away: number | null): "home" | "draw" | "away" | null {
  if (home == null || away == null) return null
  if (home > away) return "home"
  if (home === away) return "draw"
  return "away"
}

export function oddsHighlightClass(result: string | null, target: "home" | "draw" | "away"): string {
  if (result !== target) return "text-muted-foreground/60"
  return "text-primary font-bold"
}

export function h2hResultColor(homeScore: number | null, awayScore: number | null): string {
  if (homeScore == null || awayScore == null) return "text-muted-foreground"
  if (homeScore > awayScore) return "text-green-600 font-bold"
  if (homeScore === awayScore) return "text-yellow-600 font-bold"
  return "text-red-600 font-bold"
}

export function FormBadge({ result }: { result: string }) {
  const color = result === "W" ? "bg-green-500" : result === "D" ? "bg-yellow-500" : "bg-red-500"
  return (
    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${color}`}>
      {result}
    </span>
  )
}
