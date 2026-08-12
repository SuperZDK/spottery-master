-- ============================================================
-- sporttery 源库 schema（竞彩）
-- 来源：docs/jingcai-database.md 已定稿 DDL（1.0 版原样）
-- 8 张表：jingcai_schedules / jingcai_votes / jingcai_odds_spf /
--        jingcai_odds_rqspf / jingcai_odds_ttg / jingcai_odds_hafu /
--        jingcai_odds_crs / jingcai_pools
-- 表名保留 jingcai_* 前缀（与源数据/API 引用一致）
-- 末尾追加权限：crawler_sporttery 全权限（OWNER 自动拥有），
--              api_service 只读（架构文档 6.2）
-- ============================================================

-- ─── 竞彩比赛主表 ────────────────────────────────────────────
CREATE TABLE jingcai_schedules (
    match_id       INTEGER PRIMARY KEY,   -- daily.matchId = 详情文件名（sportteryMatchId）
    business_date  DATE NOT NULL,         -- daily.businessDate 销售日（开售日期）
    match_date     DATE NOT NULL,         -- daily.matchDate 比赛日期
    match_num      TEXT NOT NULL,         -- daily.matchNum（如 "周六012"）
    home_team      TEXT NOT NULL,         -- daily.homeTeam
    away_team      TEXT NOT NULL,         -- daily.awayTeam
    league         TEXT,                  -- daily.league（= matchInfo.tournamentCnName）
    home_score     INTEGER,               -- daily.matchResult.homeScore
    away_score     INTEGER,               -- daily.matchResult.awayScore
    pool_status    TEXT,                  -- daily.poolStatus（Payout / Refund）
    kickoff_time   TIMESTAMP,             -- matchInfo.matchDateTime（"2017-10-28 19:00"）
    single_spf     INTEGER,               -- oddsHistory.singleList 中 HAD 的 single
    single_rqspf   INTEGER,               -- oddsHistory.singleList 中 HHAD 的 single
    single_ttg     INTEGER,               -- oddsHistory.singleList 中 TTG 的 single
    single_hafu    INTEGER,               -- oddsHistory.singleList 中 HAFU 的 single
    single_crs     INTEGER,               -- oddsHistory.singleList 中 CRS 的 single
    scraped_at     TIMESTAMP              -- matches 详情顶层 scrapedAt
);
CREATE INDEX idx_jingcai_schedules_business_date ON jingcai_schedules (business_date);
CREATE INDEX idx_jingcai_schedules_match_date   ON jingcai_schedules (match_date);
CREATE INDEX idx_jingcai_schedules_league       ON jingcai_schedules (league);
CREATE INDEX idx_jingcai_schedules_team_pair    ON jingcai_schedules (home_team, away_team);

-- ─── 竞彩投票时间序列表 ──────────────────────────────────────
CREATE TABLE jingcai_votes (
    id                BIGSERIAL PRIMARY KEY,   -- 代理主键（时间序列无天然业务主键）
    match_id          INTEGER NOT NULL,        -- daily.matchId
    pool              TEXT NOT NULL,           -- 'HAD' | 'RQSPF'
    snapshot_at       TIMESTAMP NOT NULL,      -- 历史基线=开售日停售时间点；未来=抓取端时间戳
    goal_line         INTEGER,                 -- 仅 RQSPF 有值（-3..+3）；HAD 恒空
    odds_home         NUMERIC,                 -- had.odds / handicap.odds（主胜）
    odds_draw         NUMERIC,                 -- 平
    odds_away         NUMERIC,                 -- 客胜
    support_rate_home NUMERIC,                 -- supportRate "27%" → 0.27
    support_rate_draw NUMERIC,                 -- "27%" → 0.27
    support_rate_away NUMERIC,                 -- "46%" → 0.46
    probability_home  NUMERIC,                 -- probability "26%" → 0.26
    probability_draw  NUMERIC,                 -- "26%" → 0.26
    probability_away  NUMERIC,                 -- "48%" → 0.48
    error_home        NUMERIC,                 -- error "1%" → 0.01（可为负）
    error_draw        NUMERIC,                 -- 可为负
    error_away        NUMERIC,                 -- 可为负
    voters_home       INTEGER,                 -- voters（支持率对应池的投票数）
    voters_draw       INTEGER,
    voters_away       INTEGER,
    psy_error         INTEGER,                 -- 心理误差档位 0/1/2
    result            TEXT,                    -- had.result / handicap.result（home/draw/away）
    UNIQUE (match_id, pool, snapshot_at)
);
CREATE INDEX idx_jingcai_votes_match_pool ON jingcai_votes (match_id, pool);

-- ─── 胜平负赔率快照 ──────────────────────────────────────────
CREATE TABLE jingcai_odds_spf (
    match_id     INTEGER NOT NULL,    -- 详情文件 sportteryMatchId
    snapshot_at  TIMESTAMP NOT NULL,  -- updateDate + updateTime 拼接
    odds_home    NUMERIC,             -- hf 对应值，取官方 h
    odds_draw    NUMERIC,             -- d
    odds_away    NUMERIC,             -- a
    PRIMARY KEY (match_id, snapshot_at)
);

