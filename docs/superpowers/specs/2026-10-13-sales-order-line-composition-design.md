# 판매주문 라인 구성 — 주문별 매칭과 작성 중 박스 맞추기 (#1016 14번 행)

트래킹: #1016 14번 행(«매칭안됨» 필터가 resolve·void 로 해소된 주문도 계속 «매칭안됨»). 이 스펙은 그 행을 넘어선다 —
행을 조사하다 «주문 라인별 매칭»이라는 원래 의도가 코드에서 한 번도 동작하지 않았음이 드러났다(§1).
관련: S1 스펙 `docs/superpowers/specs/2026-09-29-outbound-live-allocation-design.md` §7.3(S2 로 넘긴 `amendBox`),
#986 스펙 `docs/superpowers/specs/2026-09-30-outbound-allocation-before-label-design.md` E2·E11.

## 1. 배경 — 라인별 매칭은 설계만 있고 동작한 적이 없다

의도(사용자, 2026-10-13): 상품매칭을 바꿔도 이미 진행 중인 주문은 몰래 바뀌지 않아야 하고, 같은 판매상품이라도 주문 라인마다
다른 매칭을 쓸 수 있어야 하며, 특정 주문의 매칭만 고칠 수 있어야 한다. 그래서 `sales_order_lines` 에 매칭 칸을 따로 뒀다.

실제:

| 장치 | 지금 | 근거 |
| --- | --- | --- |
| `sales_order_lines.product_matching_id` | 주문 생성 경로가 **넘기지 않아** 모든 라인이 NULL 로 태어난다. 채우는 곳은 «SKU 연결 저장» 하나뿐이고 그마저 **그 variant 의 모든 라인을 덮어쓴다**(출고된 과거 주문 포함). 게다가 `product_matchings` 는 variant 당 한 행(`unique(variantId)`)이라 이 칸은 내용이 아니라 «바뀌는 행의 주소»다 — 라인마다 다른 매칭을 담을 수 없다 | `sales-orders.service.ts` `convertOrderItems`, `product-sku-mapping.service.ts` 의 `update(salesOrderLines).set({ productMatchingId })`, `inventory.schema.ts` `productMatchings.uniqueVariantId` |
| `sales_order_lines.mapping_snapshot_id` | FO 생성이 이 스냅샷을 현재 매칭보다 먼저 쓰지만, 스냅샷을 찍는 유일한 곳(`confirm(id, warehouseId)`)에 창고를 넘기는 호출자가 없다 — **항상 비어 있다**. 스냅샷 테이블은 지금의 상품매칭이 아니라 옛 창고별 버전제 «SKU 매핑»(`product_sku_mappings`) 모델에서 나왔다 | `sales-orders.controller.ts` `confirm`, `product-sku-mapping.service.ts` `createSnapshotForVariant` |
| 실제로 매칭이 굳는 곳 | **FO 생성 순간.** `buildItemsFromSalesOrder` 가 그때의 상품매칭으로 FO 항목(SKU×수량)을 만든다. 그 뒤 매칭이 바뀌어도 그 FO 는 안 바뀐다. FO 전 주문은 최신 매칭을 따른다 | `fulfillments.service.ts` `buildItemsFromSalesOrder` |
| 14번 행의 필터 | `product_matching_id IS NULL` 라인이 있으면 «매칭안됨» — 위 이유로 사실상 거의 모든 주문이 걸린다. resolve·void 는 라인을 건드리지 않으니 그 경로로 푼 주문은 영원히 남는다 | `sales-orders.service.ts` `typeGroup: 'unmatched'` |
| 특정 주문의 매칭 수정 | API 없음 | — |

발상(라인별로 굳힌다)은 옳았다. 굳히는 **자리**(바뀌는 행을 가리키는 주소)와 **시점**(호출되지 않는 확정)과 **수정 불가**가 틀렸다.

## 2. 목표와 성공 기준

1. 판매주문 라인마다 «적용 구성»(SKU × 1개당 수량)이 기록으로 남고, 그 기록이 있으면 상품매칭보다 우선한다
2. 운영자가 FO 생성 **전**에 라인 하나를 1회성으로 특정 SKU 로 지정할 수 있다 — 상품매칭을 만들지 않고 그 주문의 매칭 대기가 풀린다
3. 운영자가 FO 생성 **뒤**에 라인 하나의 구성을 바꿀 수 있다 — 그 라인이 담긴 박스가 모두 작성 중(`draft`)일 때만
4. 상품매칭을 바꿔도 기본으로는 이미 굳힌 라인이 바뀌지 않는다. 운영자가 고르면 «기존 출고에도 적용»으로 일괄 반영되고,
   개별 지정 라인과 작업 중 박스는 건너뛰며 그 건수를 보여 준다
5. «매칭안됨» 필터(14번)와 «매칭체크» 페이지가 1회 지정·resolve·void 로 풀린 라인을 미매칭으로 보이지 않는다
6. 박스 목표 내용을 계산하는 함수가 하나다 — S2(주문 수정 → 출고 전파)가 같은 함수와 같은 실행부를 쓴다
7. `npm run type-check` 에러 0 · `npx jest` 실패 0 · admin-web `tsc --noEmit` 0

