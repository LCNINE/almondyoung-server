#!/usr/bin/env bash
# 로컬 E2E 앱 일괄 기동. 준비(컨테이너·마이그·시드)는 bootstrap-e2e.sh 가 한다.
#
# 사용법: npm run start:all:local            (tmux 안에서 실행 권장 — 터미널 닫아도 유지)
#         SKIP_BUILD=1 npm run start:all:local     # 빌드 생략, 기존 dist 로 재시작
#         E2E_PROFILE=full npm run start:all:local # extra 앱(리뷰·통계·알림·검색)도 함께
#         SKIP_KEY_SYNC=1 …                        # Medusa 키 동기화 생략
#         DRY_RUN=1 npm run start:all:local         # 무엇을 어떤 «순서»로 띄울지만 출력
# 종료:   Ctrl+C (전 프로세스 함께 종료)
#
# 🔴 «띄우는 집합»이 문서의 E2E 구성과 어긋나 있던 자리다. 앱 목록은 이제 산문이 아니라
# scripts/local/e2e-env-map.sh 한 곳에서 온다 — 앱을 늘리면 거기에 추가한다.
#
# 🔴 기동 순서에 이유가 있다. Medusa API 키는 초기화하면 새로 발급되는데, 그걸 «부팅 시»
# 읽는 앱이 셋 있다(channel-adapter · admin-web · storefront). 그래서
#   ① medusa 와 «키를 안 읽는» 앱들을 먼저 → ② :9000 을 기다렸다가 키 동기화 → ③ 의존 3개
# 순으로 띄운다. 예전엔 사람이 나중에 동기화하고 세 앱을 재기동해야 했고, 안 하면 증상이
# 전부 「0건」이라 환경 문제로 보이지 않았다 (docs/local-e2e-environment.md §2-A).
set -uo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/local/e2e-env-map.sh
source scripts/local/e2e-env-map.sh
mkdir -p logs

PROFILE="${E2E_PROFILE:-e2e}"

# "<이름>|<종류>|<대상>|<.env 경로>|<포트>|<medusa 키를 부팅 시 읽는가>"
#   nest = dist/apps/<대상>/main.js 를 dotenv 로 기동   web = <대상> 디렉터리에서 npm run dev
PROCS_REQUIRED=(
  "core|nest|core|apps/core/.env|3100|no"
  "user-service|nest|user-service|apps/user-service/.env|3000|no"
  "wallet|nest|wallet|apps/wallet/.env|5001|no"
  "membership|nest|membership|apps/membership/.env|3001|no"
  "file-service|nest|file-service|apps/file-service/.env|3010|no"
  "wallet-web|web|apps/wallet-web|apps/wallet-web/.env.local|3200|no"
  "auth-web|web|web/auth-web|web/auth-web/.env.local|8001|no"
  "channel-adapter|nest|channel-adapter|apps/channel-adapter/.env|3003|yes"
  "admin-web|web|apps/admin-web|apps/admin-web/.env.local|8002|yes"
  "storefront|web|web/almondyoung-storefront|web/almondyoung-storefront/.env.local|8000|yes"
)
PROCS_EXTRA=(
  "ugc-service|nest|ugc-service|apps/ugc-service/.env|3030|no"
  "analytics|nest|analytics|apps/analytics/.env|3040|no"
  "notification|nest|notification|apps/notification/.env|3050|no"
  "search|nest|search|apps/search/.env|3060|no"
)

if [ "${SKIP_BUILD:-}" != "1" ] && [ "${DRY_RUN:-}" != "1" ]; then
  echo "── 빌드 (nest 앱. 프론트는 dev 모드로 뜬다)"
  npm run build && npm run build:analytics && npm run build:ugc-service || exit 1
fi

pids=()

