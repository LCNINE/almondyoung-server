#!/usr/bin/env bash
# 로컬 전 과정(E2E) 환경 사전 «판정». 읽기 전용이다 — 아무것도 고치지 않는다.
#
# 🔴 「떠 있다」와 「최신이고 옳다」는 다르다. 2026-09-05 리허설에서 포트 8개가 전부 열려 있었지만
# 프로세스는 4일 묵은 코드였고 스키마는 3주 밀려 있었다. 이 스크립트는 그걸 잡는다.
#
# 🔴 여기서 «고치지» 않는 것이 핵심이다. 판정자가 스스로 고치면 초록불이 더 이상 증거가 아니게
# 된다("방금 내가 고쳤으니 초록"과 "원래 옳았다"를 구별할 수 없다). 고치는 건 bootstrap 이다:
#     bootstrap-e2e.sh  → 상태를 만든다 (쓰기)
#     start-all.sh      → 프로세스를 띄운다
#     preflight-e2e.sh  → 판정한다 (읽기 전용)  ← 지금 이 파일
# 그래서 아래 모든 ✗ 는 «어느 명령이 고치는지»를 함께 적는다.
#
# 사용: npm run preflight:e2e:local
set -uo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/local/e2e-env-map.sh
source scripts/local/e2e-env-map.sh
FAIL=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=1; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

PG="${LOCAL_PG:-postgresql://postgres:postgres@localhost:5432}"
MEDUSA_URL="${MEDUSA_URL:-http://localhost:9000}"
url_of() { grep -m1 '^DATABASE_URL=' "$1" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' '; }
pgq() { psql "$1" -tAc "$2" 2>/dev/null | tr -d '[:space:]'; }
http_code() { curl -s -m 10 -o /dev/null -w '%{http_code}' "$@"; }

# 여러 .env 에 같은 값이 들어 있어야 하는 키를 한 번에 판정한다.
# 어긋나면 «조용히» 401/400 이 되는 부류라, 화면만 보면 원인이 안 보인다.
same_value() {
  local key="$1"; shift
  local first="" f v missing=0
  for f in "$@"; do
    [ -f "$f" ] || { missing=1; continue; }
    v=$(e2e_env_value "$f" "$key")
    [ -z "$v" ] && { bad "$key 가 $f 에 없다 → docs/local-e2e-environment.md §4"; return; }
    if [ -z "$first" ]; then first="$v"; elif [ "$v" != "$first" ]; then
      bad "$key 가 앱마다 다르다 ($f) — 조용히 401/400 이 된다"; return
    fi
  done
  [ "$missing" = "1" ] && { warn "$key — 비교 대상 .env 일부가 없다"; return; }
  ok "$key 일치 ($#곳)"
}

echo "── 0. .env 배치 (정본 표: scripts/local/e2e-env-map.sh)"
check_env() {
  local name="$1" dest="$2" tmpl="$3" port="$4" tier="$5" kind="$6" target="$7" needs="$8" desc="$9"
  if e2e_env_present "$dest"; then ok "$name (:$port) — $dest"
  elif [ "$tier" = "required" ]; then
    bad "$name — $dest 없음 ($desc) → npm run bootstrap:e2e:local -- --install-env"
  else
    warn "$name — $dest 없음. extra 앱이라 E2E 판정과 무관하고, 없으면 안 띄운다"
  fi
}
e2e_env_each required check_env
e2e_env_each extra check_env

echo "── 1. 컨테이너"
for svc in postgres redis kafka; do
  state=$(docker compose ps -a --format '{{.Service}} {{.State}}' 2>/dev/null | awk -v s="$svc" '$1==s{print $2}')
  [ "$state" = "running" ] && ok "$svc running" || bad "$svc = ${state:-없음} → npm run bootstrap:e2e:local (kafka 는 zookeeper 부터 재기동한다)"
done

# 🔴 컨테이너가 running 이어도 브로커가 안 열려 있을 수 있다. 그 상태로 앱을 띄우면
# channel-adapter·wallet·membership 이 KafkaJSNonRetriableError 로 죽는다 — 경고가 아니라 종료다.
e2e_kafka_up && ok "kafka :9092 (브로커가 실제로 열렸다)" \
  || bad "kafka :9092 가 안 열렸다 → npm run bootstrap:e2e:local (필요하면 FORCE_KAFKA_RECREATE=1)"

