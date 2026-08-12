/**
 * Sofascore API 接口文档
 *
 * Base URL: https://api.sofascore.com/api/v1
 * 请求头: User-Agent=Mozilla/5.0, Referer=https://www.sofascore.com/, Accept=application/json
 * 限流建议: 每次请求间隔 >=200ms
 *
 * 注意: seasonId 有两套体系——
 *   - 赛程/事件类接口用 config 中的 seasonIds（如 PL 24/25 = 61627，但 config 中为 62206）
 *   - 排名/赛季列表接口必须用 `/unique-tournament/{id}/seasons` 返回的 season.id
 *   两套 ID 不一致，不可混用。
 */

// ============================================================
// 1. 联赛相关
// ============================================================

/** 获取联赛的所有赛季列表 */
// GET /unique-tournament/{uniqueTournamentId}/seasons
// Response: { seasons: [{ id: number, year: string, name: string }] }

/** 获取联赛某赛季的排名表 */
// GET /unique-tournament/{uniqueTournamentId}/season/{seasonId}/standings/{type}
//   type: "total" | "home" | "away"
// Response: { standings: [{ id, type, tournament, name, descriptions, tieBreakingRule, rows }] }
//   rows[]: { id, team, descriptions, promotion, position, matches, wins, losses, draws,
//             scoresFor, scoresAgainst, points, scoreDiffFormatted }

/** 获取联赛某赛季的球队列表（用于 team-based fallback） */
// GET /unique-tournament/{uniqueTournamentId}/season/{seasonId}/teams
// Response: { teams: [{ id: number, name: string }] }

/** 获取联赛某赛季的轮次列表 */
// GET /unique-tournament/{uniqueTournamentId}/season/{seasonId}/rounds
// Response: { rounds: [{ round: number, name?: string }] }

/** 获取联赛某赛季某轮的所有赛事 */
// GET /unique-tournament/{uniqueTournamentId}/season/{seasonId}/events/round/{round}
// Response: { events: [{ id, slug, homeTeam, awayTeam, homeScore, awayScore,
//                        roundInfo, startTimestamp, status, tournament }] }

/** 获取球队的历史赛事（已结束，按 offset 翻页，30条/页） */
// GET /team/{teamId}/events/last/{offset}
//   offset=0 是最新比赛
// Response: { events: [{ id, slug, homeTeam, awayTeam, homeScore, awayScore,
//                        roundInfo, startTimestamp, status, tournament }] }

// ============================================================
// 2. 单场比赛详情
// ============================================================

/** 获取比赛基本信息 */
// GET /event/{eventId}
// Response: {
//   event: {
//     id, slug, startTimestamp, status,
//     homeTeam, awayTeam,
//     homeScore: { display, normaltime, period1, period2 },
//     awayScore: { display, normaltime, period1, period2 },
//     winnerCode: 1=主胜 2=客胜 3=平,
//     roundInfo: { round },
//     tournament: { name, uniqueTournament: { id } },
//     season: { id },
//     venue: { stadium: { name } },
//     referee: { name },
//     attendance: number,
//     detailId: number,
//     hasEventPlayerStatistics: boolean,
//     hasEventPlayerHeatMap: boolean,
//     hasXg: boolean,
//   }
// }

/** 获取投票数据（赛前预测） */
// GET /event/{eventId}/votes
// Response: {
//   vote: { vote1: number, vote2: number, voteX: number },          // Who will win? 主/客/平
//   bothTeamsToScoreVote: { voteYes: number, voteNo: number },       // Will both teams score?
//   firstTeamToScoreVote: { voteHome: number, voteAway: number,     // Who will score first?
//                           voteNoGoal: number },
//   whoShouldHaveWonVote: { vote1: number, vote2: number }          // 赛后：谁应该赢
// }

/** 获取首发/替补/评分 + 伤病名单 */
// GET /event/{eventId}/lineups
// Response: {
//   confirmed: boolean,
//   home: {
//     formation: string,           // e.g. "4-2-3-1"
//     players: [{
//       player: { name, id, slug },
//       teamId: number,
//       shirtNumber: number,
//       jerseyNumber: string,
//       position: "G"|"D"|"M"|"F",
//       substitute: boolean,       // false=首发 true=替补
//       statistics: {
//         rating: number | null,   // null 表示未上场
//         minutesPlayed: number,
//         totalPass, accuratePass, totalShots, goalsPrevented, ...
//       }
//     }],
//     missingPlayers: [{           // 伤病/停赛名单
//       player: { name, id, position, slug },
//       type: "missing",           // 可能还有其他类型如"suspended"
//       reason: number,            // 原因编码
//       description: string,       // 伤病描述 e.g. "ACL Knee Injury"
//       externalType: number,
//       expectedEndDate: string    // 预计回归日期 ISO 格式
//     }]
//   },
//   away: { ... 同上 }
// }

