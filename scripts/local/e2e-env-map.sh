#!/usr/bin/env bash
# 로컬 E2E 환경의 «정본 표» — 어떤 앱이 어떤 .env 를 어디에 두고, 몇 번 포트로, 어떻게 뜨는가.
#
# bootstrap-e2e.sh · start-all.sh · preflight-e2e.sh 셋이 전부 이 파일을 source 한다.
# 이 표가 산문으로만 있던 동안 두 문서가 갈렸다 — docs/local-dev.md 는 6줄,
# docs/local-e2e-environment.md 는 11개 앱을 적었고, start-all.sh 는 또 다른 10개를 띄웠다.
# 표를 코드로 옮겨서 «한 곳만 고치면 되게» 한다. 앱을 늘리면 여기만 추가할 것.
# 🔴 기동 정보(kind/target/needs_key)도 여기 있다. start-all 이 자기 표를 따로 들면
#    바로 그 «표 두 벌» 문제가 되살아난다.
#
# 열: <이름>|<대상 .env>|<템플릿(-)>|<포트>|<tier>|<kind>|<target>|<needs_key>|<설명>
#   tier=required : E2E 전 과정(가입→주문→결제→출고)에 반드시 필요한 11개
#   tier=extra    : E2E 판정과 무관. .env 가 없으면 부팅하다 죽으므로 «안 띄운다»
#   kind=nest     : dist/apps/<target>/main.js 를 dotenv 로 기동
#   kind=web      : <target> 디렉터리에서 npm run dev (포트는 그쪽 dev 스크립트가 고정)
#   kind=medusa   : <target> 에서 npm run dev. 키 동기화의 기준점이라 따로 다룬다
#   needs_key=yes : Medusa API 키를 «부팅 시» 읽는다 → 키 동기화 «뒤에» 띄워야 한다
E2E_ENV_ROWS=(
  "user-service|apps/user-service/.env|.env.user-service.local.example|3000|required|nest|user-service|no|IdP — 가입·로그인·역할"
  "membership|apps/membership/.env|.env.membership.local.example|3001|required|nest|membership|no|멤버십 트리거"
  "channel-adapter|apps/channel-adapter/.env|.env.channel-adapter.local.example|3003|required|nest|channel-adapter|yes|이벤트 인박스·주문 수집"
  "file-service|apps/file-service/.env|.env.file-service.local.example|3010|required|nest|file-service|no|상품 이미지 업로드"
  "core|apps/core/.env|.env.core.local.example|3100|required|nest|core|no|어드민 주문조회·출고·매칭"
  "wallet-web|apps/wallet-web/.env.local|.env.wallet-web.local.example|3200|required|web|apps/wallet-web|no|결제 화면 (체크아웃이 넘어간다)"
  "wallet|apps/wallet/.env|.env.wallet.local.example|5001|required|nest|wallet|no|결제·포인트 백엔드"
  "storefront|web/almondyoung-storefront/.env.local|.env.storefront.local.example|8000|required|web|web/almondyoung-storefront|yes|쇼핑몰"
  "auth-web|web/auth-web/.env.local|.env.auth-web.local.example|8001|required|web|web/auth-web|no|로그인/가입 UI"
  "admin-web|apps/admin-web/.env.local|.env.admin-web.local.example|8002|required|web|apps/admin-web|yes|관리자"
  "medusa|apps/medusa/.env|.env.medusa.local.example|9000|required|medusa|apps/medusa|no|커머스 코어"
  "ugc-service|apps/ugc-service/.env|-|3030|extra|nest|ugc-service|no|리뷰 (어드민 「미답변 리뷰」 타일)"
  "analytics|apps/analytics/.env|-|3040|extra|nest|analytics|no|통계 (어드민 대시보드 타일)"
  "notification|apps/notification/.env|-|3050|extra|nest|notification|no|알림 — 로컬은 scripts/local/sms-stub.js 로 대체"
  "search|apps/search/.env|-|3060|extra|nest|search|no|상품 검색"
)

# 행을 필드로 쪼개 콜백에 넘긴다. 사용: e2e_env_each required my_fn   (tier 생략 시 전부)
e2e_env_each() {
  local want="${1:-}" fn="$2" row name dest tmpl port tier kind target needs desc
  for row in "${E2E_ENV_ROWS[@]}"; do
    IFS='|' read -r name dest tmpl port tier kind target needs desc <<< "$row"
    [ -n "$want" ] && [ "$want" != "$tier" ] && continue
    "$fn" "$name" "$dest" "$tmpl" "$port" "$tier" "$kind" "$target" "$needs" "$desc"
  done
}

# 그 앱의 .env 가 배치돼 있는가 (셋이 같은 기준을 쓰게).
e2e_env_present() { [ -f "$1" ]; }

# .env 한 줄의 값을 읽는다. 없으면 빈 문자열. 따옴표는 벗긴다.
e2e_env_value() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  grep -m1 "^${key}=" "$file" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' ' || true
}

# 🔴 kafka 없이 부팅하면 channel-adapter·wallet·membership 이 «죽는다» —
# 경고가 아니라 KafkaJSNonRetriableError 로 프로세스가 종료된다(재시도 5회 후).
# 그래서 「열려 있는가」는 셋 모두가 같은 함수로 물어야 한다.
e2e_port_open() { (echo >/dev/tcp/127.0.0.1/"$1") >/dev/null 2>&1; }
e2e_kafka_up()  { e2e_port_open 9092; }

# 그 포트를 «누가» 쥐고 있는지 돌려준다(못 알아내면 빈 문자열).
# 포트가 열렸다는 것과 «맞는 앱»이 열었다는 것은 다르다 — 2026-09-06 에 channel-adapter 가
# 3010 을 쥐고 file-service 는 안 떠 있었는데 preflight 는 「3010 ✓」로 초록을 줬다.
e2e_port_owner() {
  local pid
  pid=$(ss -ltnpH "sport = :$1" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
  [ -n "$pid" ] || return 0
  ps -p "$pid" -o args= 2>/dev/null || true
}

# kind/target 으로 «그 포트에 있어야 할» 프로세스의 지문을 만든다. web 은 next dev 라
# 명령줄로 앱을 구별할 수 없어 빈 문자열(= 판정하지 않음)을 준다.
e2e_proc_signature() {
  case "$1" in
    nest)   printf 'dist/apps/%s/main.js' "$2" ;;
    medusa) printf 'medusa' ;;
    *)      printf '' ;;
  esac
}
