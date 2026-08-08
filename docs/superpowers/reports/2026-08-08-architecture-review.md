# 아키텍처 friction 리뷰 — 고빈도 변경 영역 (2026-08-08)

`develop @ b9f44d9c0` 기준. 최근 8주 churn 상위 4개 영역을 대상으로 **deepening 기회**(얕은 모듈을 깊은 모듈로 만들 수 있는 지점)를 훑었다.

- `apps/core/src/modules/fulfillment` (194 touches)
- `apps/core/src/modules/catalog/operations/bulk-session` (162)
- `apps/channel-adapter/src/adapters/medusa` (75)
- `apps/core/src/modules/inventory` + `sales-order` (101)

용어는 [`/codebase-design`](https://github.com/anthropics/claude-code) 어휘를 그대로 쓴다 — **module · interface · depth · deep · shallow · seam · adapter · leverage · locality**, 그리고 **deletion test**(모듈을 지웠을 때 복잡도가 *사라지면* 통과층, *여러 호출자로 되살아나면* 제 몫을 한 것).

## 신뢰도 표시

| 카드 | 근거 |
|---|---|
| 01 | **철회됨.** 아래 참조 |
| 02 · 03 · 04 · 06 | **직접 재검증함** — grep census, `difflib` 비교, 두 워커 대조 독해, enum 선언 대조 |
| 05 · 07 · 08 · 09 · 10 | 탐색 에이전트의 계수에 상당 부분 의존. **착수 전 재확인 필요** |

---

## 01 — ❌ 철회 (2026-08-09)

원래 주장: "channel-adapter 의 `forConsumer` 에 `PAYMENT`·`USER`·`CORE_ORDER` 가 빠져 21개 `@OnEvent` 핸들러가 죽어 있고 Medusa 결제 Projection 에 살아있는 producer 가 없다."

**틀렸다.** Nest 의 `ServerKafka.bindEvents()` 가 `subscribe.topics` 를 `[...messageHandlers.keys()]` 로 덮어쓰므로 실제 구독은 `@OnEvent` 데코레이터가 결정한다. 배선 비대칭은 실재하나 그 결과가 없다.

전제(비대칭)는 검증했으나 결과(핸들러 사망)를 라이브러리 동작 확인 없이 추론한 실패다. 정본은 [`docs/adr/0029-events-module-registration-surfaces.md`](../../adr/0029-events-module-registration-surfaces.md), 실행은 [`../plans/2026-08-09-events-module-registration.md`](../plans/2026-08-09-events-module-registration.md).

---

## 02 — 재고예약에 단일 writer 를 준다 · **Strong**

**Files** `inventory/core/repositories/stock-event.store.ts:96,181,209` · `inventory/inventory-write-boundary.arch.spec.ts:5,24-28` · `inventory/shared/services/unified-reservation.service.ts:89,119` · `fulfillment/services/shipment-reservation.service.ts`(12곳) · `fulfillment/services/consolidation.service.ts:624` · **`sales-order/services/sales-orders.service.ts:2094,2099`**

**Problem** 원장은 모범 사례다 — `stock_events`/`stock_ledgers` 는 writer 1개, insert 3곳, update 0곳이고 **아키텍처 테스트가 강제**한다. CONTEXT.md 가 원장과 대등한 개념으로 다루는 예약은 그런 게 없다: **16곳의 쓰기가 4개 파일 3개 모듈에 흩어져 있다.** 최악은 `SalesOrdersService` 가 sales-order BC 안에서 `stock_reservations` 를 직접 UPDATE 하는 것 — `UnifiedReservationService.releaseReservation` 의 재구현이며, 그래서 `recalculateAndPublishForSku` 를 손으로 불러줘야 한다.

**Deletion test** 집중된다. `sales-orders.service.ts:2071-2113` 은 부분취소를 감당할 seam 이 없어서 생긴 코드다.

**Evidence** 가용재고 = ON_HAND − confirmed 공식이 **4벌, 답이 3가지**: `inventory.schema.ts:982`(− reserved − transit_out) / `unified-reservation.service.ts:255`(− reserved, unclamped, 1 statement) / `reservation-invariant.ts:14`(둘 다 반환) / `availability.service.ts:11`(`max(0,…)`, 2 statements, **호출자 0**). arch spec 이 못 보는 이유는 두 가지 — 스캔 루트가 `modules/inventory` 이고 `FORBIDDEN` 에 `stockReservations` 가 없다.

**Deepening** `ReservationLedger` 모듈이 모든 `confirmed → released` 전이와 단일 가용재고 read 를 소유. 판매가능수량 fan-out 을 쓰기의 *결과*로 만들어 호출자가 잊을 수 없게 한다. **Step 0 이 싸다** — arch spec 을 `modules/` 루트로 넓히고 `stockReservations` 를 `FORBIDDEN` 에 넣으면 가설적 seam 이 강제되는 seam 이 되고 위반 목록이 바로 출력된다.

**ADR** ADR-0027 §5(소진 vs 환원)는 accepted 인데 미구현이다 — `ReservationLifecycleService.consumeFulfillmentOrderReservations` 는 호출자 0이고 본문이 release 를 부른다. 재개봉이 아니라 구현 격차.

---

## 03 — 피킹 seam 을 "방식"에서 custody transport 로 옮긴다 · **Strong**

**Files** `fulfillment/picking/{discrete-picking,aggregate-then-sort,pick-to-tote}.strategy.ts` (1,603 / 2,016 / 2,269) · `picking-strategy.interface.ts:138-142,347-370` · `services/picking-process.service.ts:36-64,105-179`

**Problem** interface 가 자기 adapter 를 누설한다. `ScanPickingInput` 이 `strategy` 로 태깅된 union 이라 `scan()` 호출자가 어느 adapter 인지 미리 알아야 하고, `PickingProcessService` 는 `'bulkCartScan' in strategy` 같은 구조적 가드로 런타임에 타입을 다시 넓히며 14개 메서드 중 8개를 전략 전용으로 노출한다.

**Deletion test** 바깥 seam(`PickingProcessService`)은 집중된다 — 유지. 안쪽 `PickingStrategy` interface 는 **사라진다** — 중복 라인이 붕괴하고 런타임 downcast 2개와 mismatch 에러코드 2개가 함께 없어진다.

**Evidence** (`difflib`, autojunk off, ≥20줄 동일 블록) — discrete↔tote **1,309 / 1,603 = 82%**, 최대 연속 298줄 · discrete↔aggregate 894줄 · aggregate↔tote 856줄. 세 파일 모두에서 byte-identical 한 멤버 14개(`lockAggregate` 123줄 포함). **이미 갈라졌다**: `errorMessage()` 가 discrete↔tote 1.00 인데 aggregate 는 0.31 — aggregate 만 상수 문자열을 반환하고 그 값이 `picking_plans.invalidation_reason` 에 저장돼 작업자에게 보인다. `grep invalidat picking-strategy.contract.spec.ts` → **0** — 공유 계약 스펙이 `invalidated` 갈래를 한 번도 단언하지 않는다.

**Deepening** 공유 ceremony(~3,300줄: plan · start · staleness · lease · work-item identity · 모든 `assert*`)를 `PickingPlanCore` 로 뽑고, seam 은 **custody transport**(피킹된 재고가 source 와 PACKING 사이 어디에 놓이는가 — direct / cart+sort / tote)에만 둔다. 진짜 divergence 는 ~2,600줄.

**ADR** 충돌 없음. ADR-0027 은 다중 피킹 전략을 별도 결정 기록으로 미뤘을 뿐 3개 병렬 클래스를 요구하지 않는다.

---

## 04 — `JobLease` 모듈 (adapter 2개가 이미 존재) · **Strong**

**Files** `catalog/operations/bulk-session/services/bulk-session-job.manager.ts:234-258,1362-1437` · `form-export-job.manager.ts:87-145,238-291` · `bulk-session-job.worker.ts:45-61` · `form-export-job.worker.ts:44-61`

**Problem** lease/claim 규율이 **부재로 인해 얕다** — 메서드 5개 × 클래스 2개 × 워커 2개. 그리고 두 사본이 같은 딜레마의 반대 뿔을 잡았다:

| 위험 | form-export | bulk-session |
|---|---|---|
| 좀비의 예외가 후임에게 청구 | 닫힘 (token CAS) | **열림** (token 파라미터 자체가 없음) |
| hard kill 이 카운터를 못 올려 무한 재시도 | 닫힘 (`CASE WHEN lease_token IS NULL`, cap 검사) | **열림** |
| 워커가 *후임의* 카운터를 리셋 | 닫힘 (`if (owned)` 가드) | **열림** (`:53` 무조건 호출) |
| 재시도 주기가 lease 길이에 결합 | 분리 | 설계상 없음 |

`form-export-job.manager.ts:275-283` 이 3번을 치명적이라 명시("리셋이 상한을 영원히 막는다")하고 형제 워커가 정확히 그걸 한다. **지식이 docstring 으로, 틀린 파일에 있다.**

**Deletion test** 어느 쪽 lease 메서드를 지워도 복잡도가 다른 쪽에 그대로 되살아난다. **adapter 2개 = 진짜 seam.**

**Evidence** `grep lease_token` → 레포 전체 3파일(두 매니저 + 스키마). 두 `claim()` 본문 모두 "다른 쪽과 같은 알고리즘" 주석을 달고 있다. lease 통합 스펙이 1,102줄인데 **못 잡는다** — 슬라이스 러너 4개가 `Promise<void>` 라 "lease 를 잃고 멈췄다"를 interface 가 표현할 수 없다. `form-export` 의 `runExport(): Promise<boolean>` 은 표현할 수 있고 그 워커는 맞게 짰다.

**Deepening** 테이블 서술자(`{table, idColumn, leaseUntil, leaseToken, failureCount, claimable, terminal}`)를 seam 으로 하는 `JobLease`. `Lease` 핸들의 연산이 `owned` 를 반환해 호출자가 가드를 잊을 수 *없게* 한다.

**부수 부채** `bulk-session` 13개 파일의 프로덕션 주석 32개가 `product-import-*.ts:NNN` 을 인용하는데 그 파일들은 `69c09fbd8` 에서 삭제됐다. 그중 6개가 lease `claim()` docstring — **프로토콜이 왜 이 모양인지에 대한 논거가 삭제된 파일을 가리키는 포인터로만 남아 있다.** 둘은 아직 "6단계가 그 파일을 지운다"고 미래형으로 쓰여 있다.

---

## 05 — 출고 오퍼레이션은 interface 없는 module · **Strong** *(재확인 필요)*

**Files** `fulfillment/services/shipment-planning.service.ts:1212-1269` · `consolidation.service.ts:294-307` · `shipment-recall.service.ts:139-156` · `shipment-short-pick.service.ts:908-912` · `outbound-batch-orchestrator.service.ts:1084-1146`

**Problem** `ShipmentOperationService` 가 없다. 9개 모듈이 같은 행의 각 조각을 소유하고, `beforeManifestSnapshot` 이 3가지 호환 안 되는 모양(단일 snapshot / snapshot 배열 / `{intent}`)을 나르며 `unknown` 에서 4벌의 손수 디코더로 복원된다. `moduleRef.get(…, {strict:false})` + `if (type === …)` 체인은 seam 이 아니라 **service locator** 다 — 네 번째 resumable 타입은 그 메서드 *안*을 고쳐야 하고, resume 진입점 3개의 이름이 3가지다. `cancel` 의 재개 전제조건은 orchestrator(`:1101-1131`)에, 같은 cancel 의 완료는 `shipment-planning.service.ts:707` 에 있다.

**Evidence** `shipmentOperations` 참조 135곳 · insert 4 · update 10 · `beforeManifestSnapshot` 26곳 · 상태 문자열 리터럴 ~174곳(전이 테이블 없음) · `private conflict()` 정의 12개 중 10개 byte-identical.

**같은 폴더에 반례가 있다** — `FulfillmentCommandService.execute` 는 136줄로 idempotency-key dedup · request-hash mismatch · in-progress conflict · 응답 replay 를 3필드 입력 + 콜백 하나 뒤에 감춘다. 이 패턴이 여기서 통한다는 증거.

---

## 06 — projection 을 FO status 의 유일한 writer 로 · **Strong**

**Files** `fulfillment/services/fulfillment-progress.service.ts:3-12,52-55,93-140` · `shipment-reservation.service.ts:1111-1125` · `fulfillments.service.ts:403,639,708,778` · `sales-order/services/sales-orders.service.ts`(2곳) · `inventory/schema/inventory.schema.ts:178-188`

**Problem** 테스트를 위해 순수 함수로 뽑았는데 **locality 가 없는** 교과서 사례. `projectFulfillmentOrderProgress` 는 순수하고 문서화됐고 잘 단위 테스트됐으며 — 프로덕션 호출자가 **1개**다. 그 컬럼을 세팅하는 곳은 7곳이고 그중 1곳만 projection 을 지난다. 나머지 6곳은 하드코딩 리터럴이며 **2곳은 sales-order 모듈에서 쓴다**. 불변식이 doc comment 와 단위 테스트에만 살고, 그걸 깨뜨릴 수 있는 쓰기는 함수를 거치지 않으므로 **어떤 테스트도 위반을 잡을 수 없다**.

**Evidence** `FULFILLMENT_PROGRESS_STATUSES` = **8**개, `fulfillmentStatusEnum` = **9**개. `'shipped'` 는 DB 에 있고 `fulfillments.service.ts:640` 의 drop_ship 경로가 쓰는데 **projection 이 절대 만들 수 없다**. 오늘 잠복 상태인 이유는 `fulfillmentMode !== 'drop_ship'` 가드뿐인데, 타입 시스템도 DB 도 테스트도 그 분리를 말하지 않는다.

**Deletion test** `FulfillmentProgressService` 는 자유 함수 2개 위의 2-메서드 통과층 — 지우면 복잡도가 **이동만** 한다. 스펙/배선 9곳에서 `new` 로 직접 만들고 있어 DI 가 주는 게 없다. 순수 함수는 남기되 쓰기 경로 위로 올린다.

**ADR** ADR-0012 의 2026-07-18 update 는 FO `partially_reserved`/`ready` 를 *파생 projection* 이라 못박는다. 직접 쓰기 6곳이 그것과 모순. 재개봉이 아니라 "어느 상태가 파생이고 어느 것이 명령형인지" 후속 노트.

---

## 07 — 상품매칭은 row 가 아니라 decision 을 반환해야 · **Strong** *(재확인 필요)*

**Files** `inventory/product-sellable-quantity/services/product-sellable-quantity.calculator.ts:117,126,130` · `product-matching/services/product-sku-mapping.service.ts:666-695` · `product-matching.service.ts:81-127,514-556,719-727` · `fulfillment/services/fulfillments.service.ts:548-567` · `catalog/core/products/services/product-versions.service.ts:567,601`

**Problem** ADR-0015 는 canonical 상태가 `strategy` 이고 `status='matched'` 는 "전략 결정 완료"일 뿐이라 못박는다. 프로덕션은 5개 모듈에서 여전히 `status` 로 분기한다 — `status` 읽기 16곳 vs `strategy` 읽기 11곳, `'ignored'` 19곳. `product-sku-mapping.service.ts:666-695` 는 매칭 완료율을 `status` 만으로 계산해 `matched+void` 와 `matched`+전략없음 을 같게 센다. 판매가능수량 계산기는 `'ignored'` 에 `MATCHING_IGNORED` 라는 전용 사유 코드를 준다 — ADR-0015 는 그냥 미결정이라 한다.

**두 서비스가 같은 테이블을 소유한다.** `upsertSalesVariantPolicy` 가 양쪽에 있고 **의미가 다르다** — `ProductSkuMappingService` 는 미지정 필드를 보존하고 `ProductMatchingService` 는 fallback 으로 덮는다. `preStockSellable` 이 편집에서 살아남는지가 어느 서비스로 라우팅됐는지에 달렸다.

**Deletion test** 어느 쪽을 지워도 복잡도가 다른 쪽으로 이동한다 — 둘 다 그 module 이 아니라는 신호.

**Deepening** `MatchingDecision` union(`SkuComposition{links}` | `Void` | `Undecided{reason}`)을 반환해 호출자가 legacy 컬럼으로 분기할 수 *없게* 한다. `strategies/` 폴더는 이미 진짜 seam(adapter 2개)인데 호출자들이 우회 중이다. `product-matching/` 통합 스펙 **0개**.

---

## 08 — 반품이 두 벌, 고객 쪽은 원장에 닿지 않는다 · **Strong** *(재확인 필요)*

**Files** `sales-order/services/store-return-exchange.service.ts`(1,888) · `inventory/core/services/return.service.ts`(520) · `inventory/schema/inventory.schema.ts:1628,1654` vs `:4350,4376,4400`

**Problem** 두 모듈이 **같은 이름의 `createReturnRequest`** 를 서로 disjoint 한 테이블 집합 위에 노출하고 **서로를 전혀 참조하지 않는다**. 고객 반품이 `requested → … → refund_pending` 전 구간을 지나 wallet 환불까지 나가는 동안 **원장 이벤트가 한 건도 append 되지 않는다**. 물리 RECEIVE 는 `ReturnService` 에 있는데 그 유일한 호출자는 주문 흐름이 부르지 않는 admin REST 컨트롤러다.

**Evidence** `grep "ReturnService\|stockEvent\|InventoryCommand" store-return-exchange.service.ts` → **0**. `return.service.ts` 는 520줄에 **테스트 0개**이면서 원장 인접 상태 전이 4개를 갖는다. 이걸 덮어야 할 유일한 테스트 `store-return-exchange.refund.integration.spec.ts` 는 **10줄, `it.todo` 4개**.

**ADR-0025 drift** 이 파일이 레포 전체 직접 `.transaction()` 29곳 중 **18곳**을 갖는다(ADR follow-up 기록은 15곳). 구조적 주입 `{ db: PostgresJsDatabase }` 와 `as unknown as DbTx` 캐스트(`:126`)도 남아 있다.

---

## 09 — `SalesOrdersService` 에서 주문취소를 떼어낸다 · **Worth exploring** *(재확인 필요)*

**Files** `sales-order/services/sales-orders.service.ts:183-196`(11 deps), `:415-677`, `:1226-1446`, `:1466-1759` · `store-sales-orders.service.ts:694-741` · `sales-order-amendments.service.ts`(198)

**Problem** 얕지는 않으나 **interface 가 넓다** — public 12 / private 48, 주문 수락 · 취소 · timeline 조립 · admin 목록 · 통계 · 예약 해제를 걸친다. `cancel()`(263줄) · `cancelPartial()`(221줄) · `cancelV2Outstanding()`(294줄) 셋이 각각 effects 조립 → cancellation insert → 상태 세팅 → `linkCancellationEffects` → outbox enqueue 를 독립적으로 재구현한다. "주문취소 row 는 이 다섯 부수효과를 함의한다"가 세 곳에 산다. 취소 진입점은 `StoreSalesOrdersService` 4개 포함 **총 7개**.

**Rated Worth exploring** 분할 자체는 기계적이나 **가장 크고 새로운 `cancelV2Outstanding` 에 테스트가 0개**다(디지털 소유권 회수 · FO 조정 · wallet 환불 effects). 리팩터가 회귀 위험을 떠안는 구조라 **테스트를 먼저 씌운다**.

`SalesOrderAmendmentsService` 는 198줄 3-메서드 interface 에 writer 1개 — 넷 중 하나가 가져야 할 모양의 예시다. ADR-0016 의 분리는 테이블 레벨에서 이미 지켜지고 있다.

**인접** `store-sales-orders.service.ts:694-741` 이 가드 read 5개를 **트랜잭션 밖에서** 체인한 뒤 자기 트랜잭션을 여는 `cancel()` 을 부른다. 순수 술어는 잘 테스트됐고 read-then-act 창은 전혀 테스트되지 않았다.

---

## 10 — 삭제 목록 · **Strong**

deletion test 를 명백히 실패하는 것들. *(에이전트 계수 기반 — 지우기 전 참조 재확인)*

**통과층 (interface 가 구현보다 큼)**

| 모듈 | 줄 | 판정 |
|---|---|---|
| `bulk-session/services/bulk-session.service.ts` | 90 | 12 메서드 전부 단순 위임, 로직 0, 스펙 0. 컨트롤러가 1개 대신 3개 주입하면 끝 |
| `bulk-session/services/form-export.service.ts` | 37 | 같은 모양. 둘 합쳐 −127줄 |
| `fulfillment/services/fulfillment-progress.service.ts`(클래스) | ~10 | 자유 함수 2개 위 2-메서드 래퍼. 9개 파일에서 `new` 로 생성 |

**프로덕션 호출자 0**

| 모듈 | 줄 | 판정 |
|---|---|---|
| `fulfillment/services/availability.service.ts` | 39 | 호출자 0, 그리고 가용재고 공식의 *divergent* 4번째 사본 |
| `inventory/core/rules/{stock-update.rules,stock-rule.types}.ts` | 201 | importer 0, 스펙 0. `availableQty` 를 ledger 컬럼처럼 참조하는데 그건 view 컬럼 |
| `ReservationLifecycleService.consumeFulfillmentOrderReservations` | — | 호출자 0, 본문이 release 호출 |
| `product-purchase-constraints.service.ts::copyMapping` | 17 | `_copyMappings` 의 한 블록을 추출·테스트해놓고 정작 인라인 사용. 프로덕션 0 / 스펙 2 |
| `channel-adapter/adapters/medusa/pim.client.ts` | 308 | DI 에서 5곳 주석처리. `scripts/legacy` 에만 살아있음. ADR-0013 이 금하는 Core 직호출 경로가 주석으로 보존됨 |
| `libs/shared/src/pim/*` | 75 | 배럴에서 export 되는데 레포 전체 소비자 0 |

**어디에도 등록 안 됐는데 자기 스펙이 초록으로 유지**

`channel-adapter/consumers/fulfillment-event.consumer.ts`(343) · `stock-event.consumer.ts`(~100) — `adapter.module.ts` controllers 에 없고 `coupang-integration.spec.ts` 만 직접 `new` 한다. **실행되지 않는 코드의 동작을 단언하는 테스트.**

**죽은 스키마·어휘** 참조 0인 테이블 4개(`skuLocationMovements`·`mergeGroups`·`holidays`·`inspectionIssues`) · legacy `invoice` 명칭이 DTO 2필드 + workflow-gate op 3개에 잔존(21곳; CONTEXT.md 는 이벤트 페이로드로만 한정) · `form-export.image-allocator.spec.ts` 는 `form-export.types.ts` 의 심볼을 테스트(대응 구현 파일 없음).

---

## 잘 되어 있는 것

리뷰가 확인한 강점. **되돌리지 말 것.**

- **원장** — `stock_events`/`stock_ledgers` writer 1개, insert 3곳, update 0곳, **아키텍처 테스트가 강제**. append-only 가 관행이 아니라 구조다
- `InventoryCommandService` — adapter 8개, 우회 0개. 진짜 seam
- `version-isolation/delete-if-unmapped.ts` — 42줄 구현에 93줄 스펙, 4개 파일 6곳에서 호출. ADR-0026 이 예측한 보상을 실제로 얻었다
- `FulfillmentCommandService.execute` — 3필드 입력 뒤의 136줄 idempotency
- `OrderPollerOrchestrator` — 556줄에 1,062줄 스펙. 스코프 내 최고 커버리지. watermark durability 가 진짜로 한곳에 있다
- **ADR-0025 는 지켜졌다** — `grep "private async inTx"` → **0**, `type Tx = Parameters<…>` → **0**

## 테스트 공백 (interface 가 장애물인 곳)

- `picking-process.service.ts` — 280줄 **테스트 0**. 런타임 downcast 2개를 다 쥔 seam adapter
- `batch-session-recovery.service.ts` — 872줄, 2-메서드 interface, 자체 스펙 없음. 깊어서 오히려 테스트하기 쉬운데 안 했다
- `return.service.ts` — 520줄, 테스트 0, 원장 이벤트를 append 한다
- `purchase-order.service.ts` — 1,018줄, 테스트 0
- `product-masters.service.ts` — 1,937줄 / 328줄 스펙(17%). catalog 최대 파일
- `payment-events.consumer.ts`(295) · `payment.stream.ts`(895) · `payment-client.service.ts`(710) · `subscription-cancellation.service.ts`(999) — 각 스펙 0
- 슬라이스 러너 4개가 `Promise<void>` — "lease 를 잃고 멈췄다"를 단언할 수 없다. 카드 04 의 버그가 557줄 lease 스위트를 통과하는 이유

## 우선순위

1. **02** — 원장이 이미 증명한 패턴을 예약에 적용. arch spec 확장이 싼 step 0
2. **04** — 살아있는 카운터 버그를 고치고 adapter 2개가 이미 있음
3. **03** — 줄 수로는 최대 이득이나 리팩터가 가장 큼

02 · 05 · 06 은 `fulfillment/services` 에서 겹친다. 02 가 05 의 예약 re-pointing 우회를 일부 흡수하므로 **02 를 먼저**. 09 는 `cancelV2Outstanding` 테스트가 선행.
