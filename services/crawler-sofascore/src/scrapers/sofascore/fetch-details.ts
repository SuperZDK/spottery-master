import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { sofascoreConfig } from "../../config/index.js"
import { curlJson, sleep, shutdown } from "../../utils/curl.js"

const BASE_URL = sofascoreConfig.source.apiBaseUrl
const SCHEDULES_DIR = join(import.meta.dirname, "..", "..", "..", "data", "schedules_v3")
const DETAILS_DIR = join(import.meta.dirname, "..", "..", "..", "data", "details")
const DELAY_MS = 200

async function fetchMatchDetail(matchId: number) {
  const [pregameForm, votes, lineups, statistics, incidents, eventData] = await Promise.all([
    curlJson(`${BASE_URL}/event/${matchId}/pregame-form`).catch(() => null),
    curlJson(`${BASE_URL}/event/${matchId}/votes`).catch(() => null),
    curlJson(`${BASE_URL}/event/${matchId}/lineups`).catch(() => null),
    curlJson(`${BASE_URL}/event/${matchId}/statistics`).catch(() => null),
    curlJson(`${BASE_URL}/event/${matchId}/incidents`).catch(() => null),
    curlJson(`${BASE_URL}/event/${matchId}`).catch(() => null),
  ])
  return { pregameForm, votes, lineups, statistics, incidents, eventData }
}

function pick<T>(obj: T, keys: (keyof T)[]): Partial<T> {
  const result: Partial<T> = {}
  for (const k of keys) {
    if (obj && typeof obj === "object" && k in obj) result[k] = obj[k]
  }
  return result
}

function toMatchDetail(matchId: number, raw: any, league: any, season: string, seasonId: number): any {
  const ev = raw.eventData?.event || {}
  const pg = raw.pregameForm || null
  const vt = raw.votes || null
  const lu = raw.lineups || null
  const st = raw.statistics || null
  const ic = raw.incidents || null

  const detail: any = {
    matchId,
    league: { id: league.id, name: league.name, shortName: league.shortName },
    season,
    seasonId,
    slug: ev.slug || "",
    startTimestamp: ev.startTimestamp || 0,
    status: ev.status?.type || "",
    homeScore: ev.homeScore?.display ?? null,
    awayScore: ev.awayScore?.display ?? null,
    referee: ev.referee?.name || null,
    venue: ev.venue?.stadium?.name || null,
    attendance: ev.attendance || null,
  }

  if (pg && !pg.error) {
    detail.pregameForm = {
      homeTeam: pick(pg.homeTeam || {}, ["avgRating", "position", "value", "form"] as any),
      awayTeam: pick(pg.awayTeam || {}, ["avgRating", "position", "value", "form"] as any),
      label: pg.label || null,
    }
  }

  if (vt && !vt.error) {
    detail.votes = {
      vote: vt.vote || null,
      bothTeamsToScoreVote: vt.bothTeamsToScoreVote || null,
      firstTeamToScoreVote: vt.firstTeamToScoreVote || null,
    }
  }

  if (lu && lu.confirmed !== undefined) {
    const mapSide = (side: any) => {
      if (!side) return null
      return {
        formation: side.formation || "",
        players: (side.players || []).map((p: any) => ({
          player: { name: p.player?.name || "", id: p.player?.id || 0 },
          shirtNumber: p.shirtNumber || 0,
          position: p.position || "",
          substitute: !!p.substitute,
          statistics: p.statistics
            ? pick(p.statistics, ["rating", "minutesPlayed", "totalPass", "accuratePass", "totalShots", "keyPasses", "tackles", "aerialDuelsWon", "saves"] as any)
            : null,
        })),
        missingPlayers: (side.missingPlayers || []).map((p: any) => ({
          player: { name: p.player?.name || "", id: p.player?.id || 0 },
          type: p.type || "",
          description: p.description || null,
          expectedEndDate: p.expectedEndDate || null,
        })),
      }
    }
    detail.lineups = {
      confirmed: lu.confirmed,
      home: mapSide(lu.home),
      away: mapSide(lu.away),
    }
  }

  if (st && st.statistics) {
    detail.statistics = (st.statistics || []).map((period: any) => ({
      period: period.period || "",
      groups: (period.groups || []).map((g: any) => ({
        groupName: g.groupName || "",
        statisticsItems: (g.statisticsItems || []).map((item: any) => ({
          name: item.name || "",
          home: item.home ?? item.homeValue ?? null,
          away: item.away ?? item.awayValue ?? null,
          homeValue: item.homeValue ?? null,
          awayValue: item.awayValue ?? null,
        })),
      })),
    }))
  }

  if (ic && ic.incidents) {
    detail.incidents = (ic.incidents || []).map((x: any) => ({
      id: x.id,
      time: x.time,
      incidentType: x.incidentType,
      incidentClass: x.incidentClass || null,
      isHome: x.isHome ?? null,
      player: x.player ? { name: x.player.name, id: x.player.id } : null,
      homeScore: x.homeScore ?? null,
      awayScore: x.awayScore ?? null,
      reason: x.reason || null,
      text: x.text || null,
      assist1: x.assist1 ? { name: x.assist1.name, id: x.assist1.id } : null,
      replacementPlayer: x.replacementPlayer ? { name: x.replacementPlayer.name, id: x.replacementPlayer.id } : null,
    }))
  }

  return detail
}

