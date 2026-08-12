import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import { sofascoreConfig } from "../../config/index.js"
import type { LeagueConfig, MatchRecord, TeamInfo, ScoreInfo } from "../../types/index.js"
import { curlJson, sleep, shutdown } from "../../utils/curl.js"

const BASE_URL = sofascoreConfig.source.apiBaseUrl
const OUTPUT_DIR = join(import.meta.dirname, "..", "..", "..", "data", "schedules_v3")
const DELAY_MS = 200
const CONCURRENCY = 5

function parseSeasonKey(key: string): { startYear: number; endYear: number } {
  if (key.includes("/")) {
    const parts = key.split("/")
    return {
      startYear: parseInt(parts[0]) + 2000,
      endYear: parseInt(parts[1]) + 2000,
    }
  }
  const y = parseInt(key)
  return { startYear: y, endYear: y + 1 }
}

function estimateSeasonRange(seasonKey: string): { start: number; end: number } {
  const { startYear, endYear } = parseSeasonKey(seasonKey)
  if (seasonKey.includes("/")) {
    const start = new Date(startYear, 5, 1).getTime() / 1000   // Jun 1
    const end = new Date(endYear + 1, 0, 1).getTime() / 1000   // Jan 1 of year after endYear
    return { start, end }
  }
  const start = new Date(startYear, 0, 1).getTime() / 1000
  const end = new Date(endYear, 0, 1).getTime() / 1000
  return { start, end }
}

function toMatchRecord(ev: any, defaultRound: number, leagueName: string, slug?: string, prefix?: string): MatchRecord {
  function teamInfo(t: any): TeamInfo {
    return {
      name: t.name ?? "Unknown",
      slug: t.slug ?? "",
      shortName: t.shortName ?? "",
      userCount: t.userCount ?? 0,
      nameCode: t.nameCode ?? "",
      country: t.country ? {
        alpha2: t.country.alpha2 ?? "",
        alpha3: t.country.alpha3 ?? "",
        name: t.country.name ?? "",
        slug: t.country.slug ?? "",
      } : { alpha2: "", alpha3: "", name: "", slug: "" },
      id: t.id ?? 0,
      teamColors: t.teamColors ? {
        primary: t.teamColors.primary ?? undefined,
        secondary: t.teamColors.secondary ?? undefined,
        text: t.teamColors.text ?? undefined,
      } : {},
    }
  }

  function scoreInfo(s: any): ScoreInfo {
    return {
      current: s.current ?? undefined,
      display: s.display ?? undefined,
      period1: s.period1 ?? undefined,
      period2: s.period2 ?? undefined,
      normaltime: s.normaltime ?? undefined,
    }
  }

  return {
    id: ev.id,
    slug: ev.slug ?? "",
    tournament: {
      name: ev.tournament?.name ?? leagueName,
      slug: ev.tournament?.slug ?? "",
      category: {
        name: ev.tournament?.category?.name ?? "",
        slug: ev.tournament?.category?.slug ?? "",
      },
    },
    season: {
      name: ev.season?.name ?? "",
      year: ev.season?.year ?? "",
      id: ev.season?.id ?? 0,
    },
    roundInfo: {
      round: defaultRound,
      name: ev.roundInfo?.name ?? undefined,
      slug: slug ?? ev.roundInfo?.slug ?? undefined,
      prefix: prefix ?? ev.roundInfo?.prefix ?? undefined,
      cupRoundType: ev.roundInfo?.cupRoundType ?? undefined,
    },
    status: {
      code: ev.status?.code ?? 0,
      description: ev.status?.description ?? "",
      type: ev.status?.type ?? "unknown",
    },
    winnerCode: ev.winnerCode ?? 0,
    homeTeam: teamInfo(ev.homeTeam || {}),
    awayTeam: teamInfo(ev.awayTeam || {}),
    homeScore: scoreInfo(ev.homeScore || {}),
    awayScore: scoreInfo(ev.awayScore || {}),
    hasXg: ev.hasXg ?? false,
    hasEventPlayerStatistics: ev.hasEventPlayerStatistics ?? false,
    hasEventPlayerHeatMap: ev.hasEventPlayerHeatMap ?? false,
    startTimestamp: ev.startTimestamp ?? 0,
    date: ev.startTimestamp
      ? new Date((ev.startTimestamp + 28800) * 1000).toISOString().replace("T", " ").slice(0, 19)
      : "",
    finalResultOnly: ev.finalResultOnly ?? false,
  }
}

