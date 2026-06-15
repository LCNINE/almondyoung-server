#!/usr/bin/env bash
# dev(lcnine-services) 에 core 논리 DB 생성 + drizzle 마이그레이션.
# 전제: sst tunnel --stage dev 가 떠 있어야 함. (사설 DNS 라 IP 직접 접속)
set -euo pipefail

REGION="ap-northeast-2"
SECRET_ID="${DB_SECRET_ID:-lcnine-services-dev-DbProxySecret-xkostkek}"
DB_IP="${DB_IP:-10.0.15.105}"

echo "🔑 시크릿 조회…"
SECRET=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --region "$REGION" --query SecretString --output text)

ADMIN_URL=$(SECRET="$SECRET" DB_IP="$DB_IP" node -e "const s=JSON.parse(process.env.SECRET);console.log('postgresql://'+encodeURIComponent(s.username)+':'+encodeURIComponent(s.password)+'@'+process.env.DB_IP+':'+(s.port||5432)+'/lcnine_services?sslmode=require')")
# drizzle-kit 는 sslmode hang 회피용 uselibpqcompat 필요 (메모리 노트)
CORE_URL=$(SECRET="$SECRET" DB_IP="$DB_IP" node -e "const s=JSON.parse(process.env.SECRET);console.log('postgresql://'+encodeURIComponent(s.username)+':'+encodeURIComponent(s.password)+'@'+process.env.DB_IP+':'+(s.port||5432)+'/core?sslmode=require&uselibpqcompat=true')")

cd "$(dirname "$0")/../.."

echo "① core DB 생성(없으면)…"
ADMIN_URL="$ADMIN_URL" node -e "const postgres=require('postgres');const sql=postgres(process.env.ADMIN_URL,{max:1});(async()=>{const r=await sql\`select 1 from pg_database where datname='core'\`;if(r.length){console.log('  core DB 이미 존재')}else{await sql.unsafe('CREATE DATABASE core');console.log('  core DB 생성 완료')}await sql.end()})().catch(e=>{console.error('  실패:',e.message);process.exit(1)})"

echo "② core 마이그레이션(drizzle-kit)…"
DATABASE_URL="$CORE_URL" npx drizzle-kit migrate --config apps/core/drizzle.config.ts

echo "③ 기본 시드(홀더/창고/로케이션)…"
# postgres.js 는 uselibpqcompat 파라미터를 모름 → drizzle 전용 파라미터 제거한 URL 사용
SEED_URL="${CORE_URL%&uselibpqcompat=true}"
# import 는 기본 홀더 FK, sync 는 창고/로케이션 FK 가 필요. seeding 의 FIXED_UUIDS 와 동일.
DATABASE_URL="$SEED_URL" node -e '
const postgres=require("postgres");
const sql=postgres(process.env.DATABASE_URL,{max:1});
const BUCHEON="019d0001-0001-7000-a000-000000000001", CHINA="019d0001-0002-7000-a000-000000000002";
const warehouses=[[BUCHEON,"부천 물류창고","domestic"],[CHINA,"중국 물류창고","overseas"]];
const locations=[
 ["019d0002-0001-7000-a000-000000000001",BUCHEON,"RECEIVING_DEFAULT","입고기본존",true,"inbound_default"],
 ["019d0002-0002-7000-a000-000000000002",BUCHEON,"SHIPPING_DEFAULT","출고기본존",false,null],
 ["019d0002-0003-7000-a000-000000000003",BUCHEON,"DAMAGE_DEFAULT","불량기본존",false,null],
 ["019d0002-0004-7000-a000-000000000004",BUCHEON,"RETURN_DEFAULT","반품기본존",true,"return_default"],
 ["019d0002-0005-7000-a000-000000000005",CHINA,"RECEIVING_DEFAULT","입고기본존",true,"inbound_default"],
 ["019d0002-0006-7000-a000-000000000006",CHINA,"SHIPPING_DEFAULT","출고기본존",false,null],
 ["019d0002-0007-7000-a000-000000000007",CHINA,"DAMAGE_DEFAULT","불량기본존",false,null],
 ["019d0002-0008-7000-a000-000000000008",CHINA,"RETURN_DEFAULT","반품기본존",true,"return_default"],
];
(async()=>{
 await sql`INSERT INTO holders (id,name,is_our_asset) VALUES (${"019d0001-0000-7000-a000-000000000001"},${"기본 보유자"},${true}) ON CONFLICT (id) DO NOTHING`;
 for(const w of warehouses) await sql`INSERT INTO warehouses (id,name,type) VALUES (${w[0]},${w[1]},${w[2]}) ON CONFLICT (id) DO NOTHING`;
 for(const l of locations) await sql`INSERT INTO locations (id,warehouse_id,code,location_type,rack_id,bin_identifier,display_name,is_expiry_separated,is_active,is_system,system_role) VALUES (${l[0]},${l[1]},${l[2]},${"zone"},${null},${null},${l[3]},${false},${true},${l[4]},${l[5]}) ON CONFLICT (warehouse_id,code) DO NOTHING`;
 const h=await sql`select count(*) c from holders`, w=await sql`select count(*) c from warehouses`, lo=await sql`select count(*) c from locations`;
 console.log(`  holders=${h[0].c}, warehouses=${w[0].c}, locations=${lo[0].c}`);
 await sql.end();
})().catch(e=>{console.error("  시드 실패:",e.message);process.exit(1)});
'

echo "✅ core DB 셋업 완료 (마이그레이션 + 기본 시드)"