## 3. 결정 (사용자 결정 2026-10-13)

| # | 질문 | 결정 | 기각한 안과 이유 |
| --- | --- | --- | --- |
| D1 | 라인별 구성은 언제부터 지정 가능한가 | **FO 생성 전후 모두.** 상품매칭을 아직 만들고 싶지 않지만 들어온 주문은 내보내야 하는 1회성 지정이 필요하다 | FO 생성 뒤만: 매칭 대기 주문을 풀려면 상품매칭을 만들어야 한다 |
| D2 | 구성을 어디에 기록하나 | **새 테이블 `sales_order_line_compositions` + 라인의 출처 칸** | 옛 스냅샷 재활용: 창고에 묶이고(`warehouse_id` NOT NULL) 옛 «SKU 매핑» 모델에서 나왔으며 구성이 JSON 덩어리이고 출처 칸이 없다 — 세 번째 매칭 개념을 끌고 간다 / FO 항목에서 역산: FO 전 1회 지정(D1)을 담을 곳이 없다 |
| D3 | 일괄 적용이 운영자 개별 지정 라인을 만나면 | **건너뛴다.** 미리보기에 건수로 보인다 | 덮어쓰기: 개별 지정은 «이 주문은 일부러 다르게»라는 뜻이다 / 매번 고르기: 쓰일 일 없는 선택지 |
| D4 | 주문별 지정에 «발송 안 함»(void)을 두나 | **SKU 지정만.** | void 포함: «안 보낸다»는 매칭이 아니라 부분 취소·외부 처리에 가깝다. 매칭 수정에 섞으면 출고 수량과 환불·정산이 어긋난다 |
| D5 | 확정(`planned`)·배치 투입 박스는 | **작성 중 박스만 바꾼다.** 그 밖은 거절(주문별)·건너뜀(일괄). 운영자가 기존 «빼기»로 draft 로 돌린 뒤 다시 한다 | 피킹 전이면 자동 빼기: 송장 무효화·배치 변동이 매칭 수정의 부수효과가 되고, 일괄 적용 한 번이 배치 여럿을 흔든다 |
| D6 | 피킹이 시작된 박스 | **범위 밖.** D5 가 이미 막는다 | — |
| D7 | S2 와 부품을 공유하나 | **공유한다.** 박스 목표 = «라인별 담긴 개수 × 라인 구성». 매칭 수정은 구성을, S2 는 개수를 바꾼다 — 같은 계산의 두 입력이라 의미상 동치다 | 따로 만들기: «박스에 무엇이 들어가야 하나»의 정의가 두 벌이 되고, S2 가 수량을 다시 계산할 때 상품매칭으로 되돌아가 운영자 지정을 조용히 지운다 |
| D8 | 14번 필터의 기준 | **«`awaiting_matching` FO 생성 대기열이 열린 주문».** 대기열은 판정 함수(§5)의 결과다 | 라인 칸 백필: 사본이 다시 갈린다 / 판정을 SQL 로 한 벌 더: 매칭체크 페이지의 사본과 합쳐 셋이 된다 |

## 4. 데이터 모델

### 4.1 `sales_order_lines` 에 칸 셋 (additive)

| 칸 | 타입 | 뜻 |
| --- | --- | --- |
| `composition_source` | `varchar(16)` NULL, CHECK `IN ('matching','operator')` | NULL = 아직 굳히지 않음, 현재 상품매칭을 따른다. `matching` = FO 생성이 상품매칭에서 복사해 굳힘. `operator` = 운영자 지정 |
| `composition_set_at` | `timestamptz` NULL | 굳힌 시각 |
| `composition_set_by` | `uuid` NULL | 운영자 id. `matching` 이면 NULL |

### 4.2 새 테이블 `sales_order_line_compositions`

| 칸 | 타입 | 비고 |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `sales_order_line_id` | `uuid` NOT NULL → `sales_order_lines.id` ON DELETE CASCADE | |
| `sku_id` | `uuid` NOT NULL → `skus.id` ON DELETE RESTRICT | |
| `qty_per_unit` | `integer` NOT NULL, CHECK `> 0` | 판매 1개당 SKU 수량 |
| `created_at` | `timestamptz` NOT NULL default now | |

UNIQUE `(sales_order_line_id, sku_id)`. 예: «A×2 + B×1» = 두 행. 현재 값만 들고, 이력은 amendment 가 든다(§7.4).

### 4.3 불변식

**`composition_source IS NOT NULL` ⇔ 구성 행 ≥ 1.** 테이블을 건너는 조건이라 DB CHECK 로 못 건다. 그래서:

