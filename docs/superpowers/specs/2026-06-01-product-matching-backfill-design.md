# product_matchings 백필 SeedStep 설계

날짜: 2026-06-01
상태: 승인 대기

## 배경 / 문제

Core 의 판매상품(`product_variants`)은 레거시 쇼핑몰에서 마이그레이션하면서 DB 에 직접 INSERT 되었다. 정식 상품 등록 경로(`ProductMatchingService.handleVariantCreated()`)를 타지 않았기 때문에, 이 variant 들에는 대응하는 `product_matchings` 행이 없다.

그 결과:

- 주문 consumer(`order-events.consumer.ts` → `createFromEvent`)는 `sales_order_lines` 를 만들 때 매칭 존재를 검사하지도, 없으면 만들지도 않는다 (`productMatchingId: l.productMatchingId ?? null`).
- admin-web 매칭체크 페이지(`getOrderLines`)는 `sales_order_lines` 를 `product_matchings` 와 `variant_id` 기준 leftJoin 한다. 매칭 행이 없으면 `matchingId === undefined`.
- `InventoryMatchingDialog` 는 `line.matchingId` 가 없으면 (1) 빨간 배너("이 주문의 매칭 레코드가 없습니다…")를 띄우고 (2) `isFormValid()` 가 즉시 false → 제출 버튼 영구 비활성화. 필수 필드를 다 채워도 저장 불가.

즉 매칭 행 부재 하나가 화면의 "전략 미결정" + 다이얼로그 잠김을 동시에 유발한다.

## 목표

레거시 마이그레이션으로 직접 INSERT 되어 매칭 행이 없는 **active variant** 에게, 멱등·재실행 가능한 방식으로 `pending` 매칭 행을 만들어 준다. 현재 데이터는 dev stage 에만 있으나, 레거시 migrator 가 동일하므로 결국 live 에도 같은 작업이 필요 → `--stage` / `--deployment` 를 받는 형태여야 한다(기존 seed 인프라가 이미 제공).

비목표: 정식 경로(직접 INSERT 시 매칭 누락) 자체의 근본 보강은 이번 범위 밖. 보정만 먼저 한다.

## 핵심 결정 사항

- **매칭 상태**: 무조건 `status='pending'`, `strategy=NULL`, `isResolved=false`, `priority='high'`.
  - 이유: `sales_variant_policies.inventory_management` 의 기본값이 `false` 인데, 레거시 직접 INSERT variant 들은 이 정책 행 자체가 없을 수 있다. "정책 따라 분기" 방식을 쓰면 정책 없는 variant 가 `false` 로 읽혀 전부 `void`(무재고, `status='matched'`+`isResolved=true` 자동 완결)로 박힌다. 이들은 실물 재고가 있는 진짜 상품이므로, 관리자 결정 없이 무재고로 잠기면 안 된다. `pending` 은 아무것도 자동 완결시키지 않고 관리자 SKU 결정을 강제한다.
- **masterId 채움**: 채운다. 모든 variant 는 master 하나에 종속(사용자 확인). `product_master_variants` 정션에서 variant 당 master 를 조회. 정션은 버전별로 행이 쪼개져 있으나 master_id 는 동일하므로 `DISTINCT` 하면 1행. 매칭은 `variant_id` 만으로 식별되며 버전과 무관하다 — master_id 는 정합성용 곁다리 컬럼(nullable).
- **배치**: 기존 seed 시스템에 `SeedStep` 추가 (접근 A). `--stage`/`--deployment`/멱등성/그룹 인프라를 재사용.
- **그룹**: `backfill` (명시 실행 전용). 일반 배포 흐름과 분리.
- **대상 범위**: `product_variants.status = 'active'` 이면서 매칭 없는 variant 만. draft/inactive 는 제외해 대기큐 오염 방지.
- **실행 방법**: `db:setup` 인터랙티브 그룹 선택에서 `backfill` 을 골라 실행. dedicated npm 스크립트는 두지 않는다.

## 구현

### 1. 새 SeedStep

파일: `scripts/seeding/steps/product-matching-backfill.seed-step.ts`

