#!/usr/bin/env bash
# 로컬 E2E 의 테넌트 격리 실측 — 판정만 한다(고치지 않는다). preflight 옆에 서는 블랙박스 HTTP 점검이다:
# 테넌트 1·2 점검 계정 토큰으로 실제 경로를 부른다. 라이브는 npm run isolation:check -- --stage <stage> 가 같은 점검을 돈다.
#
#   npm run isolation:check:local              # 읽기 전용 — 매 배포 뒤 도는 부분
#   npm run isolation:check:local -- --write   # + 쓰기 경로·정지 스위치 («[개통 점검]» 이름으로 만들고 지운다)
#
# 전제: bootstrap(테넌트 2 포함) → E2E_GATE_MODE=reject start-all. 테넌트 2 는 ② 에서만 섬긴다.
set -uo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/local/e2e-env-map.sh
source scripts/local/e2e-env-map.sh

# core 가 ② 로 떠 있어야 한다 — ① 의 core 는 단일 DB 라 테넌트 2 토큰에 테넌트 1 데이터로 답한다(그건 이 실측의 실패가 아니라 전제 위반이다).
CORE_PID=$(ss -ltnpH "sport = :3100" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
CORE_MODE=""
[ -n "$CORE_PID" ] && CORE_MODE=$(tr '\0' '\n' < "/proc/$CORE_PID/environ" 2>/dev/null | grep -m1 '^TENANT_GATE_MODE=' | cut -d= -f2-)
if [ "$CORE_MODE" != "reject" ]; then
  echo "❌ core(:3100)가 ② 모드가 아니다(${CORE_MODE:-안 떠 있음}). 테넌트 2 는 ② 에서만 섬긴다."
  echo "   → E2E_GATE_MODE=reject npm run start:all:local"
  exit 1
fi

E2E_ENV_ROWS_FLAT="$(printf '%s\n' "${E2E_ENV_ROWS[@]}")"
export E2E_ENV_ROWS_FLAT E2E_SERVED_TENANT_APPS E2E_SERVED_TENANT_ID E2E_TENANT2_ID E2E_TENANT2_SLUG E2E_TENANT2_DOMAIN \
  E2E_TENANT2_CORE_DB E2E_TENANT2_PUBLIC_BUCKET E2E_TENANT2_PRIVATE_BUCKET
exec npx tsx scripts/local/isolation-check/index.ts "$@"
