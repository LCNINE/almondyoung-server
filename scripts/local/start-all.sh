#!/usr/bin/env bash
# 로컬 dev 서버 일괄 기동 (docs/local-dev.md).
# watch 모드 10개는 노트북에서 너무 무거워서, 한 번 빌드 후 node 로 실행한다.
# 코드 업데이트 반영 = git pull 후 이 스크립트 재실행.
#
# 사용법: npm run start:all:local        (tmux 안에서 실행 권장 — 터미널 닫아도 유지)
#         SKIP_BUILD=1 ./scripts/local/start-all.sh   (빌드 생략하고 기존 dist 로 재시작)
# 종료:   Ctrl+C (전 서비스 함께 종료)
set -uo pipefail
cd "$(dirname "$0")/../.."
mkdir -p logs

if [ "${SKIP_BUILD:-}" != "1" ]; then
  echo "── 빌드 (전체 nest 앱 + analytics/ugc-service)"
  npm run build && npm run build:analytics && npm run build:ugc-service || exit 1
fi

# "<서비스(dist/apps 이름)>:<env 파일>:<포트>" — 포트는 표시용 (docs/local-dev.md 포트맵)
SERVICES=(
  "core:apps/core/.env:3100"
  "user-service:apps/user-service/.env:3000"
  "wallet:apps/wallet/.env:5001"
  "membership:apps/membership/.env:3001"
  "channel-adapter:apps/channel-adapter/.env:3003"
  "notification:apps/notification/.env:3050"
  "file-service:apps/file-service/.env:3010"
  "ugc-service:apps/ugc-service/.env:3030"
  "analytics:apps/analytics/.env:3040"
  "search:apps/search/.env:3060"
)

pids=()
for entry in "${SERVICES[@]}"; do
  IFS=':' read -r svc envf port <<< "$entry"
  npx dotenv -e "$envf" -- node "dist/apps/$svc/main.js" > "logs/$svc.log" 2>&1 &
  pids+=($!)
  echo "▶ $svc (:$port) → logs/$svc.log"
done

# medusa 는 nest 가 아니라 자체 CLI (develop 모드, 자체 빌드/서빙)
(cd apps/medusa && npm run dev) > logs/medusa.log 2>&1 &
pids+=($!)
echo "▶ medusa (:9000) → logs/medusa.log"

echo ""
echo "전부 기동 중. 로그: tail -f logs/<서비스>.log / 종료: Ctrl+C"
trap 'echo "종료 중..."; kill "${pids[@]}" 2>/dev/null; wait; exit 0' INT TERM
wait
