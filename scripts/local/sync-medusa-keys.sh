#!/usr/bin/env bash
# 로컬 Medusa API 키를 .env 세 곳에 맞춘다.
#
# 왜 필요한가: Medusa DB 를 밀고 다시 시드하면 API 키가 «전부 새로 발급»된다. 그런데 그 값은
# .env(그리고 env-templates 의 예제)에 하드코딩돼 있어, 초기화 뒤엔 옛 키가 남는다.
# 증상이 조용하다 —
#   · storefront: Store API 가 401 → 상품이 0건으로 보인다(에러 화면이 아니다)
#   · channel-adapter: Medusa Admin API 가 401 → 주문 수집이 0건, 어드민 주문조회는 그냥 「0건」
#   · admin-web: /api/proxy/medusa/* 가 401
# 2026-09-06 전체 초기화에서 실제로 셋 다 밟았다 (docs/local-e2e-environment.md §2).
#
# 사용법: npm run sync:medusa-keys:local   (또는 ./scripts/local/sync-medusa-keys.sh)
#         medusa(:9000) 와 postgres 가 떠 있어야 한다.
set -euo pipefail
cd "$(dirname "$0")/../.."

PG="${LOCAL_PG:-postgresql://postgres:postgres@localhost:5432}"
MEDUSA_URL="${MEDUSA_URL:-http://localhost:9000}"

STOREFRONT_ENV="web/almondyoung-storefront/.env.local"
CHANNEL_ADAPTER_ENV="apps/channel-adapter/.env"
ADMIN_WEB_ENV="apps/admin-web/.env.local"

fail() { echo "  ✗ $*" >&2; exit 1; }

# .env 파일의 KEY=... 한 줄을 교체하거나(없으면) 덧붙인다.
put_env() {
  local file="$1" key="$2" value="$3"
  [ -f "$file" ] || fail "$file 이 없다 — env-templates 에서 먼저 복사할 것"
  if grep -q "^${key}=" "$file"; then
    # value 에 / & 가 들어갈 수 있으므로 구분자를 | 로 두고 & 를 이스케이프한다.
    # 🔴 `sed -i` 는 GNU 전용이다 — BSD(macOS) sed 는 -i 뒤를 «백업 접미사»로 먹어서
    # 스크립트와 파일이 한 칸씩 밀린다(web/... 이 `w eb/...` 로 파싱돼 "No such file").
    # 개발 머신이 macOS 라 perl 로 둔다. 둘 다에서 같게 동작한다.
    local escaped=${value//&/\\&}
    perl -pi -e "s|^\Q${key}\E=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

http_code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "── 1. publishable key (storefront)"
# seed.ts 가 만드는 것은 title='Webshop'. medusa db:migrate 가 만드는 'Default Publishable API Key'
# 도 같은 sales channel 에 붙지만, 시드가 보증하는 쪽을 정본으로 쓴다.
PK=$(psql "${PG}/medusa" -tAc "SELECT token FROM api_key
      WHERE type='publishable' AND title='Webshop' AND revoked_at IS NULL AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 1" 2>/dev/null | tr -d '[:space:]')
[ -n "$PK" ] || fail "publishable key 가 없다 — (cd apps/medusa && npx medusa exec ./src/scripts/seed.ts) 먼저"
put_env "$STOREFRONT_ENV" NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY "$PK"
echo "  ✓ ${PK:0:12}… → $STOREFRONT_ENV"

echo "── 2. secret key (channel-adapter · admin-web)"
# 🔴 secret 토큰은 DB 에 «해시»로 저장된다(평문은 발급 시 1회만 반환). 그래서 DB 에서 읽어올 수
# 없고, 지금 .env 에 있는 값이 아직 유효한지 «실제 호출로» 재는 수밖에 없다.
CURRENT_SK=$(grep -m1 '^MEDUSA_API_KEY=' "$CHANNEL_ADAPTER_ENV" 2>/dev/null | cut -d= -f2- || true)
SK=""
if [ -n "$CURRENT_SK" ]; then
  code=$(http_code -H "Authorization: Basic $(printf '%s:' "$CURRENT_SK" | base64 -w0)" \
          "${MEDUSA_URL}/admin/orders?limit=1" || true)
  if [ "$code" = "200" ]; then
    SK="$CURRENT_SK"
    echo "  · 기존 키가 아직 유효하다(200) — 새로 발급하지 않는다"
  else
    echo "  · 기존 키가 무효다(HTTP ${code:-연결실패}) — 새로 발급한다"
  fi
fi

if [ -z "$SK" ]; then
  SK=$( (cd apps/medusa && npx medusa exec ./src/scripts/create-local-secret-key.ts) 2>/dev/null \
        | grep -oE '^MEDUSA_API_KEY=sk_[0-9a-f]+' | head -1 | cut -d= -f2- )
  [ -n "$SK" ] || fail "secret key 발급 실패 — medusa 가 떠 있는지, DATABASE_URL 이 맞는지 확인"
  echo "  ✓ 새 secret key 발급: ${SK:0:12}…"
fi

put_env "$CHANNEL_ADAPTER_ENV" MEDUSA_API_KEY "$SK"
put_env "$ADMIN_WEB_ENV" MEDUSA_API_KEY "$SK"
echo "  ✓ ${SK:0:12}… → $CHANNEL_ADAPTER_ENV · $ADMIN_WEB_ENV"

echo "── 3. 검증"
pc=$(http_code -H "x-publishable-api-key: $PK" "${MEDUSA_URL}/store/regions" || true)
sc=$(http_code -H "Authorization: Basic $(printf '%s:' "$SK" | base64 -w0)" "${MEDUSA_URL}/admin/orders?limit=1" || true)
echo "  store/regions       → $pc"
echo "  admin/orders        → $sc"
[ "$pc" = "200" ] && [ "$sc" = "200" ] || fail "키 검증 실패 (기대 200/200)"

echo
echo "✅ 완료. 🔴 storefront · channel-adapter · admin-web 을 «재기동»해야 반영된다 (빌드타임/부팅시 읽는다)."
