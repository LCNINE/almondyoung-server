#!/usr/bin/env bash
# 로컬 E2E 환경의 «정본 대응표» — 어떤 앱이 어떤 .env 를 어디에 두고 몇 번 포트로 뜨는가.
#
# bootstrap-e2e.sh · start-all.sh · preflight-e2e.sh 셋이 전부 이 파일을 source 한다.
# 이 표가 산문으로만 있던 동안 두 문서가 갈렸다 — docs/local-dev.md 는 6줄, 
# docs/local-e2e-environment.md 는 11개 앱을 적었고, start-all.sh 는 또 다른 10개를 띄웠다.
# 표를 코드로 옮겨서 «한 곳만 고치면 되게» 한다. 앱을 늘리면 여기만 추가할 것.
#
# 열: <이름>|<대상 .env 경로>|<env-templates 템플릿(없으면 -)>|<포트>|<tier>|<설명>
#   tier=required : E2E 전 과정(가입→주문→결제→출고)에 반드시 필요한 11개
#   tier=extra    : 있으면 좋지만 E2E 판정과 무관 (어드민 대시보드 타일 몇 칸)
#                   .env 가 없으면 부팅하다 죽으므로, 없으면 «띄우지 않는다».
E2E_ENV_ROWS=(
  "user-service|apps/user-service/.env|.env.user-service.local.example|3000|required|IdP — 가입·로그인·역할"
  "membership|apps/membership/.env|.env.membership.local.example|3001|required|멤버십 트리거"
  "channel-adapter|apps/channel-adapter/.env|.env.channel-adapter.local.example|3003|required|이벤트 인박스·주문 수집"
  "file-service|apps/file-service/.env|.env.file-service.local.example|3010|required|상품 이미지 업로드"
  "core|apps/core/.env|.env.core.local.example|3100|required|어드민 주문조회·출고·매칭"
  "wallet-web|apps/wallet-web/.env.local|.env.wallet-web.local.example|3200|required|결제 화면 (체크아웃이 넘어간다)"
  "wallet|apps/wallet/.env|.env.wallet.local.example|5001|required|결제·포인트 백엔드"
  "storefront|web/almondyoung-storefront/.env.local|.env.storefront.local.example|8000|required|쇼핑몰"
  "auth-web|web/auth-web/.env.local|.env.auth-web.local.example|8001|required|로그인/가입 UI"
  "admin-web|apps/admin-web/.env.local|.env.admin-web.local.example|8002|required|관리자"
  "medusa|apps/medusa/.env|.env.medusa.local.example|9000|required|커머스 코어"
  "ugc-service|apps/ugc-service/.env|-|3030|extra|리뷰 (어드민 「미답변 리뷰」 타일)"
  "analytics|apps/analytics/.env|-|3040|extra|통계 (어드민 대시보드 타일)"
  "notification|apps/notification/.env|-|3050|extra|알림 — 로컬은 scripts/local/sms-stub.js 로 대체한다"
  "search|apps/search/.env|-|3060|extra|상품 검색"
)

# 행을 필드로 쪼개 콜백에 넘긴다. 사용: e2e_env_each required my_fn   (tier 생략 시 전부)
e2e_env_each() {
  local want="${1:-}" fn="$2" row name dest tmpl port tier desc
  for row in "${E2E_ENV_ROWS[@]}"; do
    IFS='|' read -r name dest tmpl port tier desc <<< "$row"
    [ -n "$want" ] && [ "$want" != "$tier" ] && continue
    "$fn" "$name" "$dest" "$tmpl" "$port" "$tier" "$desc"
  done
}

# 그 앱의 .env 가 배치돼 있는가 (bootstrap/start-all/preflight 가 같은 기준을 쓰게).
e2e_env_present() { [ -f "$1" ]; }

# .env 한 줄의 값을 읽는다. 없으면 빈 문자열. 따옴표는 벗긴다.
e2e_env_value() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  grep -m1 "^${key}=" "$file" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' ' || true
}
