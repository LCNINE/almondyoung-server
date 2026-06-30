# 출고 → 재고원장 소진 RFC (Outbound Shipment Ledger Closure)

## Status

작성 2026-06-29. **Phase 0·1·A(클러스터 A) 구현·develop 머지·live 마이그레이션 적용 완료(2026-07-01). 다음 = Cluster B — 단, live FO 10건으로 "FO 0건" 전제가 깨져 SO:FO unique 선결 점검이 게이트(Progress·후속 추적 #5).** 이 문서가 본 프로젝트의 상황판(허브)이다.

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

1. 출고 종결(재고 소진) 단위 = **상자(shipment)** = 송장 한 장. 송장(상자 라벨) 스캔은 박스 **open**, **종결 트리거는 박스 전 라인 검수 자동완료**(2026-06-30 변경, ADR-0027 #1).
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

- **송장분할**(지금 필요): 한 **FO 가 여러 상자로** → 그 FO 의 FOI 라인들이 여러 shipment 에 분배. (FOI ↔ line 이 1:1 이어도 성립 — 정의는 FO 레벨. 한 FOI 의 수량까지 쪼개지는 건 하위 케이스: `shipment_line.qty` + `unique(shipmentId, foiId)`.)
- **합배송**(나중, 모델만 열어둠): 여러 FO 라인이 한 상자에 → 한 shipment 에 여러 FO 의 line.

### 데이터 모델 (확정)

기존 `invoices`/`shipments` 재배치 + `shipment_lines` 신설.

```
invoice  (운송장번호 발급 — 기존 invoices 재활용; 라인 없음)
  id, trackingNo, carrier, issueMethod, externalServiceId
  issuedForFulfillmentOrderId → FO   (nullable; "미리 출력" 추적용)
  shipmentId → shipment              (nullable; 박스 open 시 세팅. 선발급 동안 null)
                                     # FK 가 invoice 쪽 = shipment 1:N invoice 이력. void 된 송장도 shipmentId 보존.
                                     # active 1 = (shipmentId) WHERE status≠'voided' 부분 unique
  status: issued | used | voided
  issuedAt, voidedAt
  # 출고작업 생성 시 FO별 미리 발급. 송장에 인쇄되는 상품목록 = 발급 시점 shipment_line 스냅샷.
  # 박스 내용이 바뀌는 분할 시 void + 신규 발급.

shipment  (상자 = 박스 = 출고 종결 단위 — 기존 shipments 재배치)
  id
  warehouseId                        (FO 에서 denormalize)
  openedForFulfillmentOrderId → FO   (nullable; 자동완료 판정 기준. 합배송 시 null — A 는 FO 1:1)
  status: open | shipped | in_transit | delivered | failed | canceled
  openedBy(작업자), openedAt, shippedAt
  # invoiceId 컬럼 없음 — active 송장은 invoice.shipmentId 역참조로 구함 (FK 방향 = invoice 쪽).
  # trackingNo/carrier 는 invoice 로 이동(shipments 에서 제거).
  # shipment 은 송장 발급이 아니라 송장 스캔(open)에서 lazy 생성. 동시에 여러 박스 open 가능.

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

폐기: `inspection_sessions` (검수 세션 = 상자로 흡수) + `inspection_items` (검수 상태 = `shipment_line.inspectedQty` 로 흡수). `approved/rejected` 구분도 폐기 — 정상품 가정(불량=Non-Goal)이라 `inspectedQty`(=검수통과) 하나로 충분, 거부분은 `inspection_issues` 로. 유지: `inspection_issues` (FOI 참조 불량 로그).

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
- **Phase 1 — 상자 라인 (additive)**: `shipment_lines` 신설, packing 연산(상자+라인 생성), `consumeShipment` 라인 단위 전환. (FO 는 아직 1:1) **상세 설계 확정 → Resolved Decisions §Phase 1 상세 설계.**
- **Phase 2 — 상자 워크플로 재구조 (클러스터 A, destructive)**: 원래 RFC "Phase 2" 가 사실은 *독립 restructure 2덩어리* 였어서 쪼갬 (grilled 2026-06-30). A = ① 운송장번호 재배치(`shipments.trackingNo`/`carrier` → invoice, shipment↔invoice 연결, 1:N 이력) + ② 상자=박스 승격(status `open/shipped/canceled`, `warehouseId`, `openedForFO`) + ③ 검수의 shipment_line 이주(`inspection_sessions`/`inspection_items` → `shipment`/`shipment_line`, `inspectedQty/forced` 흡수, `inspection_issues` 유지) + ④ 검수→consume 배선(현재 `ship()` 이 `shippedQty=qty` 로 덮어써 부분검수 소실되는 버그 해소). **FO↔상자는 아직 1:1**(`uqFulfillmentOrder` 유지) — 송장분할·합배송은 M:N 이 필요해 B 로. 자체 expand→backfill→contract.
- **Phase 3 — FO 정체성 (클러스터 B, destructive)**: FO = SO 1:1 스냅샷, FO-분할(`split()`/`handleFulfillmentOrderSplit`/`handleFulfillmentOrderMerge`) 은퇴 → `splitShipment`(송장분할)로 대체, FO↔상자 **M:N 개방**(`uqFulfillmentOrder`·`uqActivePerFo` drop). **A 에 단방향 의존** — `splitShipment` 스펙이 A 의 box + `inspectedQty` 를 쓴다. 자체 expand→backfill→contract.

(클러스터 A 내부 설계는 grilling 중 — Resolved Decisions 에 확정 예정. phase 경계·exit criteria 도 거기서.)

## Progress

| Phase | 상태 | 비고 |
|---|---|---|
| 설계 | ✅ 확정 | 본 RFC + ADR-0027 + CONTEXT.md |
| Phase 0 고리 닫기 | 🟩 develop 머지(통합 미검증) | FIFO 순수함수 단위(5/5) + 재배선 단위 GREEN, 빌드 클린. **develop 머지됨**(Phase 1 과 함께 squash 커밋 `bd5a9efe5`). 통합 스펙은 `describeIfDb` skip 으로 대기. |
| Phase 1 상자 라인 | 🟩 develop 머지(통합 미검증) | 스키마(`shipment_lines`+`shipments.openedBy`)·`consumeShipment`/`ensureShipmentLines`·drop_ship 가드·fail-loud·journal(openedBy 귀속)·operator 배선 완료. 단위 GREEN(fulfillments 85, outbound-consumption 5, +invoice/direct-ship 회귀)·`nest build core` 클린. **develop 머지됨**(squash `bd5a9efe5`; 머지 중 catalog 충돌 2건+중복 import 해소). **마이그레이션 `20260629092035` 적용 완료.** 단 통합 스펙(FIFO SQL·available 불변·작업자 journal)은 아직 미실행 — DATABASE_URL 닿는 환경에서 `describeIfDb` 해제해 실증 필요. |
| Phase 2 상자 워크플로 (클러스터 A) | 🟩 develop 머지·live 마이그레이션 적용·배포 | 검수 영속 붕괴(`inspection_sessions`/`items`→`shipment`/`shipment_line`)·`shipment_line{inspectedQty,forced}`·invoice FK 뒤집기(`invoice.shipmentId`)·자동완료 소진(`inspectScan`→`consumeShipment`)·박스 lazy 생성(`openBoxByScan`)·명시적 ship(`POST :id/ship`) 은퇴. **단위 GREEN**(fulfillments/shipment/outbound-consumption/invoice·hanjin/direct-ship 135)·`nest build core` 클린. 통합 spec(`outbound-consumption.integration`)은 새 박스/검수 모델로 갱신했으나 `describeIfDb` skip(빚). **develop squash-머지(`2a24ac13e`) + 마이그레이션 ordering 수정(`11c918fb9`); 마이그레이션 2개(`20260630125603`+`20260630155417`) live 적용·배포.** ⚠️ live FO 10건/FOI 28건 — "FO 0건" 전제 거짓(Cluster B 게이트 — 후속 추적 #5). 상세 = Resolved Decisions §Phase 2 (클러스터 A). |
| Phase 3 FO 정체성 (클러스터 B) | 🟦 설계 확정 | 구조만(제거+개방+강제), 흐름 미룸. FOL drop·split/merge 은퇴·M:N 개방·SO:FO unique. 1 PR. 상세 = Resolved Decisions §Phase 3 (클러스터 B). |

## Resolved Decisions (grilled 2026-06-29)

### phase 경계 / exit criteria / deploy gate / 롤백

전제: ADR-0027 결정 7 / Non-Goals 대로 **출고 기능은 아직 프로덕션 미사용** — 누수는 활발히 데이터를 깨는 중이 아니라 출고가 켜질 때를 대비한 선제 수정. 긴급도·롤백 위험이 그만큼 낮다.

| Phase | 성격 | Exit criteria | Deploy gate | 롤백 |
|---|---|---|---|---|
| **0 고리 닫기** | additive, 무스키마 | 단위 GREEN(FIFO 5/5, 재배선 81/81) + `nest build core` 클린 + 코드 리뷰. ⚠️ **통합 스펙 GREEN 은 원래 머지 전 게이트였으나 dev 환경 삭제로 실행 보류** — 스펙은 `describeIfDb` skip 으로 리포에 남고, DB 환경 복구 시 실행해 성공 기준("on_hand N↓·available 불변·SHIP 1건/FOI") 최종 확정. 그때까지 FIFO SQL·`stock_summary_view`·예약 닫기 상호작용은 실증 미검증. | 마이그레이션 없어 독립 배포 가능. (단 develop 빌드 클린 선결.) | `ship()` 재배선 커밋 revert → release 동작 복귀. 되돌릴 데이터 없음(SHIP 은 immutable POSTED, 멱등키로 재실행 안전) |
| **1 상자 라인** | additive 스키마(`shipment_lines` 신설) | 라인 단위 `consumeShipment` GREEN, FO 아직 1:1 | **Phase 0 와 deploy-between 게이트 불필요** (둘 다 additive — ADR-0005 §5 게이트는 destructive 전용). Phase 1 은 Phase 0 위 다음 PR. | 코드 revert (테이블 미사용이면 무해) |
| **2 FO=스냅샷** | destructive(재배치) | dual-write→backfill→read 전환 각 단계 GREEN | 3-PR, **각 PR 사이 deploy 1회 필수** (ADR-0005 §5) | 단계별 revert |
| **3 contract** | destructive drop | `uqActivePerFo`/`split()` 제거 후 회귀 GREEN | Phase 2 read 전환 deploy 후 1회 뒤 | drop 전 단계로 |

핵심 규칙(ADR-0005): autodeploy 의 `sst deploy → migrate` 순서가 contract race 를, additive-only 컨벤션이 expand race 를 막는다 — 짝.

### 작업자(actor) → SHIP journal 귀속

**form = journal 경유** (기존 `receive()` 패턴과 동일). `stock_events` 에 actorId 직접 컬럼은 없고 `journalId → stock_journals.actorId` 만 존재하므로:

- **Phase 1**: `consumeShipment` 가 `stock_journal`(sourceType=`SHIPMENT`, sourceId=shipmentId, actorId=`shipment.openedBy`) 1건 생성 → `InventoryCommandService.ship()` 에 `journalId?` 파라미터 추가(receive 와 대칭)해 그 SHIP 이벤트들을 한 journal 로 묶는다.
- **Phase 0**: `ship()` 에 journalId 없음 → SHIP 이벤트 `journalId=null`(무귀속). 의도된 한계.
- ⚠️ 부수 과제(Phase 1): `POST :id/ship` 컨트롤러·`FulfillmentsService.ship()` 가 현재 인증 operator 를 전혀 받지 않는다. actor 귀속은 스키마(`openedBy`)만으론 부족 — 컨트롤러에서 operator 캡처 → `openedBy` 전달 배선이 함께 필요.

### (이전 해소) packing 연산·송장분할·FOI 부분출고 상태·검수 모델 → Target Architecture 에 확정.

### Phase 1 상세 설계 (grilled 2026-06-29)

전제: **최소 고리 전환 (additive).** `shipment_line` 은 `{shipmentId, foiId, skuId, qty}` 뿐 — inspectedQty/forced/송장분할/자동완료/박스-스캔 UI 는 Phase 2(inspection 재작성, destructive)로. Target Architecture 의 박스 재배치(invoice↔shipment) 도 Phase 2.

1. **상자 정체성 = 기존 `shipments` 재사용.** 이미 per-FO(`uqFulfillmentOrder`)라 'FO 아직 1:1' 과 일치. `shipment_lines.shipmentId → shipments.id`. additive 로 `shipments.openedBy` 컬럼만 추가. `trackingNo`/`carrier` 는 그대로 두고 Phase 2 에서 invoice 로 재배치.
2. **`shipment_lines` 신설 (additive).** `{id, shipmentId→shipments, fulfillmentOrderItemId→FOI, skuId(원장용 denormalize), qty, createdAt}` + `unique(shipmentId, foiId)`(박스당 FOI 1행 — 멱등 ensure 의 `onConflictDoNothing` 근거, end-state M:N 에서도 성립) + `ck qty>0`.
3. **packing 연산 = ship 경로 안의 `ensureShipmentLines`.** `ship(foId)` 가 shipment 을 **find(require)** → 그 FO 의 FOI 를 미러한 lines 생성 → `consumeShipment(shipmentId)`. 별도 UI/스캔 엔드포인트 없음(Phase 2). lines 는 Phase 1 에선 생성 즉시 소진되는 scaffolding(독립 운영가치는 Phase 2 부터) — expand-contract 의 정상 모양.
4. **라벨 없는 자사 출고 = fail-loud (require shipment).** in_house/3pl FO 가 shipment 없이 ship 도달 시 throw('출고 전 송장/라벨 발급 필요'). 송장 선발급이 운영 원칙이고 end-state(박스 스캔=출고)의 불변식. ⇒ bare-box 생성·`trackingNo` nullable 마이그레이션 **불필요**. shipment 생성은 여전히 `issueInvoice`/`assignShipment` 한정. (기존 `ship` 스펙은 이미 owned FO 에 shipment 를 셋업하므로 회귀 없음 예상 — 구현 시 81개 확인.)
5. **drop_ship 가드.** `fulfillmentMode='drop_ship'` 이면 `consumeShipment`·lines 생성 **skip** — 종결 전이(`shipped`)+`FulfillmentShipped` 이벤트는 유지(공급사 전달로 출고 갈음). 직배 재고는 우리 소유가 아니라 원장을 건드리면 안 됨. ⚠️ **Phase 0 가 drop_ship 도 무차별 consume → 직배 종결에 FIFO/warehouseId throw 잠재버그를 심었음(예약·피킹도 이미 skip 하면서 consume 만 안 막음). 이 가드가 그 버그도 동시 수정.** 직배 전면 추출은 아래 별도 워크스트림.
6. **작업자 귀속 = openedBy(박스 연 사람).** shipment 생성(`issueInvoice`/`assignShipment`)에서 인증 operator 캡처 → `shipments.openedBy`. `consumeShipment` 가 `stock_journal{sourceType:'SHIPMENT', sourceId:shipmentId, actorId:openedBy}` 1건 생성 → `InventoryCommandService.ship()` 에 `journalId?` 추가(receive 와 대칭)해 SHIP 이벤트들을 한 journal 로 묶음. **직전 'actorId→SHIP journal 귀속' 결정의 "POST :id/ship operator 캡처" 는 정정** — 귀속이 openedBy 이므로 캡처 지점은 ship 이 아니라 `issueInvoice`/`assignShipment`(둘 다 현재 `@User` 없음). ship 컨트롤러 operator 불필요. openedBy null 이면 journal.actorId null(graceful, 무귀속).

멱등: SHIP `idempotencyKey = ship:{shipmentId}:{lineId}:{locationId}`(Phase 0 의 foId 키에서 진화). reservation 소진은 1:1 이라 FO 단위 유지(shipment→FO 도출). FIFO 의 warehouseId 는 `shipment→FO.warehouseId` 에서 도출(Phase 1 `shipments` 에 warehouseId 없음 — Phase 2 추가).

### Phase 2 (클러스터 A — 상자 워크플로) 상세 설계 (grilled 2026-06-30)

전제(steer): 출고 기능 프로덕션 미사용 ⇒ 마이그레이션은 구조 변경일 뿐 실데이터 backfill 사실상 비어 있음. 기존 스키마는 보존 대상이 아니라 *참고* — 타깃 구조를 깨끗이 설계. expand-contract 의 의미는 "데이터 보존"이 아니라 "롤링 배포 중 옛 task 가 destructive 마이그레이션 만나는 race 차단".

A 범위: FO↔상자 **아직 1:1**(`uqFulfillmentOrder` 유지). 분할·합배송·`partially_shipped` 없음(전부 B). 박스 = FO 전량.

1. **검수 영속 붕괴 (Q2).** `inspection_sessions`→`shipment`, `inspection_items`→`shipment_line` 흡수. "상자 open = 검수 단위 시작"이라 별도 session 테이블 불필요. `inspection_issues`만 유지(FOI 참조 불량 로그). 근거: session(FO당)·상태·작업자(`inspectorUserId`→`openedBy`)·카운터가 shipment 과 전부 중복, item(session×FOI)은 line(shipment×FOI)과 키 동형.

2. **`shipment_line` = `{shipmentId, foiId, skuId, qty, inspectedQty, forced}` (Q3).** `qty`=manifest(박스 계획), `inspectedQty`=검수 통과수, `forced`=강제. **`approved/rejected` 구분 폐기** — 정상품 가정이라 검수통과=approved, 거부분은 `inspection_issues` 로. consume 는 `qty` 출고, `inspectedQty==qty`(자동완료) 또는 `forced` 로 게이트.

3. **write-ownership 역전 (Q3).** 검수 스캔이 `FOI.shippedQty` 가 아니라 `shipment_line.inspectedQty` 를 올린다(현 `inspection.service:336` 의 `shippedQty=approvedQty` realign 제거). `FOI.shippedQty` 는 consume 가 박스 소진마다 누적. ⇒ 현 `ship()` 의 `shippedQty=item.qty` 덮어쓰기로 부분검수가 소실되던 버그가 구조적으로 사라짐 — 출고 수량 단일 소스 = `shipment_line`.

4. **invoice↔shipment FK = invoice 쪽 (Q4 — RFC 옛 `shipment.invoiceId unique` 정정).** `invoice.shipmentId`(nullable) + `(shipmentId) WHERE status≠'voided'` 부분 unique = "박스당 active 송장 1개". 선발급(미리 출력)=`shipmentId null`. void 된 송장도 `shipmentId` 보존 → 박스 송장 이력 온전. A 는 1:1 만 쓰지만 **B(송장분할)의 1:N 이력 요구를 미리 충족**해 B 에서 FK 재마이그레이션을 피함. `trackingNo`/`carrier` 는 `shipments` 에서 제거→invoice 로. status `issued/used/voided`.

5. **소진 트리거 = 자동완료 (Q5 — 물류팀 요구 a).** 송장 스캔=박스 open(출고 아님). 마지막 검수 스캔이 박스 전 라인을 `inspectedQty==qty` 로 채우는 순간 **그 검수 tx 안에서 `consumeShipment` 자동 발사.** 명시적 출고 엔드포인트(`POST :id/ship`·`markInvoiceShipped→ship()`) **은퇴** — `ship()` 은 자동완료가 부르는 내부 연산으로 강등. **강제출고가 유일한 override**(막힌 박스 수동 닫기 별도 없음): 대상 라인 `inspectedQty:=qty`+`forced=true` → 같은 게이트. drop_ship 은 이 경로 안 탐(예약·원장 없음, `direct-ship` 라이프사이클 유지).

6. **박스 lazy 생성 (Q6).** shipment 은 송장 발급(선발급)이 아니라 **송장 스캔(open)** 에서 born: `shipment{status:open, openedBy:작업자, openedForFulfillmentOrderId:FO, warehouseId:FO.warehouseId}` 생성 + `invoice.shipmentId` 세팅·`status=used` + **FO 미출고 FOI 미러해 `shipment_line` born**(`qty=잔량, inspectedQty=0`). 기존 `issueInvoice`/`assignShipment` 의 shipment upsert 는 **선발급-only 로 리팩터**, 박스 생성은 스캔 연산 단독 소유. Phase 1 `ensureShipmentLines`(ship-시점) **폐기**.

7. **shipment status 확장.** `+open/shipped/canceled`(현 `created/in_transit/delivered/failed`). open(스캔)→shipped(소진)→in_transit/delivered(배송추적, A 핵심 밖)/failed. `openedForFulfillmentOrderId`(A는 FO 1:1), `warehouseId` denormalize.

8. **멱등·동시성.** 여러 박스 동시 open 가능(서로 다른 FO). 자동완료는 박스별. 검수-스캔 tx: shipment `FOR UPDATE` → `inspectedQty++` → 전 라인 완료 검사 → `consumeShipment`(자체 멱등 `idempotencyKey=ship:{shipmentId}` + status 전이). 더블파이어 방지 = shipment 락.

미해결(A 잔가지, 구현 시): shipment status 전이 세부(배송추적 in_transit/delivered 출처), 검수 스캔 바코드→라인 resolve 세부.

### Phase 3 (클러스터 B — FO 정체성) 상세 설계 (grilled 2026-06-30)

재프레임(B1): **FOI 가 이미 스냅샷**(`salesOrderId`/`salesOrderLineId`/`variantId`/`mappingSnapshotId` 보유) → "FO=스냅샷"은 데이터 재구조가 아니라 **카디널리티+연산 변경**. `fulfillment_order_lines`(FOL)은 dead(코드·FK 의존 0) → **drop**. SO:FO 0..1:0..1 강제 = `fulfillmentOrders(salesOrderId) WHERE salesOrderId IS NOT NULL` 부분 unique. standalone/보상 FO(`salesOrderId=null`) = "FO 쪽 0"으로 자연 제외. unique 는 1:1 을 깨는 연산을 은퇴/수정한 *뒤에야* 걸 수 있음.

1:1 을 깨는 연산은 **둘뿐**(B5 확정): ① `split()`(FO-split) → `splitShipment`(상자 레이어)로 대체 [B4], ② SO 병합 → 은퇴(B2). ~~③ drop_ship 혼합주문~~ — 코드 확인 결과 혼합주문은 이미 **단일 FO**(`fulfillmentMode=null`, `buildItemsFromSalesOrder` 가 mode 미결정 + worker 가 SO 당 단일 create)라 FO 를 쪼개지 않음 → **drop_ship 은 1:1 위반자도, B 의 선결조건도 아님.** (직배 추출은 비선결 별도 워크스트림; 현재 직배 품목이 자사 FO 로 흡수되는 잠재버그는 그쪽에서 해소.)

**B2 — SO 병합 은퇴 → 합배송으로 대체.** 현 SO 병합(`sales-orders.service:721`)은 FO 를 합쳐 SO:FO 1:1 을 깼다. 대신 **SO·FO 는 각각 1:1 로 두고 상자에서 합친다 = 합배송**(M FO → 1 박스). ADR-0027 #6("분할·병합은 상자 레이어로")와 정합. SO 데이터 주도권이 판매채널이므로 Core 가 SO 를 병합하는 것 자체가 부적절. **합배송 *흐름*은 Non-Goal(미룸)** — B 는 M:N 모델만 연다(`uqFulfillmentOrder` drop + `openedForFO` nullable). 은퇴~합배송 흐름 사이 "두 주문 한 박스" 공백은 수용(출고 미사용이라 SO 병합 실사용도 없을 것).

**B3 — 합배송 = 의도(intent) ⊥ 실현(realization) 2레이어.**
- **shipment = 실현**: 물리 박스, **항상 lazy**(송장 스캔으로 born).
- **합배송 결정 = 의도**: early(FO 생성 전, 주문자+배송지 규칙) 또는 late(포장대 증분 스캔) 바인딩. early 라도 **박스를 eager 로 만들지 않고** 의도(FO 그룹핑)만 기록 → 박스는 포장대에서 lazy 실현. FO 를 합치지 않음(1:1 유지), shipment 을 미리 만들지 않음(lazy 유지).
- early 의도 레이어(`consolidationGroupId` 등 + 인테이크 규칙)는 합배송 흐름의 일부라 **B 밖**(미래 additive). B 의 의무는 **non-blocking** 뿐.

**B 가드 (불변식 — 구현자 주의):**
1. **shipment 은 항상 lazy 실현** — 절대 eager 생성 금지, 절대 단일 FO 에 하드와이어 금지(`openedForFO` nullable + `shipment_line → FOI` M:N 유지).
2. **합배송 로직을 shipment 에 박지 말 것** — 상위 그룹핑(의도 레이어)에 둘 것.

**B4 — `splitShipment`·합배송 *흐름* 미룸. B = 구조만.** B 의 실체: ① **제거** — FOL drop · FO-split(`split`+`handleFulfillmentOrderSplit`+`handleFulfillmentOrderMerge`+reservation-lifecycle split/merge 분기) · SO-merge FO 생성(`sales-orders.service:721`) · dead 중복출고경로(`FulfillmentOrderTransactionService.ship/complete`, reservation `case 'completed'|'shipped'`), ② **모델 개방** — `uqFulfillmentOrder` drop + `openedForFO` nullable(FO↔상자 M:N), ③ **강제** — `fulfillmentOrders(salesOrderId) WHERE salesOrderId IS NOT NULL` 부분 unique. 새 흐름(`splitShipment`·합배송)은 M:N 위에 런칭 때 additive. 근거: 둘은 완전 대칭(제거 메커니즘의 대체물·M:N 전제·런칭 때만 사용)이라 한쪽만 B 에 넣을 이유 없음. `splitShipment` 는 한 FO 안 박스 분할이라 예약을 FO 간 이전하지 않음(`handleFulfillmentOrderSplit` 불필요).

**B6 — expand-contract phasing (steer 확정: 프로덕션 FO 0건).** 출고 도메인 전체가 프로덕션 데이터·트래픽 0 — FO 한 건도 생성된 바 없음(있어도 실수·삭제 가능). ⇒ expand-contract 의 두 전제(롤링배포 race + 데이터 backfill)가 **모두 부재**라 3-PR 댄스·deploy-between 이 **불필요**(ADR-0005 §5 위반이 아니라 *조건 불성립*).
- **A = 1 PR**(박스/invoice/검수 재구조 + 마이그레이션 + 코드; expand/contract 분리 실익 없음).
- **B = 1 PR**(위 제거+개방+강제 한 번에; unique 추가가 위반 데이터도 코드레이스도 없어 안전).
- **A → B 순서**(B 마이그레이션이 A 의 `openedForFO`/status 컬럼 참조). 리뷰 응집 위해 별 PR, 안전상 deploy-between 게이트는 해제(논리 순서만).
- ⚠️ caveat: 이 PR 배포 *전에* FO 생성이 프로덕션 라이브가 되면 rigor 복원 — 특히 B unique 는 클린 데이터 + split/merge 제거 deploy 선행 필요. 이 단락이 RFC Resolved Decisions 옛 deploy-gate 표(Phase 2/3 "3-PR 필수")를 *이 work 에 한해* 대체.

참고 정정: `uqActivePerFo`(invoices) drop 은 실은 **A(invoice 재배치)** 소관 — invoice FK 가 `invoice.shipmentId` 로 바뀌며 FO-기반 active unique 가 shipmentId-기반으로 대체. Phase 3(B)에는 `uqFulfillmentOrder`(shipments) drop 만.

### 직배(drop-ship) 모델 추출 — 별도 워크스트림 (decided 2026-06-29)

**[2026-06-30 전제 정정]** 당초 이 절은 *"SO:FO 1:1 재정의가 '한 SO 를 자사 FO + 타사 직배 FO 로 쪼개기'를 무너뜨린다"* 고 적었으나, 코드 확인 결과 **그 쪼개기는 존재하지 않는다** — 혼합주문(자사+타사)은 현재 `fulfillmentMode=null` **단일 FO** 로 만들어지고, 직배 품목이 그 자사 FO 에 흡수돼 우리 재고로 예약·피킹·출고될 잠재버그가 있다(`buildItemsFromSalesOrder` 가 라인 mode 미결정, worker 가 SO 당 단일 FO). 따라서 SO:FO 1:1 이 무너뜨릴 split 이 없고, **직배 추출은 B(1:1)의 선결조건이 아니다.**

추출의 진짜 이유는 *그 흡수의 분리* 다: 직배(타사 소유·추적 불가 재고를 **공급사에 주문 내역 전달로 출고 갈음**)를 FO(자사 예약·피킹·소진에 묶인 객체)에 흡수시키는 게 부적절하다. → **직배주문을 FO 바깥의 새 모듈/엔티티(자체 라이프사이클)로 추출.** SO 진입 시(주문매칭 성공 후) `자사 FO 0..1개(디지털-only 등은 0) + 직배 공급사 수만큼의 직배주문` 으로 분기 — **직배주문은 FO 가 아니므로 이 분기는 SO:FO 1:1 을 깨지 않는다.**

본 outbound-ledger 프로젝트와 **별개 워크스트림**: B(SO:FO 1:1)의 **선결조건도 의존도 아니나**(B5 — 혼합주문이 이미 단일 FO 라 1:1 이 깨질 게 없음), FO 정체성이 정리된 뒤 하는 게 자연스러움 — 그와 함께/뒤에, 자체 ADR + phased plan 으로. Phase 1 은 위 가드(5)로 임시 격리만. 기존 `fulfillmentMode='drop_ship'` 분기·`direct-ship.service`·`directShipStatus`·`outbound-batch`/예약-retry 의 drop_ship 제외 분기는 추출 완료 후 contract 대상. (어휘는 `CONTEXT.md` 직배주문 참고.)

## Immediate Next Step

1. ~~ADR-0027 확정~~ ✅, ~~packing·검수·송장분할 데이터 모델 확정~~ ✅, ~~Phase 0 구현 계획 작성~~ ✅
2. ~~**Phase 0 구현**~~ ✅ (코드 완료, 단위 GREEN, 빌드 클린). **통합 실행은 dev 환경 삭제로 보류** — `outbound-consumption.integration.spec.ts` 는 skip 된 채 대기. DB 환경 복구 시 `./scripts/test-core-integration.sh dev outbound-consumption.integration` 으로 성공 기준("on_hand N↓·available 불변·SHIP 1건") 최종 확정.
3. ~~⚠️ **Phase 0 deploy 선결조건**: develop 빌드가 `#472`(overseas customs)의 catalog 컴파일 에러 2건으로 깨져 있음~~ ✅ **해소** — 머지(`bd5a9efe5`) 시 catalog 충돌 2건(`product-versions.service.ts` import = `type ProductSnapshot`, `projection-snapshot.assembler.ts` = `isOverseas ?? false`)+auto-merge 중복 import 해소, `nest build core` 클린.
4. ~~Phase 1(상자 라인 + packing 연산) 스키마·연산 상세 설계~~ ✅ (Resolved Decisions §Phase 1 상세 설계).
5. ~~**Phase 1 구현** (TDD): 스키마(`shipment_lines`+`shipments.openedBy`)·`consumeShipment`/`ensureShipmentLines`·drop_ship 가드·fail-loud·`ship()` journalId·operator→openedBy 배선·`ship()`→`consumeShipment` 전환~~ ✅ **완료·develop 머지(`bd5a9efe5`)·마이그레이션 `20260629092035` 적용 완료.** 단위 GREEN + 빌드 클린.
6. ⏭️ **통합 검증 빚**: `outbound-consumption.integration.spec.ts`(Phase 1 모델로 갱신됨)가 아직 `describeIfDb` skip. 마이그레이션은 적용됐으니, DATABASE_URL 닿는 환경에서 spec 을 실행해 성공 기준(on_hand N↓·available 불변·SHIP 1건/라인·작업자 journal 귀속) 실증. 배포 전 안전판.
7. ~~Phase 2 — FO=스냅샷 (destructive)~~ → **재설계·분해 확정·머지** (grilled 2026-06-30, 설계 커밋 `c7de2281a`). 원 단일 "Phase 2"가 사실 독립 restructure 2덩어리라 분해: **Phase 2 = 클러스터 A(상자 워크플로)**, **Phase 3 = 클러스터 B(FO 정체성)**. 프로덕션 FO 0건이라 expand-contract 세리머니 붕괴 → **각 1 PR, A→B 순서.** 상세 = Resolved Decisions §Phase 2 (클러스터 A)·§Phase 3 (클러스터 B). ADR-0027 #1/#4 종결 트리거 amend(검수 자동완료).
8. ~~**Cluster A 구현** (TDD, 1 PR): 검수 영속 붕괴(`inspection_sessions`/`items`→`shipment`/`shipment_line`, `inspection_issues` 유지)·`shipment_line{qty,inspectedQty,forced}`·검수 write-ownership 역전(`FOI.shippedQty` consume-driven)·`invoice.shipmentId` FK 뒤집기·자동완료 소진 트리거·박스 lazy 생성·명시적 ship 엔드포인트 은퇴~~ ✅ **develop squash-머지(`2a24ac13e`)·마이그레이션 2개 live 적용·배포 완료.** 단위 GREEN(135)·`nest build core` 클린·통합 spec 새 모델 갱신(skip 유지). 적용 시 drizzle DDL ordering 버그 2건 발견·수정(`11c918fb9` — 후속 추적 #6).
9. ⏭️ **다음 = Cluster B 구현** (구조만: FOL drop · FO-split/SO-merge/dead 중복출고경로 제거 · FO↔상자 M:N 개방(`uqFulfillmentOrder` drop + `openedForFO` nullable) · `fulfillmentOrders(salesOrderId) WHERE NOT NULL` 부분 unique). 상세 = Resolved Decisions §Phase 3 (클러스터 B). A→B 순서. **⚠️ 게이트: live FO 10건이 있어 "FO 0건" 전제가 깨졌다(후속 추적 #5) — B 의 SO:FO 부분 unique 를 걸기 전 이 데이터가 위반자(중복 salesOrderId·split/merge 출신)인지 read-only 점검 + RFC 반영 선행.**
10. 직배(drop-ship) 모델 추출 — 별도 ADR + phased plan. **B(SO:FO 1:1)의 선결조건 아님**(B5 — 혼합주문이 이미 단일 FO). 추출 이유 = 직배 품목이 자사 FO 로 흡수되는 잠재버그 분리.

### Cluster A 후속·조율 추적 (구현 중 발견, 별도 작업)

A 머지 시점에 닫히지 않고 후속/프론트 조율로 넘기는 아이템:

1. **admin/프론트 조율 — 은퇴한 ship 라우트 정리**: `POST /fulfillments/:id/ship` 라우트는 삭제됐고 자사 출고는 박스 스캔(`POST /shipments/scan` → `inspect-scan`)으로 이관됐다. 그러나 (a) `computeAdminAvailableActions`(`fulfillments.service.ts` 약 1320)가 여전히 `'ship'` 액션을 advertise, (b) admin-web `fulfillment-order.client.ts:67` / `mutations.ts:874` 의 `useShipFulfillment` 가 dead route 호출, (c) admin-web `PUT /invoices/:id/ship`(`invoices.client.ts:39`) 도 dead. → admin-web 박스 스캔 전환 + `'ship'` 액션 제거는 **별도 프론트 작업/Cluster B**.
2. **admin-web `InvoiceStatus` 타입 drift**: `dto/fulfillment.ts:511` 가 `issued|printed|shipped|canceled` — 신 enum `issued|used|voided` 와 불일치. admin-web 정비 시 동기화.
3. ✅ **해소 (EU7) — cancel→reissue→rescan unique 위반**: `shipments.uq_shipments_fulfillment_order_id`(FO 평 UNIQUE)가 `cancelInvoice`(박스 `status='canceled'` 만 바꾸고 FO 유지)+송장 재발행 후 재스캔의 `insert(shipments)`(동일 FO)와 충돌 → 미처리 raw 500. 부분 unique(`uq_shipments_fo_active` `WHERE status<>'canceled'`)로 교체해 취소박스가 재스캔을 막지 않게 함(`invoices.uq_invoices_shipment_active` 와 대칭, 마이그레이션 `20260630155417`). 부수효과로 FO당 박스 다건(취소분+활성1) 가능 → FO→박스 단건 조회(`getOne`·`markDelivered`·`buildTrackingView`)를 `ne(status,'canceled')`+최신 선택으로 방어. 이로써 `idx_shipments_opened_for_fo` 는 정당(부분 unique 가 미취소만 인덱싱하므로 전수 FO 조회용으로 잉여 아님).
4. **통합검증 빚**: `outbound-consumption.integration.spec.ts`(새 박스/검수 모델로 갱신됨)는 `describeIfDb` skip — DATABASE_URL 닿는 환경에서 실행해 "on_hand N↓·available 불변·SHIP 1건/라인·작업자 journal 귀속" + `openBoxByScan→inspectScan` 자동완료 e2e 를 실증해야 한다. 배포 전 안전판.
5. **★ "FO 0건" 전제가 live 에서 거짓 — Cluster B 게이트** (2026-07-01 live 마이그레이션 적용 시 발견): live core 에 `fulfillment_orders` **10행** + `fulfillment_order_items` **28행** 존재. `invoices`/`shipments`/`inspection_*` 는 0행이라 **Cluster A 마이그레이션엔 무해**(FO/FOI 를 destructive 하게 안 건드림, 빈 자식테이블에만 컬럼 drop·enum 교체). 그러나 **Cluster B 의 `fulfillmentOrders(salesOrderId) WHERE salesOrderId IS NOT NULL` 부분 unique 선결조건이 깨진다** — B 착수 전 이 10건이 (a) 중복 salesOrderId 가 없는지, (b) 옛 split/merge 로 생긴 1:1 위반자가 아닌지, (c) 실데이터인지 테스트 잔재인지 **read-only 점검 필수**(`cd deployments/lcnine/services && npx sst shell --stage live -- …` + `BEGIN…ROLLBACK`/SELECT). 점검 결과에 따라 B 가 1 PR(클린) vs 데이터 정리/expand-contract 로 갈린다.
6. ✅ **해소 (live 적용 시) — 마이그레이션 DDL ordering 버그 2건** (`11c918fb9`): drizzle-kit 이 EU1 마이그레이션(`20260630125603`)에 심은 ordering 버그가 코드리뷰(SQL 정독)로는 안 잡히고 **live 적용에서야** 터짐 — (a) `DROP TABLE inspection_sessions CASCADE`(#4)가 이미 제거한 FK 를 뒤에서 중복 `DROP CONSTRAINT`(→ `IF EXISTS` 멱등화), (b) 부분 unique `uq_invoices_fo_active`(predicate `status<>'canceled'`)가 `invoices.status` 타입 변경(→text)을 막음 → `DROP INDEX` 를 enum 교체 *앞*으로 이동. **교훈(통합검증 빚 #4 의 실제 비용): destructive 마이그레이션은 live 적용 전 `BEGIN…ROLLBACK` 문장별 드라이런 필수** — 메모리 `feedback_migration_dryrun_before_live`.
