# 출고 → 재고원장 소진 RFC (Outbound Shipment Ledger Closure)

## Status

작성 2026-06-29. **설계 확정, 구현 대기.** 이 문서가 본 프로젝트의 상황판(허브)이다.

- 핵심 결정의 *이유*: [`docs/adr/0027-outbound-shipment-consumes-stock-ledger.md`](./adr/0027-outbound-shipment-consumes-stock-ledger.md)
- 발견 과정·증거: [`docs/inventory-ledger-binding-review.md`](./inventory-ledger-binding-review.md)
- 도메인 어휘: `CONTEXT.md` (출고주문 / 재고예약 / 출고작업 / 상자·운송장번호)
- 원본 비전: [`docs/inventory_event_mutable.md`](./inventory_event_mutable.md)

## Goal

재고는 event-sourced 원장(`stock_events → stock_ledgers → stock_summary_view`)으로 관리한다. 원본 설계 의도(`inventory_event_mutable.md`)는 — append-only 이벤트의 추적 정확성과 mutable 작업 테이블의 효율을 결합해 — **출고작업이 재고를 묶어 두고 작업 중에는 counter 로 관리하다가, 종결 시 단일 "출고완료" 이벤트를 원장에 append 해 일관성을 유지**하는 것이었다.

검증(`inventory-ledger-binding-review.md` §3) 결과 이 고리의 **종결 절반(e3)이 빠져** 있었다: 정상 출고가 `stock_events` 를 append 하지 않고 `on_hand` 를 차감하지 않아, 예약이 풀리면 출고된 수량이 다시 가용으로 살아나는 누수가 있다.

이 프로젝트의 목표:

- **고리를 닫는다**: 출고 종결이 원장에 단일 SHIP 이벤트를 append 하고 on_hand 를 차감한다 → 재고의 단일 진실(ADR-0001) 회복.
- 닫으면서, 운영 현실(상자=송장 단위 종결, 송장분할, 향후 합배송·토탈피킹)에 맞게 **FO/상자/운송장번호 레이어를 바로잡는다.**

성공 기준: **"상자 N개 출고 → 원장 on_hand 정확히 N 감소, available 불변"** 이 seam 단위 테스트로 검증된다.

## Locked Decisions

(이유는 ADR-0027.)

1. 출고 종결(재고 소진) 단위 = **상자(shipment)** = 송장 한 장. 상자 스캔이 트리거.
2. **출고주문(FO) = 판매주문의 SKU 스냅샷**(상품매칭 적용), 박스 아님. SO ↔ FO = 0..1 : 0..1.
3. **FO ↔ 상자 = M:N** (`shipment_line` 이 source FOI 참조). 송장분할·합배송을 한 모델로 표현.
4. 상자 스캔 시 상자 라인별 **단일 SHIP 이벤트 append + 예약 소진(consume)**. 차감 로케이션은 **교체 가능 전략**(FIFO 지금 / 피킹-로케이션 나중).
5. 예약 종결 = **소진(consume)** vs **환원(release)** 구분. 출고=소진, 취소/만료=환원.
6. 운송장번호(invoice) = 상자에 발급된 택배사 번호의 이력(shipment 1:N). FO-분할(`split()`) 은퇴.
7. 소진 시 ON_HAND 부족은 **불변식 위반 → throw**. 레거시 보정 불필요(출고 기능 미사용).

## Non-Goals (지금 안 함 — 모델이 막지만 않으면 됨)

- **합배송 흐름/UI**(M FO → 1 상자) 구현. 모델(`shipment_line`)은 허용하되 흐름은 후속.
- **토탈피킹** 구현. 로케이션 결정 전략 seam 이 막지 않도록만.
- 피킹-로케이션 기반 정밀 차감(지금은 FIFO).
- **불량/거부 처리**(불량재고 전환 + 재피킹). 현재 흐름은 검수 가능한 정상품만 가정.
- 레거시 출고 데이터 마이그레이션(없음).
- 채널/주문 외부 계약 변경.

## Document Map

- ADR-0027 — 핵심 결정과 이유 (불변)
- `inventory-ledger-binding-review.md` — 검증 결과(§1–5: 버그·증거·후보 4개)
- `inventory_event_mutable.md` — 원본 설계 비전
- `CONTEXT.md` — 도메인 어휘
- `implementation-plan-outbound-ledger-phase0.md` — Phase 0 구현 계획(TDD)

## Target Architecture

### 엔티티 모델

