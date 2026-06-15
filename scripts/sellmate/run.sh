#!/usr/bin/env bash
# 셀메이트 스크립트를 dev/live core DB 로 실행하는 범용 러너.
# RDS 엔드포인트·사설 IP·시크릿을 stage 로부터 자동 탐색하므로 값이 바뀌어도 동작한다.
#
# 전제: 해당 stage 의 sst tunnel 이 떠 있어야 함.
#   dev :  cd deployments/lcnine/services && npx sst tunnel --stage dev
#   live:  cd deployments/lcnine/services && npx sst tunnel --stage live
#
# 사용:
#   bash scripts/sellmate/run.sh dev  import-products apps/core/tmp/
#   bash scripts/sellmate/run.sh live import-products apps/core/tmp/
#   DRY_RUN=1 bash scripts/sellmate/run.sh live sync-stock apps/core/tmp/
set -euo pipefail

STAGE="${1:?사용: run.sh <dev|live> <import-products|sync-stock> <파일/폴더>}"
SCRIPT="${2:?스크립트명(import-products|sync-stock) 필요}"
shift 2

REGION="ap-northeast-2"
APP="lcnine-services-${STAGE}"
DB_NAME="${DB_NAME:-core}"

echo "🔎 ${STAGE} RDS 탐색…"
# 주의: AWS CLI 자동 페이지네이션은 --query 를 페이지마다 적용 → '| [0]' 대신 grep|head 로 안전 처리.
# 1) services RDS 인스턴스의 AZ + SG
read -r AZ SG < <(aws rds describe-db-instances --region "$REGION" \
  --query "DBInstances[?starts_with(DBInstanceIdentifier,'${APP}-dbinstance')].[AvailabilityZone,VpcSecurityGroups[0].VpcSecurityGroupId]" \
  --output text | grep -v '^None' | grep . | head -1)
[ -z "${AZ:-}" ] && { echo "❌ RDS 못 찾음: ${APP}-dbinstance*"; exit 1; }

# 2) 후보 사설 IP (RDS ENI: amazon-rds 소유 + 같은 AZ/SG). live 는 auth 와 SG/AZ 가 겹칠 수
#    있어 여러 개가 나올 수 있다 → 아래에서 시크릿으로 인증되는 IP 만 선택.
IPS=$(aws ec2 describe-network-interfaces --region "$REGION" \
  --filters "Name=requester-id,Values=amazon-rds" "Name=availability-zone,Values=$AZ" "Name=group-id,Values=$SG" \
  --query "NetworkInterfaces[].PrivateIpAddress" --output text | tr '\t' ' ')
[ -z "${IPS// /}" ] && { echo "❌ RDS 사설 IP 못 찾음"; exit 1; }

# 3) services DB 시크릿 (이름으로 명확히 특정됨)
SECRET_ID=$(aws secretsmanager list-secrets --region "$REGION" \
  --query "SecretList[?starts_with(Name,'${APP}-DbProxySecret')].Name" --output text \
  | tr '\t' '\n' | grep -v '^None$' | grep . | head -1)
[ -z "${SECRET_ID:-}" ] && { echo "❌ 시크릿 못 찾음: ${APP}-DbProxySecret*"; exit 1; }
SECRET=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --region "$REGION" --query SecretString --output text)

# 4) 후보 IP 중 "대상 DB(/${DB_NAME}) 에 직접 붙어 필수 스키마가 있는" IP 만 선택.
#    /postgres 로그인만 확인하면 엉뚱한 클러스터를 고를 수 있으므로 대상 DB 자체를 검증한다.
#    주의: 'export VAR=$(...)' 는 export 가 0 을 반환해 set -e 가 probe 실패를 못 잡는다 →
#    먼저 일반 변수에 담아(실패 시 set -e 가 즉시 중단) 그 다음 export 한다.
DATABASE_URL=$(SECRET="$SECRET" IPS="$IPS" DB_NAME="$DB_NAME" node -e '
const s=JSON.parse(process.env.SECRET);
const ips=process.env.IPS.split(" ").filter(Boolean);
const postgres=require("postgres");
const auth=encodeURIComponent(s.username)+":"+encodeURIComponent(s.password);
const db=process.env.DB_NAME;
(async()=>{
  let loginOnly=[];
  for(const ip of ips){
    const base="postgresql://"+auth+"@"+ip+":"+(s.port||5432);
    const sql=postgres(base+"/"+db+"?sslmode=require",{max:1,connect_timeout:8});
    try{
      const [r]=await sql`select current_database() as db,
        (to_regclass(${"public.skus"}) is not null and to_regclass(${"public.stock_ledgers"}) is not null) as schema_ok`;
      await sql.end();
      if(r && r.db===db && r.schema_ok){ console.log(base+"/"+db+"?sslmode=require"); process.exit(0); }
      loginOnly.push(ip+"(db="+(r&&r.db)+",schema_ok="+(r&&r.schema_ok)+")");
    }catch(e){ try{await sql.end()}catch{} }
  }
  if(loginOnly.length) console.error("연결은 됐지만 대상 DB/스키마 불일치: "+loginOnly.join(", "));
  else console.error("어느 후보 IP 도 /"+db+" 연결 실패: "+ips.join(", ")+" (터널 떠있는지 확인)");
  process.exit(1);
})();')
export DATABASE_URL

MASKED_IP=$(echo "$DATABASE_URL" | sed -E 's#.*@([^:/]+).*#\1#')
echo "🔌 ${STAGE} ${DB_NAME} @ ${MASKED_IP}:5432 (시크릿 ${SECRET_ID})"
cd "$(dirname "$0")/../.."
echo "▶ ${DRY_RUN:+[DRY_RUN] }scripts/sellmate/${SCRIPT}.ts $*"
exec npx tsx "scripts/sellmate/${SCRIPT}.ts" "$@"
