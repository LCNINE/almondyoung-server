#!/usr/bin/env bash
# 로컬 E2E 에 테넌트 2 를 만든다 — 만들기 스크립트의 로컬 리허설. 멱등하다(두 번 돌려도 바뀌는 것 없음).
# bootstrap 4단계가 부른다. 혼자 불러도 된다:
#   npm run tenant:create:local
#
# 단계: 테넌트 행 «준비»(운영자 API) → core_<slug> 생성·마이그·«모든 테넌트» 시드 → 로컬 버킷 둘 → 테넌트 도메인 리디렉트
#       → 역할(키 9개) → 점검 계정 → 재마이그 + 테넌트 1 과 버전 비교 → 목록에 넣기(앱 .env 들) → 로컬 배포(core ②)
#       → 만든 직후 확인 → «활성». 목록 전 실패는 DROP DATABASE + 테넌트 행 삭제로 되돌린다.
#
# 🔴 core(:3100)가 «목록을 받기 전에» 떠 있으면 로컬 배포 단계에서 멈춘다(돌고 있는 세션을 죽이지 않는다) —
#    앱을 내리고 다시 돌리거나, E2E_GATE_MODE=reject npm run start:all:local 로 다시 띄운 뒤 다시 돌린다.
set -uo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/local/e2e-env-map.sh
source scripts/local/e2e-env-map.sh

E2E_TENANT_ENV_FILES="$(e2e_tenant_list_env_files)"
export E2E_TENANT_ENV_FILES E2E_TENANT2_ID E2E_TENANT2_SLUG E2E_TENANT2_NAME E2E_TENANT2_DOMAIN E2E_TENANT2_AUTH_DOMAIN E2E_TENANT2_CORE_DB \
  E2E_TENANT2_PUBLIC_BUCKET E2E_TENANT2_PRIVATE_BUCKET E2E_TENANT2_CHECK_LOGIN_ID
exec npx tsx scripts/local/create-tenant/index.ts
