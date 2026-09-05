#!/usr/bin/env bash
# 로컬 전 과정(E2E) 환경 사전 점검.
#
# 🔴 「떠 있다」와 「최신이다」는 다르다. 2026-09-05 리허설에서 포트 8개가 전부 열려 있었지만
# 프로세스는 4일 묵은 코드였고 스키마는 3주 밀려 있었다. 이 스크립트는 그걸 잡는다.
#
# 사용: bash scripts/local/preflight-e2e.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
FAIL=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=1; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

url_of() { grep -m1 '^DATABASE_URL=' "$1" 2>/dev/null | cut -d= -f2- | tr -d '"'\'' '; }

echo "── 1. 컨테이너"
for svc in postgres redis kafka; do
  state=$(docker compose ps -a --format '{{.Service}} {{.State}}' 2>/dev/null | awk -v s="$svc" '$1==s{print $2}')
  [ "$state" = "running" ] && ok "$svc running" || bad "$svc = ${state:-없음}  (kafka 가 exited 면 zookeeper 부터 재기동)"
done

echo "── 2. 포트"
check_port() { (echo >/dev/tcp/127.0.0.1/"$1") >/dev/null 2>&1; }
while read -r port name; do
  [ -z "$port" ] && continue
  check_port "$port" && ok "$port $name" || bad "$port $name — 안 떠 있음"
done <<'PORTS'
3000 user-service
3001 membership
3003 channel-adapter
3010 file-service
3100 core
3200 wallet-web
5001 wallet
8000 storefront
8001 auth-web
8002 admin-web
9000 medusa
19000 medusa-metrics
PORTS

echo "── 3. 프로세스 신선도 (오늘 뜬 것인가)"
STALE=$(ps -eo lstart,args | grep -E 'nest start|next dev|medusa develop' | grep -v grep \
        | grep -vc "$(date '+%b %e')" || true)
[ "${STALE:-0}" -eq 0 ] && ok "전부 오늘 기동" || warn "${STALE}개가 오늘 이전 기동 — 옛 코드일 수 있다"

echo "── 4. 스키마 최신 여부"
MED=$(url_of apps/medusa/.env)
[ -n "$MED" ] && {
  [ "$(psql "$MED" -tAc "SELECT to_regclass('public.coupon_grant');" 2>/dev/null)" = "coupon_grant" ] \
    && ok "medusa: coupon_grant 존재" || bad "medusa 마이그 밀림 → (cd apps/medusa && npx medusa db:migrate --execute-safe-links)"
}
USR=$(url_of apps/user-service/.env)
[ -n "$USR" ] && {
  [ "$(psql "$USR" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='users' AND column_name='dormant_at';" 2>/dev/null)" = "1" ] \
    && ok "user-service: users.dormant_at 존재" || bad "user-service 마이그 밀림 → 로그인이 500 으로 죽는다 (핸드오프 §4)"
}

echo "── 5. 시드"
[ -n "$USR" ] && {
  [ "$(psql "$USR" -tAc "SELECT count(*) FROM oauth_clients;" 2>/dev/null)" -ge 3 ] \
    && ok "oauth_clients ≥3 (medusa-storefront·admin-web·wallet-web)" || bad "user-service 시드 미실행 → npm run db:seed:user-service:local"
}
WAL=$(url_of apps/wallet/.env)
[ -n "$WAL" ] && {
  [ "$(psql "$WAL" -tAc "SELECT count(*) FROM region_payment_methods;" 2>/dev/null)" -ge 1 ] \
    && ok "wallet: 결제수단 매핑 존재" || bad "wallet 시드 미실행 → 결제화면이 「사용 가능한 결제수단이 없습니다」 → npx tsx scripts/local/seed-wallet-local.ts"
}

echo "── 6. 조용히 죽는 env 키"
grep -q '^PORT=' apps/medusa/.env 2>/dev/null && ok "medusa PORT (=:19000 메트릭)" || bad "apps/medusa/.env 에 PORT=9000 없음 → :19000 이 안 열린다"
grep -q '^WALLET_SERVICE_URL=' apps/admin-web/.env.local 2>/dev/null && ok "admin-web WALLET_SERVICE_URL" || bad "admin-web 적립금 화면이 조용히 죽는다"
[ -f apps/wallet-web/.env.local ] && ok "wallet-web .env.local 존재" || bad "wallet-web .env.local 없음 → 결제 페이지가 Missing required env var 로 죽는다 (핸드오프 §5)"
grep -q '^NOTIFICATION_SERVICE_URL=' apps/user-service/.env 2>/dev/null && ok "user-service → SMS 스텁" || warn "폰 인증이 503 → 회원가입 UI 를 못 지난다 (scripts/local/sms-stub.js)"

echo "── 7. 포트 충돌"
CA=$(grep -m1 '^PORT=' apps/channel-adapter/.env 2>/dev/null | cut -d= -f2)
FS=$(grep -m1 '^PORT=' apps/file-service/.env 2>/dev/null | cut -d= -f2)
[ -n "$CA" ] && [ "$CA" = "$FS" ] && bad "channel-adapter 와 file-service 가 둘 다 PORT=$CA — 하나만 뜬다 (핸드오프 §3)" || ok "channel-adapter($CA) ≠ file-service($FS)"

echo
[ "$FAIL" -eq 0 ] && echo "✅ 사전 점검 통과" || { echo "❌ 위 ✗ 를 먼저 해결할 것"; exit 1; }
