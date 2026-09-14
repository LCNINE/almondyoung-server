# 발주 수령 PR-C — 옛 DB 구조 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR-B가 사용을 중단한 입고계획 DB 구조를 안전하게 제거하고 발주·수령·재고 데이터 및 VIEW가 보존됨을 검증한다.

**Architecture:** 현재 스키마에서 옛 테이블·컬럼·관계·타입을 제거하고 Drizzle로 contract DDL을 생성한다. 앞선 custom preflight migration은 스펙의 정합성 3종을 같은 마이그레이션 트랜잭션에서 검증한다. 생성된 미적용 DDL의 CASCADE는 예상 FK를 명시적으로 해제하고 RESTRICT로 바꾸어 예상 밖 의존 객체를 PostgreSQL이 거부하도록 한다. 과거 마이그레이션 파일은 변경하지 않는다.

**Tech Stack:** NestJS · TypeScript · Drizzle/PostgreSQL · Jest · 로컬 PostgreSQL(5432).

**Spec:** `docs/superpowers/specs/2026-09-14-purchase-order-owns-receiving-design.md` §11 PR-C. 선행 계획: `docs/superpowers/plans/2026-09-14-purchase-order-owns-receiving-pr-b.md`.

## Global Constraints

- 이번 범위는 **§11 PR-C — 옛 DB 구조 제거(contract)**. PR-A #867과 PR-B #872는 develop 머지 및 라이브 migrate/deploy/검증 완료. base: `2760b89a8b4aad3a08d9528cf2176b4e9d1e7c85`(2026-09-15 origin/develop fetch 결과).
- 제거 대상은 `inbound_plans`, `inbound_plan_items`, `plan_type`, `inbound_receipt_lines.plan_item_id`, `inbound_work_logs.plan_item_id`와 그 스키마 관계·export·타입뿐이다. API/화면 동작과 수령·발주·이동·재고 원장은 보존한다.
- 배포 순서는 **deploy → migrate**. 이번 세션은 구현·검증·PR 생성까지이며 라이브 배포·마이그레이션·데이터 변경을 실행하지 않는다. 라이브 적용 직전 정합성 3종 0행과 의존성 재확인은 이후 운영자의 필수 단계다.
- 서브에이전트는 **Sol 또는 그 이하 모델만** 사용한다. 구현자는 하위 에이전트를 생성하지 않는다. `db:generate`는 컨트롤러가 실행한다. 스키마와 생성 DDL·meta는 하나의 커밋으로 묶는다.
- `DROP CASCADE`로 예상 밖 VIEW·의존 객체가 사라져서는 안 된다. 생성 SQL을 그대로 신뢰하지 않고 현재 미적용 DDL을 RESTRICT로 강화한다. 예상 FK만 명시적으로 해제하며 추가 의존 객체는 자동 삭제하지 않는다.
- 기존 적용된 SQL·snapshot을 변경하지 않는다. PR-B 백필 테스트의 역사적 단언은 보존하되 현재 DB를 여는 재실행 suite는 격리된 PR-A DB로 옮긴다. 과거 체인을 테스트하는 SQL 참조는 유효한 역사적 참조다.
- 작업 DB는 새 `pr_c_` 접두사 로컬 DB만 사용한다. 공유 `core`/`dev_core` 및 live에 migrate하지 않는다. 테스트 클라이언트·직접 생성한 DB는 정리한다. `.env`·비밀·백업 데이터를 커밋하지 않는다.
- 저장소 AGENTS.md/CLAUDE.md의 schema generate, 타입/레이어, Jest 규칙을 따른다. Yarn이 설치되지 않은 현재 환경에서는 기존 node_modules와 npm/npx를 사용하고 lockfile은 바꾸지 않는다.

## 확인된 라이브 사실과 증거 범위

2026-09-14 23:55 KST 기록 `/home/pauseb/Documents/Codex/2026-09-14/files-mentioned-by-the-user-2026/outputs/pr-b-live-deployment-result.md`를 읽었다. destination 계획 135건·품목 1,775건은 삭제 직전 전체 백업 후 정리했으며 source 계획 182건·품목 2,533건과 발주 182건·라인 2,533건은 보존됐다. PR-B 후 정합성 3종은 모두 0행이었다. 이는 **현재 PR-C 적용 전 검사의 대체 증거가 아니다**.

