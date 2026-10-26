# K3 — 직배는 «입점사가 보내는 상자», FO 상태는 투영만 — 설계

- 날짜: 2026-10-25 (develop `23852736f` 기준 코드 읽기. 라이브 실측 없음)
- 출발점: `docs/order-logistics-architecture-audit-2026-10.md` §8.1 K3
- 관련: ADR-0027(FO 는 스냅샷, FO↔상자 M:N), ADR-0046(K2 상자 수명주기), ADR-0047(K6 라인 수량), ADR-0049(K7 주문 취소)
- 상태: 사용자 승인 대기

## 1. 왜

### 1.1 업무

직배는 **입점 제조사 위탁 발송 계약**이다. 판매가 부진한 제조사에 «아몬드영 쇼핑몰에 올려 주겠다, 사입·보관은 하지 않고
주문이 오면 발송에 필요한 정보(주문 내역·배송지)를 넘기겠다»고 제안한다. 제조사가 우리 고객에게 직접 보낸다.
재고 부담 없이 구색이 늘어 협력사를 모으는 미끼가 되므로 **직배 주문이 앞으로 많아진다**(사용자, 2026-10-25).

레거시(셀메이트)에서는 직배 상품을 손으로 걸러 엑셀로 보냈다. **송장번호는 돌아오지 않았고** 입점사가 «보냈다»고 하면 믿었다.
고객은 배송 추적을 못 했다. 사용자: «이제는 그래서는 안 된다.»

### 1.2 코드 — 직배만 옛 모델에 남았다

ADR-0027(2026-07)이 FO 의 뜻을 «박스»에서 «판매주문을 SKU 로 옮긴 스냅샷»으로 바꿨다. SO↔FO 0..1:0..1, 나가는 단위는 상자,
FO↔상자 M:N, 고객 추적은 `SO → FOI → shipment_line → shipment → waybill` 로 조립한다. 직배는 그 개편에서 **일부러 빠졌다**
(`2026-07-14-outbound-consolidation-split-backorder-technical-design.md` §209·§657 «기존 direct-ship 경로 유지»).
같은 커밋(`11522f2fa`, 07-16)이 «섞이면 거절»을 넣었다. 그 결과:

| 증상 | 위치 |
|---|---|
| 창고 SKU 와 직배 SKU 가 섞인 주문은 FO 생성 거절 → 출고가 시작되지 않음 | `fulfillments.service.ts:195-199` `V2_MIXED_DIRECT_AND_WAREHOUSE_FULFILLMENT` |
| 입점사 둘의 상품이 한 주문에 있으면 FO 하나가 한 업체로만 넘어감 | `direct-ship.service.ts:272-322` |
| 업체가 `suppliers` 가 아니라 `holders` 행이고, 넘길 때 사람이 **이름 문자열**로 고름 | `direct-ship.service.ts:89-99` |
| 송장 칸 없음. 완료 이벤트가 `carrier:'CJ'`(하드코딩)·`trackingNumber:''` | `fulfillments.service.ts:513` |
| 그 이벤트가 스키마 `trackingNumber.min(1)` 위반 → 발행 시 검증이 throw → **«완료 처리»가 롤백될 가능성이 높다**(유닛 테스트는 outbox 를 mock 해 못 잡음) | `fulfillments.stream.ts:143`, `stream-publisher.service.ts:220`, `fulfillments.service.spec.ts:854` |
| FO 에 투영 어휘에 없는 `'shipped'` 를 직접 씀 | `fulfillments.service.ts:487` |
| `direct_ship_status` 를 `'pending'` 으로 쓰는 곳이 없음(NULL 을 pending 으로 간주하는 곳과 건너뛰는 곳이 섞임). `'canceled'` 도 아무도 안 씀 | §부록 A |
| 전량 취소돼도 `forwarded` 로 남아 목록에 수량 0 으로 남고 «완료»는 409 | PR #1128 «알려진 문제» |
| 정합성 점검 `ACTIVE_LINE_QUANTITY`(qty = shipped + canceled + 활성 상자 라인) 가 열린 직배 FOI 전부를 위반으로 잡음 — 상자 라인이 없으므로 | `fulfillment-reconciliation.service.ts:95-100`, `fulfillment-invariant.service.ts:154-172` |
| 상자에 매달린 것을 전부 놓침: 고객 추적 행, 고객 발송 알림(`SalesOrderShipmentDispatched`), `FulfillmentProgressed` | `store-sales-orders.service.ts:769-995`, `shipment-dispatch.service.ts:1195-1225` |

라이브 직배는 0건이다(2026-10-24 실측) — 지금이 갈아엎기 가장 싼 때다.

### 1.3 K3 와의 관계

감사 문서의 K3 는 «FO status 는 아무도 직접 쓰지 않고 투영이 정한다»는 규칙이다. 판매주문 쪽은 K7 PR3 으로 끝났고,
남은 직접 쓰기의 핵심이 직배다. 직배를 상자 모델에 태우면 직배도 수량 사실(`shippedQty`·`canceledQty`)만 쓰게 되어 K3 가
저절로 성립한다. **이 작업이 K3 다.**

## 2. 목표 · 비목표 · 반목표

### 목표

- **G1. 섞인 주문이 나간다.** 한 판매주문에 창고 상품·입점사 여러 곳의 상품이 섞여도 FO 하나 안에서 창고분은 창고 상자로,
  직배분은 **입점사별 상자**로 갈라져 각자 나간다.
- **G2. 입점사는 저절로 정해진다.** 어느 입점사로 갈지는 SKU ↔ 공급사 연결에서 정한다. 넘길 때 사람이 고르지 않는다.
- **G3. 우리 양식 하나로 내보내고 돌려받는다.** 운영자가 입점사별로 엑셀을 내려받아 보낸다(양식은 우리가 정한다, 사용자).
  입점사가 «택배사·송장번호» 또는 «못 보냄 사유»를 채워 돌려주면 운영자가 올린다(미리보기 → 적용).