echo "── 2. 포트"
check_port() { e2e_port_open "$1"; }
check_port_row() {
  local name="$1" dest="$2" tmpl="$3" port="$4" tier="$5" kind="$6" target="$7" needs="$8" desc="$9"
  e2e_env_present "$dest" || return 0   # 안 띄우기로 한 앱은 판정하지 않는다
  if ! check_port "$port"; then
    bad "$port $name — 안 떠 있음 → npm run start:all:local (logs/$name.log 확인)"; return
  fi
  # 🔴 «열림»과 «맞는 앱이 열었다»는 다르다. 2026-09-06 에 channel-adapter 가 3010 을 쥐고
  # file-service 는 안 떠 있었는데 preflight 는 「3010 ✓」로 초록을 줬다 — 그 상태에서 상품
  # 이미지 업로드는 channel-adapter 로 갔다. 그래서 소유자까지 본다.
  local sig owner
  sig=$(e2e_proc_signature "$kind" "$target")
  [ -z "$sig" ] && { ok "$port $name"; return; }          # web 은 next dev 라 구별 불가 — 판정 안 함
  owner=$(e2e_port_owner "$port")
  [ -z "$owner" ] && { ok "$port $name (소유자 확인 불가)"; return; }
  case "$owner" in
    *"$sig"*) ok "$port $name" ;;
    *) bad "$port 를 «$name 이 아닌» 것이 쥐고 있다: ${owner:0:60} — 포트 충돌. 각 .env 의 PORT 를 볼 것" ;;
  esac
}
e2e_env_each required check_port_row
e2e_env_each extra check_port_row
check_port 3099 && ok "3099 sms-stub" || bad "3099 sms-stub — 폰 인증 503 → 가입 UI 를 못 지난다 (start-all.sh 가 띄운다)"
if check_port 19000; then ok "19000 medusa-metrics"
elif check_port 9000; then bad "19000 medusa-metrics — medusa 는 떴는데 메트릭이 없다. apps/medusa/.env 에 PORT=9000 을 넣고 재기동"
else warn "19000 medusa-metrics — medusa 자체가 안 떠 있다"; fi

echo "── 3. 프로세스 신선도 (오늘 뜬 것인가)"
STALE=$(ps -eo lstart,args | grep -E 'nest start|next dev|medusa develop|main\.js' | grep -v grep \
        | grep -vc "$(date '+%b %e')" || true)
[ "${STALE:-0}" -eq 0 ] && ok "전부 오늘 기동" || warn "${STALE}개가 오늘 이전 기동 — 옛 코드일 수 있다 (재기동: npm run start:all:local)"

echo "── 4. 스키마 최신 여부"
MED=$(url_of apps/medusa/.env)
[ -n "$MED" ] && {
  [ "$(pgq "$MED" "SELECT to_regclass('public.coupon_grant')")" = "coupon_grant" ] \
    && ok "medusa: coupon_grant 존재" || bad "medusa 마이그 밀림 → npm run bootstrap:e2e:local"
}
USR=$(url_of apps/user-service/.env)
[ -n "$USR" ] && {
  [ "$(pgq "$USR" "SELECT count(*) FROM information_schema.columns WHERE table_name='users' AND column_name='dormant_at'")" = "1" ] \
    && ok "user-service: users.dormant_at 존재" || bad "user-service 마이그 밀림 → 로그인이 500 → npm run bootstrap:e2e:local"
}
# 🔴 apps/core/.env 는 core 가 아니라 dev_core 를 본다. 판정 SQL 을 core 에 날리면 안 된다.
CORE=$(url_of apps/core/.env)
[ -n "$CORE" ] && {
  case "$CORE" in *dev_core) ok "core → dev_core (E2E 가 보는 DB)" ;;
    *) warn "apps/core/.env 의 DATABASE_URL 이 dev_core 가 아니다: ${CORE##*/} — 판정 SQL 대상이 갈린다" ;; esac
}

echo "── 5. 시드"
[ -n "$USR" ] && {
  [ "$(pgq "$USR" "SELECT count(*) FROM oauth_clients")" -ge 3 ] 2>/dev/null \
    && ok "oauth_clients ≥3" || bad "user-service 시드 미실행 → npm run db:seed:user-service:local"
}
WAL=$(url_of apps/wallet/.env)
[ -n "$WAL" ] && {
  [ "$(pgq "$WAL" "SELECT count(*) FROM region_payment_methods")" -ge 1 ] 2>/dev/null \
    && ok "wallet: 결제수단 매핑 존재" || bad "결제화면이 「사용 가능한 결제수단이 없습니다」 → npm run db:seed:wallet:local"
}
[ -n "$CORE" ] && {
  # 활성 판매채널이 없으면 주문 수집이 «이번 주기의 모든 채널을 건너뛴다» — 워터마크가 안 움직인다.
  [ "$(pgq "$CORE" "SELECT count(*) FROM sales_channels")" -ge 1 ] 2>/dev/null \
    && ok "core: 판매채널 존재 (주문 수집 게이트)" || bad "판매채널 0행 → 주문이 core 로 안 흘러온다 → npm run db:seed:core:local"
  # 공급처 0행이면 매칭 다이얼로그가 «열리지도» 않는다 (#795).
  [ "$(pgq "$CORE" "SELECT count(*) FROM suppliers")" -ge 1 ] 2>/dev/null \
    && ok "core: 공급처 존재 (매칭 다이얼로그)" || bad "suppliers 0행 → 매칭을 시작조차 못 한다 → npm run db:seed:core:local"
}
[ -n "$MED" ] && {
  [ "$(pgq "$MED" "SELECT count(*) FROM region")" -ge 1 ] 2>/dev/null \
    && ok "medusa: region 존재" || bad "medusa 시드 미실행 → npm run bootstrap:e2e:local"
}

