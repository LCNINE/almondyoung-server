#!/usr/bin/env bash
#
# `outbox-marker-backfill.ts` 의 실 Postgres 검증 (ADR-0029 Task 6-C-4 선행).
#
# **왜 bash + 실 DB 인가.** 이 스크립트가 하는 일은 전부 SQL 술어다 — `LIKE '%:fully-shipped'`,
# `DISTINCT ON`, `ON CONFLICT`, NULL 이 unique 를 통과하는 것. 목 DB 로는 그 술어가 무엇을
# 거르는지 보이지 않는다(6-C-2·3 이 같은 이유로 실 PG 통합을 게이트에 넣었다).
#
# 로컬 compose postgres(5432) 에 **스크래치 DB 2개**를 만들고, 두 테이블 DDL 을 실 DB 에서
# `pg_dump` 로 복사해 온다. 손으로 다시 적으면 운영과 다른 것을 테스트하게 된다.
#
# 사용법:  bash scripts/events/outbox-marker-backfill.verify.sh
#          LOCAL_PG=postgresql://... bash scripts/events/outbox-marker-backfill.verify.sh
#
set -uo pipefail
cd "$(dirname "$0")/../.."

PG_URL="${LOCAL_PG:-postgresql://postgres:postgres@localhost:5432}"
PGHOST=$(node -e "console.log(new URL(process.argv[1]).hostname)" "$PG_URL")
PGPORT=$(node -e "console.log(new URL(process.argv[1]).port||5432)" "$PG_URL")
PGUSER=$(node -e "console.log(new URL(process.argv[1]).username||'postgres')" "$PG_URL")
export PGPASSWORD=$(node -e "console.log(decodeURIComponent(new URL(process.argv[1]).password||'postgres'))" "$PG_URL")
export PGHOST PGPORT PGUSER

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

FAIL=0
assert() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  ok   $1 = $3"; else echo "  FAIL $1: expected $2, got $3"; FAIL=1; fi
}

# 실 DB 에서 테이블 DDL 을 그대로 떠 온다. 공용 `event.outbox_events` 는 libs/events 한 파일이
# 6개 앱에 동일 생성하므로 core 의 적용본이 그 판본이다.
seed_scratch() { # $1=scratch db  $2=legacy source db  $3=legacy enum name
  local scr="$1" src="$2" enum="$3"
  psql -d postgres -Atqc "DROP DATABASE IF EXISTS $scr" >/dev/null 2>&1
  psql -d postgres -Atqc "CREATE DATABASE $scr" >/dev/null
  psql -d "$scr" -qc "CREATE SCHEMA IF NOT EXISTS event;" >/dev/null

  psql -d "$src" -Atqc "SELECT 'CREATE TYPE public.$enum AS ENUM (' || string_agg(quote_literal(enumlabel), ',' ORDER BY enumsortorder) || ');' FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='$enum';" > "$TMP/enum.sql"
  psql -d "$scr" -qf "$TMP/enum.sql" >/dev/null 2>&1

  pg_dump -d "$src" --schema-only -t 'public.outbox_events' 2>/dev/null | grep -v '^--' > "$TMP/legacy.sql"
  psql -d "$scr" -qf "$TMP/legacy.sql" >/dev/null 2>&1
  pg_dump -d core --schema-only -t 'event.outbox_events' 2>/dev/null | grep -v '^--' > "$TMP/shared.sql"
  psql -d "$scr" -qf "$TMP/shared.sql" >/dev/null 2>&1

  local ok
  ok=$(psql -d "$scr" -Atqc "SELECT (to_regclass('public.outbox_events') IS NOT NULL AND to_regclass('event.outbox_events') IS NOT NULL)")
  if [ "$ok" != "t" ]; then echo "  FAIL 스크래치 DB 준비 실패: $scr"; FAIL=1; return 1; fi
}

run() { # $1=scratch  $2=app  $3..=flags
  local scr="$1" app="$2"; shift 2
  DATABASE_URL="${PG_URL}/${scr}" npx tsx scripts/events/outbox-marker-backfill.ts --app "$app" "$@"
}

# ══════════════════════ core ══════════════════════
echo "══ core"
SCR_CORE=obmb_verify_core
seed_scratch "$SCR_CORE" core outbox_status || exit 1
QC() { psql -d "$SCR_CORE" -Atqc "$1"; }