/** 获取比赛事件（进球/黄牌/红牌/换人/中框等） */
// GET /event/{eventId}/incidents
// Response: { incidents: [{
//   id: number,
//   time: number,                // 分钟
//   incidentType: string,        // "goal"|"card"|"substitution"|"period"|"injuryTime"
//   incidentClass: string,       // goal: "regular"|"penalty"|"ownGoal"|"freeKick"|"corner"
//                                // card: "yellow"|"red"|"secondYellow"
//                                // substitution: "regular"
//   isHome: boolean,
//   player: { name, id, slug },
//   assist1: { name, id },      // 仅 goal 有
//   homeScore: number,           // 进球后比分
//   awayScore: number,
//   // 卡片独有:
//   reason: string,              // 犯规原因 "Foul"|"Argument"|"Simulation"|...
//   // 换人独有:
//   replacementPlayer: { name, id },
//   // period 独有:
//   text: string                // "HT"|"FT"
//   // injuryTime 独有:
//   text: string                // e.g. "6 minutes"
// }] }

/** 获取比赛双方统计（按半场） */
// GET /event/{eventId}/statistics
// Response: { statistics: [{
//   period: "1st"|"2nd"|"3rd"|...,
//   groups: [{
//     groupName: string,           // "Match overview"|"Shots"|"Attack"|"Passes"|"Duels"|"Defending"|"Goalkeeping"
//     statisticsItems: [{
//       name: string,              // e.g. "Ball possession"
//       home: string,              // e.g. "55%"
//       away: string,              // e.g. "45%"
//       homeValue: number,         // raw value
//       awayValue: number,
//       compareCode: number,
//       statisticsType: string,
//       valueType: string,
//     }]
//   }]
// }] }

/** 获取往绩交锋 —— ⚠️ 返回的是当前全部往绩（含该场比赛之后的），非截至赛前的历史数据，不适合投注分析 */
// GET /event/{eventId}/h2h
// Response: {
//   teamDuel: { homeWins: number, awayWins: number, draws: number },
//   managerDuel: { homeWins: number, awayWins: number, draws: number }
// }
// 替代方案: 从赛程数据中筛选两队过往比赛自行计算 H2H

/** 获取赛前排位和近期状态 */
// GET /event/{eventId}/pregame-form
// Response: {
//   homeTeam: {
//     avgRating: string,        // 平均评分
//     position: number,         // 联赛排名
//     value: string,            // 积分
//     form: string[]            // 近5场 W/L/D
//   },
//   awayTeam: { ... },
//   label: "Pts"               // value 的单位
// }

/** 获取球队当前阵容（含伤病标志，非历史） */
// GET /team/{teamId}/players
// Response: { players: [{
//   player: {
//     name, id, position, slug,
//     injured: boolean,              // 是否当前受伤
//     injury: string,                // 伤病描述
//     injuryReason: string,
//     estimatedReturnDate: string    // 预计回归
//   }
// }] }

/** 获取球队赛季累计统计（115项指标，非常适合投注分析） */
// GET /team/{teamId}/unique-tournament/{uniqueTournamentId}/season/{seasonId}/statistics/overall
// Response: { statistics: {
//   // 进攻
//   goalsScored, assists, shots, shotsOnTarget, shotsOffTarget,
//   bigChances, bigChancesCreated, bigChancesMissed,
//   penaltyGoals, freeKickGoals, headedGoals,
//   goalsFromInsideTheBox, goalsFromOutsideTheBox,
//   leftFootGoals, rightFootGoals,
//   successfulDribbles, dribbleAttempts,
//   corners, hitWoodwork, fastBreaks, fastBreakGoals,
//   // 控球/传球
//   averageBallPossession,           // 场均控球率
//   totalPasses, accuratePasses, accuratePassesPercentage,
//   totalLongBalls, accurateLongBalls,
//   totalCrosses, accurateCrosses,
//   totalOwnHalfPasses, totalOppositionHalfPasses,
//   // 防守
//   goalsConceded, cleanSheets,
//   tackles, interceptions, clearances,
//   saves, errorsLeadingToGoal,
//   totalDuels, duelsWon, duelsWonPercentage,
//   totalGroundDuels, totalAerialDuels,
//   fouls, offsides,
//   // 纪律
//   yellowCards, yellowRedCards, redCards,
//   // 评分
//   avgRating,
//   // 对手数据（Against 后缀）
//   bigChancesAgainst, cornersAgainst, ...
//   // 共约115个字段
// } }

