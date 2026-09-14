# 발주 수령 PR-C contract 적용

이 런북은 PR-B가 읽기·쓰기를 중단한 옛 입고계획 구조를 라이브 DB에서 제거할 때 사용한다. 제거 대상은
`inbound_plans`, `inbound_plan_items`, `plan_type`, `inbound_receipt_lines.plan_item_id`,
`inbound_work_logs.plan_item_id`다. 발주, 수령, 재고 원장과 `stock_summary_view`는 남아야 한다.

PR-A와 PR-B의 코드·마이그레이션·라이브 검증이 끝난 뒤에만 진행한다. 이 contract의 순서는 반드시
**deploy → migrate**다. 새 core 배포가 healthy이고 이전 core task가 drain된 것을 확인하기 전에는 migration을
실행하지 않는다. Drizzle 서비스 migration은 자동 실행되지 않는다(ADR-0005).

## 1. 적용 직전 조건

1. 배포할 commit과 두 PR-C migration
   (`*_guard-purchase-order-receiving-contract`, `*_drop-legacy-inbound-plans`)이 연속한 것을 확인한다.
2. 새 core를 배포하고 healthy 상태와 이전 task의 drain 완료를 확인한다.
3. 입고·발주 쓰기가 안정된 시점을 잡는다. 아래 조회와 migration 사이에 새 쓰기가 들어가지 않도록 운영 절차로
   통제한다. migration의 `SHARE` lock과 `lock_timeout`은 마지막 경합 방어선이다.
4. **그 시점의 source 데이터까지 복구할 수 있는 최신 백업**을 확보한다. 최소한 두 옛 테이블과 제거할 두 컬럼의
   값이 포함되어야 하며, 전체 DB 복구 지점을 권장한다. 2026-09-14의
   `pr-b-destination-backup-20260914.zip`은 삭제한 destination 행만 담은 백업이라 source 행이나 전체 DB를
   복구할 수 없다.
5. 아래 SQL을 라이브에 읽기 전용으로 실행해 결과를 배포 기록에 보관한다. 하나라도 기준과 다르면 중단한다.

## 2. 정합성 preflight

다음 세 SELECT는 PR-C guard migration과 같은 검사다. **각각 0행**이어야 한다. 결과가 있으면 자동 보정하거나
contract를 우회하지 말고 행의 출처와 PR-B 백필 상태를 조사한다.

```sql
-- (1) 옛 품목에 대응하는 발주 라인이 없다
SELECT ipi.id FROM inbound_plan_items ipi
JOIN inbound_plans ip ON ip.id = ipi.plan_id
LEFT JOIN purchase_order_lines pol ON pol.po_id = ip.linked_purchase_order_id AND pol.sku_id = ipi.sku_id
WHERE pol.po_id IS NULL;

-- (2) 옛 품목에 묶였던 회차 라인 중 링크로 옮겨지지 않은 것
SELECT irl.id FROM inbound_receipt_lines irl
LEFT JOIN purchase_order_receipt_lines porl ON porl.receipt_line_id = irl.id
WHERE irl.plan_item_id IS NOT NULL AND porl.receipt_line_id IS NULL;

-- (3) 받은 누계와 링크된 회차 라인의 순수령 합이 다르다
SELECT pol.po_id, pol.sku_id FROM purchase_order_lines pol
LEFT JOIN purchase_order_receipt_lines porl ON porl.po_id = pol.po_id AND porl.sku_id = pol.sku_id
LEFT JOIN inbound_receipt_lines irl ON irl.id = porl.receipt_line_id
GROUP BY pol.po_id, pol.sku_id, pol.received_qty
HAVING pol.received_qty <> COALESCE(SUM(irl.quantity - irl.canceled_qty), 0);
```

guard migration은 같은 세 검사를 다시 실행한다. 여섯 관련 테이블에 transaction-scoped `SHARE` lock을 먼저
잡고, 검사와 DROP 사이의 경합이나 정합성 위반이 있으면 전체 migration transaction을 중단한다.

## 3. 의존성 전체 목록

테이블 조회만으로는 제거할 컬럼과 enum의 의존성을 확인할 수 없다. 다음 한 쿼리는 두 테이블의 모든 subobject,
두 컬럼, enum을 각각 대상으로 삼고 dependent와 referenced object의 catalog/OID/subid를 함께 출력한다.

