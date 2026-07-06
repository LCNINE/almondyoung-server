#!/usr/bin/env bash
# live RDS → 로컬 docker postgres 로 전체 논리 DB 덤프/복원.
# 다른 노트북에서도 그대로 실행: docker compose up -d 로 로컬 PG 띄운 뒤 이 스크립트 실행.
#
# 사전 요구: aws CLI(로그인됨), jq, postgresql-client(pg_dump/pg_restore), sst tunnel 권한.
# 비밀번호는 Secrets Manager 에서 셸 변수로만 읽고 파일/URL 에 남기지 않는다.
#
# 사용법:
#   ./scripts/local/refresh-from-live.sh            # services + auth 전부 (tunnel 자동)
#   ./scripts/local/refresh-from-live.sh services   # services 클러스터만
#   ./scripts/local/refresh-from-live.sh auth       # auth 클러스터만
#
# SKIP_TUNNEL=1 : tunnel 을 직접 띄워두고 덤프만. sst tunnel 은 앱당 1개만 뜨므로
#   이 모드는 클러스터를 따로 지정해서 쓴다 (all 은 두 tunnel 동시가 불가):
#     npx sst tunnel --stage live   # deployments/lcnine/services 에서
#     SKIP_TUNNEL=1 ./scripts/local/refresh-from-live.sh services
#   auth 는 tunnel 바꿔 띄운 뒤:
#     SKIP_TUNNEL=1 ./scripts/local/refresh-from-live.sh auth
set -euo pipefail

REGION=ap-northeast-2
LOCAL="-h localhost -p 5432 -U postgres"        # 로컬 docker PG (pw=postgres)
export PGCONNECT_TIMEOUT=10

# 호스트/시크릿은 하드코딩하지 않고 실행 시 AWS 에서 조회한다.
# (인스턴스 재생성 시 suffix 가 바뀌어 하드코딩은 금방 썩고, 퍼블릭 레포에
#  라이브 엔드포인트를 남기지 않기 위함. prefix 는 sst 앱 이름이라 이미 공개 정보.)
find_host()   { aws rds describe-db-instances --region "$REGION" \
  --query "DBInstances[?starts_with(DBInstanceIdentifier, \`$1\`)].Endpoint.Address | [0]" --output text; }
find_secret() { aws secretsmanager list-secrets --region "$REGION" \
  --query "SecretList[?starts_with(Name, \`$1\`)].Name | [0]" --output text; }

# 클러스터 정의: <deploy_dir> <rds_host> <secret_id> <db1,db2,...>
SERVICES_DIR=deployments/lcnine/services
SERVICES_HOST=$(find_host lcnine-services-live-dbinstance)
SERVICES_SECRET=$(find_secret lcnine-services-live-DbProxySecret)
SERVICES_DBS="core medusa wallet analytics channel_adapter membership notification ugc file_service"

AUTH_DIR=deployments/lcnine/auth
AUTH_HOST=$(find_host lcnine-auth-live-idpdbinstance)
AUTH_SECRET=$(find_secret lcnine-auth-live-IdpDbProxySecret)
AUTH_DBS="user_service"

for v in SERVICES_HOST SERVICES_SECRET AUTH_HOST AUTH_SECRET; do
  if [ -z "${!v}" ] || [ "${!v}" = None ]; then
    echo "!! $v 조회 실패 — aws CLI 로그인/권한 확인" >&2; exit 1
  fi
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

wait_for_host() {  # $1=host  — tunnel 이 뜰 때까지 최대 60초 대기
  local host=$1 i
  for i in $(seq 1 30); do
    nc -z -w2 "$host" 5432 2>/dev/null && return 0
    sleep 2
  done
  echo "!! $host:5432 에 붙지 못함 (tunnel 안 뜸?)" >&2
  return 1
}

sync_cluster() {  # $1=deploy_dir  $2=host  $3=secret_id  $4=db list
  local dir=$1 host=$2 secret=$3 dbs=$4 user pw tunnel_pid="" db

  if [ "${SKIP_TUNNEL:-}" = 1 ]; then
    echo "### tunnel 수동 모드 ($dir) — 이미 떠 있다고 가정"
  else
    echo "### tunnel 기동: $dir (stage live)"
    ( cd "$REPO_ROOT/$dir" && exec npx sst tunnel --stage live ) &
    tunnel_pid=$!
    trap 'kill "$tunnel_pid" 2>/dev/null || true' RETURN
  fi
  wait_for_host "$host"

  read -r user pw < <(aws secretsmanager get-secret-value --region "$REGION" \
    --secret-id "$secret" --query SecretString --output text \
    | jq -r '"\(.username) \(.password)"')

  for db in $dbs; do
    echo "=== $db ==="
    PGSSLMODE=require PGPASSWORD="$pw" \
      pg_dump -h "$host" -U "$user" -d "$db" -Fc --no-owner --no-privileges \
    | PGPASSWORD=postgres \
      pg_restore $LOCAL -d "$db" --no-owner --no-privileges --clean --if-exists \
    || echo "!! $db 복원 중 에러 (extension/누락 role 이면 대체로 무해) — 계속" >&2
  done

  if [ -n "$tunnel_pid" ]; then
    kill "$tunnel_pid" 2>/dev/null || true
    trap - RETURN
    sleep 2  # tunnel 종료 대기 (다음 클러스터와 앱 충돌 방지)
  fi
}

target="${1:-all}"
case "$target" in services|auth|all) ;; *) echo "usage: $0 [services|auth|all]" >&2; exit 1 ;; esac

if [ "$target" = services ] || [ "$target" = all ]; then
  sync_cluster "$SERVICES_DIR" "$SERVICES_HOST" "$SERVICES_SECRET" "$SERVICES_DBS"
fi
if [ "$target" = auth ] || [ "$target" = all ]; then
  sync_cluster "$AUTH_DIR" "$AUTH_HOST" "$AUTH_SECRET" "$AUTH_DBS"
fi

echo "완료."