- **G4. 고객이 추적한다.** 송장이 붙은 직배 상자는 창고 상자와 같은 길로 고객 추적 화면·발송 알림에 나온다.
- **G5. FO 상태는 투영만 정한다(K3).** FO status 를 직접 쓰는 코드가 없고, 가드 spec 이 새로 생기는 것을 막는다.
- **G6. 취소는 K7 그대로.** 직배 상자 라인의 취소도 `OrderCancellation` 커널로만 들어오고, 넘긴 상자의 취소는 «알릴 취소»에 남는다.

### 비목표 (사용자 합의)

- 입점사 공급가 **정산**
- 택배사 조회로 **배송완료 자동 감지** (자동 조회는 지금 한진뿐) — 직배분은 «발송됨»에서 멈춘다
- 직배 **반품·교환**
- **입점사 계정**(권한을 가진 로그인) — 나중 일. 단 데이터는 «입점사 단위»로 묶어 나중에 계정이 붙을 수 있게 한다
- **외부 채널**(네이버·쿠팡)에서 파는 직배 — 직배는 아몬드영 쇼핑몰에서만 판다
- **입점사별 배송비** — 배송비는 주문당 한 번, 입점사는 상품가에 포함한다(사용자). 지금 실제로 어떻게 받는지는 사용자가 따로 확인한다
- 감사 K3 의 «판매주문 모듈이 출고 테이블을 직접 쓰는 예외 둘»(배송지 변경 `channel-order-change.manager.ts`, 공동현관 비번
  파기 `entrance-password-cleaner.ts`) — 직배와 무관하다(내 판단)

### 반목표 — 이렇게 되면 동작해도 실패다

