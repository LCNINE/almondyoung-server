# SO→FO→출고 통합 테스트 설계 (숫자 정합성 중심)

- 날짜: 2026-07-14
- 브랜치: `test/logistics-local-integration`
- 목표: 판매주문(SO) → 상품매칭 → 풀필먼트주문(FO) 변환 → 재고 할당 → 출고작업/피킹/검수/개별출고까지의 물류 종단 흐름을, **로컬 compose `core` DB에 대고 rollback-only 통합 테스트로** 검증한다. 특히 **재고 수량 등 숫자의 정합성**을 골든값 + 보존식 + 이벤트 로그 대조의 3중으로 못박는다.

## 배경 / 현재 상태

- 이 브랜치가 이미 로컬 통합 테스트 러너(`scripts/local/test-core-integration-local.sh`, `npm run test:core:integration:local`)와 inventory 도메인 스펙 3개를 추가해 뒀다. 그 기반 위에 SO×FO×출고를 관통하는 시나리오를 얹는다.
- `core` 앱의 SO / FO / inventory 바운디드 컨텍스트는 **하나의 Drizzle 스키마 객체 `wmsSchema`**(`apps/core/src/modules/inventory/schema/inventory.schema.ts`)를 공유한다. SO·FO 서비스 모두 `DbService<typeof wmsSchema>`를 주입받고 `DbTx = TxFor<typeof wmsSchema>`를 쓴다 → **단일 `drizzle(sql, { schema: wmsSchema })` + 단일 `tx`로 세 BC 테이블을 모두 읽고 쓸 수 있다.** 이것이 rollback-only 종단 테스트의 전제.
- 통합 테스트는 서비스를 직접 와이어링(HTTP·컨트롤러·auth·Kafka 미경유)하므로 `.env` 불필요. 필요한 건 마이그레이션된 postgres + `DATABASE_URL`.

### 갭 (= 이 작업이 메우는 것)

- SO→FO 변환(상품매칭 성공/실패/재매칭), FO 재고 할당(성공/부족/재시도), 출고작업→피킹→검수→개별출고의 **종단 통합 커버리지가 없다.** 개별 조각의 단위 테스트는 있으나, 세 BC를 한 tx로 잇고 **숫자가 끝까지 맞는지**를 증명하는 테스트가 없다.

## 코드 실제 (구현 전 반드시 인지 — 문서/직관과 다름)

1. **재고 이벤트 타입은 `RECEIVE / SHIP / MOVE / MARK_DEFECT / REWORK_GOOD / SCRAP / ADJUST_UP / ADJUST_DOWN` 뿐** (`transitionTypeEnum`). CLAUDE.md의 `IN/OUT/RESERVE/CONFIRM/RELEASE`는 실제 enum에 **없다**. 예약은 이벤트가 아니라 `stock_reservations`(`confirmed/released`)에 산다. 출고 소진만 `SHIP` 이벤트를 쓴다.
2. **검수(inspection)는 별도 FO 상태가 아니다.** FO enum의 `inspecting/inspected`는 죽은 값(producer 0). 검수는 `shipment_lines.inspectedQty` 단위로 추적되고, 박스 전량 검수 시 **같은 tx에서 자동으로 출고 소진**(`consumeShipment`)이 발동한다.
3. **출고작업 배치는 `ConsolidationService`가 아니라 `OutboundBatchService`.** Consolidation은 가짜 데이터를 반환하는 스텁 → 사용하지 않는다.
4. **`DbService` 대역은 `run`을 채운 정상 대역**이어야 한다. 기존 `fulfillment-reservations.facade.integration` / `...ReservationRetryWorker.integration` 스펙의 `{ db }`-only 대역은 `.run()`에서 터진다(그 스펙들은 이 외에도 stale: 4-arg 생성자에 5번째 `outbox` 인자, 발행되지 않는 이벤트 assert). 복붙 금지 — 신규 inventory 스펙(`unified-reservation.service.lifecycle.integration` 등)의 대역을 따른다.
5. **rollback tx로 못 타는 진입점 3개**(§F 참조): 백로그 드레인 크론, 예약 재시도 크론, `InvoiceService.issueInvoice`. 전부 우회한다.

## §A. 검증 코어 — 숫자 정합성 불변식 카탈로그

매 체크포인트에서 아래를 전부 건다. 실제 스키마 컬럼 기준.