| 엔티티 | 의미 | 카디널리티 |
|---|---|---|
| **출고주문 FO** | 판매주문을 상품매칭으로 SKU 변환한 **스냅샷** (박스 아님) | SO **0..1 : 0..1** FO |
| **FOI** | FO 의 SKU 라인 + 예약수량 | FO 1 : N FOI |
| **상자 shipment** | 물리 박스 = 송장(라벨) = **출고 종결(소진)의 단위** | (아래 M:N) |
| **상자 라인 shipment_line** | `{shipmentId, foiId, skuId, qty}` — source FOI 참조 | FOI 1 : N line, shipment 1 : N line ⇒ **FO ↔ shipment M:N** |
| **운송장번호 invoice** | 택배사 API 발급 운송장번호 (발급 이력) | shipment 1 : N invoice, active 1 |

- **송장분할**(지금 필요): 한 FOI 라인이 여러 상자에 → `shipment_line` 다수.
- **합배송**(나중, 모델만 열어둠): 여러 FO 라인이 한 상자에 → 한 shipment 에 여러 FO 의 line.

### 데이터 모델 (확정)

기존 `invoices`/`shipments` 재배치 + `shipment_lines` 신설.

```
invoice  (운송장번호 발급 — 기존 invoices 재활용; 라인 없음)
  id, trackingNo, carrier, issueMethod, externalServiceId
  issuedForFulfillmentOrderId → FO   (nullable; "미리 출력" 추적용)
  status: issued | used | voided
  issuedAt, voidedAt
  # 출고작업 생성 시 FO별 미리 발급. 송장에 인쇄되는 상품목록 = 발급 시점 shipment_line 스냅샷.
  # 박스 내용이 바뀌는 분할 시 void + 신규 발급.

shipment  (상자 = 박스 = 출고 종결 단위 — 기존 shipments 재배치)
  id
  invoiceId → invoice                (unique: 한 박스 = 한 송장)
  warehouseId
  openedForFulfillmentOrderId → FO   (nullable; 자동완료 판정 기준. 합배송 시 null)
  status: open | shipped | in_transit | delivered | failed | canceled
  openedBy(작업자), openedAt, shippedAt
  # 동시에 여러 박스 open 가능. 송장 스캔 = 그 박스 생성/포커스(봉인 아님).

shipment_line  (상자 라인 — 신설)
  id
  shipmentId → shipment
  fulfillmentOrderItemId → FOI       (FO↔shipment M:N 연결점)
  skuId                              (원장용 denormalize)
  qty                                (이 박스 계획 수량 = manifest)
  inspectedQty                       (그 중 검수 완료; 강제출고 시 = qty)
  forced  boolean                    (강제출고 여부 — 권한 무제한, 사유 없음)
  createdAt

fulfillment_order_items (변경)
  status: … + partially_shipped
  shippedQty: 박스 소진마다 누적 (검수가 직접 세팅하지 않음 — inspection.service:336 realign)
```

폐기: `inspection_items` (검수 상태가 `shipment_line.inspectedQty` 로 흡수). 유지: `inspection_issues`.

### 종결 seam

```
[상자 스캔]
  → consumeShipment(shipmentId)                       ← 종결 seam (작은 인터페이스)
       for each shipment_line {foiId, skuId, qty}:
            chunks = LocationStrategy.resolve(sku, wh, qty)   ← 로케이션 producer (FIFO 지금 / 피킹 나중)
            for each {locationId, qty}:
                InventoryCommandService.ship({sku, wh, loc, qty, idemKey})  ← e3: SHIP 이벤트 (dead 메서드 부활)
            reservation.consume(sku, wh, qty)           ← 소진(환원 아님)
            FOI.shippedQty += qty                        ← 누적 부분출고
       FOI 전량 → FOI shipped;  FO 전 FOI → FO shipped
```

- **소진 vs 환원**: 소진 = `on_hand -= q`(SHIP) + `reserved -= q` **함께** (available 불변). 환원 = `reserved -= q` 만 (취소/만료). 현재 ship 이 환원을 부르는 게 §3 의 버그.
- **로케이션 전략 seam**: FIFO(지금, `allocation-strategy` 재활용) ↔ 피킹-로케이션(나중, 토탈피킹). adapter 둘 = 진짜 seam → 토탈피킹 비차단 제약 흡수.
- **멱등성**: 상자 status 전이(`FOR UPDATE`) 1차 + SHIP `idempotencyKey = f(shipmentId, lineId)` 2차.

### packing·검수·송장분할 흐름

