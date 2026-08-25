#!/usr/bin/env bash
# 로컬 compose core DB 대상 통합 테스트 러너 (dev 스테이지 폐기 대체).
# 대부분의 spec 은 rollback-only 라 DB 를 더럽히지 않는다 (커밋형 lock/refund 2개는 unique 접미사 행을 남김 — docs/local-dev.md 참고). Kafka 불필요(outbox mock).
#
# 사용법: npm run test:core:integration:local            # core DB 를 쓰는 통합 스펙 전체
#         npm run test:core:integration:local -- receive.integration   # 패턴 지정
#         npm run test:core:integration:local -- integration           # 옛 동작(전 서비스) 재현
# LOCAL_PG 로 접속 URL 오버라이드 가능(포트 충돌 시).
# JEST_TIMEOUT_SECONDS 로 종료 대기 상한 조정 가능(기본 300).
set -euo pipefail
cd "$(dirname "$0")/../.."

PG="${LOCAL_PG:-postgresql://postgres:postgres@localhost:5432}"
CORE_URL="${PG}/core"

# 기본 패턴을 **core DB 를 쓰는 트리로 한정**한다 (2026-08-25 실측).
#
# 옛 기본값 `integration` 은 membership·channel-adapter·analytics 통합 스펙까지 끌어왔다.
# 이들은 각자 자기 DB 를 요구하는데 이 러너의 DATABASE_URL 은 core 를 가리키므로 **통과할 수
# 없다.** 대가가 셋이었다:
#   1. 12 suite 가 늘 빨갛다 → 매번 "어느 게 내 탓인가"를 사람이 골라내야 했다
#      (그래서 과거 조사들이 git stash 로 기준선을 다시 떠서 실패 항목명을 문자열 대조했다).
#   2. 붙을 수 없는 DB 를 기다리느라 접속 타임아웃으로 5초 이상을 태웠다.
#   3. 그중 무언가가 열린 핸들을 남겨 **테스트가 끝난 뒤에도 jest 가 종료하지 못했다.**
#      결과를 다 찍고 48분을 매달린 것을 실측했다.
# 좁히니 76초+무한대기 → 63초 정상종료가 됐다.
DEFAULT_PATTERN='(apps/core|libs/events|scripts/fulfillment-v2)/.*integration'
PATTERN="${1:-$DEFAULT_PATTERN}"

echo "── 1/3 compose postgres 기동"
docker compose up -d postgres

echo "── 2/3 postgres 준비 대기"
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  [ "$i" -eq 30 ] && { echo "postgres 준비 타임아웃" >&2; exit 1; }
  sleep 1
done

echo "── 3/3 core 마이그레이션(이미 적용됐으면 no-op)"
DATABASE_URL="$CORE_URL" npx drizzle-kit migrate --config apps/core/drizzle.config.ts

echo "── jest 실행 (pattern=${PATTERN})"
# `--forceExit` 을 쓰지 않는 건 의도다 — 그건 핸들 누수를 **숨긴다**. 대신 벽시계 상한을 걸어
# 누수가 생겨도 저녁을 통째로 먹지 않게 하고, 트립하면 진단 방법을 알려 준다.
set +e
timeout --signal=INT "${JEST_TIMEOUT_SECONDS:-300}" \
  env DATABASE_URL="$CORE_URL" npx jest --testPathPattern="$PATTERN" --runInBand
RC=$?
set -e

if [ "$RC" -eq 124 ]; then
  cat >&2 <<'MSG'

────────────────────────────────────────────────────────────────
jest 가 상한 시간 안에 종료하지 못했다.

위에 결과가 다 찍혔다면 테스트는 끝난 것이고, 남은 건 **열린 핸들 누수**다
(닫지 않은 DB 커넥션 · Nest 앱 · setInterval 등). 범인 찾기:

  npx jest --testPathPattern=<좁힌 패턴> --runInBand --detectOpenHandles

상한은 JEST_TIMEOUT_SECONDS 로 조정한다.
────────────────────────────────────────────────────────────────
MSG
fi

exit "$RC"