QC "TRUNCATE public.outbox_events; TRUNCATE event.outbox_events;" >/dev/null
# 옮겨야 하는 표지 2건 (하나는 published_at 이 2일 전 — 보존되는지 본다)
QC "INSERT INTO public.outbox_events (topic, idempotency_key, event_type, aggregate_type, aggregate_id, partition_key, payload, status, published_at) VALUES
 ('fulfillments.events.v1','11111111-1111-1111-1111-111111111111:fully-shipped','FulfillmentShipped','fulfillment','11111111-1111-1111-1111-111111111111','pk1','{\"a\":1}','published', now() - interval '2 days'),
 ('fulfillments.events.v1','22222222-2222-2222-2222-222222222222:fully-shipped','FulfillmentShipped','fulfillment','22222222-2222-2222-2222-222222222222','pk2','{\"a\":2}','published', now() - interval '1 day');" >/dev/null
# 대조군 A: 같은 topic/event_type 이지만 fully-shipped 표지가 아니다
QC "INSERT INTO public.outbox_events (topic, idempotency_key, event_type, aggregate_type, aggregate_id, partition_key, payload, status) VALUES
 ('fulfillments.events.v1','33333333-3333-3333-3333-333333333333:line-shipped','FulfillmentShipped','fulfillment','33333333-3333-3333-3333-333333333333','pk3','{\"a\":3}','published');" >/dev/null
# 대조군 B: 다른 토픽
QC "INSERT INTO public.outbox_events (topic, idempotency_key, event_type, aggregate_type, aggregate_id, partition_key, payload, status) VALUES
 ('core.orders.events.v1','44444444-4444-4444-4444-444444444444:fully-shipped','SalesOrderCancelled','sales_order','44444444-4444-4444-4444-444444444444','pk4','{\"a\":4}','published');" >/dev/null
# 이미 공용에 있는 표지 — 덮어쓰지 않아야 한다
QC "INSERT INTO public.outbox_events (topic, idempotency_key, event_type, aggregate_type, aggregate_id, partition_key, payload, status) VALUES
 ('fulfillments.events.v1','55555555-5555-5555-5555-555555555555:fully-shipped','FulfillmentShipped','fulfillment','55555555-5555-5555-5555-555555555555','pk5','{\"a\":5}','published');" >/dev/null
QC "INSERT INTO event.outbox_events (topic, aggregate_type, aggregate_id, event_type, idempotency_key, partition_key, payload, status) VALUES
 ('fulfillments.events.v1','Fulfillment','55555555-5555-5555-5555-555555555555','FulfillmentShipped','55555555-5555-5555-5555-555555555555:fully-shipped','pk5','{\"b\":5}','PUBLISHED');" >/dev/null

DRY=$(run "$SCR_CORE" core | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).markers[0].missing))")
assert "dry-run 이 옮길 행 수를 맞게 센다" 2 "$DRY"
INS=$(run "$SCR_CORE" core --execute | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).markers[0].inserted))")
assert "1회차 삽입" 2 "$INS"
INS2=$(run "$SCR_CORE" core --execute | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).markers[0].inserted))")
assert "2회차 삽입 0 (멱등)" 0 "$INS2"

assert "공용 총 행수(기존1+옮긴2)" 3 "$(QC "SELECT count(*) FROM event.outbox_events")"
assert "전부 PUBLISHED — 재발행되지 않는다" 0 "$(QC "SELECT count(*) FROM event.outbox_events WHERE status <> 'PUBLISHED'")"
assert "대조군A(line-shipped) 미이동" 0 "$(QC "SELECT count(*) FROM event.outbox_events WHERE idempotency_key LIKE '%:line-shipped'")"
assert "대조군B(다른 토픽) 미이동" 0 "$(QC "SELECT count(*) FROM event.outbox_events WHERE topic='core.orders.events.v1'")"
assert "기존 행 payload 안 덮어씀" 1 "$(QC "SELECT count(*) FROM event.outbox_events WHERE idempotency_key LIKE '55555555%' AND payload::text='{\"b\": 5}'")"
assert "published_at 보존" 1 "$(QC "SELECT count(*) FROM event.outbox_events WHERE idempotency_key LIKE '11111111%' AND published_at < now() - interval '1 day'")"
# 읽는 쪽(hasFullyShippedProjection)의 술어를 그대로 재현
assert "표지 3건 전부 공용 술어로 조회됨" 3 "$(QC "SELECT count(*) FROM event.outbox_events WHERE topic='fulfillments.events.v1' AND event_type='FulfillmentShipped' AND idempotency_key IN ('11111111-1111-1111-1111-111111111111:fully-shipped','22222222-2222-2222-2222-222222222222:fully-shipped','55555555-5555-5555-5555-555555555555:fully-shipped')")"

# ══════════════════════ wallet ══════════════════════
echo "══ wallet"
SCR_W=obmb_verify_wallet
seed_scratch "$SCR_W" wallet wallet_outbox_status || exit 1
QW() { psql -d "$SCR_W" -Atqc "$1"; }