async function fetchTeamStats(teamId: number, leagueId: number, seasonId: number) {
  const url = `${BASE_URL}/team/${teamId}/unique-tournament/${leagueId}/season/${seasonId}/statistics/overall`
  const data = await curlJson(url).catch(() => null)
  if (data?.statistics) {
    return { teamId, leagueId, seasonId, statistics: data.statistics }
  }
  return null
}

async function run(filterSlugs?: string[]) {
  console.log("=== Sofascore Match Detail Scraper ===\n")

  let leagueDirs = readdirSync(SCHEDULES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory())

  if (filterSlugs) {
    const slugToShortName: Record<string, string> = {}
    for (const league of sofascoreConfig.source.leagues) {
      slugToShortName[league.slug] = league.shortName
    }
    const targetShortNames = new Set(filterSlugs.map((s) => slugToShortName[s]).filter(Boolean))
    leagueDirs = leagueDirs.filter((d) => targetShortNames.has(d.name))
  }

  for (const dir of leagueDirs) {
    const leagueName = dir.name
    const scheduleDir = join(SCHEDULES_DIR, leagueName)
    const seasonFiles = readdirSync(scheduleDir).filter((f) => f.endsWith(".json"))

    for (const file of seasonFiles) {
      const seasonKey = file.replace(".json", "").replace("_", "/")
      const filePath = join(scheduleDir, file)
      const schedule: any = JSON.parse(readFileSync(filePath, "utf-8"))

      const league = schedule.league
      const seasonId = schedule.seasonId
      const matches = schedule.matches || []

      console.log(`\n[${leagueName}] ${seasonKey} — ${matches.length} matches`)

      const seasonDir = join(DETAILS_DIR, leagueName, file.replace(".json", ""))
      const detailBase = seasonDir
      const teamBase = join(seasonDir, "teams")
      mkdirSync(detailBase, { recursive: true })
      mkdirSync(teamBase, { recursive: true })

      let matchCount = 0
      let teamCount = 0
      let hasError = false
      const fetchedTeams = new Set<number>()

      for (const match of matches) {
        const matchId = match.id
        const targetFile = join(detailBase, `${matchId}.json`)
        if (existsSync(targetFile)) {
          continue
        }

        const raw = await fetchMatchDetail(matchId)
        await sleep(DELAY_MS) // 跨场间隔
        const detail = toMatchDetail(matchId, raw, league, seasonKey, seasonId)
        writeFileSync(targetFile, JSON.stringify(detail, null, 2), "utf-8")
        matchCount++

        const homeScore = detail.homeScore
        const awayScore = detail.awayScore
        const scoreStr = homeScore !== null ? `${homeScore}-${awayScore}` : "?-?"
        process.stdout.write(`  Match ${matchId}: ${scoreStr}`)

        if (detail.pregameForm) process.stdout.write(` | pregame`)
        if (detail.votes) process.stdout.write(` | votes`)
        if (detail.lineups) process.stdout.write(` | lineups`)
        if (detail.statistics) process.stdout.write(` | stats`)
        if (detail.incidents) process.stdout.write(` | incidents`)
        process.stdout.write(`\n`)

        // Fetch team stats lazily
        for (const tid of [match.homeTeam?.id, match.awayTeam?.id]) {
          if (!tid || fetchedTeams.has(tid)) continue
          const teamFile = join(teamBase, `${tid}.json`)
          if (existsSync(teamFile)) {
            fetchedTeams.add(tid)
            continue
          }
          const teamStats = await fetchTeamStats(tid, league.id, seasonId)
          if (teamStats) {
            writeFileSync(join(teamBase, `${tid}.json`), JSON.stringify(teamStats, null, 2), "utf-8")
            teamCount++
          }
          fetchedTeams.add(tid)
          await sleep(DELAY_MS)
        }
      }

      if (matchCount > 0 || teamCount > 0) {
        console.log(`  => ${matchCount} matches, ${teamCount} teams fetched`)
      }
      if (matchCount === 0 && teamCount === 0) {
        console.log(`  => All up-to-date`)
      }
    }
  }

  console.log("\n=== All done ===")
}

const filterSlugs = process.argv[2] ? process.argv.slice(2) : undefined
run(filterSlugs).finally(() => shutdown()).catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