- 이 두 곳을 쓰는 코드는 `LineCompositionManager` 하나뿐이다(FO 생성의 굳히기도 이걸 부른다)
- 굳히기는 «`composition_source IS NULL` 일 때만» 조건부로 쓴다(`matching` 굳히기). 운영자 지정은 출처를 덮어쓴다
- 불변식 스펙이 위반 행 0 을 확인한다(통합)

### 4.4 채우지 않는 라인

디지털 라인(FO 대상 아님)과 상품매칭이 void 인 라인은 박스에 들어가지 않으므로 굳히지 않는다(출처 NULL 유지).
**알고 남기는 것:** FO 를 만든 뒤 상품매칭이 void → 실물로 바뀌어도 그 라인은 FO 에 들어가지 않는다. 지금 동작과 같고 범위 밖이다.

## 5. 판정 — 함수 하나, 소비자 다섯

### 5.1 순수 함수

`resolveLineComposition(line, frozenRows, variantMatching)` →

| 결과 | 조건 | 쓰는 구성 |
| --- | --- | --- |
| `frozen` | 출처 NOT NULL | 구성 행 |
| `follow` | 출처 NULL, 상품매칭이 실물 SKU 로 해결(`physicalSkuLinks` > 0) | 상품매칭 링크 |
| `void` | 출처 NULL, 상품매칭 void(`isVoidMatching`) | 없음(박스 제외) |
| `missing` | 그 밖 | 매칭 대기 |

`follow`·`void` 판정은 기존 `fulfillable-matching.ts` 를 그대로 쓴다. 디지털 라인은 다섯 번째 결과 `digital` 로 따로 낸다.
그 앞에 «주문 하나의 라인을 전부 읽어 이 함수를 돌리는» `LineCompositionReader.resolveForOrder(salesOrderId, tx)` 를 둔다.
리더는 라인마다 **유효 수량**(주문 수량 − 부분 취소)도 함께 낸다 — FO 생성과 리컨실러가 «전량 취소된 미매칭 라인은 막지 않는다»를
같은 값으로 판정해야 하기 때문이다(계획 단계에서 정함). 아래 소비자는 이 리더만 부른다.

### 5.2 SQL 술어 — 목록 화면용, TS 와 한 쌍

목록(매칭체크 페이지·주문 목록)은 SQL 로 판정해야 해서 «라인이 해결됐나» 술어 `lineResolvedSql()` 을 리더 옆에 둔다. 조인 없이
상관 서브쿼리로 상품매칭을 읽는다(조인을 요구하면 쓰는 쿼리마다 모양이 갈린다):
`composition_source IS NOT NULL OR (상품매칭 matched AND (strategy = 'void' OR (strategy = 'variant' AND 링크 존재)))`.
**같은 픽스처로 TS 판정과 SQL 술어가 같은 답을 내는지 확인하는 통합 스펙**을 붙인다 — 둘이 갈리면 이 스펙이 빨개진다.

### 5.3 소비자

| # | 자리 | 바뀌는 것 |
| --- | --- | --- |
| 1 | FO 생성 `buildItemsFromSalesOrder` | 리더로 판정. `missing` 이 있으면 지금처럼 `awaiting_matching` — 단 **`waitingVariantIds` 는 `missing` 라인들의 variant 만**. `follow` 라인은 같은 트랜잭션에서 `matching` 으로 굳힌 뒤 그 구성으로 FO 항목을 만든다. 옛 스냅샷 분기 삭제 |
| 2 | 리컨실러 12번 `wake-awaiting-matching.rule.ts` | `check` 를 «기다리는 variant 의 상품매칭이 모두 해결»에서 **«리더 결과에 `missing` 없음»**으로. `fingerprint` 도 리더 결과(라인별 결과·구성)로. 안 바꾸면 1회 지정으로 풀린 주문을 상품매칭 기준으로 «안 풀림» 판정한다 |
| 3 | 매칭체크 `getOrderLines` (`excludeMatched`) | 사본 SQL 을 `lineResolvedSql()` 로 교체. 행에 출처 표시용 칸(`compositionSource`) 추가 |
| 4 | 14번 필터 `typeGroup: 'unmatched'` | `awaiting_matching` 대기열이 열린 주문(D8) |
| 5 | 주문 목록 라인 배지 «매칭 대기» (admin-web `isOrderLineMatched`) | 라인의 `productMatchingId` 대신 core 가 내려주는 `matchingResolved`(= `lineResolvedSql()`)를 본다. 판매주문 목록·상세 응답의 라인에 칸 추가. **PR 1 이 옛 칸 쓰기를 멈추므로 같은 PR 에서 바꿔야 한다** — 안 그러면 모든 라인이 «매칭 대기»가 된다(계획 단계에서 찾음) |

깨우기 경로:

- 상품매칭 저장 → `wakeBacklogsWaitingForVariant`(variant 단위) — **그대로.** 깨워진 주문은 FO 생성이 다시 판정하므로 넓게 깨워도 안전하다
- 운영자 1회 지정 → 같은 트랜잭션에서 `requeueAwaitingMatching(salesOrderId)`(기존 함수)

### 5.4 경합

