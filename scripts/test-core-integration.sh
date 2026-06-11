#!/usr/bin/env bash
# core dev DB 대상 통합 테스트 (rollback-only — DB에 데이터를 남기지 않는 spec만 대상).
#
# 사전조건: 별도 터미널에서 VPC 터널이 떠 있어야 한다.
#   ./scripts/sst-tunnel.sh deployments/lcnine/services dev
#
# Usage: ./scripts/test-core-integration.sh [stage] [jest-testPathPattern]
# Example:
#   ./scripts/test-core-integration.sh dev fulfillment-reservations.facade.integration
set -euo pipefail

STAGE="${1:-dev}"
PATTERN="${2:-integration}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "$STAGE" == "live" ]]; then
  echo "live stage 대상 통합 테스트는 허용되지 않습니다." >&2
  exit 1
fi

cd "$ROOT/deployments/lcnine/services"
exec npx sst shell --stage "$STAGE" -- node "$ROOT/scripts/test-core-integration.cjs" "$PATTERN"
