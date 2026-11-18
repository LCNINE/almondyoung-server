#!/usr/bin/env bash
# 로컬 자사몰 주문 경로(#1440) — 상품 준비(seed)·주문 넣기(order). 스택(start:all:local)이 뜬 뒤 부른다.
#
#   npm run seed:order-path:local
#   npm run order:place:local -- --count 3
#
# 앱 포트·.env 위치는 정본 표(e2e-env-map.sh)에서 온다 — isolation-check-local.sh 와 같은 방식.
set -uo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/local/e2e-env-map.sh
source scripts/local/e2e-env-map.sh

E2E_ENV_ROWS_FLAT="$(printf '%s\n' "${E2E_ENV_ROWS[@]}")"
export E2E_ENV_ROWS_FLAT
exec npx tsx scripts/local/order-path/index.ts "$@"