기존 `SeedStep` 추상 클래스(`base-seed-step.ts`) 상속. raw `postgres-js` + `drizzle` 만 사용(Nest DI 없음 — 다른 step 들과 동일).

- `readonly groups = ['backfill'] as const`
- `serviceName = 'ProductMatchingBackfill'`
- 생성자: core DB url (catalog + inventory 통합 스키마가 한 DB)

대상 쿼리:

```sql
SELECT pv.id AS variant_id
FROM product_variants pv
WHERE pv.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM product_matchings pm WHERE pm.variant_id = pv.id
  )
```

masterId 조회:

```sql
SELECT DISTINCT variant_id, master_id
FROM product_master_variants
WHERE variant_id = ANY($1)
```

variant 당 master_id 가 정확히 1개면 사용, 0개거나 2개 이상이면 `null` 로 넣고 로그 경고(데이터 이상 신호).

INSERT (멱등):

```sql
INSERT INTO product_matchings
  (variant_id, master_id, status, priority, strategy, is_resolved)
VALUES ($1, $2, 'pending', 'high', NULL, false)
ON CONFLICT (variant_id) DO NOTHING
```

`product_matchings` 에는 `variant_id` UNIQUE 제약이 있어 `ON CONFLICT (variant_id) DO NOTHING` 으로 재실행 안전.

정식 경로는 INSERT 후 `recalculateAndPublishForVariant`(판매가능수량 재계산 + Kafka publish)를 호출하지만, 이는 Nest 서비스라 seed 에서 부를 수 없다. pending 매칭은 strategy 가 없어 sellable 계산에 영향이 없고, 관리자가 resolve 할 때 그 경로가 재계산을 트리거하므로 백필에서 생략해도 안전하다.

### 2. check()

대상 variant 수를 세어 `SeedCheckResult` 리포트(기존 step 출력 포맷). 0 이면 `isFullySeeded=true`.

### 3. orchestrator 등록

`scripts/seeding/phases/03-seed-orchestrator.ts` 의 `buildSeedSteps()` core 블록(현 177–181행)에 한 줄 추가:

```ts
if (coreEntry?.hasSeedStep) {
  const coreDbUrl = urlFor(coreEntry.database);
  steps.push(new WmsSeedStep(coreDbUrl));
  steps.push(new PimSeedStep(coreDbUrl));
  steps.push(new ProductMatchingBackfillSeedStep(coreDbUrl)); // 추가
}
```

### 4. 자동 실행 차단

`db:seed:ref`(`seed-ref.ts`)는 `demo-` 가 아닌 모든 그룹을 자동 순회하므로, 그대로 두면 autodeploy 가 `backfill` 까지 매번 자동 실행한다. "명시 실행 전용"을 지키기 위해 `seed-ref.ts` 의 그룹 필터를 수정:

```ts
// before
const refGroups = allGroups.filter((g) => !g.startsWith(DEMO_GROUP_PREFIX));
// after
const refGroups = allGroups.filter(
  (g) => !g.startsWith(DEMO_GROUP_PREFIX) && g !== 'backfill',
);
```

이러면 autodeploy 는 `backfill` 을 절대 건드리지 않고, `db:setup` 인터랙티브 그룹 선택 메뉴에서만 사람이 골라 실행한다.

## 검증

- dev DB 에서 `db:setup -- --stage dev --deployment lcnine-services` → 그룹 선택 프롬프트에서 `backfill` 선택.
- 실행 후 admin-web 매칭체크 페이지에서 대상 주문이 "전략 미결정" 으로 뜨되 `matchingId` 가 채워져 "SKU 구성 매칭" 다이얼로그의 제출 버튼이 활성화되는지 육안 확인.
- 단위 테스트는 작성하지 않는다(기존 seed step 들도 테스트 없음; 이 환경에서 jest 실행은 OOM 으로 금지).

## 영향 받는 파일

- 신규: `scripts/seeding/steps/product-matching-backfill.seed-step.ts`
- 수정: `scripts/seeding/phases/03-seed-orchestrator.ts` (step 등록 1줄)
- 수정: `scripts/seeding/seed-ref.ts` (그룹 필터에서 `backfill` 제외)