-- ─── 让球胜平负赔率快照 ──────────────────────────────────────
CREATE TABLE jingcai_odds_rqspf (
    match_id     INTEGER NOT NULL,
    snapshot_at  TIMESTAMP NOT NULL,
    goal_line    INTEGER,             -- hhadList.goalLine（-3..+3）
    odds_home    NUMERIC,
    odds_draw    NUMERIC,
    odds_away    NUMERIC,
    PRIMARY KEY (match_id, snapshot_at)
);

-- ─── 总进球赔率快照 ──────────────────────────────────────────
CREATE TABLE jingcai_odds_ttg (
    match_id     INTEGER NOT NULL,
    snapshot_at  TIMESTAMP NOT NULL,
    odds_0       NUMERIC,             -- s0（0 球）
    odds_1       NUMERIC,             -- s1
    odds_2       NUMERIC,             -- s2
    odds_3       NUMERIC,             -- s3
    odds_4       NUMERIC,             -- s4
    odds_5       NUMERIC,             -- s5
    odds_6       NUMERIC,             -- s6
    odds_7       NUMERIC,             -- s7（7+ 球）
    PRIMARY KEY (match_id, snapshot_at)
);

-- ─── 半全场赔率快照 ──────────────────────────────────────────
CREATE TABLE jingcai_odds_hafu (
    match_id     INTEGER NOT NULL,
    snapshot_at  TIMESTAMP NOT NULL,
    odds_hh      NUMERIC,             -- 胜/胜
    odds_hd      NUMERIC,             -- 胜/平
    odds_ha      NUMERIC,             -- 胜/负
    odds_dh      NUMERIC,             -- 平/胜
    odds_dd      NUMERIC,             -- 平/平
    odds_da      NUMERIC,             -- 平/负
    odds_ah      NUMERIC,             -- 负/胜
    odds_ad      NUMERIC,             -- 负/平
    odds_aa      NUMERIC,             -- 负/负
    PRIMARY KEY (match_id, snapshot_at)
);

-- ─── 比分赔率快照 ────────────────────────────────────────────
CREATE TABLE jingcai_odds_crs (
    match_id      INTEGER NOT NULL,
    snapshot_at   TIMESTAMP NOT NULL,
    odds_s00s00   NUMERIC,             -- 0:0
    odds_s00s01   NUMERIC,             -- 0:1
    odds_s00s02   NUMERIC,             -- 0:2
    odds_s00s03   NUMERIC,             -- 0:3
    odds_s00s04   NUMERIC,             -- 0:4
    odds_s00s05   NUMERIC,             -- 0:5
    odds_s01s00   NUMERIC,             -- 1:0
    odds_s01s01   NUMERIC,             -- 1:1
    odds_s01s02   NUMERIC,             -- 1:2
    odds_s01s03   NUMERIC,             -- 1:3
    odds_s01s04   NUMERIC,             -- 1:4
    odds_s01s05   NUMERIC,             -- 1:5
    odds_s02s00   NUMERIC,             -- 2:0
    odds_s02s01   NUMERIC,             -- 2:1
    odds_s02s02   NUMERIC,             -- 2:2
    odds_s02s03   NUMERIC,             -- 2:3
    odds_s02s04   NUMERIC,             -- 2:4
    odds_s02s05   NUMERIC,             -- 2:5
    odds_s03s00   NUMERIC,             -- 3:0
    odds_s03s01   NUMERIC,             -- 3:1
    odds_s03s02   NUMERIC,             -- 3:2
    odds_s03s03   NUMERIC,             -- 3:3
    odds_s03s04   NUMERIC,             -- 3:4
    odds_s03s05   NUMERIC,             -- 3:5
    odds_s04s00   NUMERIC,             -- 4:0
    odds_s04s01   NUMERIC,             -- 4:1
    odds_s04s02   NUMERIC,             -- 4:2
    odds_s04s03   NUMERIC,             -- 4:3
    odds_s04s04   NUMERIC,             -- 4:4
    odds_s04s05   NUMERIC,             -- 4:5
    odds_s05s05   NUMERIC,             -- 5:5
    "odds_s-1sh"  NUMERIC,             -- 胜其他
    "odds_s-1sd"  NUMERIC,             -- 平其他
    "odds_s-1sa"  NUMERIC,             -- 负其他
    PRIMARY KEY (match_id, snapshot_at)
);

-- ─── 奖池表 ──────────────────────────────────────────────────
CREATE TABLE jingcai_pools (
    match_id          INTEGER NOT NULL,   -- 详情文件 sportteryMatchId
    pool              TEXT NOT NULL,      -- code（HAD / HHAD / CRS / TTG / HAFU）
    combination       TEXT,               -- combination（"H" / "3:1" / "4" / "H:H"）
    combination_desc  TEXT,               -- combinationDesc（组合中文描述）
    goal_line         INTEGER,            -- goalLine（仅 HHAD 有值 -2..+2，其余恒空）
    odds              NUMERIC,            -- odds（最终赔率 "4.05"）
    pool_id           INTEGER,            -- poolId（奖池 ID）
    pool_totals       BIGINT,             -- poolTotals（奖池总额，0=未结算/无总额）
    PRIMARY KEY (match_id, pool)
);

-- ─── 权限：api_service 只读 ──────────────────────────────────
GRANT SELECT ON ALL TABLES IN SCHEMA public TO api_service;
GRANT USAGE ON SCHEMA public TO api_service;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO api_service;
