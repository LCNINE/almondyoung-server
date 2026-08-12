# 창고간이동 custody 모델 설계

- 날짜: 2026-08-12
- 상태: 설계 승인 (구현 계획 미작성)
- 선행: PR #618 [가용재고 소유 모듈](../plans/2026-08-12-inventory-availability-module.md) `## 후속 (별건)` 1·2번
- 관련 ADR: 0001(가용재고 정의), 0011(채널 공통 판매가능수량), 0025(단일 트랜잭션 러너)

## 배경

물리적으로 재고를 점유하는 작업은 그 기간 동안 재고를 묶어야 한다. **출고작업에는 그 모델이 있고 창고간이동에는 없다.**

출고작업은 `batch_inventory_sessions` + `batch_inventory_session_balances` 오버레이를 쓴다. custody 는 원장을 바꾸지 않고, `BatchControlledStockGuard` 가 ON_HAND 위에 활성 세션 잔량을 덧씌운다.

창고간이동은 `IN_TRANSFER` 원장 상태가 enum 에 있으나 `transferShip`/`transferReceive` 가 **한 트랜잭션 안에서 연달아 실행된다**(`stock-event.service.ts:117-156`). 잔량이 트랜잭션 밖으로 나가지 못해 `stock_summary_view.in_transfer_qty` 는 구조적으로 항상 0 이고, **"운송 중" 기간 자체가 존재하지 않는다.**

### 이 설계를 강제하는 사실

1. **창고는 중국 1 + 부천 1.** 운송이 수일~수주다. 기간이 없는 모델은 명백히 틀렸고, 부분 도착·통관 지연·운송 중 분실이 상시 실무다.
2. **부천 재고만 판매 대상이다.** 그런데 `product-sellable-quantity.service.ts:139-143` 이 `GROUP BY sku_id` 로만 집계해 **창고를 구분하지 않는다** — 중국 재고가 그대로 한국 storefront 판매가능수량에 들어간다. 이건 표시가 아니라 실판매 게이트(`psq_` inventory item → Medusa `manage_inventory`)다.
3. **품절 시 부천 도착 예정(수량+일정)을 노출해야 한다.** 현재 담을 자리가 없다 — destination plan 이 `expectedDate: null`(`purchase-order.service.ts:319`)로 생성되고 `inbound_pending_qty` 에는 날짜가 없다.

### 발견된 기존 결함 (이 설계가 같이 닫는다)

- **`inbound_pending_qty` 이중 계상.** `purchase-order.service.ts:296-320` 이 source plan 과 destination plan 을 **둘 다** `destinationWarehouseId = 부천`으로 만드는데, 뷰의 `inbound_pending` 은 `GROUP BY ip.destination_warehouse_id`(`inventory.schema.ts:1024-1029`)로 집계한다. 같은 물량이 두 번 잡히고 `projected_available_qty` 까지 부풀려진다.
- **destination plan 수령이 무조건 `RECEIVE`.** `planType` 을 읽는 곳이 조회·표시뿐(`inbound.service.ts:333,417,421`)이고 수령 로직은 분기하지 않는다(`inbound.service.ts:109`). 부천에 재고를 만들면서 중국을 깎지 않아 **이중 계상**이 된다.
- **`transferReceive` 에 락·검증이 없다**(`inventory-command.service.ts:348`). 지금은 ship 과 같은 트랜잭션이라 ship 의 락에 얹혀 있다. 분리하면 반드시 필요하다.
- **`transfer_pending_qty` 오배선.** `stock-projection.reader.ts:212` 가 `returnPendingQuantity`(회송 예정)라는 다른 이름으로 내보낸다.

## 채택하지 않은 대안

### custody 오버레이 방식 (출고작업과 동일)

원장을 건드리지 않고 세션 잔량을 ON_HAND 위에 덧씌우는 방식. **기각.**

