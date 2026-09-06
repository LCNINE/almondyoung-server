#!/usr/bin/env bash
# 로컬 전 과정(E2E) 환경을 «만든다». 멱등하다 — 몇 번을 돌려도 같은 상태로 수렴한다.
#
# preflight-e2e.sh 의 짝이다. 역할이 다르다:
#   bootstrap  = 상태를 «만든다» (쓰기. 앱을 띄우기 전)
#   start-all  = 프로세스를 «띄운다»
#   preflight  = 상태를 «판정한다» (읽기 전용. 클릭하기 직전)
# preflight 가 고치는 일까지 하면 초록불이 더 이상 증거가 아니게 된다 — 그래서 둘을 나눈다.
#
# 사용:
#   npm run bootstrap:e2e:local                    # 전체
#   npm run bootstrap:e2e:local -- --install-env   # 없는 .env 를 템플릿에서 «복사까지» 한다
#   SKIP_CONTAINERS=1 npm run bootstrap:e2e:local  # 컨테이너 단계 생략
#   SKIP_MIGRATE=1 / SKIP_SEED=1                   # 각 단계 생략
#   LOCAL_POINT_LOGIN_IDS=<가입한아이디> …          # 포인트 시드 대상 (§2-B — 기본 계정은 새 DB 에 없다)
#
# 끝나면 `npm run start:all:local` → `npm run preflight:e2e:local` 순서다.
set -uo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/local/e2e-env-map.sh
source scripts/local/e2e-env-map.sh

INSTALL_ENV=0
for arg in "$@"; do
  case "$arg" in
    --install-env) INSTALL_ENV=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "알 수 없는 인자: $arg" >&2; exit 2 ;;
  esac
done

PG="${LOCAL_PG:-postgresql://postgres:postgres@localhost:5432}"
FAIL=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=1; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

pgq() { psql "$1" -tAc "$2" 2>/dev/null | tr -d '[:space:]'; }

# ─────────────────────────────────────────────────────────── 0. .env 배치
step "0. .env 배치 (정본 표: scripts/local/e2e-env-map.sh)"
MISSING=0
check_env() {
  local name="$1" dest="$2" tmpl="$3" port="$4" tier="$5" desc="$6"
  if e2e_env_present "$dest"; then ok "$name (:$port) — $dest"; return; fi
  if [ "$tmpl" = "-" ]; then
    warn "$name — $dest 없음, 템플릿도 없다. extra 앱이라 E2E 판정엔 무관하고, 없으면 안 띄운다"
    return
  fi
  if [ "$INSTALL_ENV" = "1" ]; then
    mkdir -p "$(dirname "$dest")"
    cp "env-templates/$tmpl" "$dest" && ok "$name ← env-templates/$tmpl → $dest (복사함 — 🔴 자리표시자를 채울 것)"
  else
    bad "$name 없음 ($desc) → cp env-templates/$tmpl $dest   (또는 --install-env)"
    MISSING=1
  fi
}
e2e_env_each required check_env
e2e_env_each extra check_env
if [ "$MISSING" = "1" ]; then
  echo
  echo "❌ .env 가 빠져 있다. --install-env 로 한 번에 복사한 뒤 «자리표시자를 채우고» 다시 실행할 것."
  echo "   채워야 하는 값과 앱 사이에서 일치해야 하는 값: docs/local-e2e-environment.md §4"
  exit 1
fi

# ─────────────────────────────────────────────────────────── 1. 컨테이너
if [ "${SKIP_CONTAINERS:-}" = "1" ]; then
  step "1. 컨테이너 — SKIP_CONTAINERS=1 이라 건너뜀"
else
  step "1. 컨테이너 (postgres · redis · kafka)"
  docker compose up -d postgres redis >/dev/null 2>&1 && ok "postgres · redis" || bad "postgres/redis 기동 실패"
  # 🔴 kafka 를 recreate 하면 zookeeper 에 옛 broker znode 가 남아 즉사한다. stop → zk 재시작 → up 순서.
  docker compose stop kafka >/dev/null 2>&1
  docker compose restart zookeeper >/dev/null 2>&1
  docker compose up -d kafka >/dev/null 2>&1
  for _ in $(seq 1 60); do (echo > /dev/tcp/127.0.0.1/9092) >/dev/null 2>&1 && break; sleep 2; done
  (echo > /dev/tcp/127.0.0.1/9092) >/dev/null 2>&1 && ok "kafka :9092" || bad "kafka :9092 가 안 열린다 (docker compose logs kafka)"
fi

