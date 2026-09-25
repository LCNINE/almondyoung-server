#!/usr/bin/env bash
# QA7 사전준비 시드 (dev 전용). 통합 테스트와 동일하게 sst shell 안에서 실행한다.
#
# 사전조건:
#   - 별도 터미널에서 VPC 터널이 떠 있어야 한다: ./scripts/sst-tunnel.sh deployments/lcnine/services dev
#   - QA_DELIVERY_PROFILE_ID 환경변수(필수) — dev DB 에 이미 있는 배송 프로필 id.
#     physical SKU 는 배송 프로필 없이 만들 수 없다(#923).
#
# Usage: QA_DELIVERY_PROFILE_ID=<id> ./scripts/qa/seed-qa7-dev.sh [stage]
set -euo pipefail

STAGE="${1:-dev}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

if [[ "$STAGE" == "live" ]]; then
  echo "live 스테이지에는 QA 시드를 넣을 수 없습니다." >&2
  exit 1
fi

cd "$ROOT/deployments/lcnine/services"
exec npx sst shell --stage "$STAGE" -- "$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/qa/seed-qa7-dev.ts"
