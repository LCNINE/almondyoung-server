#!/usr/bin/env bash
# 멤버십 해지 UI E2E — 시나리오 전체를 실제 브라우저로 훑는다.
#
#   npm run test:e2e:membership-cancel                 # 전 시나리오
#   SCENARIOS=annual-proration npm run test:e2e:membership-cancel   # 하나만
#
# 백엔드는 stub-backend.mjs 로 대체한다(3000/3001/5001). 스토어프론트는 반드시 **로컬 모드**로 띄운다 —
# .env.local 이 원격(dev) 백엔드를 가리키므로 그대로 두면 테스트가 원격에 요청을 보낸다.
set -euo pipefail
cd "$(dirname "$0")/../.."

SCENARIOS="${SCENARIOS:-recurring-withdrawal recurring-no-refund annual-proration scheduled scheduled-refundable one-time-scheduled one-time cms-manual pre-collection pre-collection-benefit-used refund-pending refund-completed mandate-rejected billing-past-due billing-uncollectible}"
PORT="${E2E_PORT:-8000}"
BASE="http://localhost:${PORT}"
LOG_DIR="${TMPDIR:-/tmp}/ay-membership-e2e"
mkdir -p "$LOG_DIR"

# 미들웨어는 _medusa_jwt 로 /mypage 를 막고, api() 는 accessToken 을 요구한다. 스텁은 검증하지 않으므로
# 형식만 맞춘 토큰이면 된다.
TOKEN=$(node -e "
const b=(o)=>Buffer.from(JSON.stringify(o)).toString('base64url');
console.log(b({alg:'HS256',typ:'JWT'})+'.'+b({sub:'e2e-user',exp:Math.floor(Date.now()/1000)+3600})+'.sig');
")

# `npm run dev` / `npx next dev` 는 중간 셸을 거치므로 $! 는 실제 dev 서버가 아니라 그 셸의 PID 다.
# 그 PID 만 죽이면 next 프로세스가 부모를 잃고 포트를 물고 남는다(다음 실행이 포트 충돌로 실패).
# 그래서 자식들을 프로세스 그룹째 띄우고(setsid) 그룹 전체에 신호를 보낸다.
kill_group() {
  local pid="$1"
  [[ -z "$pid" ]] && return 0
  # setsid 로 띄웠으면 pgid == pid. 폴백으로 프로세스 자신에게도 보낸다.
  kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
}

cleanup() {
  kill_group "${STUB_PID:-}"
  kill_group "${APP_PID:-}"
  # TERM 을 흘려보내는 자식이 있어 잠시 기다린 뒤 확실히 정리한다(고아 dev 서버 방지).
  sleep 1
  kill -KILL -- "-${STUB_PID:-0}" 2>/dev/null || true
  kill -KILL -- "-${APP_PID:-0}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait_for() {
  local url="$1" name="$2"
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "$url"; then return 0; fi
    sleep 1
  done
  echo "✗ ${name} 기동 실패: ${url}" >&2
  return 1
}

start_app() {
  echo "▶ 스토어프론트 기동 (로컬 모드, :${PORT})"
  NEXT_PUBLIC_USE_RAILWAY_BACKEND=false \
  USE_RAILWAY_BACKEND=false \
  BACKEND_DOMAIN= \
  NEXT_PUBLIC_BACKEND_DOMAIN= \
  PORT="$PORT" \
    setsid npm run dev > "$LOG_DIR/storefront.log" 2>&1 &
  APP_PID=$!
  wait_for "$BASE/kr" storefront
}

FAILED=()
start_app

for scenario in $SCENARIOS; do
  echo ""
  echo "══════ 시나리오: ${scenario} ══════"
  kill_group "${STUB_PID:-}"
  SCENARIO="$scenario" setsid node e2e/membership-cancel/stub-backend.mjs > "$LOG_DIR/stub-$scenario.log" 2>&1 &
  STUB_PID=$!
  wait_for "http://localhost:3001/subscriptions/cancel-preview" "stub($scenario)"

  if E2E_TOKEN="$TOKEN" E2E_BASE_URL="$BASE" SCENARIO="$scenario" \
      npx playwright test --config e2e/membership-cancel/playwright.config.ts --reporter=line; then
    echo "✅ ${scenario}"
  else
    echo "❌ ${scenario}"
    FAILED+=("$scenario")
  fi
done

echo ""
if [[ ${#FAILED[@]} -eq 0 ]]; then
  echo "✅ 전 시나리오 통과"
else
  echo "❌ 실패 시나리오: ${FAILED[*]}"
  exit 1
fi
