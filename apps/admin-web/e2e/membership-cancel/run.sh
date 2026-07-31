#!/usr/bin/env bash
# 관리자 해지·환불 UI E2E — 시나리오 전체를 실제 브라우저로 훑는다.
#
#   npm run test:e2e:membership-cancel
#   SCENARIOS=annual npm run test:e2e:membership-cancel
#
# 백엔드는 stub-backend.mjs 로 대체하고, MEMBERSHIP_SERVICE_URL / USER_SERVICE_URL 을 그 스텁으로
# 돌려 dev 서버를 띄운다(.env.local 의 원격 주소가 쓰이지 않도록 셸에서 주입).
# 인증은 BYPASS_AUTH=true 로 우회한다.
set -euo pipefail
cd "$(dirname "$0")/../.."

# playwright 는 스토어프론트에만 설치돼 있다 — admin-web 에 의존성을 새로 추가하지 않고 그 설치본을 쓴다.
PW_MODULES="$(cd ../../web/almondyoung-storefront/node_modules && pwd)"
PW_BIN="${PW_MODULES}/.bin/playwright"
if [[ ! -x "$PW_BIN" ]]; then
  echo "✗ playwright 를 찾을 수 없다: $PW_BIN" >&2
  echo "  web/almondyoung-storefront 에서 npm install 후 다시 실행한다." >&2
  exit 1
fi
export NODE_PATH="$PW_MODULES"

SCENARIOS="${SCENARIOS:-annual monthly-cms scheduled one-time one-time-scheduled pg-settled pg-pending no-payment}"
PORT="${E2E_PORT:-4800}"
STUB_PORT="${STUB_PORT:-4801}"
BASE="http://localhost:${PORT}"
LOG_DIR="${TMPDIR:-/tmp}/ay-admin-membership-e2e"
mkdir -p "$LOG_DIR"

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
  for _ in $(seq 1 90); do
    if curl -sf -o /dev/null "$url"; then return 0; fi
    sleep 1
  done
  echo "✗ ${name} 기동 실패: ${url}" >&2
  return 1
}

echo "▶ admin-web 기동 (:${PORT}, 스텁 백엔드 :${STUB_PORT})"
BYPASS_AUTH=true \
MEMBERSHIP_SERVICE_URL="http://localhost:${STUB_PORT}" \
USER_SERVICE_URL="http://localhost:${STUB_PORT}" \
WALLET_SERVICE_URL="http://localhost:${STUB_PORT}" \
  setsid npx next dev --port "$PORT" > "$LOG_DIR/admin-web.log" 2>&1 &
APP_PID=$!
wait_for "$BASE/membership/members" admin-web

FAILED=()
for scenario in $SCENARIOS; do
  echo ""
  echo "══════ 시나리오: ${scenario} ══════"
  kill_group "${STUB_PID:-}"
  SCENARIO="$scenario" STUB_PORT="$STUB_PORT" setsid node e2e/membership-cancel/stub-backend.mjs \
    > "$LOG_DIR/stub-$scenario.log" 2>&1 &
  STUB_PID=$!
  wait_for "http://localhost:${STUB_PORT}/admin/members" "stub($scenario)"

  if E2E_BASE_URL="$BASE" SCENARIO="$scenario" STUB_PORT="$STUB_PORT" \
      "$PW_BIN" test --config e2e/membership-cancel/playwright.config.ts --reporter=line; then
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