운영자 지정과 FO 생성이 같은 라인을 동시에 굳힐 수 있다. **둘 다 판매주문 행을 먼저 잠근다**(6번 행 «판매주문 잠금 먼저»).
`matching` 굳히기는 출처 NULL 조건부라, 운영자가 먼저 굳혔으면 FO 생성은 그 구성을 읽는다.
FO 생성(`createV2`)은 이미 판매주문을 `FOR UPDATE` 로 잠근 뒤 라인을 읽는다(계획 단계에서 확인). 그래서 같은 트랜잭션 안에서
조건부 굳히기가 0행이면 경합이 아니라 불변식 위반이다 — 조용히 넘기지 않고 던진다.

## 6. 공유 부품 — 박스 목표와 작성 중 박스 맞추기

### 6.1 `boxTarget` (순수 함수)

`boxTarget(unitsByLine: Map<lineId, number>, compositionByLine: Map<lineId, {skuId, qtyPerUnit}[]>)` →
`{ salesOrderLineId, skuId, qty }[]` (qty = 담긴 개수 × qtyPerUnit, 0 인 항목 제외).
매칭 수정은 `compositionByLine` 을 바꿔 부르고, S2 는 `unitsByLine` 을 바꿔 부른다.

### 6.2 «박스에 담긴 개수»

라인이 여러 박스로 나뉠 수 있다(`split`). 박스별 담긴 개수 = 그 박스에서 그 라인의 옛 SKU 줄 수량 ÷ 옛 구성의 1개당 수량.
옛 구성 SKU 마다 같은 값이 나와야 하며, 나눠떨어지지 않거나 SKU 마다 다르면 `COMPOSITION_UNITS_AMBIGUOUS` 로 거절한다.
옛 구성은 굳힌 구성 행이다 — 그래서 굳히지 않은(백필 전) FO 라인은 이 계산을 못 한다(§9.1 백필 전 공백).

### 6.3 `DraftBoxAmender.amend(shipmentId, target, reason, actor, tx)`

박스가 `draft` 가 아니면 `BOX_NOT_DRAFT`. 지금 줄과 목표를 `(salesOrderLineId, skuId)` 로 비교한다.

| 차이 | 처리 |
| --- | --- |
| 같은 FO 항목 줄이 있고 늘어남 | 줄·FO 항목 수량 증가 → 차이만큼 `reservePartial` |
| 새 `(라인, SKU)` | FO 항목 + 상자 줄 생성 → `reservePartial`. **지금 없는 경로 — 새로 만든다** |
| 줄어듦·빠짐 | `applyDraftCancellation` 의 «예약 해제 → 줄 감소 또는 묘비 이동»을 함수로 떼어 같이 쓰고, FO 항목은 **`qty` 를 줄인다(0 허용)** — `canceledQty` 를 쓰지 않는다(아래) |

**줄어든 수량을 `canceledQty` 로 적지 않는다(사용자 결정 2026-10-13, 계획 단계에서 찾음).** `canceledQty` 는 «고객 취소»로 읽힌다:
출고 완료 판정이 `미출고 0 && canceledQty === 0` 이라(`shipment-dispatch.service.ts` `loadFulfillmentSummaries`) 구성을 바꾼 FO 는
`FulfillmentShipped` 가 영영 안 나가고 Medusa 주문이 «출고됨»이 되지 않는다. FO 항목 `qty` 는 «이 SKU 의 수요»이므로 줄이면
미출고 수량을 읽는 곳이 전부 그대로 맞는다. SKU 가 통째로 빠지면 `qty` 가 0 이 될 수 있어 CHECK `qty > 0` 을 `qty >= 0` 으로
완화한다(마이그 1건, `migrate → deploy`). qty 0 항목 = «구성 변경으로 대체된 항목»: 불변식·정합성 SQL·진행 계산이 받아들인다.
그 전에 고객 취소분이 있었다면 `qty` 는 그 취소분까지만 줄어 `qty = canceledQty` 로 남는다.

마무리: 재고 키 잠금은 SKU 정렬 순서로 먼저(`acquireStockAvailabilityLocks`, FO 생성과 같은 규칙) · 박스는 `draft` 유지 ·
`manifestVersion` +1 · FO 합계(`totalItems`·`totalQty`) 재계산 · 배송 프로필 재계산(FO 생성과 같은 함수로 뽑아 공유) ·
`reservations.recompute` · 박스 오퍼레이션 기록(종류 `'amend'` 신설, before/after 스냅샷).

박스 가드는 분할(`split`)과 같다: `draft` 가 아니면 `BOX_NOT_DRAFT`, 활성 작업 항목·보관(custody)·활성 송장이 있으면 그 코드
(`SHIPMENT_ACTIVE_WORK_ITEM`·`SHIPMENT_CUSTODY_EXISTS`·`SHIPMENT_ACTIVE_INVOICE`). 상태만 `draft` 인 박스가 작업에 묶여 있을 수 있다.