```sql
WITH targets(target, refclassid, refobjid, refobjsubid) AS (
  SELECT 'table public.inbound_plans', 'pg_class'::regclass::oid,
         'public.inbound_plans'::regclass::oid, NULL::integer
  UNION ALL
  SELECT 'table public.inbound_plan_items', 'pg_class'::regclass::oid,
         'public.inbound_plan_items'::regclass::oid, NULL::integer
  UNION ALL
  SELECT 'column public.inbound_receipt_lines.plan_item_id', 'pg_class'::regclass::oid,
         'public.inbound_receipt_lines'::regclass::oid,
         (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'public.inbound_receipt_lines'::regclass
             AND attname = 'plan_item_id' AND NOT attisdropped)
  UNION ALL
  SELECT 'column public.inbound_work_logs.plan_item_id', 'pg_class'::regclass::oid,
         'public.inbound_work_logs'::regclass::oid,
         (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'public.inbound_work_logs'::regclass
             AND attname = 'plan_item_id' AND NOT attisdropped)
  UNION ALL
  SELECT 'type public.plan_type', 'pg_type'::regclass::oid,
         'public.plan_type'::regtype::oid, 0
)
SELECT t.target,
       pg_describe_object(d.classid, d.objid, d.objsubid) AS dependent,
       d.classid::regclass AS dependent_catalog,
       d.objid AS dependent_oid,
       d.objsubid AS dependent_subid,
       pg_describe_object(d.refclassid, d.refobjid, d.refobjsubid) AS referenced,
       d.refclassid::regclass AS referenced_catalog,
       d.refobjid AS referenced_oid,
       d.refobjsubid AS referenced_subid,
       d.deptype
FROM targets t
JOIN pg_depend d
  ON d.refclassid = t.refclassid
 AND d.refobjid = t.refobjid
 AND (t.refobjsubid IS NULL OR d.refobjsubid = t.refobjsubid)
ORDER BY t.target, dependent, referenced, d.deptype;
```

허용하는 외부 의존성은 다음 두 FK뿐이다. contract DDL이 이 제약을 이름으로 먼저 제거한다.

- `inbound_receipt_lines_plan_item_id_inbound_plan_items_id_fk`
- `inbound_work_logs_plan_item_id_inbound_plan_items_id_fk`

삭제 테이블 내부의 PK/FK/default/index/toast/row type, 두 삭제 테이블 사이의 FK, `inbound_plans.plan_type`과
그 default, PostgreSQL이 enum과 함께 만드는 array type은 삭제 대상 자체의 부속이다. 그 밖의 VIEW, 외부 FK,
외부 컬럼의 `plan_type` 사용자가 한 건이라도 나오면 중단한다. migration의 `DROP ... RESTRICT`도 미리 발견하지
못한 의존 객체가 자동 삭제되지 않게 최종 방어한다.

`stock_summary_view`가 옛 입고계획을 읽지 않고 발주 라인을 읽는지도 확인한다. 결과는 `view_exists = true`,
`uses_purchase_order_lines = true`, `uses_legacy_inbound_plans = false`여야 한다.

```sql
WITH view_definition AS (
  SELECT pg_get_viewdef('public.stock_summary_view'::regclass, true) AS sql
)
SELECT to_regclass('public.stock_summary_view') IS NOT NULL AS view_exists,
       position('purchase_order_lines' IN sql) > 0 AS uses_purchase_order_lines,
       position('inbound_plan' IN sql) > 0 AS uses_legacy_inbound_plans
FROM view_definition;
```

## 4. 생존 영역 기준값

Migration 전에 아래 결과를 저장한다. 행 수는 삭제 대상이 아닌 발주, 수령, 재고 VIEW가 contract 뒤에도 조회되고
보존됐는지 확인하는 운영 기준값이다.

```sql
SELECT 'purchase_orders' AS object, count(*) AS rows FROM purchase_orders
UNION ALL SELECT 'purchase_order_lines', count(*) FROM purchase_order_lines
UNION ALL SELECT 'inbound_receipts', count(*) FROM inbound_receipts
UNION ALL SELECT 'inbound_receipt_lines', count(*) FROM inbound_receipt_lines
UNION ALL SELECT 'purchase_order_receipt_lines', count(*) FROM purchase_order_receipt_lines
UNION ALL SELECT 'inbound_work_logs', count(*) FROM inbound_work_logs
UNION ALL SELECT 'stock_summary_view', count(*) FROM stock_summary_view
ORDER BY object;
```

## 5. 명시적 migration

백업 시각, preflight 3종 0행, 의존성 판정, 생존 영역 기준값을 기록한 뒤에만 저장소 root에서 다음 canonical 명령을
실행한다. 이 entrypoint가 `--stage`와 `--deployment`를 읽어 `deployments/lcnine/services`에서 SST shell을 다시 연다.

```sh
npm run db:migrate -- --stage live --deployment lcnine-services --yes
```

이 명령은 Core 전용이 아니다. `scripts/seeding/lib/service-registry.ts`의 `lcnine-services` registry 중 Drizzle config가
있는 **core, analytics, channel-adapter, membership, notification, ugc-service, search, wallet, file-service**를 차례로
migrate한다. 이 파일의 현재 registry를 실행 시점의 범위 정본으로 다시 확인한다. `medusa`도 registry에 있지만 Drizzle
config가 없어 이 명령의 대상은 아니다.

