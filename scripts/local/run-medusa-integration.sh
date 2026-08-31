#!/usr/bin/env bash
#
# apps/medusa 의 통합 스펙 러너.
#   기본     : HTTP 통합 스펙 (integration-tests/http/*.spec.ts)
#   --modules: 모듈 통합 스펙 (src/modules/*/__tests__/**)
#
# 왜 별도 스크립트인가: `medusaIntegrationTestRunner` 는 DATABASE_URL 을 **읽지 않는다**.
# @medusajs/test-utils/dist/database.js:12-15 가 DB_HOST / DB_USERNAME / DB_PASSWORD / DB_PORT 를
# 따로 읽어 pg-god 로 임시 DB 를 만들었다 지운다. apps/medusa/.env 에는 그 넷이 없어서
# `npm run test:integration:http` 를 그냥 부르면 전 스펙이
#   SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string
# 로 죽는다. 이건 스펙이 빨간 게 아니라 환경이 안 넘어간 것이다.
#
# 사용: scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'
#       scripts/local/run-medusa-integration.sh --modules --testPathPattern 'promotion-meta'
#
# 모듈 통합 스펙(`moduleIntegrationTestRunner`)도 같은 넷을 읽는다 — `npm run
# test:integration:modules` 를 그냥 부르면 HTTP 쪽과 똑같이 SASL 로 죽는다.
#
# 전제: docker compose 의 postgres 가 떠 있고, apps/medusa/.env 의 DATABASE_URL 이 그것을 가리킨다.
#       임시 DB 를 CREATE/DROP 하므로 그 계정에 권한이 있어야 한다(로컬 postgres 는 superuser).
set -euo pipefail

MEDUSA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../apps/medusa" && pwd)"
cd "$MEDUSA_DIR"

NPM_SCRIPT=test:integration:http
if [ "${1:-}" = "--modules" ]; then
  NPM_SCRIPT=test:integration:modules
  shift
fi

if [ ! -f .env ]; then
  echo "apps/medusa/.env 가 없다. docs/local-dev.md 「전체 스택 로컬 구동」 §2 를 먼저 하라." >&2
  exit 1
fi

# DATABASE_URL 하나에서 러너가 요구하는 넷을 파생시킨다. 값은 출력하지 않는다.
eval "$(python3 - <<'PY'
import shlex, urllib.parse
url = None
for line in open('.env'):
    if line.startswith('DATABASE_URL='):
        url = line.split('=', 1)[1].strip().strip('"').strip("'")
if not url:
    raise SystemExit("apps/medusa/.env 에 DATABASE_URL 이 없다")
u = urllib.parse.urlparse(url)
print(f"export DB_HOST={shlex.quote(u.hostname or 'localhost')}")
print(f"export DB_PORT={u.port or 5432}")
print(f"export DB_USERNAME={shlex.quote(u.username or 'postgres')}")
print(f"export DB_PASSWORD={shlex.quote(urllib.parse.unquote(u.password or ''))}")
PY
)"

exec npm run "$NPM_SCRIPT" -- "$@"