### 6.5 고객 취소 경로가 비율을 라인 구성에서 읽는다

`sales-orders.service.ts` `planV2Outstanding`(부분·전체 취소 계획)은 SKU 비율을 «FO 항목 수량 ÷ 라인 주문 수량»으로 거꾸로 계산하고
라인의 FO 항목을 전부 돈다. 구성을 바꾼 라인은 이 역산이 나눠떨어지지 않거나(부분 취소가 있던 라인의 1개당 수량 변경)
빠진 SKU 항목에서 «이미 취소된 수량»으로 걸려 **고객 취소가 거절된다.** 그래서 비율은 굳힌 구성의 `qtyPerUnit` 에서 읽고,
구성 SKU 마다 그 SKU 의 FO 항목들에서 미출고만큼 나눠 뺀다. 구성 밖 SKU 항목은 미출고가 0 이어야 한다(아니면 409).
FO 가 있는데 출처 NULL 인 라인은 409 — 라이브 0건(백필 완료)이고 새 FO 는 생성 순간 굳는다.
덤으로 «FO 생성 전 부분 취소가 있던 라인의 후속 취소»(FO 항목 수량이 주문 수량의 배수가 아니라 지금도 409)가 풀린다.
이 역산을 하는 곳은 저장소에 이 하나뿐이다(계획 단계 grep).

S1 스펙 D8 은 «줄 수량 0 = 빠진 줄»을 정했지만 코드는 아직 묘비 박스를 쓴다. **이 작업은 현재 코드를 따른다** — 갈래를 만들지 않는다.

### 6.4 S2 가 얻는 것

S2 는 «라인별 담긴 개수»를 새로 계산해 `boxTarget` → `amend` 를 부른다. 시작된 배치의 박스는 S1 이 남긴 `amendBox` 가 맡되
**목표 계산은 `boxTarget` 을 쓴다.** 그래서 «박스에 무엇이 들어가야 하나»가 한 곳에서 정의된다.

## 7. 수정 경로

### 7.1 주문별 지정 — `PUT /sales-orders/:id/lines/:lineId/composition`

본문: `{ items: [{ skuId, qtyPerUnit }], note? }`. 판매주문을 잠근 뒤:

1. 라인이 디지털이면 `LINE_NOT_PHYSICAL`. SKU 가 직배송(drop_ship)이면 `DROP_SHIP_NOT_SUPPORTED`(FO 생성도 창고 SKU 와 섞지 않는다)
2. **FO 가 없으면** 구성을 `operator` 로 굳히고, `awaiting_matching` 이면 그 주문을 깨운다. 끝
3. **FO 가 있으면** 그 라인이 담긴 박스가 모두 `draft` 인지 본다. 아니면 `LINE_BOX_NOT_DRAFT` + 박스 목록(id·상태·배치)
4. 라인 출처가 NULL(백필 전)이면 `COMPOSITION_NOT_FROZEN`
5. 구성을 `operator` 로 굳히고 박스마다 §6.2 로 담긴 개수 → `boxTarget` → `amend`
6. amendment 한 행: `amendment_kind = 'fulfillment_only'`, `origin = 'operator'`, `status = 'applied'`,
   델타 `{ type: 'line_composition', salesOrderLineId, before, after }`

같은 구성으로 다시 부르면 무변경(멱등) — 박스 비교가 차이 0 이고 amendment 를 쓰지 않는다.

### 7.2 일괄 적용 — 미리보기와 적용

- `GET /matchings/variants/:variantId/existing-lines-impact` — 그 variant 의 굳힌 라인 중 FO 가 미완료인 것을
  넷으로 센다: **바꿀 수 있음**(출처 `matching`, 새 매칭과 구성이 다름, 박스 모두 draft) / **개별 지정 건너뜀**(출처 `operator`) /
  **작업 중 건너뜀**(draft 아닌 박스 있음) / **이미 같음**. 상품매칭이 void 이거나 링크 0 이면 «바꿀 수 있음»은 0 이다(D4)
- `POST /matchings/variants/:variantId/apply-to-existing-lines` — «바꿀 수 있음»을 **주문마다 별도 트랜잭션**으로
  §7.1 3~6 과 같은 경로로 처리한다(출처는 `matching` 유지). 미리보기 뒤 상태가 바뀔 수 있으니 **적용 때 다시 판정**하고
  `{ changed, skipped: { reason, count }[] }` 를 돌려준다. 다시 보내면 «이미 같음»이 되어 멱등

한 트랜잭션에 몰지 않는 이유: 잠금이 여러 판매주문·재고 키에 걸쳐 출고 작업과 교착·대기가 커진다. 부분 성공은 결과로 보인다.

### 7.3 거절·주의 경계

- 새 SKU 재고 부족은 **거절하지 않는다** — FO 생성과 같이 가능한 만큼 예약하고 박스는 draft 로 남는다
- 배송 프로필이 달라지면 FO 생성과 같은 규칙으로 박스 프로필을 다시 정한다(섞이면 NULL — 확정 단계가 막는다, 지금과 같음)