# ─────────────────────────────────────────────────────────── 2. 마이그레이션
if [ "${SKIP_MIGRATE:-}" = "1" ]; then
  step "2. 마이그레이션 — SKIP_MIGRATE=1 이라 건너뜀"
else
  step "2. 마이그레이션 (drizzle 11개 DB + Medusa 는 별개다)"
  npm run --silent db:migrate:local >/dev/null 2>&1 && ok "drizzle (core·dev_core·wallet·… 11개)" \
    || bad "drizzle 마이그레이션 실패 → ./scripts/local/migrate-all.sh 를 직접 돌려 로그를 볼 것"
  (cd apps/medusa && npx medusa db:migrate --execute-safe-links) >/dev/null 2>&1 \
    && ok "medusa (+ module link sync)" || bad "medusa 마이그레이션 실패"
fi

# ─────────────────────────────────────────────────────────── 3. 시드
if [ "${SKIP_SEED:-}" = "1" ]; then
  step "3. 시드 — SKIP_SEED=1 이라 건너뜀"
else
  step "3. 시드 (전부 ON CONFLICT — 다시 돌려도 안전하다)"
  npm run --silent db:seed:user-service:local >/dev/null 2>&1 \
    && ok "user-service — 역할·스코프·admin 계정·OAuth 클라이언트 3" || bad "user-service 시드 실패"
  npm run --silent db:seed:wallet:local >/dev/null 2>&1 \
    && ok "wallet — 결제수단·지역 (없으면 결제화면이 「사용 가능한 결제수단이 없습니다」)" || bad "wallet 시드 실패"
  npm run --silent db:seed:core:local >/dev/null 2>&1 \
    && ok "core(dev_core) — 판매채널·공급처·매칭 backfill" || bad "core 시드 실패"

  # Medusa 시드는 ON CONFLICT 가 아니다 — 이미 시드됐으면 건너뛴다.
  REGIONS=$(pgq "${PG}/medusa" "SELECT count(*) FROM region")
  if [ "${REGIONS:-0}" -gt 0 ] && [ "${FORCE_MEDUSA_SEED:-}" != "1" ]; then
    ok "medusa — 이미 시드됨 (region ${REGIONS}개). 다시 하려면 FORCE_MEDUSA_SEED=1"
  else
    (cd apps/medusa && npx medusa exec ./src/scripts/seed.ts && npx medusa exec ./src/scripts/seed-shipping.ts) >/dev/null 2>&1 \
      && ok "medusa — store·region·tax·publishable key·sales channel + 배송" || bad "medusa 시드 실패"
  fi

  # 🔴 §2-B. user-service 시드가 만드는 계정은 admin 하나뿐이다. 인자 없이 돌리면 아무에게도 안 들어간다.
  if [ -n "${LOCAL_POINT_LOGIN_IDS:-}" ]; then
    npm run --silent db:seed:points:local >/dev/null 2>&1 \
      && ok "포인트 — ${LOCAL_POINT_LOGIN_IDS}" || bad "포인트 시드 실패"
  else
    warn "포인트 시드는 건너뜀 — 대상 계정이 필요하다. 가입을 «먼저» 하고:"
    warn "    LOCAL_POINT_LOGIN_IDS=<가입한아이디> npm run db:seed:points:local"
  fi
fi

# ─────────────────────────────────────────────────────────── 4. Medusa 키 동기화
step "4. Medusa API 키 동기화"
if (echo > /dev/tcp/127.0.0.1/9000) >/dev/null 2>&1; then
  npm run --silent sync:medusa-keys:local >/dev/null 2>&1 \
    && ok "publishable · secret 키를 storefront·channel-adapter·admin-web 에 반영" \
    || bad "키 동기화 실패 → npm run sync:medusa-keys:local 을 직접 돌려 로그를 볼 것"
else
  # medusa 가 떠 있어야만 되는 단계다(secret 은 DB 에 해시로만 남아 실제 호출로 유효성을 잰다).
  # start-all.sh 가 medusa 를 띄운 «직후·의존 앱들보다 먼저» 자동으로 부른다 — 그래서 여기선 안내만.
  ok "medusa 가 아직 안 떠 있다 — start-all.sh 가 medusa 기동 직후 자동으로 동기화한다"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 준비 완료. 다음:"
  echo "     npm run start:all:local        # 앱 기동 (medusa 뜬 뒤 키 동기화까지 자동)"
  echo "     npm run preflight:e2e:local    # 클릭하기 직전 판정"
else
  echo "❌ 위 ✗ 를 먼저 해결할 것."
  exit 1
fi
