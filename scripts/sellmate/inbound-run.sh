#!/usr/bin/env bash
# 입고예정 파이프라인(import-inbound-plans / match-sku-to-variant / sync-restock-to-medusa)을
# live/dev RDS 로 실행하는 러너. run.sh 와 같은 방식으로 시크릿을 런타임 조회해
# CORE_DB_URL / MEDUSA_DB_URL 을 주입한다(비번은 transcript 에 안 찍음).
#
# 전제: 해당 stage 의 sst tunnel 이 떠 있어야 함.
#
# 사용:
#   bash scripts/sellmate/inbound-run.sh live import-inbound   <csv> [--apply]
#   bash scripts/sellmate/inbound-run.sh live match-sku        <csv> [--limit N] [--apply]
#   MEDUSA_API_URL=... MEDUSA_API_KEY=... \
#     bash scripts/sellmate/inbound-run.sh live sync-restock   [--apply]
set -euo pipefail

STAGE="${1:?사용: inbound-run.sh <dev|live> <import-inbound|match-sku|sync-restock> [args]}"
STEP="${2:?스텝(import-inbound|match-sku|sync-restock) 필요}"
shift 2

REGION="ap-northeast-2"
APP="lcnine-services-${STAGE}"

echo "🔎 ${STAGE} RDS 탐색…"
read -r AZ SG < <(aws rds describe-db-instances --region "$REGION" \
  --query "DBInstances[?starts_with(DBInstanceIdentifier,'${APP}-dbinstance')].[AvailabilityZone,VpcSecurityGroups[0].VpcSecurityGroupId]" \
  --output text | grep -v '^None' | grep . | head -1)
[ -z "${AZ:-}" ] && { echo "❌ RDS 못 찾음: ${APP}-dbinstance*"; exit 1; }

IPS=$(aws ec2 describe-network-interfaces --region "$REGION" \
  --filters "Name=requester-id,Values=amazon-rds" "Name=availability-zone,Values=$AZ" "Name=group-id,Values=$SG" \
  --query "NetworkInterfaces[].PrivateIpAddress" --output text | tr '\t' ' ')
[ -z "${IPS// /}" ] && { echo "❌ RDS 사설 IP 못 찾음"; exit 1; }

SECRET_ID=$(aws secretsmanager list-secrets --region "$REGION" \
  --query "SecretList[?starts_with(Name,'${APP}-DbProxySecret')].Name" --output text \
  | tr '\t' '\n' | grep -v '^None$' | grep . | head -1)
[ -z "${SECRET_ID:-}" ] && { echo "❌ 시크릿 못 찾음: ${APP}-DbProxySecret*"; exit 1; }
SECRET=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --region "$REGION" --query SecretString --output text)

# 대상 DB 로 직접 붙어 존재를 검증한 IP 로 URL 을 만든다(엉뚱한 클러스터 회피).
# db_name 별 검증 테이블: core→skus, medusa→product.
build_url() {
  local db="$1" probe="$2"
  SECRET="$SECRET" IPS="$IPS" DB_NAME="$db" PROBE="$probe" node -e '
    const s=JSON.parse(process.env.SECRET);
    const ips=process.env.IPS.split(" ").filter(Boolean);
    const postgres=require("postgres");
    const auth=encodeURIComponent(s.username)+":"+encodeURIComponent(s.password);
    const db=process.env.DB_NAME, probe=process.env.PROBE;
    (async()=>{
      for(const ip of ips){
        const base="postgresql://"+auth+"@"+ip+":"+(s.port||5432);
        const sql=postgres(base+"/"+db+"?sslmode=require",{max:1,connect_timeout:8});
        try{
          const [r]=await sql`select current_database() as db, (to_regclass(${probe}) is not null) as ok`;
          await sql.end();
          if(r && r.db===db && r.ok){ console.log(base+"/"+db+"?sslmode=require"); process.exit(0); }
        }catch(e){ try{await sql.end()}catch{} }
      }
      console.error("대상 DB /"+db+" 붙을 IP 없음: "+ips.join(", ")+" (터널 확인)"); process.exit(1);
    })();'
}

CORE_DB_URL=$(build_url core "public.skus")
export CORE_DB_URL
MASK=$(echo "$CORE_DB_URL" | sed -E 's#.*@([^:/]+).*#\1#')
echo "🔌 core @ ${MASK}:5432 (시크릿 ${SECRET_ID})"

cd "$(dirname "$0")/../.."

case "$STEP" in
  import-inbound)
    exec npx tsx apps/core/scripts/import-inbound-plans.ts "$@"
    ;;
  match-sku)
    MEDUSA_DB_URL=$(build_url medusa "public.product")
    export MEDUSA_DB_URL
    echo "🔌 medusa @ ${MASK}:5432"
    exec npx tsx apps/channel-adapter/scripts/match-sku-to-variant.ts "$@"
    ;;
  sync-restock)
    : "${MEDUSA_API_URL:?MEDUSA_API_URL 필요}" "${MEDUSA_API_KEY:?MEDUSA_API_KEY 필요}"
    exec npx tsx apps/channel-adapter/scripts/sync-restock-to-medusa.ts "$@"
    ;;
  *)
    echo "❌ 모르는 스텝: $STEP"; exit 1;;
esac