### 7.4 오류 코드

| 코드 | 언제 |
| --- | --- |
| `LINE_NOT_PHYSICAL` | 디지털 라인 |
| `DROP_SHIP_NOT_SUPPORTED` | 직배송 SKU 지정 |
| `LINE_BOX_NOT_DRAFT` | 라인이 담긴 박스 중 draft 아닌 것 — 박스 목록 동봉 |
| `COMPOSITION_NOT_FROZEN` | FO 가 있는데 출처 NULL(백필 전) |
| `COMPOSITION_UNITS_AMBIGUOUS` | §6.2 계산 불가 |
| `BOX_NOT_DRAFT` | `amend` 직접 호출 시 방어 |
| `LINE_NOT_IN_FULFILLMENT` | FO 가 있는데 그 라인의 FO 항목이 없음(void 매칭 라인·FO 전 전량 취소 라인) — 지정해도 출고에 안 실린다(§4.4). FO 항목은 있어도 살아 있는(묘비·대체 아닌) 박스가 하나도 없을 때도 같다 — 맞출 박스 없이 구성만 바뀌면 안 된다 |
| `SALES_ORDER_CANCELLED` | 전체 취소된 판매주문 |
| `SALES_ORDER_CLOSED` (409) | 판매주문 상태가 `shipped`·`delivered` — 코어 밖(셀메이트 수기 출고 스크립트)에서 닫힌 주문 |
| `FULFILLMENT_ORDER_CLOSED` (409) | FO 상태가 `shipped`·`completed`·`canceled` — 항목 잔량이 남아 있어도 닫힌 FO 는 고치지 않는다 |
| `SKU_HOLDER_MISMATCH_FOR_3PL` | 3PL FO(`ownerId`)에 다른 화주의 SKU 지정 — FO 생성과 같은 규칙 |
| `SKU_NOT_FOUND` (400) | 없는 SKU 지정 |
| `COMPOSITION_ITEMS_INVALID` (400) | 구성 항목 형식 오류(빈 목록·SKU 중복·1개당 수량이 양의 정수가 아님) |
| `SHIPMENT_COMPONENT_CHANGED_RETRY` (409) | 라인의 박스를 세고 잠그는 사이 분할·합포장이 박스 구성을 바꿨다 — 다시 시도하면 된다 |

`amend` 는 분할과 같은 가드를 거치므로 `SHIPMENT_ACTIVE_WORK_ITEM`·`SHIPMENT_CUSTODY_EXISTS`·`SHIPMENT_ACTIVE_INVOICE`
(409) 도 이 경로에서 나올 수 있다(상태만 draft 이고 작업·보관·송장에 묶인 박스). 일괄 적용은 이 셋과 재시도 코드를
«작업 중», 닫힘·박스 없음·SKU 경로 위반을 «적용 불가»로 센다.

경로 접두사는 상품매칭 컨트롤러가 이미 쓰는 `matchings` 다(스펙 초안의 `product-matchings` 는 없는 경로였다).
주문별 지정·일괄 적용 둘 다 관리자 영역 기본 가드(`AdminRealmGuard`) 뒤에 둔다 — 판매주문 취소·상품매칭 저장과 같은 수준.

## 8. 화면 (admin-web)

1. **매칭체크(`/order/matching`)** — 행마다 «이 주문만» 버튼. SKU·1개당 수량 고르기는 `InventoryMatchingDialog` 수동 탭의
   SKU 검색·구성 목록을 `PickedSkuList`·`SkuSearchPanel`(`sku-composition-picker.tsx`)로 뽑아 두 다이얼로그가 같이 쓴다(따로 있는 «SKU 검색 다이얼로그»는 없다 —
   `SearchDialog` 는 공급처·화주 검색이다). 지정된 행은 매칭 칸에 «개별 지정»과 **라인의 구성**(상품매칭 SKU 가 아니라)을 보인다.
   `excludeMatched` 는 §5.2 술어 — 기본값이 켜져 있어 지정한 행은 기본 화면에서 빠진다
2. **출고 주문 상세(`/order/fulfillments/[id]`)** — 라인마다 구성 표시, 개별 지정이면 «개별 지정»(매칭 출처는 정상 상태라 표시 없음),
   같은 다이얼로그로 변경. FO 항목 `qty` 0 이면서 고객 취소 상태가 아닌 것은 «대체됨»(구성 변경으로 빠진 SKU; 옛 부분취소는 qty 0 + status canceled 로 쓴다) — `canceledQty`(고객 취소)와 다르다.
   `LINE_BOX_NOT_DRAFT` 면 박스·배치 링크(«빼기»는 거기서): 배치에 든 박스 → `/order/outbound-batches?batchId=…`(드로어가 열린다),
   배치 없는 박스 → `/order/fulfillments/<foId>`. 박스 상세 경로는 따로 없다