- **추가 원장 쓰기가 0건이라 오버레이의 이점이 없다.** 출고작업은 원장 방식이면 라인당 5~6 전이(`AT_SOURCE→WORKER→TOTE→SORTING→PACKING→PACKED`)가 필요해 오버레이가 라인당 1건으로 줄였다. 이동은 현재도 2건(ship+receive)이고 트랜잭션을 나눠도 2건 그대로다.
- **병목 완화 근거도 이동에는 해당되지 않는다.** 판매와 경합하는 지점은 `pg_advisory_xact_lock(hashtext('sku:warehouse'))`인데, 피킹은 오버레이 방식에서도 이 락을 잡고 원장 행에 `FOR UPDATE` 까지 건다(`discrete-picking.strategy.ts:1170,1300`, `pick-to-tote.strategy.ts:1518,1648`, `aggregate-then-sort.strategy.ts:1365,1493`, `batch-inventory-session.service.ts:585`, `batch-controlled-stock.guard.ts:50`). 오버레이가 아낀 건 락이 아니라 원장 행 갱신과 이벤트 로그다. `transferShip` 은 어차피 그 락을 잡으므로(`inventory-command.service.ts:324`), 트랜잭션을 나누면 락 보유 시간이 오히려 짧아진다.
- **grain 위조가 필요 없다.** 오버레이를 택한 결정적 이유는 cart/tote/worker 를 원장 grain `(sku, warehouse, location, state)` 으로 표현할 수 없어 가짜 전역 location 을 만들어야 했다는 것이다(`docs/outbound-consolidation-split-backorder-decision-record.md`). `IN_TRANSFER` 는 이미 enum 에 있고 창고 경계를 실제로 넘는다.
- **가용재고가 공짜로 맞는다.** 정본 산식은 `ON_HAND 합 − confirmed 예약 합`(`warehouse-availability.ts:21`)이다. `IN_TRANSFER` 는 ON_HAND 가 아니므로 산식을 한 줄도 안 고치고 출발 창고 가용이 준다. 오버레이를 택하면 산식에 `− custody` 항을 더해야 하고, PR #618 이 6벌 → 실질 2벌로 수렴시킨 직후에 다시 분산시킨다.

### 이동을 부천 입고 계획으로 표현

`inbound_plans` 를 이동 문서로 쓰는 안. **기각.**

- `linked_purchase_order_id` 가 **NOT NULL + FK** 라 발주 없는 자발적 이동을 아예 넣을 수 없다.
- 발주 A·B·C 가 두세 선적 회차에 섞여 오는 실제 패턴을 표현하지 못한다. 도착 예정이 발주에 1:1 로 묶여 계획을 발주별로 쪼개야 하고 실제 선적 회차와 영원히 어긋난다.
- 출발 이벤트와 도착 계획이 서로를 모른다 — 짝 강제와 미완결 감시를 밖에서 다시 만들어야 한다.

### 현행 2종 유지 (발주=이중계획, 자발=movement_jobs)

새 테이블이 없다는 것 외에 이점이 없다. 같은 물리 사건에 두 벌의 상태·ETA·미완결 감시가 생긴다 — 가용재고 산식이 6벌이었던 것과 같은 종류의 부채를 문서 층에 만든다. **기각.**

## 설계

### 1. 원장 — 구간을 존속시킨다

`transferShip` 이 커밋되고 `transferReceive` 가 별도 트랜잭션으로 실행된다. 그 사이 `IN_TRANSFER` 잔량이 실제로 존재한다.

- **park 위치를 시스템 로케이션으로.** 현재는 출발 로케이션에 그대로 둔다(`toLocationId: input.fromLocationId`). `stock_ledgers.location_id` 가 NOT NULL 이고 PK 구성요소(`inventory.schema.ts:917-939`)라 어딘가에는 매달려야 하는데, 출발 선반에 두면 떠난 선반이 안 비어 보여 적치·재고조사가 틀어진다. 창고별 `transit_out` 롤을 `SYSTEM_LOCATION_ROLES`(`warehouse.constants.ts:25`)에 추가한다. 기각된 "가짜 전역 location" 과 달리 창고에 소속되며, `inbound_default` 등 이미 쓰는 장치다.
- **`transferReceive` 에 자체 락과 검증 추가.** 도착 창고 기준 advisory 락 + "미도착 잔량 ≥ 수령량".

