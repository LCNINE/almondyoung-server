#!/usr/bin/env bash
# dev(lcnine-services) core DB 로 sellmate 스크립트를 실행하는 헬퍼.
#
# 전제: 다른 터미널/창에서 sst tunnel 이 떠 있어야 한다.
#   cd deployments/lcnine/services && npx sst tunnel --stage dev
#
# 이 dev core DB 는 사설 DNS 라 호스트네임으로 안 풀린다 → 사설 IP 로 직접 접속한다.
# (IP/시크릿ID 가 바뀌면 아래 기본값을 갱신하거나 환경변수로 덮어쓰기)
#
# 사용:
#   bash scripts/sellmate/dev-run.sh import-products apps/core/tmp/
#   bash scripts/sellmate/dev-run.sh sync-stock     apps/core/tmp/
#   DRY_RUN=1 bash scripts/sellmate/dev-run.sh sync-stock apps/core/tmp/
set -euo pipefail

SCRIPT="${1:?사용: dev-run.sh <import-products|sync-stock> <파일/폴더>}"; shift

REGION="ap-northeast-2"
SECRET_ID="${DB_SECRET_ID:-lcnine-services-dev-DbProxySecret-xkostkek}"
DB_IP="${DB_IP:-10.0.15.105}"
DB_NAME="${DB_NAME:-core}"

echo "🔑 시크릿($SECRET_ID)에서 자격증명 조회…"
SECRET=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --region "$REGION" --query SecretString --output text)

# 비밀번호 특수문자 안전하게 URL 인코딩해서 DATABASE_URL 구성 (비번은 화면에 안 찍힘)
export DATABASE_URL=$(SECRET="$SECRET" DB_IP="$DB_IP" DB_NAME="$DB_NAME" node -e "const s=JSON.parse(process.env.SECRET);const u=encodeURIComponent(s.username),p=encodeURIComponent(s.password);console.log('postgresql://'+u+':'+p+'@'+process.env.DB_IP+':'+(s.port||5432)+'/'+process.env.DB_NAME+'?sslmode=require')")

echo "🔌 대상: ${DB_IP}:5432/${DB_NAME} (사설 IP, 터널 경유)"
cd "$(dirname "$0")/../.."
echo "▶ scripts/sellmate/${SCRIPT}.ts $*"
exec npx tsx "scripts/sellmate/${SCRIPT}.ts" "$@"