3. **상품매칭 저장 다이얼로그(`InventoryMatchingDialog`)** — 저장 뒤 미리보기가 `applicable && changeable > 0` 일 때만 한 단계:
   «바꿀 수 있음» 은 항상 보이고 나머지 숫자는 0 이면 숨긴다 + «기존 출고에도 적용». 결과 «바뀜 N · 건너뜀 M(사유별)». 바꿀 것이 0 이면(건너뜀만 있어도) 이 단계는 없다 —
   적용 버튼이 할 일이 없다
4. 정상 상태는 숨기고 설명 문구는 «개별 지정» 표시와 거절 사유뿐
5. 판정(미리보기 숫자 → 표시, 오류 코드 → 문구·링크)은 순수 함수로 빼서 테스트한다(admin-web 은 컴포넌트 테스트 환경이 없다)

### 8.1 화면이 요구하는 core 읽기·오류 본문 (PR 3 계획 단계에서 찾음, 2026-10-14)

- **라인 구성 항목을 내려주는 GET 이 없었다.** 응답에 칸만 더한다(additive, 마이그 없음):
  - `GET /fulfillments/:id` 에 `lines: [{ salesOrderLineId, productName, quantity, compositionSource, composition: [{ skuId, skuCode, skuName, qtyPerUnit }] }]`
    — FO 항목이 가리키는 라인들
  - `GET /matchings/order-lines` 행에 `composition`(같은 항목 모양, 굳히지 않은 라인은 빈 배열)
- **`GlobalExceptionFilter` 는 `code`·`message`·`errors`·허용목록 `details` 밖의 칸을 버린다** — PR 2 의 `LINE_BOX_NOT_DRAFT` 가
  본문 최상위에 실은 `boxes` 는 화면에 도착하지 않았다(PR 2 통합 스펙은 매니저 예외만 보고 HTTP 응답은 안 봤다). 매니저가
  `details: { fulfillmentOrderId, boxes: [{ shipmentId, status, batchId, hasActiveWaybill }] }` 로 싣고, 필터 허용목록에
  `LINE_BOX_NOT_DRAFT` 를 모양 검증과 함께 더한다(`SIMPLE_OUTBOUND_PLAN_INVALIDATED` 와 같은 방식). 프록시·axios 래퍼는 본문을 그대로 넘긴다
- 화면이 문구를 갖는 코드는 §7.4 표 + `BOX_NOT_DRAFT`·`FULFILLMENT_INVARIANT_COMPONENT_CHANGED_RETRY`(다시 시도)·`AMEND_WOULD_EMPTY_BOX`·
  amend 가드 셋. 모르는 코드·코드 없는 404·검증 400 은 서버 메시지를 그대로 보인다

## 9. PR 분할과 배포

### 9.1 PR 1 — core 판정과 굳히기 (expand)

- 마이그(additive): §4.1 칸 셋 · §4.2 테이블 · `shipment_operation_type` 에 `'amend'`
- §5 전부(판정 함수·리더·SQL 술어·소비자 다섯·경합 잠금). 소비자 5 때문에 admin-web 의 `isOrderLineMatched` 한 곳도 이 PR 에 들어간다
- 옛 칸 쓰기·읽기 중단: «SKU 연결 저장»의 라인 `productMatchingId` 일괄 덮어쓰기, `confirm` 의 스냅샷 생성, FO 생성의 스냅샷 분기.
  컬럼은 남긴다
- 백필 `scripts/ops/1016-14-backfill-line-compositions.ts` — FO 항목이 있고 출처 NULL 인 물리 라인을 FO 항목에서 역산해 `matching`
  으로 굳힌다. 1개당 수량 = FO 항목 수량 ÷ FO 생성 당시 유효 수량. FO 생성 전 부분 취소가 있었는지는 기록으로 구분되지 않으므로
  «주문 수량»과 «주문 수량 − 부분 취소 합» 둘 중 모든 SKU 를 나눠떨어지게 하는 값을 쓰고, 둘 다 안 되거나 둘 다 되며 결과가 다르면
  보고만 한다(사람 판단). dry-run 기본, `--apply`
- 배포: **`migrate → deploy` → 백필 dry-run → 사람이 `--apply`**
- 백필 전 공백: FO 있고 출처 NULL 인 라인은 수정 API 가 `COMPOSITION_NOT_FROZEN`. 출고에는 영향 없다(FO 는 이미 만들어졌다)

### 9.2 PR 2 — core 수정 경로

§6(`boxTarget`·`DraftBoxAmender`·감소 로직 함수화·배송 프로필 함수 공유)과 §7 API, §6.5 취소 경로.
마이그 1건: `fulfillment_order_items` CHECK `qty > 0` → `qty >= 0`(제약 완화). 배포 **`migrate → deploy`**.
롤링 중 옛 태스크는 qty 0 항목을 «불변식 위반»으로 읽는다 — qty 0 은 새 코드의 수정 API 만 만들므로, 롤아웃이 끝나기 전
그 API 를 쓰지 않으면 겹치지 않는다(PR 3 화면이 같은 배포에 실려도 롤아웃 완료 뒤에 쓴다).