| ID | 불변식 | 근거 |
|---|---|---|
| **I1 이벤트↔원장** | 부호합 `Σ(RECEIVE.qty) − Σ(SHIP.qty) == Σ stock_ledgers.qty WHERE stockState='ON_HAND'` (sku·warehouse별) | event log = 진실의 원천. 프로젝션 drift·이벤트 누락 차단 |
| **I2 가용재고 항등** | `stock_summary_view.availableQty == onHand − Σ(stock_reservations.qty WHERE status='confirmed')` (transit_out=0 전제) | 예약은 별도 테이블. 뷰가 수식과 일치하는지 |
| **I3 예약 3중 합** | `FO.totalReservedQty == Σ FOI.reservedQty == Σ confirmed reservations(targetId=FO.id)` | FO/라인/예약테이블 3자 합 일치 |
| **I4 라인 수량 흐름** | FOI별 `reservedQty → pickedQty → shippedQty` 각 단계 `== qty`, `shippedQty>=qty ⇒ FOI.status='shipped'` | 피킹·검수·출고 수량 누락 방지 |
| **I5 출고 불변 (ADR-0027)** | `consumeShipment` 전후: `onHand ↓ shipped` AND `Σconfirmed ↓ shipped` → **`availableQty` 불변** | 예약이 "해제"가 아니라 "소진"되므로 가용량 보존 |
| **I6 물질보존** | sku별 테스트 종료 시 `receivedTotal == onHandRemaining + shippedTotal` | 재고가 생기지도 사라지지도 않음 |

부호 맵: `RECEIVE, ADJUST_UP → +` / `SHIP, ADJUST_DOWN, SCRAP → −` / `MOVE → 0`(창고 내 이동). 본 시나리오가 실제로 생성하는 이벤트는 RECEIVE·SHIP 뿐.

## §B. 공용 지원 모듈

`apps/core/src/modules/fulfillment/services/__support__/logistics-integration.ts` (`.spec.ts`가 아니므로 테스트로 수집되지 않음). 4개 스펙이 공유하며 ~15개 서비스 손와이어링을 한 곳에 격리.

- `makeDbService(db)` — `run`을 채운 정상 대역:
  ```ts
  { db, run: (fn, tx) => tx ? fn(tx) : db.transaction((t) => fn(t)) } as unknown as DbService<typeof wmsSchema>
  ```
- `inRollbackTx(db, fn)` — 케이스를 tx로 감싸고 끝에 `Rollback` sentinel throw.
- **픽스처 빌더** (전부 `tx` 인자): `seedWarehouse`, `seedHolder`, `seedSku`, `seedLocation(locationType:'zone')`, `seedSalesOrder(lines)`(라인 `mappingSnapshotId=null`로 라이브 매칭 경로 강제), `seedMatching(variantId, skuId, {strategy})`.
- `wireLogistics(dbService)` — 서비스 그래프 조립: InventoryCommandService, UnifiedReservationService, ProductSellableQuantityService, StockEventStore, LocationService, FulfillmentsService, ProductSkuMappingService, FulfillmentOrderCreationBacklogService, FulfillmentOrderReservationRetryWorker, OutboundBatchService, PickingProcessService, ShipmentService, OutboundConsumptionService, ReservationLifecycleService, OutboxService. 흐름이 부르지 않는 policies/barcode 등은 "호출 시 실패"하는 스텁.
- **숫자 프로브**: `onHand(sku,wh)`, `onHandAt(sku,loc)`, `netFromEvents(sku,wh)`(부호합), `confirmedReserved(sku,wh)`, `availableFromView(sku,wh)`.
- **어서션 헬퍼**:
  - `assertStockConsistent(tx, sku, wh, { onHand, reserved })` — I1+I2+골든값을 한 번에.
  - `assertFoReservationAgg(tx, foId)` — I3.
  - `assertConservation(tx, sku, wh, { received, shipped })` — I6.

체크포인트마다 `assertStockConsistent(...)` 한 줄로 3중 검증이 걸리게 하는 것이 설계 의도.

## §C. 스펙 4개 · 케이스 · 체크포인트

전부 rollback-only, `DATABASE_URL` 게이트(`describeIfDb`), `--runInBand`.

