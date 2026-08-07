# 배치 피킹방식 ↔ 피킹전략 정합성 설계 스펙

- 날짜: 2026-07-27
- 대상: `apps/core` (fulfillment, inventory schema) + `apps/admin-web`
- 브랜치: `docs/picking-method-strategy-alignment` (base `4a5d0eca7`)
- 상태: 설계 승인됨 (구현 전) — 브레인스토밍 산출물
- 해결 이슈: #543 (배치 `pickingMethod` ↔ 피킹 전략 정합성 공백)
- 관련: #542 (하드닝 현황판 W4 정정 — 이 작업 후 갱신), `docs/superpowers/specs/2026-07-26-warehouse-app-phase3-outbound-design.md` §3.5 (발견 지점), `docs/adr/0005-drizzle-migration-and-autodeploy.md` (마이그레이션 순서)

## 1. 목표

출고 배치가 어떤 방식으로 처리되는지를 **한 축으로 통일**한다. 현재 배치의 `picking_method` 컬럼과 피킹 plan 의 `strategy` 컬럼이 서로를 검증하지 않아 "개별피킹이라고 기록된 배치 위에서 토탈피킹이 수행되는" 상태가 기술적으로 가능하다. 토탈피킹 개통(#542) 전에 이 공백을 닫는다.

**이번 범위는 정합성까지다.** 창고의 `supported_picking_strategies` 설정은 건드리지 않으므로 토탈피킹·멀티오더 피킹은 여전히 비활성으로 남는다 (§9).

## 2. 현재 상태 실측

### 2.1 두 축이 독립적으로 움직인다

| 축 | 저장 위치 | 정해지는 시점 | 실제 동작을 지배하는가 |
|---|---|---|---|
| `picking_method` | `outbound_batches.picking_method` (notNull, enum `individual`\|`total_picking`) | 배치 생성 | **아니오** |
| `strategy` | `picking_plans.strategy` (notNull, enum `discrete`\|`aggregate_then_sort`\|`pick_to_tote`) | plan 생성 | **예** |

plan 생성 경로(`picking-process.service.ts:73-83`)는 배치를 조회하지만 `warehouseId` 만 뽑는다. 검증은 `PickingStrategyRegistry.resolveForWarehouse` 가 **창고 설정만** 본다. 세 전략 구현 어디에도 `batch.pickingMethod` 참조가 없다.

plan 생성 이후 모든 작업(`start`/`scan`/`handoff`)은 `withPlanStrategy`(`picking-process.service.ts:193-212`)가 **`picking_plans.strategy` 를 DB 에서 다시 읽어** 전략을 해석한다. 컨트롤러의 `strategy: 'discrete'`(`picking-v2.controller.ts:136`)나 입력 타입의 `strategy?: 'discrete'` 는 권위가 아니라 TS 유니온 판별자다.

### 2.2 `picking_method` 는 아무도 읽지 않는다

마이그레이션 스냅샷·테스트 픽스처를 제외한 전량 참조:

| 위치 | 성격 |
|---|---|
| `inventory.schema.ts:202,2241` | enum·컬럼 정의 |
| `enum-values.ts:148` | enum 값 재export (타입) |
| `outbound-batch-orchestrator.service.ts:80` | `dto.pickingMethod !== 'individual'` → 409. **요청 body 검사이지 저장된 컬럼 검사가 아니다** |
| `outbound-batch-orchestrator.service.ts:106` | insert |
| `outbound-batch-orchestrator.service.ts:115` | 감사 로그 payload |
| `outbound-batch-orchestrator.service.ts:552,634` | 상세·목록 응답 DTO |

`where`/`orderBy` 조건으로 쓰이는 곳이 없고, admin-web 은 생성 시 `'individual'` 을 **하드코딩**하며(`create-batch-dialog/index.tsx:51`) 목록·상세 **어디에도 렌더링하지 않는다.**

### 2.3 `cart_capacity` 도 같은 상태

`outbound_batches.cart_capacity`(`inventory.schema.ts:2242`, 주석 `// 토탈피킹 시 바구니 수`)는 레포 전체 참조 **0건**이다. DTO 에도 없다.

즉 배치 테이블에는 "여기서 피킹 방식과 그 파라미터를 설정한다"는 **미완의 설계 의도가 두 칸** 박혀 있다. #543 은 죽은 컬럼 하나의 문제가 아니라 배선되지 않은 원 설계의 문제다.

### 2.4 전략을 실제로 고르는 두 경로

| 경로 | 누가 고르나 | 시점 |
|---|---|---|
| admin-web 배치 상세 드로어 (`batch-detail-drawer/index.tsx:143-176`) | 사람이 `<Select>` 로 선택. 옵션 = `batch.warehouse.supportedPickingStrategies` | 피킹 시작 직전 |
| warehouse-app 단순출고 (`simple-outbound.service.ts:574`) | core 가 `'discrete'` 하드코딩 | 작업자 첫 송장 스캔 |

배치 생성 시점에는 아무도 방식을 정하지 않는다.

### 2.5 배치에는 수정 API 가 없다

`outbound-batch-v2.controller.ts` 의 엔드포인트는 생성·목록·송장 추가/제거·work item claim·조회가 전부다. 배치 속성을 고치는 수단이 없으므로, 방식을 잘못 고르면 취소 후 재생성이다 (§9 에서 범위 밖으로 명시).

## 3. 현장 이해 — 세 방식의 물리적 실체

커스터디 전이가 "물건이 지금 누구·어디 손에 있나"이므로 물리 절차와 거의 1:1이다. 세 전략 모두 종착점은 `PACKING` 으로 고정이다(`inspectionReadyCustody`).

### 3.1 개별피킹 `discrete` — `AT_SOURCE → WORKER → PACKING`

작업자 한 명이 **송장 한 건**을 잡고 그 주문에 필요한 물건만 들고 한 바퀴 돈다. 물건은 **집히는 순간 특정 송장에 귀속**된다. 중간 커스터디가 `WORKER` 하나뿐인 이유다.

대가는 이동이다. 주문 10건이 같은 선반을 필요로 하면 그 선반을 10번 간다. Phase 3 단순출고가 쓰는 방식이다.

### 3.2 토탈피킹 `aggregate_then_sort` — `AT_SOURCE → BULK_CART → SORTING → PACKING`

**큰 카트** 한 대로 두 단계를 수행한다.

1. **벌크 수거**(`bulk_collect`): 배치 전체 합계로 집는다("A상품 17개"). 선반은 한 번만 간다. 이때 물건은 **누구 것인지 모르는 풀** 상태다 — 커스터디 `BULK_CART` 에는 송장 귀속이 없다.
2. **분류**(`sort`): 카트를 **포장대까지 들고 와야** 분류가 시작된다. 스캔으로 주문별 귀속을 확정 → `SORTING` 또는 바로 `PACKING`.

`cart_handoff` 로 카트째 다른 작업자에게 넘길 수 있다(`logistics_manager`/`master` 권한 — 무주공산 물건의 책임 이전이라 감사 대상).

배치 크기의 상한은 카트의 **부피·무게**라서 시스템이 정형화할 수 없다. 사람이 판단한다.

### 3.3 멀티오더 피킹 `pick_to_tote` — `AT_SOURCE → TOTE → PACKING` (도입 예정)

**바구니가 여럿 달린 전용 카트**로 한 바퀴에 여러 주문을 처리하되, 집는 즉시 해당 주문의 바구니에 넣는다. **분류 단계가 없다** — 카트 위에서 분류가 끝난다. `requiresPhysicalTote: true` 로 토트가 실물 등록·관리된다(`tote_status`, `shipment_tote_assignments`).

이동은 토탈피킹처럼 아끼고 귀속은 개별피킹처럼 즉시 확정하는 중간 형태다.

### 3.4 배치의 의미 = 카트 한 대 분량

**벌크 수거용 카트는 배치당 한 대**다. 배치를 두는 이유 자체가 "카트 한 대에 실리는 작업량"이다.

여기서 `cart_capacity` 의 의미가 확정된다:

| 해석 | 판정 |
|---|---|
| 카트 **대수** | **아니다.** 배치당 한 대이므로 항상 1 |
| 카트 한 대의 **바구니 수** | **맞다.** 바구니 하나 = 주문 하나 → **배치에 담을 수 있는 송장 수 상한** |

따라서 `cart_capacity` 는 **`pick_to_tote` 의 파라미터**이지 `aggregate_then_sort` 의 것이 아니다. 큰 카트에는 바구니가 없다. 스키마 주석 `// 토탈피킹 시 바구니 수` 는 두 방식을 뒤섞은 서술이며, 이 스펙이 정정한다.

강제 지점도 이로부터 나온다. 바구니 24개짜리 카트에 송장 25건을 담아 현장에 내보내면 **이미 늦다.** 수거 중이 아니라 **배치를 짤 때** 막아야 한다.

## 4. 결정 — 배치가 방식을 정하고 전략은 그로부터 파생된다

세 방식이 각자 다른 카트·다른 분류 시점·다른 제약을 가지므로 방식과 전략은 **1:1** 이다. 방식을 정하면 전략이 결정되고, plan 이 고를 자유도는 0 이다. 따라서 "배치가 방식을 정하고 plan 이 그 안에서 전략을 고른다"가 아니라 **plan 이 전략을 아예 고르지 않는다.**

이로써 #543 은 검증으로 막히는 것이 아니라 **어긋날 두 축이 사라져 구조적으로 소멸**한다.

### 4.1 검토했으나 채택하지 않은 안

| 안 | 내용 | 기각 사유 |
|---|---|---|
| 조합 검증만 추가 | `pickingMethod` 유지 + plan 생성 시 허용 조합 검증 | 1:1 이므로 두 컬럼을 영구히 동기화하는 코드를 짜는 셈. 공백을 없애는 게 아니라 관리 가능하게 유지할 뿐 |
| `pickingMethod` 은퇴, plan 이 전부 소유 | 배치 두 컬럼 drop, plan 에 파라미터 추가 | 배치 생성~plan 생성 사이엔 활성 plan 이 없어 **방식을 표시할 수 없다**. "내일 토탈피킹 배치 3건 잡아둠" 같은 계획 뷰가 불가능. destructive 마이그레이션 2-PR 비용도 큼 |
| 첫 plan 이 배치 컬럼을 write-back | 배치는 방식 없이 생성, plan 이 파생 기록 | 바구니 수를 놓을 자리가 없다(plan 생성 때 받으면 결국 위 안). 배치 목록의 방식 칸이 plan 전엔 빈칸 |

## 5. 설계

### 5.1 방식 ↔ 전략 1:1 맵 (단일 출처)

신규 `apps/core/src/modules/fulfillment/picking/picking-method.contract.ts`:

```ts
export const STRATEGY_BY_PICKING_METHOD = {
  individual:    'discrete',
  total_picking: 'aggregate_then_sort',
  multi_order:   'pick_to_tote',
} as const satisfies Record<PickingMethodEnum, PickingStrategyName>;
```

- `method` = 현장 용어(무엇을 하는가), `strategy` = 코드 전략(어떻게 구현했나)로 **어휘를 분리**한다. `pick_to_tote` 를 method 값으로 그대로 쓰면 두 어휘가 섞이므로 `multi_order`(멀티오더 피킹)를 쓴다.
- `satisfies Record<PickingMethodEnum, ...>` 가 핵심이다. `picking_method` enum 에 값이 추가되면 **이 맵을 갱신하지 않는 한 컴파일이 깨진다.** 두 축이 다시 벌어지는 것을 타입이 막는다.
- 역방향 조회가 필요하면 이 맵에서 파생한다. 별도 상수를 두지 않는다.

### 5.2 배치 생성 — 리터럴 게이트를 창고 능력 검사로 교체

`CreateOutboundBatchV2Dto`:

```ts
@IsIn(['individual', 'total_picking', 'multi_order'])
pickingMethod: PickingMethodEnum;

@IsOptional() @IsInt() @Min(1) @Max(2147483647)
cartCapacity?: number;
```

`OutboundBatchOrchestrator.createBatch`:

1. `orchestrator.ts:80` 의 `dto.pickingMethod !== 'individual'` 하드코딩 게이트를 **삭제**한다.
2. 창고 조회(`:93-97`)의 select 에 `supportedPickingStrategies` 를 추가하고, `STRATEGY_BY_PICKING_METHOD[dto.pickingMethod]` 가 그 배열에 없으면 409 `OUTBOUND_BATCH_METHOD_NOT_SUPPORTED`.
3. `multi_order` 면 `cartCapacity` 필수, 그 외 방식이면 제공 시 거부 → 400 (`BadRequestException`).

**이 검사가 이번 범위(§9)를 자동으로 지킨다.** 창고 설정을 바꾸지 않는 한 `total_picking`·`multi_order` 배치는 생성 단계에서 막히고 실효 동작은 현재와 동일하다. 개통 스위치가 `warehouses.supported_picking_strategies` **한 곳으로 통일**되므로, 나중에 켤 때 코드 배포가 필요 없다.

### 5.3 plan 생성 — 전략을 고르지 않는다

`PlanPickingV2Dto.strategy` 를 **선택 필드로 강등**한다(`@IsOptional()` 추가, 값 집합은 유지).

`PickingProcessService.plan` 시그니처를 `plan(input, tx?)` 로 바꾸고 전략을 인자로 받지 않는다. 배치 조회(`picking-process.service.ts:74-79`)의 select 에 `pickingMethod` 를 추가한 뒤:

```ts
const derived = STRATEGY_BY_PICKING_METHOD[batch.pickingMethod];
if (input.requestedStrategy && input.requestedStrategy !== derived) {
  throw conflict('PICKING_STRATEGY_BATCH_METHOD_MISMATCH',
    `Batch ${input.batchId} is ${batch.pickingMethod}; strategy ${input.requestedStrategy} is not allowed`);
}
const strategy = await registry.resolveForWarehouse(derived, batch.warehouseId, trx);
```

- 컨트롤러는 `dto.strategy` 를 `input.requestedStrategy` 로 전달한다. 안 보내면 배치에서 파생, 보내면 일치 검증 후 파생값 사용.
- 즉시 제거하지 않는 것은 외부 호출자에 대한 완충이다. admin-web 은 이번에 전송을 중단하고(§5.6), 필드 제거는 후속 정리로 남긴다.
- 창고 지원 검사는 기존 `resolveForWarehouse` 가 계속 수행한다. 두 검사는 **직교**한다 — 배치 방식과의 정합성(신규) vs 창고 능력(기존).
- `simple-outbound.service.ts:574` 의 `this.picking.plan('discrete', {...})` 호출도 새 시그니처에 맞춘다. 단순출고는 `individual` 배치만 다루므로 파생 결과가 `discrete` 로 동일하다.

**재plan 에도 자동 적용된다.** plan 버전을 새로 만들 때도 같은 경로를 타므로, 배치가 생애 중 전략을 갈아타는 것이 막힌다.

### 5.4 `cart_capacity` — 배치 크기 상한

`OutboundBatchOrchestrator.addShipment` 에서 강제한다:

- 배치의 `pickingMethod` 가 `multi_order` 이면, 현재 활성 work item 수(`status NOT IN ('completed','excluded')`)가 `cartCapacity` 이상일 때 409 `OUTBOUND_BATCH_CART_CAPACITY_EXCEEDED`.
- `individual`·`total_picking` 배치는 `cartCapacity` 가 NULL 이므로 검사하지 않는다.

송장 제외(`excludeShipment`, `orchestrator.ts:178`)로 자리가 비면 다시 담을 수 있다. 즉 상한은 **활성 송장 수** 기준이다.

### 5.5 409 코드 전달 (곁다리 결함)

`outbound-batch-orchestrator.service.ts:1330`:

```ts
// 현재 — GlobalExceptionFilter 는 `error` 필드만 코드로 통과시키므로
// 이 파일의 모든 409 가 클라이언트에 'CONFLICT' 로만 도착한다
private conflict(code, message) { return new ConflictException({ code, message }); }

// 수정 — simple-outbound.service.ts:655 와 동일하게
private conflict(code, message) { return new ConflictException({ code, error: code, message }); }
```

신규 409 코드를 admin-web 이 구분해 안내해야 하므로 함께 고친다. 기존 409 들도 자신의 코드를 되찾는다(정보가 늘어나는 방향이라 안전).

### 5.6 admin-web

| 화면 | 변경 |
|---|---|
| 배치 생성 다이얼로그 | `pickingMethod` `<Select>` 추가(현재 `'individual'` 하드코딩). 옵션은 선택한 창고의 `supportedPickingStrategies` 에서 **역파생**하여 지원하지 않는 방식은 노출하지 않는다. `multi_order` 선택 시 바구니 수 `<Input>` 노출·필수 |
| 배치 상세 드로어 | **전략 `<Select>` 제거.** 선택이 배치 생성으로 이동했으므로 "계획 생성" 버튼만 남는다. plan 생성 요청에서 `strategy` 전송 중단 |
| 배치 목록·상세 | `pickingMethod` 표시 추가 (현재 API 가 내려주는데 렌더하지 않음). `multi_order` 배치는 바구니 수도 표시 |

`STRATEGY_BY_PICKING_METHOD` 의 프론트 대응물은 admin-web 에 별도 상수로 두되, 값이 어긋나면 타입 체크가 잡도록 기존 DTO 타입(`'discrete' | 'aggregate_then_sort' | 'pick_to_tote'`)과 묶는다.

## 6. 마이그레이션

**파일 1개.** CHECK 제약이 enum 리터럴을 직접 비교하지 않고 `::text` 로 캐스팅하는 것이 조건이다.

```sql
ALTER TYPE "public"."picking_method" ADD VALUE 'multi_order';--> statement-breakpoint
ALTER TABLE "outbound_batches" ADD CONSTRAINT "ck_outbound_batches_cart_capacity"
CHECK ("picking_method"::text <> 'multi_order' OR ("cart_capacity" IS NOT NULL AND "cart_capacity" >= 1));
```

**`::text` 가 빠지면 배포가 깨진다.** Postgres 는 새로 추가한 enum 값을 같은 트랜잭션 안에서 **enum 리터럴로** 쓰는 것을 거부한다(`unsafe use of new value of enum type`). 파일을 둘로 나눠도 해결되지 않는다 — drizzle 은 **대기 중인 마이그레이션 파일 전부를 하나의 트랜잭션에 묶기** 때문이다(`drizzle-orm/pg-core/dialect.js:60`, `session.transaction()` 안에서 전체 파일 순회). 즉 신규 배포처럼 두 파일이 동시에 처음 적용되는 경우 같은 트랜잭션이다. `::text` 비교는 문자열 상수라 enum 값을 해석하지 않으므로 안전하다.

> 이 사실은 구현 중 실측으로 확인됐다(빈 DB 에 전체 마이그레이션을 한 번에 적용하는 리허설). 초기 설계는 "파일 2개로 나누면 된다"고 적었으나 틀렸다.

additive 이고 기존 행은 전부 `individual` 이라 위반이 없다. 컬럼 추가·삭제·타입 변경은 없다(두 컬럼 모두 이미 존재).

**배포 순서: `migrate` → `deploy`** (ADR-0005 §5 expand phase). 새 코드가 `multi_order` 값을 쓰기 전에 enum 에 값이 있어야 한다. 신규 secret·플래그 0.

## 7. 에러 계약

| 코드 | 상태 | 발생 지점 |
|---|---|---|
| `OUTBOUND_BATCH_METHOD_NOT_SUPPORTED` | 409 | 배치 생성 — 창고가 그 방식에 대응하는 전략을 지원하지 않음 |
| `OUTBOUND_BATCH_CART_CAPACITY_EXCEEDED` | 409 | 송장 추가 — `multi_order` 배치의 바구니 정원 초과 |
| `PICKING_STRATEGY_BATCH_METHOD_MISMATCH` | 409 | plan 생성 — 요청 `strategy` 가 배치 방식에서 파생된 값과 불일치 |
| (400) | 400 | `multi_order` 인데 `cartCapacity` 없음 / 그 외 방식인데 `cartCapacity` 제공 |

409 는 모두 `{ code, error: code, message }` 형태로 던진다(§5.5).

기존 `OUTBOUND_BATCH_STRATEGY_NOT_AVAILABLE` 은 사라진다 — 하드코딩 게이트가 창고 능력 검사로 대체되므로 `OUTBOUND_BATCH_METHOD_NOT_SUPPORTED` 가 그 자리를 대신한다.

## 8. 테스트

TDD 로 진행한다. 특히 **핵심 회귀 테스트는 현재 코드에서 통과해버리므로 진짜 RED 에서 시작**해야 한다.

| 대상 | 케이스 |
|---|---|
| 1:1 맵 | 전 enum 값 커버 (타입 레벨 `satisfies` + 런타임 전수 단언) |
| **핵심 회귀** | `individual` 배치에 `aggregate_then_sort` plan 요청 → 409. 되돌리면 성공해버리는지 확인 |
| plan 파생 | `strategy` 미전달 시 배치에서 파생되어 plan 이 생성되는가 |
| 재plan | plan v2 를 다른 전략으로 만들려 해도 같은 검증을 받는가 |
| 배치 생성 | 창고 미지원 방식 → 409 / `multi_order` 인데 `cartCapacity` 없음 → 400 / `individual` 인데 `cartCapacity` 제공 → 400 |
| 바구니 정원 | 정원 도달 후 송장 추가 → 409 / 송장 제외 후 재추가 → 성공 |
| 단순출고 회귀 | `simple-outbound` 경로가 새 시그니처에서 동일하게 동작 (fulfillment 통합 스위트 전량) |

통합 스펙은 `describeIfDb` 게이트라 **`DATABASE_URL` 없이 돌리면 조용히 초록**이다. 반드시 실 DB 를 주고 실행한다.

## 9. 범위 밖 (명시)

| 항목 | 사유 |
|---|---|
| 창고 `supported_picking_strategies` 설정 변경 | = 토탈피킹·멀티오더 실제 개통. 별도 결정. 토탈피킹 현장 흐름(카트 스캔 3종)은 검증된 적 없는 2,000줄이라 정합성 작업과 묶으면 둘 다 늦어진다 |
| 배치 수정 API | 방식을 잘못 고르면 취소 후 재생성. 개통 전에는 `individual` 외 배치를 만들 이유가 없다 |
| `PlanPickingV2Dto.strategy` 필드 제거 | 이번엔 선택 필드로 강등만. 외부 호출자 확인 후 후속 정리 |
| #542 현황판 W4 정정 | 이 작업 완료 후 실제 상태에 맞춰 갱신 |
| `admin-web/src/lib/types/dto/orders.ts:157,165,177` | `'individual' \| 'wave' \| 'batch'` — DB enum 에 없는 값 집합을 쓰는 레거시 타입. 별건 |
| 큰 카트(`aggregate_then_sort`)의 배치 크기 상한 | 부피·무게라 정형화 불가. 사람이 판단 |

## 10. 리스크

| 리스크 | 완화 |
|---|---|
| plan 생성 API 계약 변경이 미확인 외부 호출자를 깨뜨림 | `strategy` 를 제거하지 않고 선택 필드로 강등 + 일치 검증. 기존 호출자가 올바른 값을 보내던 경우 그대로 동작 |
| CHECK 에서 `::text` 를 빠뜨려 배포 시 `unsafe use of new value of enum type` | §6 에 명시. 빈 DB 에 전체 마이그레이션을 적용하는 리허설로 검증(신규 배포 경로와 동일) |
| 배포 순서를 `deploy` → `migrate` 로 뒤집음 | expand phase 이므로 `migrate` 먼저. 뒤집으면 새 코드가 `multi_order` enum 값을 못 찾아 실패 |
| 창고 설정에 이미 `aggregate_then_sort`·`pick_to_tote` 가 켜진 창고가 있을 경우, 배치 생성 옵션이 갑자기 늘어남 | 배포 전 `warehouses.supported_picking_strategies` 실측 확인. 켜져 있다면 개통 여부를 별도 판단 |