launch() {
  local name="$1" kind="$2" target="$3" envf="$4" port="$5"
  # .env 가 없으면 «띄우지 않는다». 예전엔 그대로 띄워서 analytics·ugc-service 가 매번
  # `Cannot read properties of null (reading 'clientId')` 로 죽고 로그만 빨갰다.
  if [ ! -f "$envf" ]; then
    printf '\033[33m⊘ %s (:%s) — %s 없음. 건너뛴다\033[0m\n' "$name" "$port" "$envf"
    return
  fi
  if [ "${DRY_RUN:-}" = "1" ]; then echo "▶ (dry-run) $name (:$port) [$kind $target]"; return; fi
  case "$kind" in
    nest) npx dotenv -e "$envf" -- node "dist/apps/$target/main.js" > "logs/$name.log" 2>&1 & ;;
    web)  (cd "$target" && npm run dev) > "logs/$name.log" 2>&1 & ;;
  esac
  pids+=($!)
  echo "▶ $name (:$port) → logs/$name.log"
}

launch_group() { # $1=medusa 키 의존 여부 필터(yes|no)  $2.. = 행들
  local want="$1"; shift
  local row name kind target envf port needs
  for row in "$@"; do
    IFS='|' read -r name kind target envf port needs <<< "$row"
    [ "$needs" = "$want" ] && launch "$name" "$kind" "$target" "$envf" "$port"
  done
}

trap 'echo "종료 중..."; kill "${pids[@]}" 2>/dev/null; wait; exit 0' INT TERM

# ── SMS 스텁 (회원가입 폰 인증). 없으면 가입 UI 를 못 지난다.
if [ "${DRY_RUN:-}" = "1" ]; then echo "▶ (dry-run) sms-stub (:3099)"; else
  node scripts/local/sms-stub.js > logs/sms-stub.log 2>&1 &
  pids+=($!); echo "▶ sms-stub (:3099) → logs/sms-stub.log"
fi

# ── ① medusa + 키를 안 읽는 앱들
if [ "${DRY_RUN:-}" = "1" ]; then echo "▶ (dry-run) medusa (:9000)"; else
  (cd apps/medusa && npm run dev) > logs/medusa.log 2>&1 &
  pids+=($!); echo "▶ medusa (:9000) → logs/medusa.log"
fi
launch_group no "${PROCS_REQUIRED[@]}"
[ "$PROFILE" = "full" ] && launch_group no "${PROCS_EXTRA[@]}"
[ "$PROFILE" != "full" ] && echo "· extra 앱(리뷰·통계·알림·검색)은 생략 — E2E_PROFILE=full 로 함께 띄운다"

# ── ② medusa 를 기다렸다가 키 동기화
if [ "${DRY_RUN:-}" = "1" ]; then
  echo "· (dry-run) medusa :9000 을 기다렸다가 sync-medusa-keys.sh — 아래 3개보다 «먼저»"
elif [ "${SKIP_KEY_SYNC:-}" != "1" ]; then
  echo "· medusa :9000 대기 중 (키 동기화 후에 의존 3개를 띄운다)"
  for _ in $(seq 1 120); do (echo > /dev/tcp/127.0.0.1/9000) >/dev/null 2>&1 && break; sleep 2; done
  if (echo > /dev/tcp/127.0.0.1/9000) >/dev/null 2>&1; then
    if ./scripts/local/sync-medusa-keys.sh > logs/sync-medusa-keys.log 2>&1; then
      echo "✓ Medusa 키 동기화 완료 (logs/sync-medusa-keys.log)"
    else
      # 실패해도 기동은 계속한다 — 시드 전이면 여기서 막히는 게 더 나쁘다.
      printf '\033[33m! 키 동기화 실패 — logs/sync-medusa-keys.log. 「0건」 증상이 나오면 여기부터 볼 것\033[0m\n'
    fi
  else
    printf '\033[33m! medusa :9000 이 안 열렸다 — 키 동기화를 건너뛴다 (logs/medusa.log)\033[0m\n'
  fi
fi

# ── ③ Medusa 키를 부팅 시 읽는 앱들
launch_group yes "${PROCS_REQUIRED[@]}"

echo ""
if [ "${DRY_RUN:-}" = "1" ]; then echo "(dry-run) 실제로 띄우지 않았다."; exit 0; fi
echo "전부 기동 중. 로그: tail -f logs/<이름>.log / 종료: Ctrl+C"
echo "판정: npm run preflight:e2e:local"
wait