QW "TRUNCATE public.outbox_events; TRUNCATE event.outbox_events;" >/dev/null
# 같은 인텐트에 2행 → 공용엔 1행만
QW "INSERT INTO public.outbox_events (message_id, event_type, aggregate_type, aggregate_id, partition_key, payload, status, published_at) VALUES
 ('m1','payment.intent.failed','PaymentGateway','aaaaaaaa-0000-0000-0000-000000000001','pk-a','{\"x\":1}','PUBLISHED', now() - interval '3 days'),
 ('m2','payment.intent.failed','PaymentGateway','aaaaaaaa-0000-0000-0000-000000000001','pk-a','{\"x\":2}','PUBLISHED', now() - interval '2 days'),
 ('m3','payment.intent.failed','PaymentGateway','aaaaaaaa-0000-0000-0000-000000000002','pk-b','{\"x\":3}','PUBLISHED', now() - interval '1 day');" >/dev/null
# 대조군 A: 다른 event_type
QW "INSERT INTO public.outbox_events (message_id, event_type, aggregate_type, aggregate_id, partition_key, payload, status) VALUES
 ('m4','payment.intent.succeeded','PaymentGateway','aaaaaaaa-0000-0000-0000-000000000003','pk-c','{\"x\":4}','PUBLISHED');" >/dev/null
# 같은 멱등키 2행 → 공용엔 1행
QW "INSERT INTO public.outbox_events (message_id, event_type, aggregate_type, aggregate_id, partition_key, payload, status) VALUES
 ('m5','mandate.rejected','PaymentGateway','bbbbbbbb-0000-0000-0000-000000000001','pk-d','{\"idempotencyKey\":\"idem-1\"}','PUBLISHED'),
 ('m6','mandate.rejected','PaymentGateway','bbbbbbbb-0000-0000-0000-000000000002','pk-e','{\"idempotencyKey\":\"idem-1\"}','PUBLISHED'),
 ('m7','mandate.rejected','PaymentGateway','bbbbbbbb-0000-0000-0000-000000000003','pk-f','{\"idempotencyKey\":\"idem-2\"}','PUBLISHED');" >/dev/null
# 대조군 B: 멱등키 없는 mandate.rejected — 옮길 근거가 없다
QW "INSERT INTO public.outbox_events (message_id, event_type, aggregate_type, aggregate_id, partition_key, payload, status) VALUES
 ('m8','mandate.rejected','PaymentGateway','bbbbbbbb-0000-0000-0000-000000000004','pk-g','{\"invoiceId\":null}','PUBLISHED');" >/dev/null

run "$SCR_W" wallet >/dev/null
run "$SCR_W" wallet --execute >/dev/null
SECOND=$(run "$SCR_W" wallet --execute | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s).markers;console.log(m[0].inserted+m[1].inserted)})")
assert "2회차 삽입 0 (멱등)" 0 "$SECOND"

assert "intent.failed 인텐트당 1행" 2 "$(QW "SELECT count(*) FROM event.outbox_events WHERE event_type='payment.intent.failed'")"
assert "mandate 멱등키당 1행" 2 "$(QW "SELECT count(*) FROM event.outbox_events WHERE event_type='mandate.rejected'")"
assert "공용 총 행수" 4 "$(QW "SELECT count(*) FROM event.outbox_events")"
assert "전부 PUBLISHED — 재발행되지 않는다" 0 "$(QW "SELECT count(*) FROM event.outbox_events WHERE status <> 'PUBLISHED'")"
assert "대조군A(succeeded) 미이동" 0 "$(QW "SELECT count(*) FROM event.outbox_events WHERE event_type='payment.intent.succeeded'")"
assert "대조군B(멱등키 없는 mandate) 미이동" 0 "$(QW "SELECT count(*) FROM event.outbox_events WHERE event_type='mandate.rejected' AND idempotency_key IS NULL")"
assert "topic 이 계약값으로 채워짐" 4 "$(QW "SELECT count(*) FROM event.outbox_events WHERE topic='payments.events.v1'")"
# 읽는 쪽 두 술어를 그대로 재현
assert "BillingCharge dedupe 재현(인텐트1)" 1 "$(QW "SELECT count(*) FROM event.outbox_events WHERE aggregate_id='aaaaaaaa-0000-0000-0000-000000000001' AND event_type='payment.intent.failed'")"
assert "Invoice dedupe 재현(idem-1)" 1 "$(QW "SELECT count(*) FROM event.outbox_events WHERE event_type='mandate.rejected' AND idempotency_key='idem-1'")"

psql -d postgres -Atqc "DROP DATABASE IF EXISTS $SCR_CORE" >/dev/null 2>&1
psql -d postgres -Atqc "DROP DATABASE IF EXISTS $SCR_W" >/dev/null 2>&1

echo
if [ "$FAIL" = 0 ]; then echo "전부 통과"; else echo "실패 있음"; fi
exit $FAIL