### 2. 이동 지시서 — 짝의 소유자

창고 간 이동을 `movement_jobs` 에서 분리해 전용 문서를 만든다. 현재 `movement_jobs` 한 테이블에 즉시 창고 내 이동 / 계획 창고 내 이동 / 계획 창고 간 이동 세 가지가 섞여 있고 `transfer.service.ts:158` 의 `isInterWarehouse` 분기가 그 셋을 가른다. 창고 간을 떼면 그 분기가 사라진다.

```
transfer_orders          from_warehouse_id, to_warehouse_id
                         status: draft | shipped | partially_received | closed
                         eta, eta_updated_at, shipped_at, closed_at
transfer_order_lines     sku_id, from_location_id
                         planned_qty, shipped_qty, received_qty, lost_qty
transfer_order_receipts  도착 회차 (+ lines)
```

- **도착은 회차다.** 수주간 운송이면 부분 도착이 정상이다. 회차 없이 라인에 누적만 쌓으면 "언제 몇 개 왔는지"를 잃는다. 입고가 이미 `inbound_receipts`/`inbound_receipt_lines` 로 회차를 쓴다.
- **상태 정의**: `draft`(선적 전) → `shipped`(전량 출발) → `partially_received`(일부 도착) → `closed`(`shipped_qty = received_qty + lost_qty`, 즉 미도착 잔량 0). `closed` 는 전량 도착과 분실 정산 완료를 함께 덮는다.
- **미완결 = `shipped_qty − received_qty − lost_qty > 0`.** 한 테이블 조회로 나오며, 체류 시간 크론을 붙이면 트랜잭션 분리가 만드는 최대 부채가 닫힌다.
- **`lost_qty` 확정 시점**은 도착 회차 등록 시(회차에 분실 수량을 함께 기재) 또는 문서 마감 시 잔량 일괄 처리 두 가지다. 어느 쪽이든 `IN_TRANSFER` 잔량을 소진시키는 원장 이벤트를 동반한다.
- **ETA 는 문서 단위.** 같은 배에 실리므로 라인별로 나눌 이유가 없다. 지연 시 `eta` 를 갱신하고 `eta_updated_at` 을 남긴다.
- **발주와 연결하지 않는다.** 중국 입고가 끝나면 재고는 원장 grain 으로 녹아들고 발주 출처가 사라진다(로트/배치 추적이 없다 — `lot_number`·`serial` 컬럼 없음, `expiryDateManagement`(`:508`)는 SKU 속성 플래그일 뿐). 지시서는 "중국 ON_HAND 에서 SKU X 를 N개 뺀다"만 말하므로 발주 조합에 불가지하다. 합쳐 선적, 여러 회차에 섞임, 부분 선적이 모두 제약 없이 표현된다. **대가**: 발주별 도착 이력과 수입 원가 배부를 포기한다(후자는 현재도 구조가 없다 — `purchase_orders` 에 관세·운임 컬럼 없음, `purchase_order_lines.unit_price` 단가뿐).

### 3. 발주 경유 흐름의 재배선

발주는 **source plan(공급사→중국 입고)만** 만든다. destination plan 생성을 폐지하고, 중국 입고 완료 시 이동 지시서 초안을 자동 생성한다.

이로써 위 "기존 결함" 두 건(`inbound_pending_qty` 이중 계상, destination plan 의 무조건 `RECEIVE`)이 구조적으로 불가능해진다.

### 4. 판매성 축

`warehouses.is_sellable boolean not null default true` 를 추가하고 중국만 `false`.

`warehouses.type`(`['domestic','overseas','bonded','return']`, `inventory.schema.ts:56`) 재사용은 하지 않는다 — `type` 은 성격이고 판매성은 정책이다. 반품 창고 재고를 팔지는 별개 결정이며 지금 우연히 겹칠 뿐이다. `type` 을 읽는 비즈니스 로직이 0곳이라 "이미 있는 축을 살린다"는 이점도 실제로 없다.