실행 전 각 대상 DB의 live `drizzle.__drizzle_migrations`와 해당 서비스 journal을 대조한다. 이 작업의 허용 pending
set은 다음과 같아야 한다.

- Core: `20260914154449_guard-purchase-order-receiving-contract`,
  `20260914154815_drop-legacy-inbound-plans` 두 개만 pending
- 나머지 등록 Drizzle 서비스: pending migration 0개

다른 pending migration이 있거나 Core의 두 파일 중 하나가 이미 단독 적용된 상태면 이 작업으로 묶어 실행하지 말고
중단한다. 실행 직전 확정한 registry, 서비스별 live 최신 history, journal 비교 결과를 배포 기록에 남긴다.

`scripts/seeding/phases/02-schema-sync.ts`는 서비스별 오류를 catch한 뒤 다음 서비스로 계속 진행하며 오류를 다시 던지지
않는다. 따라서 전체 프로세스의 exit 0이나 마지막 한 줄만으로 성공을 판정할 수 없다. 아홉 서비스 각각의
`── Migrating: <service> ──` 블록과 성공 출력을 보관하고, `Failed to migrate: <service>`가 한 건도 없으며 마지막
`Schemas migrated:` 목록에 아홉 서비스가 모두 있는지 확인한다. 한 서비스라도 증거가 없으면 실패로 취급한다.

또한 `apps/core/drizzle.config.ts`가 로컬 `apps/core/.env`의 `DATABASE_URL`을 다시 읽을 수 있다는 기존 운영 함정이
있다. Core 로그가 live DB를 대상으로 했다는 증거가 없으면 성공으로 판정하지 않는다. 마지막으로 live Core에서 다음
history/hash 조회와 §6 postcheck를 실행해야 적용 완료다. 결과는 아래 두 행과 정확히 같아야 한다.

```sql
SELECT created_at, hash
FROM drizzle.__drizzle_migrations
WHERE created_at IN (1789400689029, 1789400895203)
ORDER BY created_at;

-- 1789400689029 | 1f22efdc3d3a9846fc1058fe60c565b2a1e0fcbf8be923fae5105fba099888ab
-- 1789400895203 | 9695e02d0ed5ba194a837dcfc77cde74720483d9a8aba12c9d66e1d032a823ba
```

## 6. 적용 후 확인

제거 대상 다섯 종류가 모두 없어야 한다. 한 행의 `true, true, true`와 컬럼 조회 0행을 기대한다.

```sql
SELECT to_regclass('public.inbound_plans') IS NULL AS plans_removed,
       to_regclass('public.inbound_plan_items') IS NULL AS items_removed,
       to_regtype('public.plan_type') IS NULL AS plan_type_removed;

SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
    ('inbound_receipt_lines', 'plan_item_id'),
    ('inbound_work_logs', 'plan_item_id')
  )
ORDER BY table_name, column_name;
```

§4의 생존 영역 쿼리를 다시 실행해 모든 객체가 조회되고 migration 전 행 수와 같은지 비교한다. §3의
`stock_summary_view` 정의 검사를 다시 실행하되, 제거된 regclass cast를 포함한 의존성 목록 쿼리는 contract 뒤에
재실행하지 않는다. 이어서 정합성 3종은 옛 테이블/컬럼이 없어 SQL 자체가 더는 실행되지 않는 것이 정상이다.

차이가 있거나 application health check가 실패하면 추가 쓰기를 막고 복구 절차로 전환한다. destination ZIP에 기대지
말고 §1에서 확보한 최신 source/전체 DB 복구 지점을 사용한다. 원인과 복구 결과가 확인될 때까지 migration을 재시도하지
않는다.

## 7. 증거의 시점과 문서 부채

2026-09-14 23:55 KST의 PR-B 라이브 기록에서는 destination 계획 135건·품목 1,775건을 백업 후 삭제했고, source
계획 182건·품목 2,533건과 그에 대응하는 발주 182건·라인 2,533건을 보존했다. 당시 PR-C 정합성 3종은 0행이었다.
이 수치는 과거 증거이며 이번 live 적용 직전 검사와 최신 백업을 대신하지 않는다. 옛 셀메이트 CSV import 코드가 발주와
입고계획을 함께 만들던 경로는 확인했지만, 보존된 각 라이브 행이 그 경로에서 만들어졌는지는 확정하지 않았다.

`docs/api/wms-api.html`과 `web/almondyoung-storefront/public/wms-api.html`은 PR-B 이전 API snapshot으로 남아 있는
문서 부채다. 이 DB contract 적용 판단에는 사용하지 않는다.
