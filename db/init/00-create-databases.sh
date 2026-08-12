#!/bin/bash
# ============================================================
# Spottery Monorepo —— 建库 + 角色 + 权限隔离（入口脚本）
# docker-entrypoint-initdb.d 只执行顶层 .sh/.sql，不递归子目录，
# 因此本脚本负责：建角色 → 建库 → 依次执行各库 schema DDL。
#
# 权限模型（架构文档第 6.2 节，命名已定稿）：
#   crawler_sofascore → sofascore   读写
#   crawler_titan     → titan       读写
#   crawler_sporttery → sporttery   读写
#   api_service       → core        读写；sofascore/titan/sporttery 只读
#                       （连接后 SET default_transaction_read_only = on 强制）
# ============================================================
set -euo pipefail

APP_PASSWORD="${PG_APP_PASSWORD:?PG_APP_PASSWORD must be set}"

echo "[init] creating roles..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE crawler_sofascore LOGIN PASSWORD '${APP_PASSWORD}';
CREATE ROLE crawler_titan LOGIN PASSWORD '${APP_PASSWORD}';
CREATE ROLE crawler_sporttery LOGIN PASSWORD '${APP_PASSWORD}';
CREATE ROLE api_service LOGIN PASSWORD '${APP_PASSWORD}';
SQL

echo "[init] creating databases..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE DATABASE sofascore OWNER crawler_sofascore;
CREATE DATABASE titan OWNER crawler_titan;
CREATE DATABASE sporttery OWNER crawler_sporttery;
CREATE DATABASE core OWNER api_service;
SQL

# 各库 schema DDL 位于 db/init/<database>/*.sql，由本脚本顺序执行。
declare -A DB_OWNER=( [sofascore]=crawler_sofascore [titan]=crawler_titan [sporttery]=crawler_sporttery [core]=api_service )
for db in sofascore titan sporttery core; do
  dir="/docker-entrypoint-initdb.d/${db}"
  if [ -d "$dir" ]; then
    for f in "$dir"/*.sql; do
      [ -e "$f" ] || continue
      echo "[init] applying ${f} -> database ${db}"
      psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" -f "$f"
    done
  fi
# 将建表者（postgres 超级用户）建出的对象归属转移给各库应用角色，
# 并授予全部权限，保证 crawler_* 能读写自己的源库。
owner="${DB_OWNER[$db]}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<SQL
ALTER SCHEMA public OWNER TO ${owner};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${owner};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${owner};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${owner};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${owner};
SQL
done

# ─── 只读放开（读不隔离，写单向）────────────────────────────
# 所有应用角色可读所有库（SELECT + schema/sequence USAGE + 默认权限），
# 写（INSERT/UPDATE/DELETE）仍只给各库 OWNER。用于跨源判定（如 titan 读
# sporttery 判断无效场次 Refund）。
APP_ROLES="crawler_sofascore crawler_titan crawler_sporttery api_service"
for db in sofascore titan sporttery core; do
  for role in $APP_ROLES; do
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<SQL
GRANT CONNECT ON DATABASE ${db} TO ${role};
GRANT USAGE ON SCHEMA public TO ${role};
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role};
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${role};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO ${role};
SQL
  done
done

echo "[init] databases ready: core / sofascore / titan / sporttery"