### 스펙 1 — 변환·매칭 `sales-order-to-fulfillment.conversion.integration.spec.ts`
- 1a **매칭됨→FO 생성**: `seedMatching(V, sku, {strategy:'variant'})` 후 `FulfillmentsService.create({salesOrderId, warehouseId, shippingAddress}, tx)`. FO 생성, `FOI.qty == SOline.qty × link.quantity`.
- 1b **매칭없음→실패**: 매칭 행 없이 `create` → `BadRequestException{ code:'PRODUCT_SKU_MATCHING_REQUIRED', missingLines:[{ variantId, reason:'NO_PRODUCT_SKU_MATCHING' }] }`. 백로그를 `'processing'`로 seed 후 `markAwaitingMatching(id, missingLines, tx)` → status `'awaiting_matching'`, `waitingVariantIds ∋ variantId`.
- 1c **재매칭→성공**: `ProductSkuMappingService.upsert(variantId, { links:[{skuId, quantity:1}] }, tx)` → 내부 `wakeBacklogsWaitingForVariant`로 백로그 `'awaiting_matching'→'pending'`. 재-`create` → FO 생성, FOI 수량 정확.
- 1d **void 전략**: `seedMatching(V, _, {strategy:'void'})` → 라인 드롭, FO `status='completed'`(0 physical item), 백로그 `markNotRequired`.

### 스펙 2 — 재고할당·재시도 `fulfillment-stock-allocation.integration.spec.ts`
- 2a **충분→'ready'**: `receive` onHand ≥ qty 후 매칭+`create` → FO `'ready'`. `assertStockConsistent`(onHand 불변, reserved=qty), `assertFoReservationAgg`.
- 2b **부족→'unfulfillable'**: onHand < qty → `reserveStock`가 `ConflictException` → FO `'unfulfillable'`, `reservationFailureReason='RESERVATION_FAILED'`, **`reservationFailureDetails.failedItems[].{requiredQty, availableQty}` 숫자 정확**. confirmed 예약 0건. all-or-nothing(부분예약 없음) 확인.
- 2c **보충+재시도**: `receive` 추가 → `FulfillmentOrderReservationRetryWorker.retryOne(foId, tx)` → FO `'ready'`, reserved 채워짐, I2·I3 재확인, I6(received == onHand + 0).

### 스펙 3 — 출고작업·피킹·검수·출고 `outbound-batch-pick-ship.integration.spec.ts`
`'ready'` + confirmed 예약 상태의 FO(들)을 seed 후:
- 3a **배치**: `OutboundBatchService.createBatch({ salesOrderIds, warehouseId, … }, tx)` → FO `'ready'→'allocated'`(batchId 세팅), batch `'created'`, `batch.totalItems/totalQty == Σ`.
- 3b **피킹**: `startPicking(batchId, tx)` → `'picking'` → `PickingProcessService.pickItem({ batchId, skuId, pickedQty }, tx)`(SKU별 FOI FIFO 분배) → `completeBatch(batchId, tx)` → FO `'picked'`, batch `'completed'`. `Σ pickedQty == Σ qty` (I4).
- 3c **송장·검수·출고**: `invoices` 행(`status:'issued'`, `trackingNo`) + FO `status='invoiced'` 직접 seed → `ShipmentService.openBoxByScan(trackingNo, op, tx)`(shipment `'open'`, invoice `'used'`) → `inspectScan(shipmentId, barcode, qty, op, tx)`로 전량 검수 → 자동 `consumeShipment` → `SHIP` 이벤트, `FOI.shippedQty==qty`, FO `'shipped'`, shipment `'shipped'`. **I5(출고 전후 avail 불변)**, I1(SHIP 포함 재대조), `shipment_lines.inspectedQty==qty`.

### 스펙 4 — 골든패스 E2E `so-to-ship.golden-path.integration.spec.ts`
SO 2건(하나는 매칭없음→매칭, 하나는 재고부족→보충→재시도)을 §D 타임라인대로 변환·할당·배치·피킹·검수·출고까지 한 tx로 관통. 전 구간 골든값 + 종료 시 sku별 **I6 물질보존 sweep**. 실패 종단(2b unfulfillable, 1b missingLines)은 스펙 1·2 전용이며 골든패스는 "재고부족→보충→성공" 해피 서사만 포함.

## §D. 샘플 데이터 "월드" — 숫자 타임라인

SKU-A·SKU-B, 창고 W1·로케이션 L1. SO-1(V1→A, 5개), SO-2(V2→B, 3개).