/** 获取球员跨赛季跨赛事统计（约40项指标/赛季，可用于建立球员强度模型） */
// GET /player/{playerId}/statistics
// Response: {
//   typesMap: {
//     [uniqueTournamentId]: ["overall"|"home"|"away"][]
//   },
//   seasons: [{
//     year: string,
//     startYear: number,
//     endYear: number,
//     team: { name, id },
//     uniqueTournament: { name, id },
//     statistics: {
//       // 核心指标
//       rating: number,               // 赛季平均评分
//       appearances: number,          // 出场次数
//       minutesPlayed: number,
//       goals: number,
//       assists: number,
//       goalsAssistsSum: number,
//       expectedGoals: number,        // xG
//       expectedAssists: number,      // xA
//       // 进攻
//       totalShots, shotsOnTarget, keyPasses,
//       bigChancesCreated, bigChancesMissed,
//       successfulDribbles,
//       // 传球
//       totalPasses, accuratePasses, accuratePassesPercentage,
//       totalCrosses, accurateCrosses,
//       totalLongBalls, accurateLongBalls,
//       // 防守（非门将）
//       tackles, interceptions, blockedShots, clearances,
//       aerialDuelsWon,
//       // 纪律
//       yellowCards, redCards,
//       // 门将
//       saves, goalsConceded, cleanSheet,
//       // 评分权重（用于计算加权平均）
//       totalRating, countRating,
//       // 共约40个字段
//     }
//   }]
// }
// 注意: seasons 包含该球员所有赛季+所有赛事的数据（联赛、国家队、杯赛等）
//       可通过 uniqueTournament.id 过滤出目标联赛

/** 获取联赛某赛季各单项排行榜（17个类别，含评分/进球/助攻/xG/传球等） */
// GET /unique-tournament/{uniqueTournamentId}/season/{seasonId}/top-players/overall
// Response: {
//   topPlayers: {
//     rating: [{ statistics: { rating, appearances }, player, team, playedEnough: boolean }],
//     goals: [{ statistics: { goals, appearances }, ... }],
//     expectedGoals: [{ statistics: { expectedGoals }, ... }],
//     assists: [{ statistics: { assists }, ... }],
//     expectedAssists: [{ statistics: { expectedAssists }, ... }],
//     goalsAssistsSum: [{ statistics: { goalsAssistsSum }, ... }],
//     penaltyGoals: [{ statistics: { penaltiesTaken }, ... }],
//     freeKickGoal: [{ statistics: { shotFromSetPiece }, ... }],
//     scoringFrequency: [{ statistics: { scoringFrequency }, ... }],  // 分钟/进球
//     totalShots: [{ statistics: { totalShots }, ... }],
//     shotsOnTarget: [{ statistics: { shotsOnTarget }, ... }],
//     bigChancesMissed: [{ statistics: { bigChancesMissed }, ... }],
//     bigChancesCreated: [{ statistics: { bigChancesCreated }, ... }],
//     accuratePasses: [{ statistics: { accuratePasses }, ... }],
//     keyPasses: [{ statistics: { keyPasses }, ... }],
//     accurateLongBalls: [{ statistics: { accurateLongBalls }, ... }],
//   }
// }
// 可用于赛前快速对比两队核心球员的赛季表现

// ============================================================
// 3. 数据存储结构（output 目录布局）
// ============================================================
//
// data/schedules/
//   ├─ 英超/
//   │   ├─ 16_17.json      ← 赛季文件, 内容 SeasonSchedule
//   │   ├─ 17_18.json
//   │   └─ ...
//   ├─ 美职联/              ← 单年联赛用实际年份: 2016.json, 2017.json, ...
//   ├─ 瑞典超/
//   ├─ 欧冠/
//   └─ ... (共31个联赛/杯赛)
//
// -- SeasonSchedule 结构 --
// {
//   league: { id, name, shortName, slug, country },
//   season: string,              // "16/17" | "2016"
//   seasonId: number,
//   matches: [{
//     id, slug,
//     homeTeam, homeTeamId,
//     awayTeam, awayTeamId,
//     homeScore, awayScore,
//     round, startTimestamp,
//     date, status, tournamentName
//   }]
// }
