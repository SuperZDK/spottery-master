-- ============================================================
-- titan 源库 schema（球探）
-- 来源：docs/titan007-database.md 已定稿 DDL（1.0 版原样）
-- 8 张表：competitions/teams/companies/schedules/euro_odds/
--        asian_odds/over_under_odds/analysis
-- 末尾追加权限：crawler_titan 全权限（OWNER 自动拥有），
--              api_service 只读（架构文档 6.2）
-- ============================================================

-- ─── 联赛维度表 ──────────────────────────────────────────────
CREATE TABLE titan_competitions (
    competition_id   INTEGER PRIMARY KEY,   -- 球探联赛编码
    name_cn          TEXT,                  -- competition_name_cn（德乙）
    name_en          TEXT,                  -- competition_name_en（2. Bundesliga）
    is_cup           BOOLEAN NOT NULL,      -- leagues / cups 目录推导
    updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ─── 球队维度表 ──────────────────────────────────────────────
CREATE TABLE titan_teams (
    team_id      INTEGER PRIMARY KEY,       -- 球探球队编码
    name_cn      TEXT,                      -- home_team / away_team 中文名
    name_en      TEXT,                      -- home_team_en / away_team_en 英文名
    updated_at   TIMESTAMPTZ DEFAULT now()
);

-- ─── 公司维度表 ──────────────────────────────────────────────
CREATE TABLE titan_companies (
    company_id       INTEGER PRIMARY KEY,   -- 球探公司编码
    name             TEXT,                  -- company_name（betfair / 澳门 / 365 / ...）
    odds_category    TEXT[] NOT NULL,       -- ['european'] / ['asian','over_under']（一家可属多类）
    updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ─── 赛程主表 ────────────────────────────────────────────────
CREATE TABLE titan_schedules (
    schedule_id         INTEGER PRIMARY KEY,   -- matches[].schedule_id
    competition_id      INTEGER NOT NULL,      -- 顶层 competition_id（冗余，查询入口）
    competition_name_cn TEXT,                  -- 顶层 competition_name_cn（冗余）
    competition_name_en TEXT,                  -- 顶层 competition_name_en（冗余）
    season              TEXT NOT NULL,         -- 顶层 season
    is_cup              BOOLEAN NOT NULL,      -- leagues / cups 目录推导
    group_name          TEXT,                  -- matches[].group_name
    round_name          TEXT,                  -- matches[].round_name
    sub_league_id       INTEGER,               -- matches[].sub_league_id（阶段编码，110 值）
    match_time          TIMESTAMPTZ NOT NULL,  -- matches[].match_time（"2015-07-25 02:30"）
    home_team_id        INTEGER,               -- matches[].home_team_id
    away_team_id        INTEGER,
    home_team           TEXT,                  -- matches[].home_team（冗余中文名）
    away_team           TEXT,
    home_team_en        TEXT,                  -- matches[].home_team_en（冗余英文名）
    away_team_en        TEXT,
    full_score          TEXT,                  -- matches[].full_score（"1-3"）
    half_score          TEXT,                  -- matches[].half_score（"0-3"）
    status              INTEGER,               -- 0=已完赛 1=未开赛 -1=延期 2=进行中
    scraped_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_titan_sched_comp_season ON titan_schedules (competition_id, season);
CREATE INDEX idx_titan_sched_time        ON titan_schedules (match_time);
CREATE INDEX idx_titan_sched_home_team   ON titan_schedules (home_team_id);
CREATE INDEX idx_titan_sched_away_team   ON titan_schedules (away_team_id);

-- ─── 欧赔快照表 ──────────────────────────────────────────────
CREATE TABLE titan_euro_odds (
    id             BIGSERIAL PRIMARY KEY,   -- 代理主键（无业务含义）
    schedule_id    INTEGER NOT NULL,        -- 关联 titan_schedules
    company_id     INTEGER NOT NULL,        -- 关联 titan_companies
    change_time    TIMESTAMPTZ NOT NULL,    -- changes[].time 推断年份后转化
    home_win       NUMERIC,                 -- 主胜赔率
    draw           NUMERIC,                 -- 平赔率
    away_win       NUMERIC,                 -- 客胜赔率
    home_win_rate  NUMERIC,                 -- 胜率（37.89 → 0.3789）
    draw_rate      NUMERIC,
    away_win_rate  NUMERIC,
    payout_rate    NUMERIC,                 -- 返还率
    kelly_home     NUMERIC,                 -- 凯利指数
    kelly_draw     NUMERIC,
    kelly_away     NUMERIC,
    is_initial     BOOLEAN,                 -- 初盘标记（changes[].is_initial 或 (初盘) 后缀）
    UNIQUE (schedule_id, company_id, change_time, home_win, draw, away_win)
);
CREATE INDEX idx_titan_euro_odds_comp  ON titan_euro_odds (company_id);
CREATE INDEX idx_titan_euro_odds_time  ON titan_euro_odds (change_time);

-- ─── 亚盘快照表 ──────────────────────────────────────────────
CREATE TABLE titan_asian_odds (
    id             BIGSERIAL PRIMARY KEY,   -- 代理主键（无业务含义）
    schedule_id    INTEGER NOT NULL,
    company_id     INTEGER NOT NULL,
    subtype        TEXT NOT NULL DEFAULT 'full',   -- 'full' 当前恒值，为 half 预留
    change_time    TIMESTAMPTZ NOT NULL,           -- changes[].time 推断年份后转化
    line_raw       TEXT NOT NULL,                  -- 盘口中文原串（"平手/半球"、"受让半球"）
    line_value     NUMERIC,                        -- 盘口映射数值（0.25 / -0.5 / ...）
    home_odds      NUMERIC,                        -- 主水
    away_odds      NUMERIC,                        -- 客水
    status         TEXT,                           -- changes[].status（"即" / "早"）
    UNIQUE (schedule_id, company_id, subtype, change_time, line_raw, home_odds, away_odds)
);
CREATE INDEX idx_titan_asian_odds_comp ON titan_asian_odds (company_id);
CREATE INDEX idx_titan_asian_odds_time ON titan_asian_odds (change_time);

-- ─── 大小球快照表 ────────────────────────────────────────────
CREATE TABLE titan_over_under_odds (
    id             BIGSERIAL PRIMARY KEY,   -- 代理主键（无业务含义）
    schedule_id    INTEGER NOT NULL,
    company_id     INTEGER NOT NULL,
    subtype        TEXT NOT NULL,              -- 'full' / 'half'
    change_time    TIMESTAMPTZ NOT NULL,       -- changes[].time 推断年份后转化
    score          TEXT,                       -- changes[].score（多为空，即时段位）
    line_raw       TEXT NOT NULL,              -- 盘口（"2.5" / "2/2.5" / "1"）
    over_odds      NUMERIC,                    -- 大水
    under_odds     NUMERIC,                    -- 小水
    status         TEXT,                       -- changes[].status（"即" / "早"）
    UNIQUE (schedule_id, company_id, subtype, change_time, line_raw, over_odds, under_odds)
);
CREATE INDEX idx_titan_ou_odds_comp ON titan_over_under_odds (company_id);
CREATE INDEX idx_titan_ou_odds_time ON titan_over_under_odds (change_time);

-- ─── 竞彩开设赛程镜像 ────────────────────────────────────────
-- 来源：jc/history/{date}.json（titan 视角的竞彩赛程，70,337 场，sid 全局唯一）
-- 定位：支撑赛事中心"标记是否竞彩开设"；与"竞彩赔率不进球探库"不冲突（存赛程/比分，非赔率）
-- match_map/team_map 为派生产物，不落库；跨源对齐键 = (business_date, match_num)
CREATE TABLE titan_jc_schedule (
    sid             INTEGER PRIMARY KEY,   -- titan 比赛 id（history 全局唯一）
    business_date   DATE NOT NULL,         -- 竞彩销售日
    kickoff_time    TIMESTAMP,             -- kickoff（"2026-08-01 18:30"）
    status          SMALLINT,              -- -1 完场；-10 异常
    match_num       TEXT,                  -- "周六001"（= 竞彩编号，可 JOIN jingcai_schedules）
    sclass_id       INTEGER,               -- 软关联 titan_competitions
    sub_id          INTEGER,               -- 阶段/子联赛
    home_team_id    INTEGER,               -- 软关联 titan_teams
    away_team_id    INTEGER,
    home_team       TEXT,                  -- 简体名
    away_team       TEXT,
    home_team_en    TEXT,                  -- 英文名
    away_team_en    TEXT,
    full_score      TEXT,                  -- "0-3"
    half_score      TEXT,                  -- "0-1"
    home_score      INTEGER,               -- 由 full_score 拆出
    away_score      INTEGER,
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_titan_jc_schedule_business_date ON titan_jc_schedule (business_date);
CREATE INDEX idx_titan_jc_schedule_sclass ON titan_jc_schedule (sclass_id);

-- ─── 赛前分析三表（改造版，替代旧 titan_analysis 单表） ──────
-- 主表 titan_analysis_matches：每场一行，比赛信息 + 赛前情报（心水重点）+ standings/lineup JSONB。
-- h2h / recent 拆表：每条交锋/近期记录一行，带 sclass_id（爬取时按 ignore_sclass 过滤野鸡赛）。
-- id = 自增主键（纯技术）；schedule_id = 本场 sid；ref_schedule_id = 历史记录场次自己的 sid。

-- ─── 主表：每场分析 ───────────────────────────────────────────
CREATE TABLE titan_analysis_matches (
    schedule_id        INTEGER PRIMARY KEY,   -- 本场 titan sid
    competition_id     INTEGER,               -- 本场赛事 id（原 sclass_id，语义更明确）
    competition_name_cn TEXT,                 -- 赛事中文名（冗余）
    home_team_id       INTEGER,
    away_team_id       INTEGER,
    home_team          TEXT,
    away_team          TEXT,
    match_time         TIMESTAMPTZ,
    standings          JSONB,                 -- 积分榜
    -- 心水推荐/媒体分析（nowscore 补充）
    media_home_trend   TEXT,                  -- 主队近况走势
    media_home_path    TEXT,                  -- 主队盘路
    media_away_trend   TEXT,                  -- 客队近况走势
    media_away_path    TEXT,                  -- 客队盘路
    confidence_index   TEXT,                  -- 信心指数
    h2h_record         TEXT,                  -- 对赛成绩
    media_analysis     TEXT,                  -- 媒体分析正文
    scraped_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_am_sclass ON titan_analysis_matches (sclass_id);
CREATE INDEX idx_am_time  ON titan_analysis_matches (match_time);

-- ─── 交锋记录表（每条一行） ───────────────────────────────────
CREATE TABLE titan_analysis_h2h (
    id             BIGSERIAL PRIMARY KEY,
    schedule_id    INTEGER NOT NULL,          -- 本场 sid（关联主表）
    match_date     DATE,
    sclass_id      INTEGER,                   -- 交锋赛事 id（过滤野鸡）
    home_team_id   INTEGER,
    away_team_id   INTEGER,
    home_team      TEXT,
    away_team      TEXT,
    home_score     INTEGER,
    away_score     INTEGER,
    half_score     TEXT,                  -- 半场比分（"1-0"）
    ref_schedule_id INTEGER,                  -- 历史交锋场次自己的 sid
    UNIQUE (schedule_id, match_date, home_team_id, away_team_id)
);
CREATE INDEX idx_ah_sched ON titan_analysis_h2h (schedule_id);
CREATE INDEX idx_ah_sclass ON titan_analysis_h2h (sclass_id);

-- ─── 近期战绩表（每条一行） ───────────────────────────────────
CREATE TABLE titan_analysis_recent (
    id             BIGSERIAL PRIMARY KEY,
    schedule_id    INTEGER NOT NULL,          -- 本场 sid（关联主表）
    side           TEXT NOT NULL,             -- 'home' / 'away'
    match_date     DATE,
    sclass_id      INTEGER,                   -- 赛事 id（过滤野鸡）
    home_team_id   INTEGER,
    away_team_id   INTEGER,
    home_team      TEXT,
    away_team      TEXT,
    home_score     INTEGER,
    away_score     INTEGER,
    half_score     TEXT,                  -- 半场比分（"0-2"）
    ref_schedule_id INTEGER,                  -- 历史场次自己的 sid
    UNIQUE (schedule_id, side, match_date, home_team_id, away_team_id)
);
CREATE INDEX idx_ar_sched ON titan_analysis_recent (schedule_id);
CREATE INDEX idx_ar_sclass ON titan_analysis_recent (sclass_id);

-- ─── 权限：api_service 只读 ──────────────────────────────────
GRANT SELECT ON ALL TABLES IN SCHEMA public TO api_service;
-- titan_jc_schedule 建表晚于上面的快照授权，显式补授（live 库已执行同款）
GRANT SELECT ON titan_jc_schedule TO api_service;
GRANT USAGE ON SCHEMA public TO api_service;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO api_service;
