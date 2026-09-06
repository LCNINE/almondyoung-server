#!/usr/bin/env bash
# 로컬 E2E 앱 일괄 기동. 준비(컨테이너·마이그·시드)는 bootstrap-e2e.sh 가 한다.
#
# 사용법: npm run start:all:local            (tmux 안에서 실행 권장 — 터미널 닫아도 유지)
#         SKIP_BUILD=1 npm run start:all:local     # 빌드 생략, 기존 dist 로 재시작
#         E2E_PROFILE=full npm run start:all:local # extra 앱(리뷰·통계·알림·검색)도 함께
#         SKIP_KEY_SYNC=1 …                        # Medusa 키 동기화 생략
#         DRY_RUN=1 npm run start:all:local        # 무엇을 어떤 «순서»로 띄울지만 출력
# 종료:   Ctrl+C (전 프로세스 함께 종료)
#
# 🔴 «띄우는 집합»이 문서의 E2E 구성과 어긋나 있던 자리다. 앱 목록도 기동 방법도 이제
# scripts/local/e2e-env-map.sh 한 곳에서 온다 — 여기에 표를 따로 두면 그 문제가 되살아난다.
#
# 🔴 기동 순서에 이유가 있다. Medusa API 키는 초기화하면 새로 발급되는데, 그걸 «부팅 시»
# 읽는 앱이 셋 있다(channel-adapter · admin-web · storefront — 표의 needs_key=yes). 그래서
#   ① medusa 와 키를 안 읽는 앱들 → ② :9000 을 기다렸다 키 동기화 → ③ 키를 읽는 앱들
# 순으로 띄운다. 예전엔 사람이 나중에 동기화하고 세 앱을 재기동해야 했고, 안 하면 증상이
# 전부 「0건」이라 환경 문제로 보이지 않았다 (docs/local-e2e-environment.md §2-A).
set -uo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/local/e2e-env-map.sh
source scripts/local/e2e-env-map.sh
mkdir -p logs

PROFILE="${E2E_PROFILE:-e2e}"
DRY="${DRY_RUN:-}"

# ── kafka 게이트. 🔴 channel-adapter·wallet·membership 은 kafka 없이 부팅하면 경고가 아니라
# KafkaJSNonRetriableError 로 «죽는다». 그 상태로 띄우면 로그를 열기 전엔 안 보인다.
# 띄우는 건 bootstrap 의 일이므로 여기선 막고 안내만 한다.
if [ "$DRY" != "1" ] && ! e2e_kafka_up; then
  echo "❌ kafka :9092 가 안 열려 있다."
  echo "   이대로 띄우면 channel-adapter·wallet·membership 이 KafkaJSNonRetriableError 로 죽는다"
  echo "   (경고가 아니라 프로세스 종료다 — 로그를 열기 전엔 안 보인다)."
  echo "   → npm run bootstrap:e2e:local     # 컨테이너를 띄우는 건 bootstrap 의 일이다"
  exit 1
fi

if [ "${SKIP_BUILD:-}" != "1" ] && [ "$DRY" != "1" ]; then
  echo "── 빌드 (nest 앱. 프론트는 dev 모드로 뜬다)"
  npm run build && npm run build:analytics && npm run build:ugc-service || exit 1
fi

pids=()
trap 'echo "종료 중..."; kill "${pids[@]}" 2>/dev/null; wait; exit 0' INT TERM

launch() {
  local name="$1" dest="$2" tmpl="$3" port="$4" tier="$5" kind="$6" target="$7" needs="$8" desc="$9"
  [ "$PROFILE" != "full" ] && [ "$tier" = "extra" ] && return 0
  [ "$needs" != "$LAUNCH_PHASE" ] && return 0
  # .env 가 없으면 «띄우지 않는다». 예전엔 그대로 띄워서 analytics·ugc-service 가 매번
  # `Cannot read properties of null (reading 'clientId')` 로 죽고 로그만 빨갰다.
  if ! e2e_env_present "$dest"; then
    printf '\033[33m⊘ %s (:%s) — %s 없음. 건너뛴다\033[0m\n' "$name" "$port" "$dest"
    return 0
  fi
  if [ "$DRY" = "1" ]; then echo "▶ (dry-run) $name (:$port) [$kind $target]"; return 0; fi
  case "$kind" in
    nest)          npx dotenv -e "$dest" -- node "dist/apps/$target/main.js" > "logs/$name.log" 2>&1 & ;;
    web|medusa)    (cd "$target" && npm run dev) > "logs/$name.log" 2>&1 & ;;
  esac
  pids+=($!)
  echo "▶ $name (:$port) → logs/$name.log"
}

# ── SMS 스텁 (회원가입 폰 인증). 표에 없다 — .env 가 없는 순수 스텁이라서.
if [ "$DRY" = "1" ]; then echo "▶ (dry-run) sms-stub (:3099)"; else
  node scripts/local/sms-stub.js > logs/sms-stub.log 2>&1 &
  pids+=($!); echo "▶ sms-stub (:3099) → logs/sms-stub.log"
fi

# ── ① medusa 와 «키를 안 읽는» 앱들 (medusa 도 needs_key=no 라 여기 포함된다)
LAUNCH_PHASE=no
e2e_env_each "" launch
[ "$PROFILE" != "full" ] && echo "· extra 앱(리뷰·통계·알림·검색)은 생략 — E2E_PROFILE=full 로 함께 띄운다"

# ── ② medusa 를 기다렸다가 키 동기화
if [ "$DRY" = "1" ]; then
  echo "· (dry-run) medusa :9000 을 기다렸다가 sync-medusa-keys.sh — 아래보다 «먼저»"
elif [ "${SKIP_KEY_SYNC:-}" != "1" ]; then
  echo "· medusa :9000 대기 중 (키 동기화 후에 의존 앱들을 띄운다)"
  for _ in $(seq 1 120); do e2e_port_open 9000 && break; sleep 2; done
  if e2e_port_open 9000; then
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
LAUNCH_PHASE=yes
e2e_env_each "" launch

echo ""
if [ "$DRY" = "1" ]; then echo "(dry-run) 실제로 띄우지 않았다."; exit 0; fi
echo "전부 기동 중. 로그: tail -f logs/<이름>.log / 종료: Ctrl+C"
echo "판정: npm run preflight:e2e:local"
wait