async function fetchLeagueSeasonMatches(
  league: LeagueConfig,
  seasonId: number,
  seasonKey?: string,
): Promise<MatchRecord[]> {
  let roundList: { round: number; name?: string; slug?: string; prefix?: string }[]

  if (seasonKey && league.seasonRounds?.[seasonKey]) {
    roundList = league.seasonRounds[seasonKey]
  } else if (league.rounds && league.rounds.length > 0) {
    roundList = league.rounds
    // Supplement config rounds with API rounds for leagues (catches rounds not in config)
    if (league.type === "league") {
      try {
        const data = await curlJson(`${BASE_URL}/unique-tournament/${league.id}/season/${seasonId}/rounds`)
        const apiRounds: typeof roundList = data.rounds ?? []
        if (apiRounds.length > 0) {
          const existingRounds = new Set(roundList.map(r => r.round))
          for (const r of apiRounds) {
            if (!existingRounds.has(r.round)) roundList.push(r)
          }
        }
      } catch {}
    }
  } else {
    try {
      const data = await curlJson(`${BASE_URL}/unique-tournament/${league.id}/season/${seasonId}/rounds`)
      roundList = data.rounds ?? []
    } catch {
      roundList = []
    }
  }

  if (roundList.length === 0) {
    process.stdout.write(`    Rounds unavailable, trying team-based fallback\n`)
    return fetchCupSeasonMatches(league, seasonKey!, seasonId)
  }

  const seasonRange = seasonKey ? estimateSeasonRange(seasonKey) : null
  const allMatches: MatchRecord[] = []
  const seenMatchIds = new Set<number>()

  async function fetchRound(rd: { round: number; slug?: string; prefix?: string }): Promise<{ round: number; events: any[] } | null> {
    try {
      let url = `${BASE_URL}/unique-tournament/${league.id}/season/${seasonId}/events/round/${rd.round}`
      if (rd.slug) url += `/slug/${rd.slug}`
      if (rd.prefix) url += `/prefix/${encodeURIComponent(rd.prefix)}`
      const data = await curlJson(url)
      return { round: rd.round, events: data.events ?? [] }
    } catch {
      return null
    }
  }

  for (let i = 0; i < roundList.length; i += CONCURRENCY) {
    const batch = roundList.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map((r) => fetchRound(r)))

    for (let ri = 0; ri < results.length; ri++) {
      const result = results[ri]
      if (!result) {
        process.stdout.write(`    Round ${batch[ri].round} (${batch[ri].slug ?? ''}): FAIL\n`)
        continue
      }

      const { round, events } = result

      if (events.length === 0) {
        process.stdout.write(`    Round ${round}: 0 matches\n`)
        continue
      }

      let added = 0
      for (const ev of events) {
        if (seenMatchIds.has(ev.id)) continue
        const ts = ev.startTimestamp ?? 0
        if (seasonRange && (ts < seasonRange.start || ts >= seasonRange.end)) continue
        seenMatchIds.add(ev.id)
        allMatches.push(toMatchRecord(ev, round, league.name, batch[ri].slug, batch[ri].prefix))
        added++
      }

      process.stdout.write(`    Round ${round}: ${events.length} events (${added} new)\n`)
    }

    await sleep(DELAY_MS)
  }

  allMatches.sort((a, b) => a.startTimestamp - b.startTimestamp)

  if (allMatches.length === 0 && seasonKey) {
    if (league.type === "league") {
      process.stdout.write(`    Rounds returned 0 matches, no team-based fallback for leagues\n`)
      return []
    }
    process.stdout.write(`    Rounds returned 0 matches, trying team-based fallback\n`)
    return fetchCupSeasonMatches(league, seasonKey, seasonId)
  }

  return allMatches
}

function getOffsetsForSeason(seasonKey: string): number[] {
  const { startYear } = parseSeasonKey(seasonKey)
  const yearsBack = 2026 - startYear
  const base = Math.round(yearsBack * 2)
  const offsets: number[] = []
  for (let i = -6; i <= 6; i++) {
    const off = base + i
    if (off >= 0) offsets.push(off)
  }
  return [...new Set(offsets)].sort((a, b) => a - b)
}

function buildRoundSlugMap(league: LeagueConfig, seasonKey: string): Record<string, number> {
  const map: Record<string, number> = {}
  const list = (seasonKey && league.seasonRounds?.[seasonKey]) || league.rounds || []
  for (const r of list) {
    if (r.slug) map[r.slug] = r.round
  }
  return map
}

