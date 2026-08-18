#!/usr/bin/env bash
# 개별 배송비 그룹 표시 E2E (#661) — 실제 로컬 Medusa 를 백엔드로 쓴다.
#
#   npm run test:e2e:shipping-group-notice
#
# 선행 조건:
#   - 로컬 Medusa 가 :9000 에 기동 (cd apps/medusa && npm run dev)
#     postgres 컨테이너(almondyoung-server-postgres-1)와 로컬 redis 가 필요하다.
#
# 시드(배송비 그룹·상품·기본 설정)는 이 스크립트가 멱등으로 넣는다. 스텁을 쓰지 않는 이유:
# 배송비 그룹·정책·확정 금액이 전부 서버에서 오고, 체크아웃 분해는 cart.shipping_methods
# 확정값에 의존하므로 스텁으로는 진짜를 못 본다.
set -euo pipefail
cd "$(dirname "$0")/../.."

PORT="${E2E_PORT:-8000}"
BASE="http://localhost:${PORT}"
MEDUSA="${E2E_MEDUSA_URL:-http://localhost:9000}"
MEDUSA_APP_DIR="$(cd ../../apps/medusa && pwd)"
LOG_DIR="${TMPDIR:-/tmp}/ay-shipping-notice-e2e"
mkdir -p "$LOG_DIR"

# dev 서버는 중간 셸을 거쳐 $! 가 실제 서버 PID 가 아니다. setsid 로 그룹째 띄우고 그룹째 정리한다.
kill_group() {
  local pid="${1:-}"
  [[ -z "$pid" ]] && return 0
  kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
}

# next dev 는 기동할 때 next-env.d.ts 와 tsconfig.json 을 제 손으로 고쳐 쓴다. distDir 을
# 갈아끼우면 그 경로가 이 두 파일에 박혀 작업 트리가 더러워지므로, 원본을 떠뒀다가 되돌린다.
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
  # PID 가 비면 "-0" 은 자기 프로세스 그룹 전체를 죽인다(exit 137). 비어있지 않을 때만 KILL.
  if [[ -n "${APP_PID:-}" ]]; then
    kill -KILL -- "-${APP_PID}" 2>/dev/null || true
  fi
  restore_next_touched
}
trap cleanup EXIT INT TERM

if ! curl -sf -o /dev/null "${MEDUSA}/health"; then
  echo "✗ 로컬 Medusa 가 ${MEDUSA} 에 없다. cd apps/medusa && npm run dev 로 먼저 띄워라." >&2
  exit 1
fi

echo "▶ 시드 (멱등)"
(
  cd "$MEDUSA_APP_DIR" &&
    npx medusa exec ./src/scripts/seed.ts &&
    npx medusa exec ./src/scripts/seed-shipping.ts &&
    npx medusa exec ./src/scripts/seed-e2e-shipping-notice.ts
) > "$LOG_DIR/seed.log" 2>&1 || {
  echo "✗ 시드 실패" >&2
  tail -20 "$LOG_DIR/seed.log" >&2
  exit 1
}

# publishable key — 스토어프론트와 스펙(고객 생성)이 같이 쓴다.
PUBLISHABLE_KEY="${E2E_PUBLISHABLE_KEY:-$(docker exec almondyoung-server-postgres-1 \
  psql -U postgres -d medusa -tAc \
  "select token from api_key where type='publishable' and deleted_at is null order by created_at asc limit 1" 2>/dev/null || true)}"
if [[ -z "$PUBLISHABLE_KEY" ]]; then
  echo "✗ publishable key 를 못 찾았다. E2E_PUBLISHABLE_KEY 로 직접 넘겨라." >&2
  exit 1
fi

# 이미 뭔가 :PORT 를 쓰고 있으면 기동이 조용히 실패하고, 준비 확인은 그 남의 서버가 대신
# 응답해 통과해버린다. 남의 서버는 이 스크립트의 시드·키와 무관하므로 먼저 막는다.
if curl -sf -o /dev/null "$BASE/kr" 2>/dev/null; then
  echo "✗ 이미 :${PORT} 에 뜬 서버가 있다. 끄거나 E2E_PORT 로 다른 포트를 지정해라." >&2
  exit 1
fi

# 단독 빌드 디렉터리 — 개발 중인 dev 서버의 .next 와 캐시를 섞지 않는다.
rm -rf .next-e2e

# `npm run dev` 대신 next 를 직접 부른다. dev 스크립트가 포트(-p 8000)와 NODE_OPTIONS(--inspect)를
# 안에 박아둬서 환경변수로는 못 바꾼다. 스토어프론트는 반드시 **로컬 모드**로 띄운다 — .env 가
# 원격 백엔드를 가리키면 테스트가 원격에 요청을 보낸다.
echo "▶ 스토어프론트 기동 (로컬 모드, :${PORT})"
NODE_OPTIONS= \
NEXT_DIST_DIR=.next-e2e \
NEXT_PUBLIC_USE_RAILWAY_BACKEND=false \
USE_RAILWAY_BACKEND=false \
BACKEND_DOMAIN= \
NEXT_PUBLIC_BACKEND_DOMAIN= \
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" \
PORT="$PORT" \
  setsid npx next dev --turbopack -p "$PORT" > "$LOG_DIR/storefront.log" 2>&1 &
APP_PID=$!

for _ in $(seq 1 90); do
  curl -sf -o /dev/null "$BASE/kr" && break
  sleep 2
done
curl -sf -o /dev/null "$BASE/kr" || {
  echo "✗ 스토어프론트 기동 실패" >&2
  tail -30 "$LOG_DIR/storefront.log" >&2
  exit 1
}

# dev 서버는 라우트를 처음 밟을 때 컴파일한다. 첫 단언 전에 미리 데워 둔다.
for handle in e2e-ship-flat e2e-ship-default e2e-ship-perqty e2e-ship-cond e2e-ship-digital; do
  curl -sf -o /dev/null "$BASE/kr/products/${handle}" || true
done
curl -sf -o /dev/null "$BASE/kr/cart" || true

E2E_BASE_URL="$BASE" \
E2E_MEDUSA_URL="$MEDUSA" \
E2E_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" \
  npx playwright test --config e2e/shipping-group-notice/playwright.config.ts "$@"