백업은 같은 outputs의 `pr-b-destination-backup-20260914.zip`이며 삭제한 destination 행의 전체 백업이지 source/전체 DB 백업이 아니다. 옛 셀메이트 CSV import가 발주와 입고계획을 함께 만들던 코드 경로는 확인됐으나 해당 라이브 행의 정확한 실행 출처는 확정하지 않았다. 스펙의 과거 “라이브 없음/미확인” 설명은 이 검증 기록으로 보완한다.

## File Structure

| 파일 | 책임 |
|---|---|
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` | 두 테이블, enum, 두 컬럼, 관계/export/모델 타입 제거 |
| `apps/core/src/modules/inventory/schema/enum-values.ts` | `planTypeEnum` import와 `planTypeValues`/`PlanTypeEnum` 제거 |
| `apps/core/drizzle/*_guard-purchase-order-receiving-contract.sql` + meta | custom 정합성 guard(컨트롤러 생성) |
| `apps/core/drizzle/*_drop-legacy-inbound-plans.sql` + meta | schema 생성 contract DDL, 미적용 CASCADE를 RESTRICT로 강화 |
| `apps/core/src/modules/inventory/schema/purchase-order-receiving-backfill-guard.integration.spec.ts` | 현재 DB 의존 재실행 suite를 과거 체인의 격리 DB로 이동 |
| `apps/core/src/modules/inventory/schema/purchase-order-receiving-contract.integration.spec.ts` | 실제 migration chain, 데이터·VIEW 보존, 거절 및 rollback 검증 |
| `apps/core/src/modules/inventory/procurement/procurement.module.ts` | ADR-0039의 현재 조달 경계와 `received` 의미를 설명 |
| `web/almondyoung-storefront/src/domains/products/product-details/components/product-actions/restock-notice.tsx` | 재입고 metadata의 현재 발주 라인 원천을 설명 |
| `docs/runbooks/purchase-order-receiving-contract.md` | 라이브 적용 전 쿼리/의존성 검사, deploy → migrate, 검증·복구 경계 |
| `docs/superpowers/specs/2026-09-14-purchase-order-owns-receiving-design.md` | 과거 미확인 설명에 확인 시점·실제 검증 기록 추가 |

### Task 1: 정합성 가드와 contract 스키마·마이그레이션

**Files:** 위 schema 2개, 새 migration 2개와 meta, 새 contract integration spec, 기존 backfill-guard spec의 현재 DB 의존 suite.

**Interfaces:** PR-B 체인의 끝은 `_backfill-purchase-order-receiving`. 신규 custom tag suffix는 `_guard-purchase-order-receiving-contract`, DDL suffix는 `_drop-legacy-inbound-plans`. 컨트롤러가 custom 파일을 먼저 생성하고, 구현자가 schema를 정리한 뒤 DDL을 생성한다. 구현자는 생성 요청 시 진행 상태를 파일에 기록하고 컨트롤러에 알린다.

- [x] **Step 1: 실제 DB 테스트를 먼저 작성하고 RED 확인.** `purchase-order-receiving-backfill-guard.integration.spec.ts`의 `readMigrationFiles` + `PgDialect.migrate`, unique DB 이름, finally cleanup 방식을 따른다. PR-B까지만 적용한 임시 DB에 source 계획/품목, 대응 발주 라인, direct 및 purchase_order 회차, 작업 로그를 만든다. 기대하는 실패는 contract가 없어서 옛 테이블/컬럼이 남거나 잘못된 데이터가 거절되지 않는 것이다. 테스트를 건너뛰거나 텍스트 검색만으로 대체하지 않는다.

```ts
expect(await client`SELECT to_regclass('public.inbound_plans') AS name`).toEqual([{ name: null }]);
expect(await client`SELECT to_regclass('public.inbound_plan_items') AS name`).toEqual([{ name: null }]);
expect(await client`SELECT to_regtype('public.plan_type') AS name`).toEqual([{ name: null }]);
```

행/컬럼 존재 확인 외에 발주·발주 라인·수령 라인·링크·작업 로그와 재고 VIEW 정의/OID·조회 결과가 변경되지 않았음을 전후 비교한다. 테스트는 clean empty chain도 끝까지 적용한다.

- [x] **Step 2: 컨트롤러에게 custom migration 생성 요청.** 컨트롤러 명령:

```sh
npm run db:generate:core -- --custom --name guard-purchase-order-receiving-contract
```

생성 custom 파일에 다음 세 SELECT를 각각 `IF EXISTS (...) THEN RAISE EXCEPTION 'PR-C guard: ...'; END IF;`로 감싼 `DO $$ BEGIN ... END $$;`를 넣는다. 다음 한 문장으로 검사 이전에 transaction-scoped lock을 잡아 검사와 DROP 사이 쓰기 경합을 차단한다: `LOCK TABLE purchase_order_lines, purchase_order_receipt_lines, inbound_receipt_lines, inbound_work_logs, inbound_plans, inbound_plan_items IN SHARE MODE;`. `SET LOCAL lock_timeout = '10s'`로 잠금 실패는 변경 없이 중단시킨다.

```sql
SELECT ipi.id FROM inbound_plan_items ipi
JOIN inbound_plans ip ON ip.id = ipi.plan_id
LEFT JOIN purchase_order_lines pol ON pol.po_id = ip.linked_purchase_order_id AND pol.sku_id = ipi.sku_id
WHERE pol.po_id IS NULL;

SELECT irl.id FROM inbound_receipt_lines irl
LEFT JOIN purchase_order_receipt_lines porl ON porl.receipt_line_id = irl.id
WHERE irl.plan_item_id IS NOT NULL AND porl.receipt_line_id IS NULL;

SELECT pol.po_id, pol.sku_id FROM purchase_order_lines pol
LEFT JOIN purchase_order_receipt_lines porl ON porl.po_id = pol.po_id AND porl.sku_id = pol.sku_id
LEFT JOIN inbound_receipt_lines irl ON irl.id = porl.receipt_line_id
GROUP BY pol.po_id, pol.sku_id, pol.received_qty
HAVING pol.received_qty <> COALESCE(SUM(irl.quantity - irl.canceled_qty), 0);
```

각 위반을 다른 fixture로 만들고 예외와 schema/data/migration journal rollback을 단언한다. 누계 fixture는 취소량도 포함한다. 별도 커넥션이 purchase_order_lines에 ROW EXCLUSIVE를 보유한 상태에서 실제 guard+DDL 실행이 10초 lock_timeout으로 거절되고 schema/data/journal이 PR-B 그대로인지 검증한다. 테스트 finally에서 잠금을 해제한다. migration journal은 PR-B backfill → PR-C guard → PR-C DDL 연속 순서를 단언하고 두 PR-C migration은 항상 한 migrate 호출에 넣는다.

- [x] **Step 3: schema와 enum export를 제거하고 DDL 생성 요청.** 두 테이블 정의 및 해당 enum, receipt/work log `planItemId`, table registry, sku/warehouse/purchase order 역관계, 옛 관계 정의/registry, `InboundPlan`/`NewInboundPlan`/`InboundPlanItem`/`NewInboundPlanItem`, enum-values를 정리한다. 이후 컨트롤러 실행:

```sh
npm run db:generate:core -- --name drop-legacy-inbound-plans
```

미적용 DDL은 생존 테이블의 두 FK를 명시적 `DROP CONSTRAINT`로 해제하고 `inbound_plan_items`를 `inbound_plans`보다 먼저 삭제한다. 두 테이블의 DROP에 `RESTRICT`를 사용한다. 테이블 내부의 자기 FK는 테이블과 함께 제거되는 PostgreSQL 동작을 실제 테스트로 확인한다. 두 `plan_item_id` 컬럼과 `plan_type`도 RESTRICT로 제거한다. 예상 밖 FK/VIEW/타입 의존성은 삭제하지 않는다. DDL이 enum, 두 테이블, 두 컬럼, 예상 FK 이외 객체를 변경하면 원인을 조사해 범위를 바로잡는다.

```sql
-- Expected shape; use the exact FK names emitted by the generator.
DROP TABLE "inbound_plan_items" RESTRICT;
DROP TABLE "inbound_plans" RESTRICT;
ALTER TABLE "inbound_receipt_lines" DROP COLUMN "plan_item_id" RESTRICT;
ALTER TABLE "inbound_work_logs" DROP COLUMN "plan_item_id" RESTRICT;
DROP TYPE "public"."plan_type" RESTRICT;
```

- [x] **Step 4: 의존성 안전성/전환 양쪽 검증.** 옛 계획 테이블 VIEW, 두 제거 컬럼 중 하나를 참조하는 VIEW, `plan_type`을 쓰는 외부 컬럼, 예상 밖 FK를 각각 만들어 migrate가 의존성 오류로 실패하고 모든 데이터·객체·적용 이력이 그대로임을 검증한다. 정상 케이스는 `stock_summary_view` 및 기존 모든 VIEW가 보존된다. 새 schema를 쓰는 Drizzle insert/select가 PR-B DB(deploy 후 migrate 전)와 contract DB 모두에서 작동함을 검증한다. PR-B의 역사 테스트는 기존 경계에서 계속 통과해야 한다. 기존 backfill-guard spec의 두 번째 describe는 현재 DATABASE_URL에 옛 테이블을 삽입하므로 격리된 pre-PR-B DB로 옮기거나 기존 격리 suite에 합친다. 두 기존 단언(P1 거절/정상 통과)을 보존한다.

```sh
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pr_c_base_20260915 npx jest --runInBand --testPathPattern='purchase-order-receiving-(contract|backfill-guard).integration'
npm run type-check
```

- [x] **Step 5: 자체 리뷰 후 schema+SQL+meta+tests 함께 커밋.** `git diff --check`, targeted 테스트, 생성 journal 순서와 이전 파일 불변 확인. 커밋: `refactor(inventory): 옛 입고계획 DB 구조를 안전하게 제거한다`. report에 명령/실제 결과/RED-GREEN 증거와 남은 우려를 남긴다. 컨트롤러는 별도 Sol reviewer로 스펙 준수와 품질을 검토한다.

### Task 2: 운영 절차와 최종 회귀 검증

**Files:** 새 runbook, spec의 라이브 관측 설명, procurement/restock의 설명 주석, 이 계획의 완료 체크/검증 기록.

**Interfaces:** Task 1의 신규 migration 2개와 통합 테스트를 사용한다. 과거 PR-B 결과는 시점이 명시된 관측이고 앞으로 실행할 명령과 구분한다.

- [x] **Step 1: 런북에 deploy → migrate 절차와 읽기 전용 preflight SQL을 기록.** Task 1의 정합성 세 SELECT를 각각 그대로 복사하고 결과가 모두 0행이어야 한다고 적는다. `pg_depend` 조회는 `pg_describe_object(classid,objid,objsubid)`와 ref object/subid를 포함하여 두 테이블·두 컬럼·enum의 의존성을 읽을 수 있게 한다. FK 2개와 삭제 테이블 자체 부속 외에 VIEW·외부 FK·타입 이용자가 있으면 중단한다. stock_summary_view는 발주 라인을 참조해야 한다. migrate가 RESTRICT로 최종 방어함도 설명한다.

```sql
SELECT pg_describe_object(classid, objid, objsubid) AS dependent,
       pg_describe_object(refclassid, refobjid, refobjsubid) AS referenced, deptype
FROM pg_depend
WHERE refobjid IN ('public.inbound_plans'::regclass, 'public.inbound_plan_items'::regclass);
```

테이블 의존성만으로 컬럼/enum 검사가 끝났다고 하지 않는다. 라이브 적용은 후속 지시 때 배포 완료 확인 → 쓰기 안정화/최신 백업 확인 → 세 검사 및 의존성 확인 → 명시적 migrate → 두 테이블/enum/두 컬럼 부재와 세 생존 영역(발주, 수령, 재고 VIEW) 보존 확인 순서다. 기존 destination ZIP으로 source를 복구할 수 없음을 명시하고 삭제 전 source 테이블/컬럼의 최신 백업 또는 전체 DB 복구 지점을 운영자가 확보하도록 한다.

- [x] **Step 2: spec의 낡은 라이브 설명 보완.** §11 PR-B의 “라이브에 이 경로를 쓰는 데이터가 없다”는 가정과 §15의 미측정 설명을 과거 시점의 설명으로 표시하고 위 확인 사실을 추가한다. CSV import 경로 확인과 실제 개별 행 출처의 불확실성을 구분한다. PR-B 적용 SQL은 수정하지 않는다.

- [x] **Step 3: 최종 검증.** 컨트롤러와 분담하여 type-check, DB 없는 전체 Jest, admin-web tsc/순수 테스트, 창고 앱 기존 테스트, Core build를 실행한다. 로컬 통합 러너의 동일 패턴을 작업 전용 base/head DB에 적용하여 비교한다. `test:core:integration:local`은 공유 core에 migrate하므로 직접 사용하지 않고 동등 명령과 차이를 결과에 적는다.

```sh
npm run type-check
env -u DATABASE_URL npx jest --maxWorkers=2
npm run build:core
npm run test:admin-web -- --maxWorkers=2
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pr_c_head_20260915 npx jest --runInBand --testPathPattern='(apps/core|libs/events|libs/cron-once|scripts/fulfillment-v2)/.*integration'
cd apps/admin-web && npx tsc --noEmit
# Separate command from repository root:
cd native/warehouse-app && npm test -- --run
```

계약 변경에 대한 수령/취소/잔량종결/입고대기/stock VIEW/동기화 SQL의 실제 DB 회귀 테스트를 유지한다. 이번 PR은 화면 변경이 없으므로 기존 PR-B 화면 스모크를 재실행했다는 주장은 하지 않으며 DB 변경 후 업무 동작은 통합 테스트 증거로 보고한다. root type-check와 DB 없는 전체 Jest, admin 검사, 창고 앱, Core build는 모두 exit 0이어야 한다. 별도 실 DB 통합은 스펙 §12가 명시한 develop 대비 새 실패 0 기준을 적용하고 base와 실패 테스트 이름을 대조한다. 최종 검색에서 runtime 참조는 0건이어야 한다. 역사 SQL/test/docs와 설명 주석은 분류하여 남긴다.

- [x] **Step 4: 문서 검증 후 커밋.** `docs(inventory): PR-C 적용 전 검사와 배포 절차를 기록한다`. 각 명령의 실제 결과와 미실행 항목을 기록한다. task review 및 whole-branch review를 Sol로 수행하고 중요 지적을 수정·재검토한다.

- [x] **Step 5: 컨트롤러가 검증된 브랜치를 push하고 develop 대상 PR 생성.** PR 본문에 제거 대상, 선행 라이브 완료 기록, 테스트 결과/base 비교, destructive migration, **deploy → migrate**, **이번 세션 live 미적용**, 이후 재검사/백업 조건을 적는다. #871에 관련 링크를 걸되 이 세션에서 merge하거나 배포하지 않는다.

## 계획 자체 검토

- 스펙 §11 PR-C 제거 대상 5종: Task 1 Step 3. 관계/타입 정리: 같은 단계.
- 정합성 3종: Task 1 Step 2 및 Task 2 Step 1. 라이브 재확인은 후속 적용 전 조건.
- CASCADE 위험: 생성물 검토 + RESTRICT로 강화 + 예상 밖 의존 객체 rollback 테스트(Task 1 Step 3~4).
- deploy → migrate: Global Constraints, Task 2 런북과 PR 본문. 이번 세션 라이브 변경 없음.
- 공유 파일/의존 인터페이스: Task 1은 schema/SQL/test 생성, Task 2는 이를 수정하지 않고 문서/검증으로 소비. 양쪽 migration suffix와 테스트 패턴 일치.

## 코드 감사 반영

- 현재 DB를 전제로 옛 행을 삽입하던 PR-B 재실행 테스트를 격리된 역사 DB로 이동하도록 Task 1에 추가했다.
- `docs/api/wms-api.html` 및 `web/almondyoung-storefront/public/wms-api.html`은 PR-B 이전 API 스냅샷이다. 이번 DB contract에서 전체 API 문서를 임의로 재생성하지 않고 런북에 기존 문서 부채로 기록한다. 실제 DB/runtime 조회 참조는 제거한다.

## 이번 워크트리 기준선

- root type-check 및 admin-web tsc: exit 0.
- DB 없는 Jest: admin 의존성 연결 전 601 suite 통과/1 suite 모듈 누락. 기존 admin node_modules를 연결한 후 해당 suite 5개 테스트 통과. 최종 전체 실행에서 재확인한다.
- 창고 앱: 64 files / 326 tests 통과.
- 새 PR-B DB에 전체 Core 통합 패턴 실행: 9 failed / 94 passed suites, 14 failed / 631 passed / 4 todo tests. 실패 suite: bulk-session-publish, bulk-session-draft, shipment-planning, product-masters-variant-preview, stock-valuation.reader, inventory-command.service.adjust, stocktaking-uniques, unified-reservation.service.lifecycle, unified-reservation.service.lock. 최종 HEAD와 실패 test 이름까지 비교한다.

## 계획 리뷰 반영

- Sol 계획 리뷰의 역사 테스트 격리, 두 migration 단일 트랜잭션/연속 순서, SHARE lock 6개와 실제 경합 rollback 검증, 빠진 최종 명령을 반영했다. 중복되는 guard mutation 검증은 실제 SQL 거절/rollback 검증으로 대체했다.
- 검증 기준 해석: CLAUDE.md의 0실패 요구는 root type-check와 DB 없는 Jest에 적용한다. 별도 Core 실 DB 통합에는 스펙 §12의 명시적 “develop 기준선 대비 새 실패 0”을 적용한다. 두 검증 층을 혼동하지 않는다.

## 실제 검증 기록

- Task 1 commit `a7af70349`: 독립 리뷰 지적 0건. schema snapshot은 두 테이블·enum·두 컬럼/FK만 제거했고 기존
  VIEW는 유지했으며 migration chain이 연속함을 확인했다.
- 컨트롤러 검증: root type-check, DB 없는 Jest(602 suites/5,312 tests), Core build, admin-web tests
  (112 suites/960 tests)와 tsc, 창고 앱 tests(64 files/326 tests), consume-validation gate 모두 exit 0. 첫 parallel
  Jest 실행은 통과했지만 worker teardown 경고가 한 번 있었고, 이어서 `--runInBand --detectOpenHandles`로 같은 전체
  suite를 실행해 같은 602 suites/5,312 tests 통과 및 경고 비재현을 확인했다.
- 실 DB 통합: PR-B base 9 failed/94 passed suites, PR-C head 8 failed/96 passed suites. 실패 이름 비교에서 새 실패
  0건이며 base-only stock valuation 실패의 비재현을 PR-C 개선으로 간주하지 않는다. 계약 targeted 역사/PR-C suite는
  2 suites/21 tests 통과했다. 공유 DB를 migrate하는 wrapper 대신 동일 Jest pattern을 격리 DB에 실행했다.
- 2026-09-15 Task 2: 빈 migration prefix에서 PR-B까지 적용한 `pr_c_t2_20260915`에서 런북 정합성 3종이 각각
  0행이고 5개 제거 대상의 dependency inventory가 예상한 두 외부 FK와 삭제 객체 자체 부속만 출력함을 확인했다.
  읽기 전용 `pr_c_head_20260915` postcheck는 두 테이블·enum·두 컬럼 부재, `stock_summary_view` 존재,
  `purchase_order_lines` 참조, 옛 계획 참조 부재를 확인했다. 작업 DB는 검증 후 삭제했다.
- 이번 세션에는 라이브 DB 조회·migration·deploy, 브라우저/창고 앱 수동 smoke를 실행하지 않았다.
- Sol의 task review와 whole-branch review를 완료했다. 최종 문서 지적 두 건은 `177f94a2a`에서 수정했고 scoped
  re-review에서 모두 해결됐으며 남은 지적은 없다.
- 브랜치를 push하고 develop 대상 [PR #873](https://github.com/LCNINE/almondyoung-server/pull/873)을 생성했다.
  라이브 배포·migration은 머지 후 별도 지시로 수행한다.
