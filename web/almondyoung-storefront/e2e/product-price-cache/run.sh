#!/usr/bin/env bash
# 멤버십 가격이 캐시 세그먼트를 넘어 새지 않는지 실제 브라우저로 확인한다.
#
#   npm run test:e2e:product-price-cache
#
# 스텁이 아니라 **로컬 Medusa(:9000)** 를 그대로 쓴다 — 가격 계산과 캐시 분리가 진짜로
# 맞물리는지가 확인 대상이라 스텁으로는 의미가 없다. 아래 준비가 되어 있어야 한다:
#   - docker compose up -d postgres, 로컬 redis
#   - apps/medusa 가 :9000 에 기동 (CATALOG_SEGMENT_SECRET, MEDUSA_MEMBERSHIP_GROUP_ID 설정)
#   - 멤버십 그룹과 그 그룹 전용 price list 가 있는 상품
set -euo pipefail
cd "$(dirname "$0")/../.."

PORT="${E2E_PORT:-8000}"
BASE="http://localhost:${PORT}"
MEDUSA="${E2E_MEDUSA_URL:-http://localhost:9000}"
LOG_DIR="${TMPDIR:-/tmp}/ay-price-cache-e2e"
mkdir -p "$LOG_DIR"

: "${E2E_PUBLISHABLE_KEY:?E2E_PUBLISHABLE_KEY 필요}"
: "${E2E_GROUP_ID:?E2E_GROUP_ID 필요}"
: "${E2E_CUSTOMER_ID:?E2E_CUSTOMER_ID 필요}"
: "${E2E_MEMBER_TOKEN:?E2E_MEMBER_TOKEN 필요}"
: "${E2E_PRODUCT_HANDLE:?E2E_PRODUCT_HANDLE 필요}"
: "${E2E_BASE_PRICE:?E2E_BASE_PRICE 필요}"
: "${E2E_MEMBER_PRICE:?E2E_MEMBER_PRICE 필요}"
export E2E_COMPOSE_FILE="${E2E_COMPOSE_FILE:-$(cd ../.. && pwd)/docker-compose.yml}"

# dev 서버는 중간 셸을 거쳐 $! 가 실제 서버 PID 가 아니다. 프로세스 그룹째 정리한다.
kill_group() {
  local pid="$1"
  [[ -z "$pid" ]] && return 0
  kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
}

cleanup() {
  kill_group "${APP_PID:-}"
  sleep 1
  kill -KILL -- "-${APP_PID:-0}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if ! curl -sf -o /dev/null "${MEDUSA}/health"; then
  echo "✗ 로컬 Medusa 가 ${MEDUSA} 에 없다" >&2
  exit 1
fi

echo "▶ 스토어프론트 기동 (로컬 모드, :${PORT})"
NEXT_PUBLIC_USE_RAILWAY_BACKEND=false \
USE_RAILWAY_BACKEND=false \
BACKEND_DOMAIN= \
NEXT_PUBLIC_BACKEND_DOMAIN= \
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY="$E2E_PUBLISHABLE_KEY" \
NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID="$E2E_GROUP_ID" \
CATALOG_SEGMENT_SECRET="${CATALOG_SEGMENT_SECRET:-local-catalog-segment-secret}" \
PORT="$PORT" \
  setsid npm run dev > "$LOG_DIR/storefront.log" 2>&1 &
APP_PID=$!

for _ in $(seq 1 90); do
  curl -sf -o /dev/null "$BASE/kr" && break
  sleep 2
done
curl -sf -o /dev/null "$BASE/kr" || { echo "✗ 스토어프론트 기동 실패"; tail -30 "$LOG_DIR/storefront.log"; exit 1; }

E2E_BASE_URL="$BASE" npx playwright test --config e2e/product-price-cache/playwright.config.ts "$@"
