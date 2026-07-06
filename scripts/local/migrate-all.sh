#!/usr/bin/env bash
# 로컬 postgres(docker compose)에 전 서비스 drizzle 마이그레이션 적용.
# DATABASE_URL 을 셸에서 명시 주입하므로 각 앱 .env 가 어디를 가리키든 절대 원격 DB 를 건드리지 않는다.
# (drizzle.config.ts 의 dotenv config() 는 이미 설정된 env 를 덮어쓰지 않음)
#
# 사용법: npm run db:migrate:local   (또는 ./scripts/local/migrate-all.sh)
# medusa 는 drizzle 이 아니므로 별도: cd apps/medusa && npx medusa db:migrate --execute-safe-links
set -euo pipefail
cd "$(dirname "$0")/../.."

# LOCAL_PG 로 오버라이드 가능 (예: 포트가 다른 머신)
PG="${LOCAL_PG:-postgresql://postgres:postgres@localhost:5432}"

# "<논리DB>:<drizzle config 경로>" — package.json 의 db:generate:* 와 동일한 config
SERVICES=(
  "core:apps/core/drizzle.config.ts"
  "wallet:apps/wallet/drizzle.config.ts"
  "analytics:apps/analytics/drizzle.config.ts"
  "channel_adapter:apps/channel-adapter/drizzle.config.ts"
  "membership:apps/membership/drizzle.config.ts"
  "notification:apps/notification/database/drizzle/drizzle.config.ts"
  "ugc:apps/ugc-service/src/db/drizzle.config.ts"
  "file_service:apps/file-service/drizzle.config.ts"
  "user_service:apps/user-service/database/drizzle/drizzle.config.ts"
)

for entry in "${SERVICES[@]}"; do
  db="${entry%%:*}"
  config="${entry#*:}"
  echo "── migrate ${db} (${config})"
  DATABASE_URL="${PG}/${db}" npx drizzle-kit migrate --config "$config"
done

echo "✅ drizzle 마이그레이션 완료. medusa 는 별도 실행:"
echo "   DATABASE_URL=${PG}/medusa npx medusa db:migrate --execute-safe-links  (apps/medusa 에서)"