판정은 **`sellable-warehouses.ts` 순수 판독 1벌**에 가둔다(`warehouse-availability.ts` 와 같은 형태). 아래 세 지점이 전부 그것만 호출한다:

| 지점 | 현재 | 변경 |
|---|---|---|
| `product-sellable-quantity.service.ts:139-143` | 전 창고 `SUM` | sellable 창고만 합산 |
| `fulfillments.service.ts:331` `validateWarehouseExists` | 존재 여부만 확인 | 비판매 창고를 출고 창고로 지정하면 거절 |
| `warehouse.constants.ts:19` | 해외 창고 시드가 `supportedPickingStrategies: ['discrete']` | 비워서 배치 생성 게이트가 막게 |

예약은 호출자가 창고를 지정하는 구조(`unified-reservation.service.ts:78`)라 위 두 번째 지점만 막으면 중국에 예약이 걸릴 경로가 없다.

**알려진 확장 지점**: 장차 "중국몰은 중국 창고, 한국몰은 부천 창고"가 필요해지면 이 boolean 이 (warehouse × sales_channel) M:N 으로 바뀐다. 그때의 진짜 제약은 컬럼 모양이 아니라 **ADR-0011(모든 판매채널이 같은 수량을 공유한다)** 이며, 그것을 뒤집는 것이 주된 작업이다. 조인 테이블을 지금 만들지 않는 이유는 (a) 요구가 없고 (b) `warehouses`(inventory)와 `sales_channels`(`catalog.schema.ts:551`)가 다른 BC 라 seam 을 투기적으로 여는 셈이기 때문이다. 판정을 한 함수에 가둬 두면 그때 바뀌는 코드가 그 함수 내부와 시그니처로 국한된다.

### 5. 파이프라인 판독

부천 관점에서 물량은 3단계를 거친다. ETA 를 이동 지시서에만 매달면 ②가 어디에도 안 잡혀, MD 가 "재고 0, 입고예정 0"으로 보고 **중복 발주**한다. 그래서 "입고 예정"을 이동 지시서가 아니라 **공급 파이프라인**으로 정의한다.

| 단계 | 출처 | 예정일 |
|---|---|---|
| ① 발주 잔량 (중국 미도착) | source plan `pending` | 발주 `expected_arrival` |
| ② 중국 대기 (이동 미생성) | 출발 창고(비판매) ON_HAND | **미정** |
| ③ 이동 중 | `IN_TRANSFER` + 지시서 `eta` | 지시서 `eta` |

- 새 테이블이 필요 없다. 셋 다 기존 원장·문서에서 읽힌다. ②는 비판매 창고 ON_HAND 그 자체다(`IN_TRANSFER` 는 별도 상태라 자동 배제).
- **"예정일 미정"을 값으로 노출한다.** 숨기면 ②가 다시 사각지대가 된다.
- 읽기 전용 서비스 하나로 만들고, 대상 창고와 SKU 목록을 받아 위 3단계를 낸다.

**이번 범위는 core API 까지.** storefront 는 Medusa 를 통해 상품을 읽으므로 프론트 노출에는 Medusa 투영이 한 겹 더 필요하며, 그것은 프론트 작업과 함께 결정한다.

### 6. 곁다리로 정리되는 것

- `inbound_pending_qty` — destination plan 폐지로 이중 계상이 사라지고 의미가 "발주 잔량(①)"으로 확정된다.
- `transfer_pending_qty` — 이동 지시서 기반으로 재정의하거나 삭제한다. 현재 `stock-projection.reader.ts:212` 의 `returnPendingQuantity` 오배선도 같이 없앤다.

## 동시성·오류 처리