### 9.3 PR 3 — admin-web

§8. PR 2 와 같은 `sst deploy` 에 실어도 된다 — 새 API 만 부르는 화면이다. Core 롤아웃이 끝난 뒤에 쓴다(§9.2).

§8.1 의 core 변경(응답 칸 둘·필터 허용목록·`LINE_BOX_NOT_DRAFT` 본문 모양)도 이 PR 에 들어간다 — 전부 additive 이고 마이그가 없다.
화면은 새 칸이 없으면 그 표시를 숨기고(구성 칸·박스 링크) 서버 메시지로 물러서므로 admin-web 이 Core 보다 먼저 떠도 깨지지 않는다.
PR 2 가 이미 라이브(2026-10-14 Core td 242)라 이 PR 의 core 변경은 새 배포 하나로 나간다.

### 9.4 PR 4 — contract (PR 1 배포·백필 완료 뒤, 적어도 한 번의 배포를 사이에 두고)

`sales_order_lines.product_matching_id`·`mapping_snapshot_id`, `fulfillment_order_items.mapping_snapshot_id`,
`product_sku_mapping_snapshots` 테이블 DROP. 응답 DTO(`sales-order-response.dto.ts`)·admin-web 타입(`lib/types/dto/orders.ts`)·
`getMappingSnapshot`·`createSnapshotForVariant` 제거. 순서 **`deploy → migrate`**.

### 9.5 배포 전 라이브 확인 (PR 본문에 SQL 로)

- PR 1: 백필 대상 라인 수, 역산 불가 라인 수
- PR 4: 옛 칸을 읽는 코드 0(grep 결과 첨부), 백필 뒤 «FO 있고 출처 NULL» 물리 라인 0

## 10. 테스트

- 단위: `resolveLineComposition`, `boxTarget`, 박스 비교(diff), §6.2 담긴 개수 계산, 백필 역산
- 통합(`describeIfDb`, `--runInBand`):
  - FO 생성이 `follow` 라인을 굳힌다 · `missing` 라인만 `waitingVariantIds` 에
  - FO 전 1회 지정 → 매칭 대기 깨어남 → FO 가 지정 구성으로 생성
  - 리컨실러 12번이 1회 지정 주문을 «풀림»으로 판정
  - `amend`: 예약 해제·추가, 묘비 이동, FO 합계, `manifestVersion`, 오퍼레이션 기록, 끝에 불변식 검사기
  - 일괄 적용: 개별 지정·작업 중 건너뜀, 재실행 멱등, 운영자 지정과 동시 실행
  - TS 판정 ↔ `lineResolvedSql()` 일치
  - §4.3 불변식 위반 0
  - 구성 변경 뒤 고객 부분·전체 취소가 통과한다(§6.5) · 변경 뒤 FO 항목 `canceledQty` 가 0 으로 남는다(§6.3)
- admin-web: §8-5 순수 함수

## 11. 범위 밖

- 피킹 시작 뒤·확정·배치 투입 박스의 자동 수정(D5·D6) — 시작된 배치 박스의 내용 변경은 S2/`amendBox`
- 라인별 «발송 안 함»(D4)
- FO 생성 뒤 void → 실물 매칭 변경의 반영(§4.4)
- 옛 «창고별 SKU 매핑»(`product_sku_mappings`)의 생존 여부 — 스냅샷이 사라지면 사용처가 줄어든다. 후속으로 따로 확인

## 12. 계획 단계에서 확인할 것

1. ~~유효 수량을 구하는 곳이 둘인지~~ — **둘이고, PR 2 는 안 쓴다**(2026-10-13 확인). 리더의 `sumCancelledByLine`(취소 범위 전부)과
   `SalesOrdersService.loadPriorPartialCancellationContext`(`partial` 만 — 채널 변경 리더가 `getCancelledQuantityByLine` 으로 쓴다).
   V2 전체 취소 행도 `metadata.cancelledLines` 를 실으므로 둘의 답은 **전체 취소된 주문에서만** 갈린다. §6.2 는 «박스 줄 ÷ 옛 1개당
   수량»이라 유효 수량이 필요 없다. 하나로 모으는 일은 판매 단위로 개수를 다시 세는 S2 가 한다
2. ~~FO 생성 워커가 판매주문을 잠그는지(§5.4)~~ — 잠근다(`createV2` 의 `FOR UPDATE`). §5.4 에 반영
3. ~~배송 프로필 계산을 FO 생성에서 함수로 뽑을 수 있는지(§6.3)~~ — 뽑힌다. «전부 NULL 아님 + 한 종류면 그 값, 아니면 NULL» 세 줄이
   `createV2` 에만 있고 분할·합포장·묘비는 값을 복사만 한다. `compatibleShippingProfileId` 순수 함수로 뽑아 FO 생성과 amend 가 쓴다
4. admin-web 이 `productMatchingId`·`mappingSnapshotId` 를 어디서 읽는지(PR 4 범위)