- **업로드가 취소하거나 환불을 정한다.** 업로드는 사실(보냈다/못 보낸다)만 기록한다. 취소는 관리자가 기존 취소로 한다
  (K7 «커널 밖 취소 금지», #1016 15번 «판단은 건마다 관리자가»).
- **직배 상자가 창고 흐름에 끼어든다.** 예약·예약 재시도 워커·피킹·배치·합배송·한진 채번·재고 원장 차감 어디에도 들어가면 안 된다.
- **K2 를 우회한 상자 상태 쓰기.** 직배 상자 상태도 `transitionShipments` 로만 바뀐다.
- **FO status 직접 쓰기가 남거나 새로 생긴다.**
- **입점사를 이름 문자열로 찾는다.**

## 3. 결정 (대화에서 정한 것)

| # | 결정 | 근거 |
|---|---|---|
| D1 | 직배 = **입점사가 싸서 보내는 상자**. 주문 하나 = FO 하나, 그 안에서 입점사별 상자 | 사용자 승인. ADR-0027 모델과 일치 |
| D2 | 입점사 = `suppliers` 행 (`is_direct_delivery = true`). `holders` 는 직배에서 쓰지 않는다 | `suppliers.is_direct_delivery`·`sku_suppliers.supplier_sku` 가 이미 있다 |
| D3 | 양식은 우리가 하나로 정한다 | 사용자 |
| D4 | 돌려받는 엑셀: 송장이 빈 줄 = **아직 안 보냄**, «못 보냄 사유»가 적힌 줄 = **못 보냄** | 사용자 승인. 기다릴 줄과 손댈 줄을 가르기 위해 |
| D5 | **송장이 있는 줄만 발송 처리.** 같은 입점사 안에서도 보낸 것은 보낸 대로 나간다 | «있는 것 먼저»(#1016 15번 §1.3) |
| D6 | «못 보냄» 줄이 생긴 주문은 관리자 앞(정체 보드)에 뜬다. 취소 여부·고객 연락은 관리자가 건마다 | 사용자 승인 |
| D7 | 범위: 정산·배송완료 감지·반품교환·입점사 계정·외부 채널·입점사별 배송비 제외 | 사용자 |
| D8 | 직배 상자도 창고 상자의 **발송 되돌리기**를 같은 명령으로 지원한다 | 사용자 승인. 창고와 대칭 |
| D9 | 입점사의 합포장 = 입점사 상자 **합치기**(창고 합배송과 같은 표현) | 사용자 승인. «상자 = 송장 한 장» 유지 |
| D10 | 개통은 입점사 단위, 한 입점사는 셀메이트·새 시스템 중 한쪽에만 | 사용자 승인. 직배 상품은 아직 새 시스템에 없음 |

## 4. 모양

### 4.1 데이터

**입점사 상자.** `shipments` 에 `supplier_id`(→ `suppliers`, nullable)를 더하고 `warehouse_id` 의 NOT NULL 을 푼다.
CHECK: **`warehouse_id` 와 `supplier_id` 중 정확히 하나.** 이것이 «입점사 상자»의 유일한 판별자다
(`fulfillment_mode` 나 SKU `stock_type` 으로 판별하지 않는다).

- 상자 라인은 그대로 `shipment_lines`(FOI 참조). `reserved_qty` 는 늘 0.
- 수령인은 `recipient_snapshot` 에 창고 상자와 같은 방식으로 굳힌다. 공동현관 비번(`entrance_password`)도 같은 칸을 쓴다 — 입점사에 넘길 정보다.
- **«넘김»은 상태가 아니라 기록이다(내 판단).** 상자에 «넘긴 시각»과 «내려받기 묶음 id»를 남긴다. 상태는 `draft`(대기·넘김) →
  `shipped` → (취소면 `canceled`). 이유: K2 전이표에 새 상태를 늘리지 않고, `planned` 는 배송 프로필을 요구하며 창고 흐름(배치·할당)이
  읽는 상태라 섞이기 쉽다.
- **«못 보냄»은 상자 라인 단위 기록이다.** 사유 텍스트·보고 시각·올린 사람. 라인 수량은 바꾸지 않는다(취소가 아니다).

**송장.** 입점사가 돌려준 송장은 **수기 송장**(`waybills.source = 'manual'`, 상태 `registered`/`used`/`voided`)으로 남긴다.
`carrier` enum 이 6곳(CJ·HANJIN·LOTTE·LOGEN·KDEXP·CJGLS)뿐이라 입점사가 쓰는 택배사(최소 우체국)를 더한다 — 목록은 빌더가
국내 주요 택배사로 정한다. 이 enum 은 이벤트 계약(`fulfillments.stream.ts`·`shipments.stream.ts` 의 zod)에도 있으므로 §6 순서를 따른다.

**FO.** 새 FO 에는 `fulfillment_mode = 'drop_ship'` 을 쓰지 않는다 — 한 FO 에 창고분과 직배분이 섞이므로 FO 단위 모드는 뜻이 없다.
직배 여부는 상자(`supplier_id`)로 판정한다. `direct_ship_status` 칸과 FO `drop_ship` 모드는 **contract 단계에서** 걷는다(§6). fulfillment_status 의 `'shipped'` 값은
걷지 않는다 — 셀메이트 스크립트가 쓰므로 남기고, 셀메이트 컷오버(#923) 때 걷는다(§6·§7).

**알릴 취소.** `direct_ship_cancel_notices` 의 업체 FK 를 `holders` 에서 `suppliers` 로 옮긴다. 테이블은 10-24 에 생겼다 —
라이브 행 수를 먼저 재고, 0 이면 단순 교체, 아니면 expand-contract.

### 4.2 입점사 정하기 (G2)

- **직배 SKU(`stock_type = 'drop_shipped'`)는 저장할 때 직배 공급사(`is_direct_delivery = true`)와의 `sku_suppliers` 연결을 정확히 하나** 갖는다.
  규칙 위치는 배송 프로필 필수화와 같은 `SkuCatalogManager` 도메인 검증(내 판단, `2026-09-26-delivery-profile-management-design.md` §4.3 과 같은 이유).
  «값이 실제로 바뀔 때만 검사» 규칙도 그대로 따른다.
- 기존 직배 SKU 중 연결이 없는 것: FO 생성이 **fail-closed** 로 거절되고 기존 생성 백로그의 실패로 드러난다(내 판단). 빌더는 착수 때 라이브에서
  `drop_shipped` SKU 수와 연결 없는 수를 잰다.
- admin-web SKU 폼: 재고 유형이 «직배»면 입점사 선택이 필수로 뜬다.

### 4.3 흐름

1. **FO 생성.** 판매주문 하나에 FO 하나. FOI 를 SKU 의 직배 공급사로 묶어, 창고분은 지금처럼 창고 draft 상자로, 직배분은 **입점사마다 draft 상자 하나**로.
   «섞이면 거절»은 없앤다. 직배 상자 라인은 예약하지 않는다.
2. **대기 목록.** 직배 화면이 «넘기지 않은 draft 입점사 상자»를 입점사별로 보인다.
3. **내려받기 = 넘김.** 운영자가 입점사 하나를 골라 엑셀(XLSX)을 받으면 그 파일에 담긴 상자들에 «넘긴 시각·묶음 id»가 찍힌다.
   다시 받기(같은 묶음 재발급)는 허용한다 — 메일 첨부를 잃어버리는 일은 흔하다(내 판단).
4. **입점사가 채워 돌려줌.** 줄 = 상자 라인. 열은 최소 «행 키(라인 id), 주문번호, 상품명, 공급사 상품코드, 수량, 수령인, 연락처, 주소,
   공동현관 비번·배송 메모, 택배사, 송장번호, 못 보냄 사유». 행 키는 입점사가 지워도 주문번호+공급사 상품코드로 되짚지 못하게 **필수**로 둔다.
5. **올리기 → 미리보기 → 적용.** 미리보기는 줄마다 판정을 보인다: 발송 / 합포장 / 못 보냄 / 아직 / 정정 / 오류(모르는 행 키, 다른 입점사의 줄,
   이미 보낸 줄, 취소된 줄, 택배사 이름 불명, 송장과 사유가 둘 다 있음, **행 키와 주문번호·공급사 상품코드가 서로 안 맞음** 등). 마지막 검사는
   입점사가 줄을 섞어 붙여 넣는 실수를 잡기 위한 것이다 — 잘못 반영되면 되돌리기(9)가 있지만 고객에게 발송 알림이 이미 나간다. 적용은 오류 없는 줄만, 상자 단위로 한 트랜잭션.
6. **발송 기록(직배 발송 명령).** 송장이 있는 줄들을 (상자, 택배사, 송장번호)로 묶는다.
   - 한 상자의 줄 전부가 같은 송장 → 그 상자가 그 송장으로 `shipped`.
   - 한 상자의 줄이 송장 둘 이상으로 나뉘거나 일부만 송장이 있음 → **K2 의 구성 편집 문으로 상자를 나눈 뒤** 각 상자를 발송.
     송장 없는 줄(아직·못 보냄)은 원래 상자에 draft 로 남는다.
   - **합포장(사용자 승인):** 같은 입점사의 **다른 주문** 줄들이 같은 (택배사, 송장번호)로 올라오면 미리보기가 «합포장»으로 보이고, 적용하면
     그 입점사 상자들을 창고 합배송과 같은 방식(새 상자 하나, 원래 상자는 `superseded`)으로 합친 뒤 그 송장으로 발송한다. «상자 = 송장 한 장»
     (`shipments` 주석)이 지켜지므로 `uq_waybills_tracking_live` 를 건드리지 않는다. 수령인(`canonicalConsolidationRecipient`)이 다르면 오류.
     지금 합배송(`consolidation.service.ts`)은 창고·자사출고 전용(`isCompatibleInHouseAggregate`, 창고 단위 후보 조회)이라 입점사 상자 갈래가 필요하다.
   - 라인 수량의 일부만 보냈다는 표현은 받지 않는다 — 줄은 전량 발송 또는 미발송(내 판단, v1 단순화).
   - 기록: 수기 송장 → 상자 `shipped`(`transitionShipments`) → FOI `shippedQty` 증가 → FO `shippedAt`(전량일 때) → **FO 상태는 투영**(§4.5) → 이벤트(§4.6).
7. **못 보냄.** 라인에 «못 보냄» 기록만 남는다. 정체 보드에 새 상태(예: `drop_ship_unfulfillable`)로 뜨고, 직배 화면에도 입점사별로 보인다.
   관리자는 고객에게 묻고, 기다리거나(입점사가 다음 파일에 송장을 채워 오면 6 으로) 기존 취소로 그 줄을 취소한다.
8. **송장 정정(내 판단).** 이미 발송된 상자에 다른 송장번호가 올라오면 미리보기에서 «정정»으로 따로 보이고, 적용하면 옛 수기 송장을 `voided`,
   새 수기 송장을 등록한다. 상태 전이는 없다. 고객 추적은 waybill 을 읽으므로 바로 바뀐다. Medusa 메타데이터를 다시 보낼지는 빌더가 §4.6 과 함께 정한다.
9. **발송 되돌리기(사용자 승인).** 엉뚱한 줄에 송장이 반영된 경우 등. 창고 상자와 **같은 명령**(`shipment.dispatch.recall`, `shipment-recall.service.ts` `report`)과
   같은 전이(`shipped → recovery_required(DISPATCH_RECALL_PENDING) → draft`)를 쓴다. 입점사 상자 갈래는 재고 원장 역분개·예약 복구를 건너뛰고,
   수기 송장 `voided`, FOI `shippedQty` 되돌림, FO `shippedAt` 비움, FO 투영, `ShipmentDispatchRecalled` 를 창고와 같이 낸다. 상자는 «넘김» 기록을 지닌 채
   draft 로 돌아간다(물건은 아직 입점사에 있다). 되돌린 뒤 그 줄은 다음 업로드로 다시 발송되거나 기존 취소로 취소된다.
   합포장으로 합쳐진 상자를 되돌리면 합친 상자 그대로 draft 가 된다(다시 쪼개지 않는다, 내 판단).

### 4.4 상자 수명주기 (K2 와의 접점)

- 전이표(`shipment-transitions.ts`)에 **`draft → shipped` 를 입점사 상자 전용으로** 더한다(지금 `shipped` 는 `planned` 에서만 온다).
  «입점사 상자만»은 `transitionShipments` 가 `supplier_id IS NOT NULL` 조건을 CAS 에 붙여 강제한다 — 창고 상자가 이 전이를 타면 0행이다.
- 입점사 상자가 쓰는 전이: `draft → shipped`(신규), `draft → canceled`, `draft → superseded`(합포장), `shipped → recovery_required(DISPATCH_RECALL_PENDING)`
  → `draft`(되돌리기). 나머지(`planned` 관련, `CANCEL_REPLAN_PENDING`·`CONSOLIDATION_PENDING` 대기, `in_transit`, `delivered`)는 쓰지 않는다.
  막는 방법(전이표에 상자 종류 칸, 또는 CAS 조건)은 빌더가 고른다.
- `dispatch_attempts` 의 CHECK 는 `recalled` 에도 `stock_journal_id` 를 요구한다 — §4.6 의 종류 칸으로 `dispatched`·`recalled` 둘 다 넓힌다.
- 나누기는 기존 구성 편집 문(`editShipmentManifest` 계열)을 쓴다. 입점사 상자는 예약이 없으므로 예약 재계산이 0 이어야 한다 — 빌더가 그 경로가
  예약 0 상자에서 무해한지 확인한다.

### 4.5 FO 상태 투영 (K3 본체)

- FO status 를 쓰는 곳은 **투영 하나**다. 지금 투영 호출은 둘이고 입력이 다르다:
  `shipment-reservation.service.ts:1118-1130`(확정 예약·활성 라인 수량을 넣음), `unboxed-demand-cancellation.ts:270-300`(예약 0·활성 라인 0 을 넣음 —
  그래서 부분취소 뒤 `ready` 가 `created` 로 떨어질 수 있다). 이를 **«FO id 들 → 행을 읽어 투영 → 쓰기»를 혼자 하는 함수 하나**로 모은다.
  입력(FOI 수량 사실, 활성 상자 라인 수량, 확정 예약)은 그 함수가 직접 읽는다 — 호출자가 입력을 조립하지 않는다.
- 직배 발송, 직배 상자 취소, 기존 dispatch·recall·planning 취소가 FO 수량 사실을 바꾸면 이 함수를 부른다.
- 투영 어휘(`fulfillment-progress.service.ts` 의 8개)는 바꾸지 않는다. 입점사 상자 라인은 예약이 0 이라 «예약 부족»으로 보이면 안 된다 —
  투영 입력에서 입점사 상자 라인의 수량을 «예약된 것과 같다»(창고 예약 대상 아님)로 다룬다. 정확한 방법은 빌더가 정하되, **창고분이 다 예약되고
  직배분만 남은 FO 가 `ready` 로 보여야** 한다.
- **가드 spec:** `update(fulfillmentOrders)` 의 `.set({ status` 가 투영 함수 밖에 있으면 빨강. `@CronOnce` 가드·`order-cancellation.guard.spec.ts` 와 같은 방식
  (예외 목록은 줄어드는 방향만). FOI `status` 쓰기도 같은 가드에 넣는다(지금 `fulfillments.service.ts:482` 의 `'shipped'`).

### 4.6 이벤트와 고객 화면 (G4)

**고객 추적.** `buildV2TrackingShipments`(`store-sales-orders.service.ts:827-995`)는 상자 → `dispatch_attempts` → waybill 로 송장을 찾는다.
입점사 상자는 재고 원장을 쓰지 않으므로 지금 `dispatch_attempts` 의 CHECK(`dispatched` 면 `stock_journal_id` 필수)를 통과하지 못한다.

**입점사 상자도 발송 시도 행을 만든다(내 판단).** CHECK 를 «재고 원장 또는 입점사 상자»로 넓힌다 — CHECK 는 다른 테이블을 못 보므로 시도 행에
종류 칸을 둔다. 이유: 추적 조립·`FulfillmentProgressed`·`ShipmentShipped`(둘 다 `dispatchAttemptId` 필수)를 창고와 같은 모양으로 쓸 수 있고,
아래 `ShipmentShipped` 를 내려면 어차피 필요하다. 조건: **고객 추적 화면에서 직배 상자가 창고 상자와 같은 모양(상자별 택배사·송장번호·라인)으로 나온다.**

**이벤트.**
- `FulfillmentShipped`(v1, Medusa 주문 메타데이터 투영) — FO 가 전량 발송될 때 창고와 같은 생성자 `createFulfillmentShippedV1Projection` 으로만 낸다.
  `ship()` 의 직접 enqueue 는 없어진다. 직배 상자의 실제 택배사·송장이 실린다.
- 고객 발송 알림 `SalesOrderShipmentDispatched` — 직배 상자 발송에도 나가야 한다(고객이 창고분과 같은 알림을 받는다). 스키마가 창고 전용 칸
  (`warehouseId`·`dispatchAttemptId` 등)을 요구하면 계약을 넓힌다 — §6 의 «소비자 먼저».
  **PR 3 확인: 계약 변경 불필요** — `warehouseId` 칸이 없고 `carrier` 는 문자열이며 `dispatchAttemptId` 는 입점사 시도 행(`kind='supplier'`)이 채운다.
  notification 의 택배사 표시 이름만 14개로 넓혔다.
- `ShipmentShipped` — **낸다(내 판단).** 외부 채널 발송용만이 아니다: Medusa 도 능력 표에서 `route: projection` 이라
  (`channel-capabilities.ts:71`), `shipment-dispatch-inbox.worker.ts:458` 가 이 이벤트로 Medusa `order.metadata.coreShipmentAttempts` 에 상자별 기록을 남기고,
  Medusa 자동 리뷰 자격의 «발송됨» 단계가 그 칸을 읽는다(`apps/medusa/src/scripts/lib/auto-review-eligibility.ts:82-96, 176`). 안 내면 직배 주문은 «주문 나이»
  단계로만 리뷰 자격을 얻는다. 페이로드의 `warehouseId`(UUID 필수)는 입점사 상자에 없으므로 계약을 넓힌다(창고 또는 입점사) — §6 «소비자 먼저».
- 직배 SKU 는 외부 채널에서 팔지 않는다(비목표). 빌더는 채널 주문의 직배 SKU 가 라이브에 0 인지 재고, 0 이 아니면 사용자에게 알린다.

**판매주문 단계·정체 보드·수량 사실.** 지금 FO 단위 `direct_ship_status` 를 읽는 곳(부록 A (c))은 모두 상자 기반으로 옮긴다.
- 정체 보드: 입점사 상자를 상자 단위로 판정한다. 넘기지 않은 draft → `dispatch` 단계 `drop_ship_pending`, 넘긴 draft → `track` 단계
  `drop_ship_forwarded`, 못 보냄 라인이 있음 → 새 상태(관리자 개입), shipped → `done`(배송완료 감지가 없으므로, 내 판단 — 안 그러면 영영 «추적 중 갇힘»으로 뜬다).
- K6 수량 사실(`line-quantities.sql.ts:176-179`): `forwarded` = 넘긴 입점사 상자의 미발송 라인 수량, `partner_completed` = 발송된 입점사 상자 라인 수량.
  뜻은 지금과 같다. 판매주문 단계 매핑(`fulfillment-phase.ts` `dropShipUnitPhase`: 완료→delivered, 넘김→shipping)도 **지금 동작을 유지한다**(내 판단 —
  배송완료 감지가 없어 «배송중»에서 영영 멈추지 않게). 반품 자격(`claimable`)은 여전히 0 이다(비목표와 일치).
- 정합성 점검 `ACTIVE_LINE_QUANTITY` 는 직배 FOI 에도 상자 라인이 생기므로 손대지 않고 맞게 된다. 확인만 한다.

### 4.7 취소 (K7 과의 접점, G6)

- 직배에도 상자가 생기므로 `SalesOrdersService.cancel` 은 직배 주문을 `hasBoxedFulfillment` → **상자 후 취소**(`cancelAfterBoxing` → `ShipmentPlanningService`)로 보낸다.
  지금 «알릴 취소» 행은 상자 전 경로(`UnboxedDemandCancellation.recordPartnerNotices`)에만 있다 — **상자 후 경로로 옮긴다.**
  조건은 «넘긴(넘김 기록이 있는) 입점사 상자의 라인이 취소됨». 같은 트랜잭션, 같은 취소 id(ADR-0049 PR5 방식).
- **«못 보냄»으로 보고된 라인의 취소는 알릴 취소를 남기지 않는다** — 입점사가 먼저 알려 준 것이다(사용자 승인, 세부는 내 판단).
- 발송된 입점사 상자 라인은 취소할 수 없다(지금 창고 상자와 같은 규칙). 잘못 반영된 발송이면 먼저 되돌리고(§4.3-9) 취소한다. 반품은 비목표.
- 입점사 상자 라인 취소는 예약 해제가 없다. 상자 후 취소 경로가 예약 0 상자에서 무해한지 빌더가 확인한다.
- 직배 판단 때문에 K7 커널(`OrderCancellation`)의 인터페이스는 바뀌지 않아야 한다. 바뀌어야 하면 그 자체를 설계 신호로 보고 사용자에게 알린다.

### 4.8 창고 흐름에서 빼기 (반목표 지키기)

입점사 상자는 `warehouse_id` 가 NULL 이라 창고로 거르는 조회에서는 저절로 빠진다. **창고로 거르지 않는 조회가 위험하다.** 빌더는 착수 때
`shipments`·`shipment_lines` 를 읽는 조회를 전수하고, 다음은 반드시 입점사 상자를 뺀다: 예약·예약 재시도 워커(`FulfillmentOrderReservationRetryWorker`),
계획 확정(`plan`), 할당·배치·합배송·피킹, 한진 채번·라벨 인쇄, dispatch, 재고 원장, 상자 분할 화면의 예약 몫. 지금 `drop_ship`/`drop_shipped` 로
거르는 가드(부록 A (h))는 판별자를 `supplier_id` 로 바꾸거나 «입점사 상자는 이 함수에 오지 않는다» 불변식으로 대체한다.
가드 spec 하나를 둔다: 창고 흐름의 진입 함수들이 입점사 상자를 받으면 throw 하는지.

### 4.9 관리자 화면 (admin-web)

기존 «직배송 운영»(`app/(admin)/order/direct-ship`)을 고친다. 화면 이름의 «업체»는 «입점사»로.
- **대기:** 입점사별 넘기지 않은 상자 수, 입점사 하나 선택 → 엑셀 내려받기(= 넘김).
- **넘긴 것:** 넘김 묶음별 진행(발송·아직·못 보냄 수), 다시 받기.
- **올리기:** 파일 → 미리보기(줄별 판정) → 적용.
- **못 보냄:** 입점사별 못 보냄 라인, 주문으로 가는 링크(취소는 기존 주문 취소 화면에서).
- **알릴 취소:** 그대로(업체 → 입점사).
- 옛 «Forward(업체 이름 입력)»·«Complete(completedBy 입력)» 버튼과 FO 상세 «직배» 탭의 같은 버튼은 없앤다.
- 권한·PII: 내려받기 파일은 고객 이름·연락처·주소를 담는다 — 기존 내보내기와 같은 권한(`order.order.export`)과 ADR-0048 의 PII 규칙(`@PiiResponse`·접속기록)을
  따른다. 올리기는 새 쓰기 라우트(`fulfillment.order.write`). 화면은 `screen-access.ts`·`mutation-guard` 규칙을 따른다.

## 5. 빌더에게 맡기는 것

- PR 나누기와 순서(§6 의 단계 제약 안에서)
- 칼럼 이름, 넘김 묶음을 테이블로 둘지 칼럼으로 둘지
- 엑셀 열 순서·머리글 문구·택배사 이름 별칭 표, 추가할 택배사 목록
- 입점사 상자를 창고 전용 전이에서 막는 방법(§4.4)
- 투영에서 입점사 상자 라인을 «예약 대상 아님»으로 다루는 방법(§4.5)
- 정체 보드 «못 보냄» 상태의 이름·갇힘 기준
- ADR: «직배는 입점사 상자»(ADR-0027 의 직배 예외를 대체) 하나를 쓴다. ADR-0049 의 «알릴 취소는 상자 전 출고 명령이 쓴다» 문장은 이 ADR 이 고친다.

## 6. 배포 순서 제약

- **expand** (additive: `shipments.supplier_id`, `warehouse_id` NULL 허용, CHECK, 라인 «못 보냄» 칸, 넘김 기록, 알릴 취소의 supplier FK, `carrier` enum 값 추가) — `migrate → deploy`.
- **이벤트 계약의 enum·칸 추가는 소비자 먼저 배포한다.** 소비자가 zod 로 검증하고 모르는 값이면 throw 한다(channel-adapter, notification).
  `carrier` 에 새 값을 넣는 PR 은 소비자 배포가 끝난 뒤에야 core 가 그 값을 낼 수 있다.
  **SST 한 스택은 컴포넌트 순서를 못 정한다(`--target` 도 이 저장소에선 못 쓴다)** — 그래서 «소비자 먼저»는 배포 한 번 안에서가 아니라
  **배포 둘 사이**에서 지킨다. PR 3 은 계약·소비자만 넓히고 core 는 옛 6개 택배사·`warehouseId` 출처만 낸다(`CONSUMER_ROLLOUT_CARRIERS`).
  core 가 새 값·`supplierId` 출처를 내는 것은 PR 3 라이브 뒤의 PR 5 다(PR 3 계획 E3, 2026-10-25).
- **contract** (`direct_ship_status` 칸 drop, ~~fulfillment_status `'shipped'` 값 제거~~ (**`'shipped'` 는 셀메이트 스크립트가 써서 남겼다 — PR 8 N1, 셀메이트 컷오버 #923 때 걷는다**), 옛 직배 서비스 경로 삭제, `holders` FK 제거) — 별도 PR,
  사이에 배포 한 번 이상, `deploy → migrate`. enum 값 제거는 Postgres 에서 타입 재생성이라 빌더가 스크래치 DB 에서 먼저 돌린다
  (메모: drizzle DROP 순서 함정).
- 배포는 묶음 배포 방침(CLAUDE.md, `npm run deploy:preflight`)을 따른다.
- **개통은 입점사 단위다(사용자 승인).** 직배 상품은 아직 새 시스템에 올라가지 않았다(사용자, 2026-10-25) — 옮길 기존 데이터가 없다.
  순서: 공급사 등록(`is_direct_delivery`) → SKU 를 `drop_shipped` + 입점사 연결로 등록 → 쇼핑몰 게시. **한 입점사는 셀메이트와 새 시스템 중 한쪽에만 있다**
  — 같은 주문이 두 번 가지 않게. 계획에 운영자용 개통 점검표를 넣는다. 위험: 직배 상품을 `physical` 로 잘못 등록하면 창고 FO 가 없는 재고를
  기다리며 멈춘다 — 점검표 항목으로 둔다.
- 착수 전 라이브 실측(터널은 사용자가) — 위 사실 확인용, 0 이 기대값이다: `drop_shipped` SKU 수·직배 공급사 연결 없는 수, `fulfillment_mode='drop_ship'` FO 수, `direct_ship_cancel_notices` 행 수,
  채널 주문 중 직배 SKU 수. 하나라도 0 이 아니면 그 행의 이행(백필·종결)을 계획에 넣는다.

## 7. PR 나누기

PR 마다 계획서를 따로 쓴다(`docs/superpowers/plans/2026-10-25-k3-…-prN.md`). **개통(첫 입점사 등록)은 PR 1~7 이 모두 라이브가 된 뒤다** —
그 전까지는 직배 SKU 가 라이브에 0 이라 PR 4~6 은 휴면이다.

| PR | 내용 | 배포 | 마이그 |
|---|---|---|---|
| 1 | **FO 투영 하나**(§4.5): 투영 함수 하나로 모으고 FO·FOI status 직접 쓰기 가드. 남은 예외는 옛 직배 생성·`ship()` | Core | 없음 |
| 2 | **입점사 상자 expand**(§4.1·§4.2·§4.8): 스키마 추가, SKU 직배 입점사 규칙, 창고 흐름 진입점의 입점사 상자 거부 가드 | Core | expand, `migrate → deploy` |
| 3 | **이벤트 계약 넓히기**(§4.6·§6): `ShipmentShipped` 의 창고/입점사 출처, `carrier` 새 값, 소비자(외부 채널 manual·알림 택배사 이름) | services 한 번(순서 무관 — core 는 아직 새 값을 내지 않는다) | 없음 |
| 4 | **FO 생성이 입점사 상자를 만든다**(§4.3-1) + 읽는 쪽을 상자 기반으로(정체 보드·K6 수량 사실·판매주문 단계·직배 목록), «섞이면 거절» 제거 | Core | 없음(필요하면 expand) |
| 5 | **직배 발송 명령**(§4.3-3~9·§4.4·§4.6): 내려받기=넘김, 올리기 미리보기/적용, 발송·합포장·정정·못 보냄, 이벤트, 되돌리기 갈래, `CONSUMER_ROLLOUT_CARRIERS` 문 제거 | Core(PR 3 라이브 뒤) | 없음 |
| 6 | **취소**(§4.7): 알릴 취소를 상자 후 경로로, 못 보냄 억제, 입점사 FK | Core | 없음 |
| 7 | **admin-web**(§4.9·§4.2): 직배 화면 개편, SKU 폼 입점사 | admin-web | 없음 |
| 8 | **contract**(§6): `direct_ship_status`·~~FO `'shipped'` 값~~(셀메이트 스크립트가 써서 남겼다 — PR 8 N1)·옛 직배 경로·`holders` FK 제거 | Core, `deploy → migrate` | contract |

**PR 5 구현자에게(PR 3 이 정한 것):**
- PR 5 는 **PR 3 라이브(배포 태그) 확인 뒤에만** 배포한다. 그 전에 core 가 새 택배사·`supplierId` 를 내면, 아직 옛 버전인 소비자가 zod 로 throw 한다.
- 🔴 **PR 5 라이브 뒤에는 channel-adapter·notification 을 PR 3 이전으로 롤백하지 않는다** — 새 값을 거절해 DLQ 로 간다.
- 외부 채널(네이버·쿠팡) 발송은 «입점사 출처» 또는 «옛 6개 밖 택배사»면 manual 이다(PR 3 E4). 창고 수기 송장을 새 택배사로 열려면 어댑터 택배사 표부터 넓혀야 한다 — 네이버는 모르는 코드를 CJGLS 로 바꿔 보낸다.
- 고객 추적 링크는 새 8개가 `null` 이다(PR 3 E5). 실물 송장으로 URL 을 확인해 `buildTrackingUrl` 에 더한다.

**PR 5 구현자에게(PR 4 가 정한 것):**
- 발송 명령은 FOI `shipped_qty` 를 써야 한다 — K6 사다리의 `delivered`(발송된 입점사 상자)가 미결 0 을 요구한다.
- 합포장(한 입점사 상자에 여러 주문): 직배 목록 읽기는 상자 단위 `salesOrderId`·`orderNo` 만 낸다. 합포장이면 라인별 주문 칸이 필요하다.
- 정체 보드에서 회수 대기 입점사 상자(recovery_required + DISPATCH_RECALL_PENDING)는 복구 갈래가 먼저 잡아 `unclassified/<code>` 로 보인다. 원하는 운영자 화면인지 정한다.
- 직배 목록은 `GET /direct-ship/supplier-queue`(입점사별 대기·넘김·못 보냄 수)와 `GET /direct-ship/supplier-queue/:supplierId/shipments?stage=pending|forwarded`다. 고객 개인정보가 없다 — 수령인은 내려받기에만 둔다.
- 내려받기·넘김은 `recovery_code IS NOT NULL` 인 상자를 넘기지 않는다 — 직배 목록은 recovery_required 상자를 열린 것(N6 의 대기·넘김)으로 세지만 보드는 취소·재계획 상자를 `cancel` 로 보여 준다.
- K6 `forwarded` 는 «못 보냄» 라인을 포함해 고객에게 「배송 중」으로 보인다 — 입점사가 못 보낸다고 한 라인이 그렇게 보여도 되는지 정한다.

## 부록 A. 지금 직배를 특별 취급하는 곳

2026-10-25 탐색 결과. 착수 때 다시 잰다: `grep -rnE "drop_ship|drop_shipped|directShip|direct_ship" apps/core/src apps/admin-web/src --include=*.ts --include=*.tsx | grep -v '\.spec\.'`

- **(a) FO 생성·분기:** `fulfillments.service.ts:121, 179-199, 262-275, 288-357`(직배 전용 생성 `createFulfillmentOrderFromItems`, 창고 기본값은 `fulfillment-order-creation-backlog.worker.ts:117-126`)
- **(b) 상태 쓰기:** `direct-ship.service.ts:272-356`(넘김·완료), `fulfillments.service.ts:446-534`(`ship()`), `:536-555`(`adminAvailableActions`)
- **(c) 읽기·통계:** `direct-ship.service.ts:101-515`, `direct-ship.controller.ts`, `sales-orders.service.ts:755-768, 1059-1134`(필터·카운트), `line-quantities.sql.ts:176-179` 와 그 독자(`line-quantities.reader.ts`, `order-fulfillment-phase.sql.ts`, `self-cancel-block.ts`), `fulfillment-phase.ts`, `store-sales-orders.service.ts:700-735`, `order-progress.judge-sql.ts:124-131`, `order-progress.thresholds.ts:52-53`
- **(d) 이벤트:** `fulfillments.stream.ts:81-96, 141-145`, `fulfillments-v2.stream.ts:53-79`, channel-adapter `fulfillment-events.consumer.ts:37-69` → `inbox-worker.service.ts:486-524`(Medusa 메타데이터 병합만)
- **(e) 취소:** `unboxed-demand-cancellation.ts:14, 101, 129, 134-178, 270-300`, `sales-orders.service.ts:1257-1290`, `direct-ship-cancel-notice/`, `channel-order-change.reader.ts:90-104`
- **(f) admin-web:** `app/(admin)/order/direct-ship/page.tsx`, `features/order/direct-ship/**`, FO 상세 `direct-ship-tab.tsx`, `lib/api/domains/orders/direct-ship.client.ts`, 훅(`lib/services/orders/queries.ts`·`mutations.ts`), `order-progress.shape.ts:237-240`, `line-composition-view.ts:33-39`, SKU 폼
- **(g) 스키마:** `inventory.schema.ts:122, 206, 215, 1737, 1776-1818`, 마이그 `20261024021515_add-direct-ship-cancel-notices.sql`, 계약 `fulfillments.stream.ts:12, 129`
- **(h) 창고 흐름 가드:** `shipment-planning.service.ts:1732-1745`, `allocation.locks.ts:198-215`, `outbound-batch-orchestrator.service.ts:1216-1256`, `consolidation.service.ts:953-983`, `line-composition-edit.manager.ts`·`.reader.ts`

**PR 6 구현자에게(PR 5 가 정한 것):**
- 상자 후 취소가 입점사 상자 라인을 줄일 때 «못 보냄» 기록이 있는 라인은 알릴 취소를 남기지 않는다(§4.7) — 판별은 라인의 `unfulfillable_*` 칸.
- 발송된 입점사 상자 라인은 취소할 수 없다. 먼저 되돌린다(PR 5 의 입점사 되돌리기).
- 합포장 상자는 여러 판매주문을 담는다 — 한 주문만 취소하면 그 주문 라인만 줄어야 한다.

**PR 7 구현자에게(PR 5 가 정한 것):**
- 시트는 JSON(`columns`·`rows`)으로 온다 — XLSX 는 admin-web 이 만든다. 머리글은 응답 `columns` 그대로, 내려받기에는 `X-Pii-Export-Reason` 헤더를 입력받는다.
- 넘김 응답의 `skippedShipments`(수령인 불완전로 넘기지 못한 상자)를 반드시 보여 준다. 그 상자는 고칠 때까지 대기로 남는다.
- 올리기 화면은 미리보기 판정·오류 코드를 한국어 문구로 풀고, 적용은 미리보기 토큰과 같은 파일로 부른다.
- 넘김 묶음별 발송·아직·못 보냄 수 읽기가 없다 — 필요하면 core 읽기 하나를 같이 만든다.
- 되돌리기 버튼에서 입점사 상자는 «회수 확인» 문구를 «입점사와 확인»으로 바꾼다.
- FO 상세 `shipments[]` 에 `supplierId`·`supplierLineQty` 가 없다. 상자 상세(`getShipmentDetail`)는 입점사 라인을 예약 0 으로 보이니 «미예약»으로 그리지 않는다.
- 직배 목록 읽기는 상자 단위 주문 칸만 낸다. 되돌린 합포장 상자가 다시 목록에 나오면 라인별 주문이 필요하다.

**PR 8 구현자에게(PR 5 가 정한 것):** 옛 `direct-ship.service.ts`·`ship()`·`computeAdminAvailableActions`·옛 시트 라우트(`POST /direct-ship/export/file` 류)와 `PII_EXPORT_EXCEPTIONS` 의 `/direct-ship/export/:companyName` 을 지운다. 정정은 이벤트를 다시 내지 않아 Medusa 메타데이터·고객 문자가 옛 번호로 남는다 — 정정이 잦으면 계약을 넓혀 다시 낸다.

**PR 7 구현자에게(PR 6 이 정한 것):**
- 「알릴 취소」 탭은 행의 `supplierId` 로 묶고 내려받기·완료에 `{ supplierId, noticeIds }` 를 보낸다 — 옛 `companyName` 본문은 400 이다. 목록 쿼리도 `?supplierId=`(uuid). 머리글은 `companyName`(입점사 이름) 그대로 써도 된다. CSV 는 서버가 만든다(개인정보 없음, 열은 입점사 시트의 행 키·주문번호·상품명·공급사 상품코드 + 취소 넷).
- 「못 보냄」 화면에서 취소로 가는 링크 — 못 보냄 라인의 취소는 알릴 취소를 남기지 않는다고 문구로 알려도 된다(입점사가 먼저 알려 온 것).

**PR 8 구현자에게(PR 6 이 정한 것):** `direct_ship_cancel_notices.holder_id` 칸·FK·`ck_direct_ship_cancel_notices_party` 를 `supplier_id NOT NULL` 로 좁힌다(`deploy → migrate`, 스크래치 DB 먼저). 읽기는 이미 `suppliers` 만 조인한다. `seedFo({ dropShip })` 픽스처의 옛 직배 갈래도 함께.

**PR 8 구현자에게(PR 7 이 정한 것):**
- admin-web 은 옛 `/direct-ship/{dashboard,companies,orders…,export…}` 를 더는 부르지 않는다 — 서버 쪽을 지워도 된다.
- PR 7 이 `GET /direct-ship/suppliers/:supplierId/handoffs` 를 더했고, 넘김 POST 는 `x-pii-export-reason` 을 먼저 확인한다(`readPiiExportReason`, `libs/authorization`). 옛 라우트를 지울 때 이 둘은 지우지 않는다.
- FO 목록의 `drop_ship` 배지·`fo-status-cell` 라벨·`FulfillmentMode` 의 `drop_ship` 은 FO 모드를 걷을 때 같이 걷는다.
- N9 공급사 상품코드는 미결이다.
- PR 7 이 손대지 않은 것 ① 섞인 FO 에서 라인 구성 편집 버튼(`canEditLineComposition`)이 FO 모드로만 갈려 입점사 라인에도 떠서 서버가 `DROP_SHIP_NOT_SUPPORTED` 로 거절한다.
- PR 7 이 손대지 않은 것 ② 직배 목록은 상자 단위 주문 칸만 내므로, 내 되돌린 합포장 상자가 대기에 다시 오면 주문 하나로만 보인다.