echo "── 6. 앱 사이에서 «같아야» 하는 값 (어긋나면 조용히 401/400)"
same_value OAUTH_INTERNAL_SECRET apps/user-service/.env web/auth-web/.env.local
same_value OIDC_CLIENT_SECRET apps/medusa/.env web/almondyoung-storefront/.env.local apps/admin-web/.env.local apps/wallet-web/.env.local
same_value WALLET_API_KEY apps/medusa/.env apps/wallet/.env apps/wallet-web/.env.local
same_value CORE_INTERNAL_KEY apps/core/.env apps/channel-adapter/.env
same_value MEDUSA_API_KEY apps/channel-adapter/.env apps/admin-web/.env.local

echo "── 7. OIDC_ISSUER_URL 이 «로컬» IdP 를 가리키는가"
# 🔴 라이브를 가리키면 libs/authorization 이 라이브 JWKS 로 서명을 검증해 전 API 가 401 인데,
# 화면은 「총 주문 0건」을 멀쩡히 그린다. 2026-09-06 에 apps/core/.env 가 실제로 그랬다.
for f in apps/core/.env apps/user-service/.env apps/channel-adapter/.env apps/wallet/.env \
         apps/medusa/.env apps/admin-web/.env.local web/almondyoung-storefront/.env.local; do
  [ -f "$f" ] || continue
  v=$(e2e_env_value "$f" OIDC_ISSUER_URL)
  case "$v" in
    "") warn "$f 에 OIDC_ISSUER_URL 없음" ;;
    http://localhost:3000|http://127.0.0.1:3000) ok "$f → $v" ;;
    *) bad "$f 의 OIDC_ISSUER_URL 이 $v — 로컬 토큰 서명을 검증 못 해 «전 API 401». http://localhost:3000 으로" ;;
  esac
done

echo "── 8. Medusa API 키가 «지금» 유효한가"
# 🔴 medusa DB 를 초기화하면 키가 새로 발급되는데 증상이 전부 「0건」이라 환경 문제로 안 보인다.
if (echo >/dev/tcp/127.0.0.1/9000) >/dev/null 2>&1; then
  PK=$(e2e_env_value web/almondyoung-storefront/.env.local NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY)
  SK=$(e2e_env_value apps/channel-adapter/.env MEDUSA_API_KEY)
  if [ -n "$PK" ]; then
    c=$(http_code -H "x-publishable-api-key: $PK" "${MEDUSA_URL}/store/regions")
    [ "$c" = "200" ] && ok "publishable → /store/regions 200" \
      || bad "publishable 키 무효(HTTP $c) → storefront 상품이 「0건」. npm run sync:medusa-keys:local 후 재기동"
  else warn "storefront 에 NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY 없음"; fi
  if [ -n "$SK" ]; then
    c=$(http_code -H "Authorization: Basic $(printf '%s:' "$SK" | base64 -w0)" "${MEDUSA_URL}/admin/orders?limit=1")
    [ "$c" = "200" ] && ok "secret → /admin/orders 200" \
      || bad "secret 키 무효(HTTP $c) → 주문 수집 0건·어드민 주문조회 「0건」. npm run sync:medusa-keys:local 후 재기동"
  else warn "channel-adapter 에 MEDUSA_API_KEY 없음"; fi
else
  warn "medusa :9000 이 안 떠 있어 키 유효성을 못 잰다"
fi

echo "── 9. 그 외 «없으면 조용히 죽는» 값"
grep -q '^PORT=' apps/medusa/.env 2>/dev/null && ok "medusa PORT (=:19000 메트릭)" || bad "apps/medusa/.env 에 PORT=9000 없음 → :19000 이 안 열린다"
grep -q '^WALLET_SERVICE_URL=' apps/admin-web/.env.local 2>/dev/null && ok "admin-web WALLET_SERVICE_URL" || bad "admin-web 적립금 화면이 조용히 죽는다(통계가 전부 0)"
grep -q '^NOTIFICATION_SERVICE_URL=' apps/user-service/.env 2>/dev/null && ok "user-service → SMS 스텁" || bad "폰 인증이 503 → 회원가입 UI 를 못 지난다"
[ -n "$(e2e_env_value apps/medusa/.env COUPON_AUTO_ISSUE_ENABLED)" ] && ok "medusa COUPON_AUTO_ISSUE_ENABLED" || warn "쿠폰 자동발급 API 가 빈 배열만 반환한다"

echo "── 10. 포트 충돌"
CA=$(e2e_env_value apps/channel-adapter/.env PORT)
FS=$(e2e_env_value apps/file-service/.env PORT)
[ -n "$CA" ] && [ "$CA" = "$FS" ] && bad "channel-adapter 와 file-service 가 둘 다 PORT=$CA — 하나만 뜬다" || ok "channel-adapter(${CA:-?}) ≠ file-service(${FS:-?})"

echo
[ "$FAIL" -eq 0 ] && echo "✅ 사전 점검 통과" || { echo "❌ 위 ✗ 를 먼저 해결할 것"; exit 1; }