async function fetchCupSeasonMatches(
  league: LeagueConfig,
  seasonKey: string,
  seasonId: number,
): Promise<MatchRecord[]> {
  const seasonRange = estimateSeasonRange(seasonKey)
  const offsets = getOffsetsForSeason(seasonKey)
  const slugToRound = buildRoundSlugMap(league, seasonKey)

  let teams: { id: number; name: string }[] = []
  try {
    const data = await curlJson(`${BASE_URL}/unique-tournament/${league.id}/season/${seasonId}/teams`)
    teams = data.teams ?? []
    if (teams.length === 0) {
      process.stdout.write(`    No teams found\n`)
      return []
    }
    process.stdout.write(`    ${teams.length} teams\n`)
  } catch (err) {
    process.stdout.write(`    [ERROR] fetch teams: ${err}\n`)
    return []
  }

  const allMatches: MatchRecord[] = []
  const seenMatchIds = new Set<number>()

  for (let i = 0; i < teams.length; i += CONCURRENCY) {
    const batch = teams.slice(i, i + CONCURRENCY)

    const results = await Promise.all(
      batch.map(async (team) => {
        const teamMatches: MatchRecord[] = []

        for (const offset of offsets) {
          let data: any
          try {
            data = await curlJson(`${BASE_URL}/team/${team.id}/events/last/${offset}`)
          } catch {
            break
          }

          const events = data.events ?? []
          if (events.length === 0) continue

          let allTooOld = true
          for (const ev of events) {
            const tid = ev.tournament?.uniqueTournament?.id
            const ts = ev.startTimestamp ?? 0

            if (ts >= seasonRange.start) allTooOld = false

            if (tid !== league.id) continue
            if (ts < seasonRange.start || ts >= seasonRange.end) continue

            if (seenMatchIds.has(ev.id)) continue
            seenMatchIds.add(ev.id)
            const configRound = slugToRound[ev.roundInfo?.slug] ?? ev.roundInfo?.round ?? 0
            teamMatches.push(toMatchRecord(ev, configRound, league.name, ev.roundInfo?.slug, ev.roundInfo?.prefix))
          }

          if (allTooOld) break
          await sleep(50)
        }

        return { team, matches: teamMatches }
      }),
    )

    for (const result of results) {
      if (result.matches.length > 0) {
        process.stdout.write(`    ${result.team.name}: ${result.matches.length} matches\n`)
      }
      allMatches.push(...result.matches)
    }
  }

  allMatches.sort((a, b) => a.startTimestamp - b.startTimestamp)
  return allMatches
}

async function run(filterSlugs?: string[]) {
  console.log("=== Sofascore Schedule Scraper ===\n")

  const leagues = filterSlugs
    ? sofascoreConfig.source.leagues.filter((l) => filterSlugs.includes(l.slug))
    : sofascoreConfig.source.leagues
  let totalLeagues = 0
  let totalSeasons = 0
  let totalMatches = 0

  for (const league of leagues) {
    const seasonKeys = Object.keys(league.seasonIds)
    totalLeagues++

    for (const seasonKey of seasonKeys) {
      const seasonId = league.seasonIds[seasonKey]
      const dirPath = join(OUTPUT_DIR, league.shortName)
      const fileName = `${seasonKey.replace("/", "_")}.json`
      const filePath = join(dirPath, fileName)

      mkdirSync(dirPath, { recursive: true })

      if (existsSync(filePath) && !force) {
        let raw = readFileSync(filePath, "utf-8")
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1)
        const existing = JSON.parse(raw)
        if ((existing.matches?.length ?? 0) > 0) {
          totalSeasons++
          console.log(`[SKIP] ${league.shortName} ${seasonKey} (${existing.matches.length} matches)`)
          continue
        }
        console.log(`[RE-FETCH] ${league.shortName} ${seasonKey} (0 matches in existing file)`)
      }

      console.log(`[FETCH] ${league.shortName} ${seasonKey} (seasonId: ${seasonId})`)

      const matches = await fetchLeagueSeasonMatches(league, seasonId, seasonKey)

      const schedule = {
        league: {
          id: league.id,
          name: league.name,
          shortName: league.shortName,
          slug: league.slug,
          country: league.country,
        },
        season: seasonKey,
        seasonId,
        matches,
      }

      if (matches.length === 0) {
        console.log(`  => 0 matches, skipped write (preserving existing file)\n`)
        continue
      }
      writeFileSync(filePath, JSON.stringify(schedule, null, 2), "utf-8")
      totalSeasons++
      totalMatches += matches.length
      console.log(`  => Saved ${matches.length} matches to ${fileName}\n`)
    }
  }

  console.log("=== Summary ===")
  console.log(`Leagues: ${totalLeagues}`)
  console.log(`Seasons: ${totalSeasons}`)
  console.log(`Total matches: ${totalMatches}`)
  console.log("=== All done ===")
}

const args = process.argv.slice(2)
const force = args.includes("--force") || args.includes("-f")
const filterSlugs = args.filter((a) => !a.startsWith("-"))
run(filterSlugs.length > 0 ? filterSlugs : undefined).finally(() => shutdown()).catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