- **송장 스캔** → `invoice.status=used`, `shipment` open (라인 = `openedForFO` 미출고분, `inspectedQty=0`). 여러 박스 동시 open 가능, 스캔은 포커스 전환일 뿐 봉인 아님.
- **상품 검수 스캔** → 해당 라인 `inspectedQty += 1` (행 추가 없음 — 원본 doc 의 counter 방식).
- **자동완료** → 박스의 모든 라인 `inspectedQty == qty` → `consumeShipment` 자동 호출(봉인 버튼 불필요).
- **강제출고** → 지정 상품/박스 라인 `inspectedQty := qty`, `forced=true` → 같은 완료 경로. 작업자 누구나, 사유 없음.
- **송장분할** (명시적 액션) `splitShipment(shipmentId, spec)` — **불변식: `Σqty`·`ΣinspectedQty` 보존, 이전은 미검수분 우선.** 원 invoice void + 신규 invoice 2개 발급·연결. 예약은 FOI 에 그대로(라인 이동이 예약을 안 건드림).
  - 방법1 (미검수 자동 이전): 라인별 `qty − inspectedQty` 를 새 박스로, 원 라인 `qty := inspectedQty` → 원 박스 자동완료/출고.
  - 방법2 (수량 지정, 미검수 우선): `movedUninspected = min(t, qty−inspectedQty); movedInspected = t − movedUninspected`. 예) A 5개 중 4검수, 3 이전 → 새 박스 `qty=3,inspectedQty=2` / 원 박스 `qty=2,inspectedQty=2`.

불량/거부(불량재고 전환 + 재피킹)는 이 흐름 밖(Non-Goal). 현재 모델은 검수 가능한 정상품만 가정.

## Proposed Phased Plan (expand-contract, ADR-0005 §5)

순서는 "고리부터 닫고, 구조는 뒤에" — destructive phase 사이엔 deploy 1회.

- **Phase 0 — 고리 닫기 (additive, 현 1:1 모델 위에서)**: 현재 invoice=FO(1:1) 전제로 `markAsShipped`/`ship` 경로에 소진(SHIP 이벤트 + FIFO 로케이션 전략 + `reservation.consume`) 추가, release→consume 버그 수정. → §3 누수 즉시 해소. dead `InventoryCommandService.ship()` 부활. **계획: `implementation-plan-outbound-ledger-phase0.md`.**
- **Phase 1 — 상자 라인 (additive)**: `shipment_lines` 신설, packing 연산(상자+라인 생성), `consumeShipment` 라인 단위 전환. (FO 는 아직 1:1)
- **Phase 2 — FO=스냅샷 (dual-write→backfill→read 전환)**: FO 를 SO 1:1 스냅샷으로, FO-분할 은퇴, invoice 를 shipment 로 재배치.
- **Phase 3 — contract**: `uqActivePerFo`/`uqFulfillmentOrder` drop, `split()`/`handleFulfillmentOrderSplit` 제거.

(phase 경계·exit criteria 는 아직 미확정 — Open Questions.)

## Progress

| Phase | 상태 | 비고 |
|---|---|---|
| 설계 | ✅ 확정 | 본 RFC + ADR-0027 + CONTEXT.md |
| Phase 0 고리 닫기 | 🟨 구현 완료(통합 미검증) | FIFO 순수함수 단위(5/5) + 재배선 단위(`fulfillments.service.spec` 81/81) GREEN. 통합 스펙(`outbound-consumption.integration.spec.ts`) 작성 완료·**터널 실행 대기**. |
| Phase 1 상자 라인 | ⬜ | |
| Phase 2 FO 스냅샷 | ⬜ | |
| Phase 3 contract | ⬜ | |

## Open Questions

- **phase 경계 / exit criteria** 구체화 (각 phase 의 deploy gate, 롤백 기준).
- **작업자(actor) → SHIP journal 귀속**: `shipment.openedBy` 를 `stock_journals.actorId` 로 흘리는 형태 확정.
- (해소됨) packing 연산·송장분할·FOI 부분출고 상태·검수 모델 → Target Architecture 에 확정.

## Immediate Next Step

1. ~~ADR-0027 확정~~ ✅, ~~packing·검수·송장분할 데이터 모델 확정~~ ✅, ~~Phase 0 구현 계획 작성~~ ✅
2. ~~**Phase 0 구현**~~ ✅ (코드 완료, 단위 GREEN) → **통합 스펙을 터널에서 실행**해 "상자 N개 출고 → on_hand N 감소, available 불변" 성공 기준 확정. (`./scripts/sst-tunnel.sh deployments/lcnine/services dev` → `./scripts/test-core-integration.sh dev outbound-consumption.integration`)
3. ⚠️ **Phase 0 deploy 선결조건**: develop 빌드가 `#472`(overseas customs)의 catalog 컴파일 에러 2건(`product-versions.service.ts`, `projection-snapshot.assembler.ts` — 미import 심볼)으로 깨져 있음. Phase 0 는 additive 라 독립 머지 가능하나 **deploy 는 이 빌드 깨짐이 먼저 고쳐져야** 가능. (Phase 0 와 무관한 선행 이슈.)
4. Phase 1(상자 라인 + packing 연산) 스키마·연산 상세 설계.