- `transferShip` 은 이미 advisory 락 + `assertReservationInvariant`(`inventory-command.service.ts:324-325`)를 잡는다. 유지한다.
- 부분 도착은 반복 호출이므로 **회차마다 멱등키**가 필요하다. `InventoryIdempotencyService` 의 기존 패턴(`inbound.simple`)을 그대로 쓴다.
- 이동 지시서 상태 전이는 헤더 `FOR UPDATE` 로 직렬화한다(`transfer.service.ts:124` 선례).
- **`received + lost <= shipped` 는 DB check 제약으로 막는다.** `batch_inventory_sessions` 의 `settled + returned + shortage <= handed_in`(`inventory.schema.ts:2616`)과 같은 형태. 애플리케이션 검증만으로는 새는 것을 이미 배웠다.
- 운송 중 분실은 `IN_TRANSFER → 소멸` 정산이며 **기존 `SCRAP` 전이를 재사용한다.** 새 `transition_type` 값 추가는 이벤트 계약에 노출될 경우 소비자 선배포가 필요해 비싸다 — 실제 노출 여부는 구현 계획에서 확인한다.
- 영원한 미도착(③ 장기 체류)과 중국 장기 체류(②)를 각각 크론으로 감시한다.

## 테스트 전략

PR #624 의 교훈을 적용한다 — `view-parity.integration.spec.ts` 는 픽스처가 ON_HAND 행만 심어서, 모듈 산식을 `stock_state IN ('ON_HAND','DEFECTIVE')` 로 오염시켜도 초록이었다. **테스트가 산출물일 때는 RED 를 먼저 볼 수 없으므로, 프로덕션 코드를 일부러 깨뜨려 빨강을 관측하는 절차를 각 스펙에 명시한다.**

- 가용·파리티 스펙 픽스처에 `IN_TRANSFER` 행과 비판매 창고 행을 반드시 심는다.
- 핵심 통합 케이스: 부분 도착 2회차 / 운송 중 분실 / 미도착 잔존 / 비판매 창고 재고가 `product_sellable_quantity` 에 안 잡힘 / 파이프라인 3단계 합이 발주·원장과 일치.
- 러너는 `npm run test:core:integration:local`(5432 compose). 워크트리에서는 `COMPOSE_PROJECT_NAME=almondyoung-server` 가 필요하다.
- 통합 스펙을 쓰기 전에 시드할 테이블의 `\d` 를 먼저 뽑는다 — 계획서 SQL 이 실제 스키마의 NOT NULL·FK 와 어긋나는 실수가 반복됐다.

## 배포

- 새 테이블·컬럼은 전부 additive → **expand 단계이므로 `migrate → deploy`** 순서다(contract 의 `deploy → migrate` 와 반대이므로 혼동하지 말 것).
- destination plan 폐지는 기존 데이터가 있으면 contract 단계로 분리해야 한다. 물류팀이 WMS 를 아직 쓰지 않으므로 데이터가 0 일 가능성이 높지만 **배포 전 실측으로 확인한다.**

### 착수 전 실측 (미실행)

```sql
-- 창고별 원장 재고 — 중국이 실제로 원장 재고를 드는가
SELECT w.name, sl.stock_state, count(*) AS rows, sum(sl.qty) AS qty
FROM stock_ledgers sl JOIN warehouses w ON w.id = sl.warehouse_id
GROUP BY 1,2 ORDER BY 1,2;

-- 이중 입고 계획이 실제로 쓰이는가 (destination plan 폐지가 contract 인지 판정)
SELECT plan_type, status, count(*) FROM inbound_plans
WHERE requires_transfer OR parent_plan_id IS NOT NULL GROUP BY 1,2;

-- warehouse_transfer 잡이 실제로 돌고 있는가
SELECT count(*) FROM stock_journals WHERE source_type = 'warehouse_transfer';
```

## 범위 밖

- 프론트(storefront·admin-web) 화면. core API 까지가 이번 범위다.
- 채널별 판매가능수량(ADR-0011 개정).
- 발주별 원가 배부·로트 추적.
- custody 오버레이의 창고 grain 확장(#618 후속 2번). 출고작업의 숏피킹 구간에 "예약은 되나 피킹 때 409" 틈이 남아 있으나 별건이다.
