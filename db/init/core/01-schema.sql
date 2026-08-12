-- ============================================================
-- core 聚合/平台库
-- 当前阶段：跨源映射表（mapping 维护项目写入，api_service 读写）
-- unified_* / aggregated_* 等聚合表在聚合引擎阶段创建。
-- ============================================================

-- ─── 平台用户（认证：登录/注册/个人中心）────────────────────────
-- 内容接口全公开只读；登录仅用于认证与控制面。
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'FREE',   -- FREE / VIP / ADMIN
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 跨源球队映射 ────────────────────────────────────────────
-- 一行 = 一个真实球队，sofaid（sofascore 球队 id）为主键锚点。
-- 某源字段为空 = 该源无此队数据。对齐只用 id；名字列是展示/维护便利。
CREATE TABLE cross_source_teams (
    sofaid       INTEGER PRIMARY KEY,   -- sofascore 球队 id（锚点）
    sofascoreen  TEXT NOT NULL,         -- sofascore entity.name（英文名）
    sofacode     TEXT,                  -- sofascore entity.nameCode（如 "VFB"）
    sofaslug     TEXT,                  -- sofascore entity.slug（如 "vfb-stuttgart"）
    sofanational BOOLEAN,               -- sofascore entity.national（国家队标记）
    titanid      INTEGER UNIQUE,        -- titan 球队 id（空=无此队）
    titancn      TEXT,                  -- titan 中文名（name_cn）
    titanen      TEXT,                  -- titan 英文名（tdl{id}.js 抓取）
    jingcainame  TEXT,                  -- 竞彩队名（竞彩无 id，阶段二填）
    updated_at   TIMESTAMPTZ DEFAULT now()
);

-- ─── 跨源联赛映射 ────────────────────────────────────────────
-- 一行 = 一个真实联赛，titanid（titan 联赛 id）为主键锚点。
-- titan 侧竞彩涉及 134 个联赛（全量入表）；sofaid 可空（仅 29 个 sofascore 覆盖）；
-- jingcainame 由 build-match-map.ts 的知识库映射表（LEAGUE_JC_ALIAS）填充，空=竞彩无对应。
CREATE TABLE cross_source_leagues (
    titanid      INTEGER PRIMARY KEY,   -- titan 联赛 id（锚点，134 个全）
    titancn      TEXT,                  -- titan 中文名
    titanen      TEXT,                  -- titan 英文名
    sofaid       INTEGER UNIQUE,        -- 可空：sofascore 联赛 id（29 个有）
    sofascoreen  TEXT,                  -- 可空：sofascore 英文名
    jingcainame  TEXT,                  -- 竞彩联赛名（120 个有，14 个空）
    updated_at   TIMESTAMPTZ DEFAULT now()
);

-- ─── 跨源比赛映射 ────────────────────────────────────────────
-- 一行 = 一场真实比赛，锚点 = titan_jc_schedule.sid（titan 竞彩镜像，三源中最全的竞彩源）。
-- 其余源 id 可空：未匹配到该源则对应列留空，不删行不猜。
-- 由 build-match-map.ts 填充（脚本首次运行自动 CREATE TABLE IF NOT EXISTS）。
CREATE TABLE cross_source_matches (
    titan_jc_sid      INTEGER PRIMARY KEY,   -- 锚点 = titan_jc_schedule.sid
    titan_schedule_id INTEGER UNIQUE,        -- 可空：titan_schedules.schedule_id
    sofa_match_id     INTEGER UNIQUE,        -- 可空：sofascore.schedules.match_id
    jc_match_id       INTEGER UNIQUE,        -- 可空：jingcai_schedules.match_id
    business_date     DATE,                  -- 竞彩销售日
    kickoff_time      TIMESTAMPTZ,           -- 开赛时间（titan 侧）
    sclass_id         INTEGER,               -- titan 联赛 id（冗余）
    home_sofaid       INTEGER,               -- 主队 sofaid（冗余，供聚合）
    away_sofaid       INTEGER,               -- 客队 sofaid（冗余，供聚合）
    updated_at        TIMESTAMPTZ DEFAULT now()
);
