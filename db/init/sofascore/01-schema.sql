-- ============================================================
-- sofascore 源库 schema
-- 来源：docs/sofascore-database.md 已定稿 DDL（1.0 版原样）
-- 15 张表：countries/leagues/seasons/teams/schedules/status_codes/
--        cup_round_types/round_prefixes/players/match_players/
--        match_details/match_votes/match_missing_players/
--        match_statistics/team_season_stats
-- 末尾追加权限：crawler_sofascore 全权限（OWNER 自动拥有），
--              api_service 只读（架构文档 6.2）
-- ============================================================

-- ─── 国家/洲际区域表 ──────────────────────────────────────────
CREATE TABLE countries (
    country_id  SERIAL PRIMARY KEY,     -- 自增
    alpha2      TEXT UNIQUE,            -- "DE"（europe 等洲际区域为 NULL）
    alpha3      TEXT,                   -- "DEU"
    name        TEXT NOT NULL,          -- "Germany"
    slug        TEXT UNIQUE NOT NULL,   -- "germany"（leagues 侧主关联键）
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ─── 联赛表 ──────────────────────────────────────────────────
CREATE TABLE leagues (
    league_id    INTEGER PRIMARY KEY,   -- league.id（Sofascore 原始 ID，非自增）
    name         TEXT NOT NULL,         -- 英文名 "2. Bundesliga"
    short_name   TEXT,                  -- 中文简称（德乙）
    slug         TEXT,                  -- "2-bundesliga"
    country_slug TEXT,                  -- 软关联 countries.slug（"germany"/"europe"）
    scraped_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);

-- ─── 赛季表 ──────────────────────────────────────────────────
CREATE TABLE seasons (
    season_id  INTEGER PRIMARY KEY,     -- seasonId（全局唯一）
    league_id  INTEGER NOT NULL,        -- 软关联 leagues.league_id
    season_key TEXT NOT NULL,           -- "16/17" / "2024"
    UNIQUE (league_id, season_key)
);

-- ─── 球队表 ──────────────────────────────────────────────────
CREATE TABLE teams (
    team_id     INTEGER PRIMARY KEY,    -- team.id（Sofascore 原始 ID）
    name        TEXT NOT NULL,          -- 英文名 "VfB Stuttgart"
    slug        TEXT,                   -- "vfb-stuttgart"
    short_name  TEXT,                   -- "Stuttgart"（部分队为空）
    name_code   TEXT,                   -- "VFB"（全部有值）
    user_count  INTEGER,                -- 关注人数（爬虫快照，可变化）
    country_id  INTEGER,                -- 软关联 countries.country_id（按 alpha2 匹配）
    team_colors JSONB,                  -- {primary,secondary,text}
    scraped_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ─── 赛程主表 ────────────────────────────────────────────────
CREATE TABLE schedules (
    match_id      INTEGER PRIMARY KEY,  -- match.id
    league_id     INTEGER NOT NULL,     -- 顶层 league.id（match.tournament 无 id）
    season_id     INTEGER NOT NULL,     -- 软关联 seasons.season_id
    season_key    TEXT NOT NULL,        -- 冗余顶层 season 字符串
    slug          TEXT,                 -- 比赛 slug
    status_code   INTEGER NOT NULL,     -- 软关联 status_codes.code
    status_type   TEXT NOT NULL,        -- finished/postponed/canceled/notstarted
    winner_code   INTEGER,              -- 1=主胜 2=平 3=客胜 0=无结果
    home_team_id  INTEGER NOT NULL,     -- 软关联 teams.team_id
    away_team_id  INTEGER NOT NULL,
    -- ==== 比分（10 列全保留，语义见"〇、设计全局原则·6"）====
    home_score_current     INTEGER,     -- 实时/含加时或点球数
    home_score_display     INTEGER,     -- 显示的足球比分（含加时，点球场=120分钟比分）
    home_score_normaltime  INTEGER,     -- 90 分钟常规比分 ★竞彩首要展示
    home_score_period1     INTEGER,     -- 上半场
    home_score_period2     INTEGER,     -- 下半场
    away_score_current     INTEGER,
    away_score_display     INTEGER,
    away_score_normaltime  INTEGER,
    away_score_period1     INTEGER,
    away_score_period2     INTEGER,
    -- ==== 轮次（roundInfo）====
    round_num       INTEGER,            -- roundInfo.round
    round_name      TEXT,               -- 杯赛轮次名（Final/Quarterfinals...），联赛为 NULL
    round_slug      TEXT,
    round_prefix    TEXT,               -- Qualification/Preliminary/Europa Playoffs/Relegation-Promotion
    cup_round_type  INTEGER,            -- 2 的幂=该轮场次数（16=32强...1=决赛）
    -- ==== 标记 ====
    has_xg                      BOOLEAN,
    has_event_player_statistics BOOLEAN,
    has_event_player_heat_map    BOOLEAN,
    -- ==== 时间 ====
    kickoff_time    TIMESTAMPTZ NOT NULL,  -- startTimestamp
    scraped_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_schedules_league_season_round ON schedules (league_id, season_id, round_num);
CREATE INDEX idx_schedules_kickoff           ON schedules (kickoff_time);
CREATE INDEX idx_schedules_home_team         ON schedules (home_team_id);
CREATE INDEX idx_schedules_away_team         ON schedules (away_team_id);

-- ─── 状态码字典表 ────────────────────────────────────────────
CREATE TABLE status_codes (
    code              INTEGER PRIMARY KEY,
    status_type       TEXT NOT NULL,      -- finished/postponed/canceled/notstarted
    description       TEXT NOT NULL,      -- Ended/AET/AP/Postponed/Canceled/Abandoned/Walkover/Retired
    meaning_cn        TEXT NOT NULL,      -- 完场/加时完场/点球完场/延期/取消/中止/判负/弃赛
    final_result_only BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at        TIMESTAMPTZ DEFAULT now()
);

-- ─── 杯赛轮次字典表 ──────────────────────────────────────────
CREATE TABLE cup_round_types (
    value            INTEGER PRIMARY KEY,   -- 2 的幂
    matches_in_round INTEGER NOT NULL,      -- = value（该轮比赛场次数）
    round_name_en    TEXT NOT NULL,
    round_name_cn    TEXT NOT NULL,
    updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ─── 阶段标签字典表 ──────────────────────────────────────────
CREATE TABLE round_prefixes (
    value      TEXT PRIMARY KEY,      -- Qualification/Preliminary/Europa Playoffs/Relegation-Promotion
    meaning_cn TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─── 球员维度表 ──────────────────────────────────────────────
CREATE TABLE players (
    player_id     INTEGER PRIMARY KEY,   -- lineups.player.id（Sofascore 球员原始 ID）
    name          TEXT NOT NULL,         -- lineups.player.name（跨场一致，抽样 0 漂移）
    position      TEXT,                  -- 惯用位置：出场最多的 G/D/M/F 短码（聚合值）
    first_seen_at TIMESTAMPTZ,           -- 该球员在 match_players 中最早比赛的 kickoff_time
    last_seen_at  TIMESTAMPTZ,           -- 最近比赛的 kickoff_time
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ─── 比赛阵容表 ──────────────────────────────────────────────
CREATE TABLE match_players (
    match_id       INTEGER NOT NULL,      -- 软关联 schedules.match_id（details.matchId）
    player_id      INTEGER NOT NULL,     -- 软关联 players.player_id
    league_id      INTEGER,               -- 查询入口：与 schedules.league_id 同值（复用 details.league.id）
    season_id      INTEGER,               -- 查询入口：与 schedules.season_id 同值（复用 details 顶层 seasonId）
    is_home        BOOLEAN NOT NULL,     -- 主队球员?（home/away 侧）
    shirt_number   INTEGER,              -- shirtNumber
    position       TEXT,                 -- 本场实际位置（G/D/M/F 短码）
    substitute     BOOLEAN,              -- 是否替补
    -- ==== 球员比赛统计（statistics，仅 6 键，1:1 归入本表）====
    rating         NUMERIC(4,2),         -- statistics.rating（如 7.2）
    minutes_played INTEGER,              -- statistics.minutesPlayed
    total_pass     INTEGER,              -- statistics.totalPass
    accurate_pass  INTEGER,              -- statistics.accuratePass
    total_shots    INTEGER,              -- statistics.totalShots
    saves          INTEGER,              -- statistics.saves（仅门将有值）
    PRIMARY KEY (match_id, player_id)
);
CREATE INDEX idx_match_players_ls          ON match_players (league_id, season_id, match_id);
CREATE INDEX idx_match_players_player_season ON match_players (player_id, season_id);

-- ─── 比赛详情表 ──────────────────────────────────────────────
CREATE TABLE match_details (
    match_id           INTEGER PRIMARY KEY,   -- 软关联 schedules.match_id
    league_id          INTEGER NOT NULL,     -- details.league.id（软关联 leagues，查询入口）
    season_id          INTEGER NOT NULL,     -- details.seasonId（软关联 seasons，查询入口）
    referee            TEXT,                 -- referee（裁判名）
    venue              TEXT,                 -- venue（球场名）
    attendance         INTEGER,              -- attendance（到场人数，仅部分场次有）
    lineups_confirmed  BOOLEAN,              -- lineups.confirmed
    home_formation     TEXT,                 -- lineups.home.formation（"3-4-3"）
    away_formation     TEXT,                 -- lineups.away.formation
    -- ==== pregameForm（1:1 归入本表，仅新数据有）====
    pregame_home_avg_rating  NUMERIC,        -- pregameForm.homeTeam.avgRating "6.84"
    pregame_home_position    INTEGER,        -- pregameForm.homeTeam.position
    pregame_home_value       INTEGER,        -- pregameForm.homeTeam.value（积分）
    pregame_home_form        JSONB,          -- pregameForm.homeTeam.form ["D","W","W","W","D"]
    pregame_away_avg_rating  NUMERIC,
    pregame_away_position    INTEGER,
    pregame_away_value       INTEGER,
    pregame_away_form        JSONB
);
CREATE INDEX idx_match_details_ls ON match_details (league_id, season_id);

-- ─── 球迷投票时间序列表 ──────────────────────────────────────
CREATE TABLE match_votes (
    id             BIGSERIAL PRIMARY KEY,
    match_id       INTEGER NOT NULL,        -- 软关联 schedules.match_id
    league_id      INTEGER,                 -- 查询入口：与 schedules.league_id 同值（复用 details.league.id）
    season_id      INTEGER,                 -- 查询入口：与 schedules.season_id 同值（复用 details 顶层 seasonId）
    snapshot_at    TIMESTAMPTZ NOT NULL,   -- 抓取时间点（历史回填=开赛时间，未来抓取=抓取端时间戳）
    vote_home      INTEGER,                -- votes.vote.vote1
    vote_draw      INTEGER,                -- votes.vote.vote2
    vote_away      INTEGER,                -- votes.vote.voteX
    both_yes       INTEGER,                -- votes.bothTeamsToScoreVote.voteYes
    both_no        INTEGER,                -- votes.bothTeamsToScoreVote.voteNo
    first_home     INTEGER,                -- votes.firstTeamToScoreVote.voteHome
    first_nogoal   INTEGER,                -- votes.firstTeamToScoreVote.voteNoGoal
    first_away     INTEGER,                -- votes.firstTeamToScoreVote.voteAway
    UNIQUE (match_id, snapshot_at)
);
CREATE INDEX idx_match_votes_ls ON match_votes (league_id, season_id, match_id);

-- ─── 伤停球员表 ──────────────────────────────────────────────
CREATE TABLE match_missing_players (
    id                BIGSERIAL PRIMARY KEY,
    match_id          INTEGER NOT NULL,      -- 软关联 schedules.match_id
    league_id         INTEGER,               -- 查询入口：与 schedules.league_id 同值（复用 details.league.id）
    season_id         INTEGER,               -- 查询入口：与 schedules.season_id 同值（复用 details 顶层 seasonId）
    is_home           BOOLEAN NOT NULL,     -- 主队缺阵?（lineups.home/away 下）
    player_id         INTEGER,              -- missingPlayers[].player.id
    player_name       TEXT NOT NULL,        -- missingPlayers[].player.name
    missing_type      TEXT,                 -- "missing"
    description       TEXT,                 -- "ACL Knee Injury" 等
    expected_end_date TIMESTAMPTZ           -- "2025-12-05T00:00:00+00:00"
);
CREATE INDEX idx_match_missing_ls     ON match_missing_players (league_id, season_id, match_id);
CREATE INDEX idx_match_missing_player ON match_missing_players (player_id);

-- ─── 球队比赛统计表 ──────────────────────────────────────────
CREATE TABLE match_statistics (
    match_id   INTEGER NOT NULL,           -- 软关联 schedules.match_id
    league_id  INTEGER,                    -- 查询入口：与 schedules.league_id 同值（复用 details.league.id）
    season_id  INTEGER,                    -- 查询入口：与 schedules.season_id 同值（复用 details 顶层 seasonId）
    is_home    BOOLEAN NOT NULL,          -- TRUE=主队 / FALSE=客队
    period     TEXT NOT NULL,             -- ALL / 1ST / 2ND（ET1/ET2 加时舍弃，竞彩 90 分钟结算）
    -- ============ 51 指标 value 列（statisticsItems.homeValue/awayValue 按 is_home 取对应侧）============
    -- 【核心档 15】覆盖 >90%
    total_shots            INTEGER,       -- Total shots 总射门
    corner_kicks           INTEGER,       -- Corner kicks 角球
    shots_on_target        INTEGER,       -- Shots on target 射正
    shots_off_target       INTEGER,       -- Shots off target 射偏
    free_kicks             INTEGER,       -- Free kicks 任意球
    fouls                  INTEGER,       -- Fouls 犯规
    throw_ins              INTEGER,       -- Throw-ins 界外球
    goal_kicks             INTEGER,       -- Goal kicks 球门球
    goalkeeper_saves       INTEGER,       -- Goalkeeper saves 门将扑救
    ball_possession        NUMERIC,       -- Ball possession 控球率
    yellow_cards           INTEGER,       -- Yellow cards 黄牌
    blocked_shots          INTEGER,       -- Blocked shots 封堵射门
    shots_inside_box       INTEGER,       -- Shots inside box 禁区内射门
    shots_outside_box      INTEGER,       -- Shots outside box 禁区外射门
    hit_woodwork           INTEGER,       -- Hit woodwork 击中门框
    -- 【重要档 20】覆盖 60-90%
    duels                  INTEGER,       -- Duels 对抗
    ground_duels           INTEGER,       -- Ground duels 地面对抗
    offsides               INTEGER,       -- Offsides 越位
    passes                 INTEGER,       -- Passes 传球
    accurate_passes        INTEGER,       -- Accurate passes 传球成功
    aerial_duels           INTEGER,       -- Aerial duels 空中对抗
    tackles                INTEGER,       -- Tackles 抢断
    total_tackles          INTEGER,       -- Total tackles 总抢断
    tackles_won            INTEGER,       -- Tackles won 抢断成功
    long_balls             INTEGER,       -- Long balls 长传
    crosses                INTEGER,       -- Crosses 传中
    dribbles               INTEGER,       -- Dribbles 过人
    interceptions          INTEGER,       -- Interceptions 拦截
    clearances             INTEGER,       -- Clearances 解围
    dispossessed           INTEGER,       -- Dispossessed 被抢断
    final_third_entries    INTEGER,       -- Final third entries 进入进攻三区
    fouled_in_final_third  INTEGER,       -- Fouled in final third 进攻三区被犯规
    big_chances            INTEGER,       -- Big chances 大机会
    big_chances_missed     INTEGER,       -- Big chances missed 错失大机会
    big_chances_scored     INTEGER,       -- Big chances scored 大机会进球
    -- 【低覆盖有独特价值 2】
    expected_goals         NUMERIC,       -- Expected goals 期望进球 xG
    red_cards              INTEGER,       -- Red cards 红牌
    -- 【次要档 14】覆盖 <60%
    through_balls          INTEGER,       -- Through balls 直塞球
    recoveries             INTEGER,       -- Recoveries 夺回球权
    goals_prevented        NUMERIC,       -- Goals prevented 阻止进球
    final_third_phase      INTEGER,       -- Final third phase 进攻三区推进
    touches_in_penalty_area INTEGER,      -- Touches in penalty area 禁区内触球
    distance_covered       NUMERIC,       -- Distance covered 跑动距离(km)
    number_of_sprints      INTEGER,       -- Number of sprints 冲刺次数
    high_claims            INTEGER,       -- High claims 高空球接获
    big_saves              INTEGER,       -- Big saves 关键扑救
    errors_lead_to_shot    INTEGER,       -- Errors lead to a shot 失误致射
    punches                INTEGER,       -- Punches 拳击球
    errors_lead_to_goal    INTEGER,       -- Errors lead to a goal 失误致丢球
    penalty_saves          INTEGER,       -- Penalty saves 扑出点球
    -- ============ 6 个复合分数指标 text 列（保真原始文本，查询时解析分母/百分比）============
    ground_duels_text      TEXT,          -- 如 "37/65 (57%)"
    aerial_duels_text      TEXT,          -- 如 "16/28 (57%)"
    long_balls_text        TEXT,          -- 如 "22/71 (31%)"
    crosses_text           TEXT,          -- 如 "5/19 (26%)"
    dribbles_text          TEXT,          -- 如 "5/13 (38%)"
    final_third_phase_text TEXT,          -- 如 "60/108 (56%)"
    PRIMARY KEY (match_id, is_home, period)
);
CREATE INDEX idx_match_statistics_ls ON match_statistics (league_id, season_id, match_id);

-- ─── 球队赛季统计表 ──────────────────────────────────────────
CREATE TABLE team_season_stats (
    team_id    INTEGER NOT NULL,       -- 原生 teamId，软关联 teams.team_id
    league_id  INTEGER NOT NULL,       -- 原生 leagueId，软关联 leagues（查询入口）
    season_id  INTEGER NOT NULL,       -- 原生 seasonId，软关联 seasons（查询入口）
    -- ==== 元数据（statistics.*）====
    matches         INTEGER,           -- statistics.matches 源站统计的场次数（可用于校验）
    awarded_matches INTEGER,           -- statistics.awardedMatches 判给场次
    -- ==== 进攻 ====
    goals_scored             INTEGER,  -- goalsScored 进球数
    goals_conceded           INTEGER,  -- goalsConceded 失球数
    own_goals                INTEGER,  -- ownGoals 乌龙球数
    assists                  INTEGER,  -- assists 助攻数
    penalty_goals            INTEGER,  -- penaltyGoals 点球进球
    penalties_taken          INTEGER,  -- penaltiesTaken 点球主罚次数
    free_kick_goals          INTEGER,  -- freeKickGoals 任意球进球
    free_kick_shots          INTEGER,  -- freeKickShots 任意球射门
    goals_from_inside_the_box    INTEGER,  -- goalsFromInsideTheBox 禁区内进球
    goals_from_outside_the_box   INTEGER,  -- goalsFromOutsideTheBox 禁区外进球
    headed_goals             INTEGER,  -- headedGoals 头球进球
    left_foot_goals          INTEGER,  -- leftFootGoals 左脚进球
    right_foot_goals         INTEGER,  -- rightFootGoals 右脚进球
    big_chances_created      INTEGER,  -- bigChancesCreated 创造的大机会
    -- ==== 射门 ====
    shots                    INTEGER,  -- shots 总射门
    shots_on_target          INTEGER,  -- shotsOnTarget 射正
    shots_off_target         INTEGER,  -- shotsOffTarget 射偏
    shots_from_inside_the_box    INTEGER,  -- shotsFromInsideTheBox 禁区内射门
    shots_from_outside_the_box   INTEGER,  -- shotsFromOutsideTheBox 禁区外射门
    blocked_scoring_attempt  INTEGER,  -- blockedScoringAttempt 被封堵的射门
    hit_woodwork             INTEGER,  -- hitWoodwork 击中门框
    big_chances              INTEGER,  -- bigChances 大机会
    big_chances_missed       INTEGER,  -- bigChancesMissed 错失大机会
    -- ==== 过人 / 定位球 ====
    successful_dribbles      INTEGER,  -- successfulDribbles 成功过人
    dribble_attempts         INTEGER,  -- dribbleAttempts 过人尝试次数
    corners                  INTEGER,  -- corners 角球数
    free_kicks               INTEGER,  -- freeKicks 获得的任意球
    throw_ins                INTEGER,  -- throwIns 界外球
    goal_kicks               INTEGER,  -- goalKicks 球门球
    -- ==== 快攻 ====
    fast_breaks              INTEGER,  -- fastBreaks 快攻次数
    fast_break_shots         INTEGER,  -- fastBreakShots 快攻射门
    fast_break_goals         INTEGER,  -- fastBreakGoals 快攻进球
    -- ==== 控球与传球 ====
    average_ball_possession  NUMERIC,  -- averageBallPossession 平均控球率(%)
    total_passes             INTEGER,  -- totalPasses 总传球
    accurate_passes          INTEGER,  -- accuratePasses 成功传球
    accurate_passes_percentage       NUMERIC,  -- accuratePassesPercentage 传球成功率(%)
    total_own_half_passes    INTEGER,  -- totalOwnHalfPasses 本方半场总传球
    accurate_own_half_passes INTEGER,  -- accurateOwnHalfPasses 本方半场成功传球
    accurate_own_half_passes_percentage  NUMERIC,  -- accurateOwnHalfPassesPercentage 本方半场传球成功率(%)
    total_opposition_half_passes INTEGER,  -- totalOppositionHalfPasses 对方半场总传球
    accurate_opposition_half_passes   INTEGER,  -- accurateOppositionHalfPasses 对方半场成功传球
    accurate_opposition_half_passes_percentage NUMERIC,  -- accurateOppositionHalfPassesPercentage 对方半场传球成功率(%)
    total_long_balls         INTEGER,  -- totalLongBalls 总长传
    accurate_long_balls      INTEGER,  -- accurateLongBalls 成功长传
    accurate_long_balls_percentage    NUMERIC,  -- accurateLongBallsPercentage 长传成功率(%)
    total_crosses            INTEGER,  -- totalCrosses 总传中
    accurate_crosses         INTEGER,  -- accurateCrosses 成功传中
    accurate_crosses_percentage       NUMERIC,  -- accurateCrossesPercentage 传中成功率(%)
    -- ==== 防守 ====
    clean_sheets             INTEGER,  -- cleanSheets 零封场次
    tackles                  INTEGER,  -- tackles 抢断
    interceptions            INTEGER,  -- interceptions 拦截
    saves                    INTEGER,  -- saves 扑救（门将）
    errors_leading_to_goal   INTEGER,  -- errorsLeadingToGoal 失误致丢球
    errors_leading_to_shot   INTEGER,  -- errorsLeadingToShot 失误致对方射门
    penalties_commited       INTEGER,  -- penaltiesCommited 被判点球次数
    penalty_goals_conceded   INTEGER,  -- penaltyGoalsConceded 点球失球
    clearances               INTEGER,  -- clearances 解围
    clearances_off_line      INTEGER,  -- clearancesOffLine 门线解围
    last_man_tackles         INTEGER,  -- lastManTackles 最后一人抢断
    total_duels              INTEGER,  -- totalDuels 总对抗
    duels_won                INTEGER,  -- duelsWon 对抗获胜
    duels_won_percentage     NUMERIC,  -- duelsWonPercentage 对抗胜率(%)
    total_ground_duels       INTEGER,  -- totalGroundDuels 总地面对抗
    ground_duels_won         INTEGER,  -- groundDuelsWon 地面对抗获胜
    ground_duels_won_percentage NUMERIC,  -- groundDuelsWonPercentage 地面对抗胜率(%)
    total_aerial_duels       INTEGER,  -- totalAerialDuels 总空中对抗
    aerial_duels_won         INTEGER,  -- aerialDuelsWon 空中对抗获胜
    aerial_duels_won_percentage      NUMERIC,  -- aerialDuelsWonPercentage 空中对抗胜率(%)
    possession_lost          INTEGER,  -- possessionLost 失去球权
    ball_recovery            INTEGER,  -- ballRecovery 夺回球权
    -- ==== 纪律 ====
    offsides                 INTEGER,  -- offsides 越位
    fouls                    INTEGER,  -- fouls 犯规
    yellow_cards             INTEGER,  -- yellowCards 黄牌
    yellow_red_cards         INTEGER,  -- yellowRedCards 两黄变一红
    red_cards                INTEGER,  -- redCards 红牌
    -- ==== 其他 ====
    avg_rating               NUMERIC,  -- avgRating 平均评分
    kilometers_covered       NUMERIC,  -- kilometersCovered 跑动距离(km)
    number_of_sprints        INTEGER,  -- numberOfSprints 冲刺次数
    -- ==== 对手视角（Against，指标名含 Against 前缀）====
    shots_against                    INTEGER,  -- shotsAgainst 对手总射门
    shots_on_target_against          INTEGER,  -- shotsOnTargetAgainst 对手射正
    shots_off_target_against         INTEGER,  -- shotsOffTargetAgainst 对手射偏
    shots_blocked_against            INTEGER,  -- shotsBlockedAgainst 对手被封堵射门
    shots_from_inside_the_box_against    INTEGER,  -- shotsFromInsideTheBoxAgainst 对手禁区内射门
    shots_from_outside_the_box_against   INTEGER,  -- shotsFromOutsideTheBoxAgainst 对手禁区外射门
    corners_against                  INTEGER,  -- cornersAgainst 对手角球
    hit_woodwork_against             INTEGER,  -- hitWoodworkAgainst 对手击中门框
    blocked_scoring_attempt_against  INTEGER,  -- blockedScoringAttemptAgainst 对手被封堵射门
    big_chances_against              INTEGER,  -- bigChancesAgainst 对手大机会
    big_chances_created_against      INTEGER,  -- bigChancesCreatedAgainst 对手创造大机会
    big_chances_missed_against       INTEGER,  -- bigChancesMissedAgainst 对手错失大机会
    crosses_successful_against       INTEGER,  -- crossesSuccessfulAgainst 对手成功传中
    crosses_total_against            INTEGER,  -- crossesTotalAgainst 对手总传中
    dribble_attempts_total_against   INTEGER,  -- dribbleAttemptsTotalAgainst 对手过人尝试
    dribble_attempts_won_against     INTEGER,  -- dribbleAttemptsWonAgainst 对手成功过人
    long_balls_successful_against    INTEGER,  -- longBallsSuccessfulAgainst 对手成功长传
    long_balls_total_against         INTEGER,  -- longBallsTotalAgainst 对手总长传
    offsides_against                 INTEGER,  -- offsidesAgainst 对手越位
    red_cards_against                INTEGER,  -- redCardsAgainst 对手红牌
    yellow_cards_against             INTEGER,  -- yellowCardsAgainst 对手黄牌
    tackles_against                  INTEGER,  -- tacklesAgainst 对手抢断
    interceptions_against            INTEGER,  -- interceptionsAgainst 对手拦截
    clearances_against               INTEGER,  -- clearancesAgainst 对手解围
    errors_leading_to_goal_against   INTEGER,  -- errorsLeadingToGoalAgainst 对手失误致丢球
    errors_leading_to_shot_against   INTEGER,  -- errorsLeadingToShotAgainst 对手失误致射门
    key_passes_against               INTEGER,  -- keyPassesAgainst 对手关键传球
    total_passes_against             INTEGER,  -- totalPassesAgainst 对手总传球
    accurate_passes_against          INTEGER,  -- accuratePassesAgainst 对手成功传球
    accurate_own_half_passes_against INTEGER,  -- accurateOwnHalfPassesAgainst 对手本方半场成功传球
    accurate_opposition_half_passes_against INTEGER,  -- accurateOppositionHalfPassesAgainst 对手对方半场成功传球
    own_half_passes_total_against    INTEGER,  -- ownHalfPassesTotalAgainst 对手本方半场总传球
    opposition_half_passes_total_against INTEGER,  -- oppositionHalfPassesTotalAgainst 对手对方半场总传球
    accurate_final_third_passes_against INTEGER,  -- accurateFinalThirdPassesAgainst 对手进攻三区成功传球
    total_final_third_passes_against INTEGER,  -- totalFinalThirdPassesAgainst 对手进攻三区总传球
    PRIMARY KEY (team_id, season_id)
);
CREATE INDEX idx_team_season_stats_ls ON team_season_stats (league_id, season_id);

-- ─── 权限：api_service 只读 ──────────────────────────────────
GRANT SELECT ON ALL TABLES IN SCHEMA public TO api_service;
GRANT USAGE ON SCHEMA public TO api_service;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO api_service;
