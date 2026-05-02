#!/usr/bin/env bash
# SST bastion으로 VPC 내부 자원(특히 RDS)에 로컬 접근하기 위한 터널.
# 한 터미널을 점유하므로 별도 창에서 띄워두고, 다른 창에서 db:migrate 등을 돌린다.
#
# Usage: ./scripts/sst-tunnel.sh <app-dir> <stage>
# Example:
#   ./scripts/sst-tunnel.sh deployments/lcnine/auth dev
#   ./scripts/sst-tunnel.sh deployments/lcnine/services live
#
# 최초 1회 머신당:  sudo npx sst tunnel install
set -euo pipefail

APP_DIR="${1:-}"
STAGE="${2:-}"

if [[ -z "$APP_DIR" || -z "$STAGE" ]]; then
  echo "Usage: $0 <app-dir> <stage>" >&2
  exit 1
fi

cd "$APP_DIR"
exec npx sst tunnel --stage "$STAGE"