| 시점 | 동작 | onHand A | resv A | avail A | onHand B | resv B | avail B | 검증 |
|---|---|---|---|---|---|---|---|---|
| t0 | receive A+10, B+1 | 10 | 0 | 10 | 1 | 0 | 1 | I1 |
| t1 | SO-1 변환+할당 | 10 | 5 | 5 | 1 | 0 | 1 | I2, I3 |
| t2 | SO-2 변환 시도(매칭X) | 10 | 5 | 5 | 1 | 0 | 1 | backlog awaiting_matching |
| t3 | V2 매칭+재변환→할당실패 | 10 | 5 | 5 | 1 | 0 | 1 | FO-2 unfulfillable, details{req:3, avail:1} |
| t4 | receive B+5 | 10 | 5 | 5 | 6 | 0 | 6 | I1 |
| t5 | retryOne(FO-2) | 10 | 5 | 5 | 6 | 3 | 3 | I2, I3, FO-2 ready |
| t6 | 배치→피킹→검수→출고 A | 5 | 0 | 5 | 6 | 3 | 3 | **I5 avail A 5→5 불변**, I1(net=5) |
| t7 | 〃 B | 5 | 0 | 5 | 3 | 0 | 3 | **I5 avail B 3→3 불변**, I1(net=3) |
| 끝 | 보존 sweep | recv10 = onHand5 + ship5 | | | recv6 = onHand3 + ship3 | | | **I6 ✓** |

t6·t7에서 avail이 안 변하는 것이 I5의 핵심 관측점. 모든 칸이 §A 불변식과 맞물려 떨어지도록 설계된 값.

## §E. 파일 레이아웃 · 러너

- 지원 모듈: `apps/core/src/modules/fulfillment/services/__support__/logistics-integration.ts`.
- 스펙 1·2·3: 기존 컨벤션대로 리드 서비스 인근에 콜로케이트(스펙 1은 sales-order 모듈, 2·3은 fulfillment 모듈). 골든패스는 fulfillment 모듈.
- 실행: `npm run test:core:integration:local -- <패턴>` (예: `-- golden-path`, `-- conversion`). `DATABASE_URL` 미설정 시 `npm test`에서 자동 skip → 유닛 흐름 무영향.

## §F. tx 전파 제약 (rollback-only 우회로)

| 정문 (rollback 불가) | 이유 | 옆문 (테스트) |
|---|---|---|
| `FulfillmentOrderCreationBacklogWorker`(크론) | 자기 tx + `NOW()` + `SKIP LOCKED` | `FulfillmentsService.create(dto, tx)` / `wakeBacklogsWaitingForVariant(variantId, tx)` 직접 호출 |
| `FulfillmentOrderReservationRetryWorker.retryUnfulfillable()`(크론) | tx 안 넘김 | `worker.retryOne(foId, tx)` 직접 호출(tx 받음) |
| `InvoiceService.issueInvoice` | 외부 송장발급 3-tx라 의도적 tx 거부 | `invoices` 행 + FO `status='invoiced'` 직접 seed |

그 외 관여 서비스(`FulfillmentsService`, `OutboundBatchService`, `PickingProcessService`, `ShipmentService`, `OutboundConsumptionService`, `UnifiedReservationService`, `InventoryCommandService`, `ProductSkuMappingService`, `FulfillmentOrderCreationBacklogService`)는 모두 `tx?: DbTx` 마지막 인자 + `this.dbService.run(fn, tx)` 전파를 지킨다 → 외부 rollback tx를 넘기면 안전.

## 비범위 (YAGNI)

- Kafka/outbox 실발행(outbox mock), OIDC/auth, HTTP 컨트롤러 경유.
- Consolidation 실경로, drop_ship/3PL 분기, 반품·교환(sales-order refund) — 별도 스펙.
- ephemeral DB 모드. 커밋형(비-rollback) 케이스 — 전 케이스 rollback-only로 설계.
- `issueInvoice`/`cancelInvoice` 등 tx 거부 경로의 내부 로직 검증(단위 테스트 영역).

## 검증 방법

- `npm run test:core:integration:local -- integration`(또는 개별 패턴)로 신규 4개 스펙이 로컬 compose `core` DB에서 green.
- `DATABASE_URL` 미설정 시 `npm test`에서 자동 skip(기존 게이트) — CI/유닛 흐름 무영향.
- 각 스펙은 §A의 불변식 위반 시 실패해야 한다 — 구현 후 의도적으로 한 숫자를 틀리게 넣어 어서션이 실제로 잡는지 1회 확인(negative check).
