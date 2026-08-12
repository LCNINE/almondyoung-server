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
#
# 두 단계로 돈다.
#   1) 정상 — 세그먼트가 맞물릴 때 가격이 안 새는지, 세그먼트 계약을 지키는지
#   2) 시크릿 어긋남 — 양쪽 시크릿이 다른 배포 시차 구간에서 회원가가 그대로 나오는지
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
export E2E_MEDUSA_URL="$MEDUSA"

SECRET="${CATALOG_SEGMENT_SECRET:-local-catalog-segment-secret}"
export CATALOG_SEGMENT_SECRET="$SECRET"

# dev 서버는 중간 셸을 거쳐 $! 가 실제 서버 PID 가 아니다. 프로세스 그룹째 정리한다.
kill_group() {
  local pid="$1"
  [[ -z "$pid" ]] && return 0
  kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
}

# next dev 는 기동할 때 next-env.d.ts 와 tsconfig.json 을 제 손으로 고쳐 쓴다. distDir 을
# 갈아끼우면 그 경로가 이 두 파일에 박혀 작업 트리가 더러워지므로, 원본을 떠뒀다가 되돌린다.
# (git 으로 되돌리면 사용자가 손댄 내용까지 날아갈 수 있어 파일 복사로 처리한다.)
TOUCHED_BY_NEXT=(next-env.d.ts tsconfig.json)
for f in "${TOUCHED_BY_NEXT[@]}"; do
  [[ -f "$f" ]] && cp "$f" "$LOG_DIR/$(basename "$f").orig"
done

restore_next_touched() {
  for f in "${TOUCHED_BY_NEXT[@]}"; do
    [[ -f "$LOG_DIR/$(basename "$f").orig" ]] && cp "$LOG_DIR/$(basename "$f").orig" "$f"
  done
}

cleanup() {
  kill_group "${APP_PID:-}"
  sleep 1
  kill -KILL -- "-${APP_PID:-0}" 2>/dev/null || true
  restore_next_touched
}
trap cleanup EXIT INT TERM

if ! curl -sf -o /dev/null "${MEDUSA}/health"; then
  echo "✗ 로컬 Medusa 가 ${MEDUSA} 에 없다" >&2
  exit 1
fi

# 세그먼트 시크릿이 Medusa 쪽과 맞는지 먼저 본다. 안 맞으면 Medusa 가 카탈로그 요청을
# 400 으로 막는다 — 스토어프론트는 토큰으로 폴백하므로 화면은 살지만, 그 상태로 1단계를
# 돌리면 "세그먼트가 맞물린 상태" 를 검증하는 게 아니게 된다. 여기서 잡고 끝낸다.
probe=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "x-publishable-api-key: ${E2E_PUBLISHABLE_KEY}" \
  -H "x-catalog-segment: reg" \
  -H "x-catalog-segment-key: ${SECRET}" \
  "${MEDUSA}/store/products?limit=1")
if [[ "$probe" == "400" ]]; then
  echo "✗ CATALOG_SEGMENT_SECRET 가 Medusa(apps/medusa/.env) 쪽 값과 다르다" >&2
  exit 1
fi

# 이미 뭔가 :PORT 를 쓰고 있으면 기동이 조용히 실패하고, 아래 준비 확인은 그 남의 서버가
# 대신 응답해 통과해버린다. 그러면 이 스크립트가 세팅한 시크릿·그룹 id 와 무관한 서버를
# 검증하게 되므로(2단계 시크릿 어긋남은 아예 성립하지 않는다) 먼저 막는다.
if curl -sf -o /dev/null "$BASE/kr" 2>/dev/null; then
  echo "✗ 이미 :${PORT} 에 뜬 서버가 있다. 끄거나 E2E_PORT 로 다른 포트를 지정해라." >&2
  exit 1
fi

start_storefront() {
  local secret="$1"
  local label="$2"
  local dist="$3"

  # 단계마다 빌드/캐시 디렉터리를 새로 판다. unstable_cache 항목은 `.next/cache` 에 남아
  # 서버를 재시작해도 살아남으므로, 그냥 재기동만 하면 2단계가 1단계에 저장된 응답을 그대로
  # 읽어 Medusa 에 아예 요청하지 않는다(= 시크릿 어긋남이 검증되지 않는다).
  # 개발 중인 dev 서버의 `.next` 와도 분리된다.
  rm -rf "$dist"

  # `npm run dev` 대신 next 를 직접 부른다. dev 스크립트가 포트(-p 8000)와
  # NODE_OPTIONS(--inspect)를 스크립트 안에 박아둬서, 환경변수로는 둘 다 못 바꾼다.
  # 그대로 쓰면 개발 중인 서버와 포트·인스펙터가 부딪혀 기동이 실패한다.
  echo "▶ 스토어프론트 기동 (${label}, :${PORT})"
  NODE_OPTIONS= \
  NEXT_DIST_DIR="$dist" \
  NEXT_PUBLIC_USE_RAILWAY_BACKEND=false \
  USE_RAILWAY_BACKEND=false \
  BACKEND_DOMAIN= \
  NEXT_PUBLIC_BACKEND_DOMAIN= \
  NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY="$E2E_PUBLISHABLE_KEY" \
  NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID="$E2E_GROUP_ID" \
  CATALOG_SEGMENT_SECRET="$secret" \
  PORT="$PORT" \
    setsid npx next dev --turbopack -p "$PORT" > "$LOG_DIR/storefront.log" 2>&1 &
  APP_PID=$!

  for _ in $(seq 1 90); do
    curl -sf -o /dev/null "$BASE/kr" && break
    sleep 2
  done
  curl -sf -o /dev/null "$BASE/kr" || {
    echo "✗ 스토어프론트 기동 실패"
    tail -30 "$LOG_DIR/storefront.log"
    exit 1
  }

  # dev 서버는 라우트를 처음 밟을 때 컴파일한다. 그 전에 첫 단언이 들어가면 헤더·푸터만 있는
  # 셸을 읽고 "가격이 없다" 로 실패한다. 상품 페이지를 한 번 warm up 해두고 시작한다.
  curl -sf -o /dev/null "$BASE/kr/products/${E2E_PRODUCT_HANDLE}" || true
}

run_specs() {
  E2E_BASE_URL="$BASE" npx playwright test --config e2e/product-price-cache/playwright.config.ts "$@"
}

echo "━━ 1단계: 세그먼트 정상 ━━"
start_storefront "$SECRET" "정상" ".next-e2e"
run_specs --ignore-snapshots \
  e2e/product-price-cache/price-segment.spec.ts \
  e2e/product-price-cache/catalog-segment.spec.ts "$@"

echo "━━ 2단계: 시크릿 어긋남 ━━"
cleanup
APP_PID=""
start_storefront "deliberately-wrong-secret" "시크릿 어긋남" ".next-e2e-skew"
E2E_SECRET_SKEW=1 run_specs e2e/product-price-cache/secret-skew.spec.ts "$@"
