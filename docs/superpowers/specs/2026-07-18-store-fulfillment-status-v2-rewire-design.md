# 스토어 표시상태 V2 재배선 — 고객 주문 화면 대표 배송 상태 (설계)

> 날짜: 2026-07-18
> 선행: `docs/superpowers/specs/2026-07-13-sales-order-status-derivation-design.md` (작업 15 / WS-D — "FO 기준 도출" 원칙 확정)
> 관련: ADR-0017(주문 상태/액션 매트릭스), ADR-0027(outbound shipment consumes stock ledger)
> 대상 파일: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts`, `.../dto/store-order-actions.dto.ts`

## 1. 배경과 문제

고객 주문 목록/상세 상단의 대표 "이행 상태"(`StoreOrderActionsResponseDto.fulfillmentStatus`)를 도출하는 `deriveFulfillmentStatus()` 와 취소 게이트 `hasShippedEvidence()` 가 **구 V1 FO 상태 어휘**로 작성되어 있다. Outbound V2 재작업이 FO 상태를 "작업 단계 상태머신"(allocating→picking→picked→invoiced→shipped)에서 "수량 기반 파생 projection"으로 바꾸면서 값 집합과 **의미**가 함께 바뀌었지만, 스토어 표시 레이어는 컷오버 범위 밖이라 낡은 채 남았다.

현재 코드 (`store-sales-orders.service.ts:42-45, 993-1007`):

```typescript
const FO_DELIVERED_STATUSES = new Set(['completed']);
const FO_SHIPPED_STATUSES = new Set(['shipped', 'completed']);
const FO_PACKED_STATUSES = new Set(['picked', 'inspecting', 'invoiced', 'labeled', 'forwarded']);
const FO_PICKING_STATUSES = new Set(['picking', 'allocated']);
```

현행 FO enum 은 `created, partially_reserved, ready, processing, shipped(직배 전용), partially_shipped, completed, canceled, recovery_required` 다. 위 상수의 `picked/inspecting/invoiced/labeled/picking/allocated` 는 전부 제거된 V1 값, `forwarded` 는 FO status 가 아니라 `directShipStatus` 값이다. 결과적으로 나타나는 결함:

1. **출고 직후 "배송 완료" 오표시 (가장 심각).** V2 projector 에서 FO `completed` 는 "전량 출고(수요 정산 완료)"지 배송 완료가 아니다 (`fulfillment-progress.service.ts:75-77` — 배송/추적 상태는 의도적으로 FO progress 입력에서 제외). 그러나 표시 코드는 `completed → delivered` 로 매핑하고 이 분기가 최우선이라, 창고 주문이 전량 출고되는 순간 "배송 중" 없이 곧바로 "배송 완료"로 표시된다.
2. **반품/교환 게이트가 이 오표시에 물림.** `store-sales-orders.service.ts:581-582` 가 `fulfillmentStatus === 'delivered'` 일 때만 반품/교환을 허용하는데, 위 버그로 출고 직후 게이트가 열린다 — 아직 배송 중인 상품에 반품 버튼 노출.
3. **출고 전 진행 단계 소실.** `packed/picking` 매칭값이 전부 죽어 도달 불가하고, 현행 `ready/processing/partially_reserved` 는 어느 집합에도 안 잡혀 fallthrough 로 전부 `created` 표시. `awaiting_matching` 분기도 죽은 값(`unfulfillable`/`reserving`)을 봐서 도달 불가.
4. **부분 출고 오표시 + 취소 게이트 불일치.** `partially_shipped` 가 어느 집합에도 없어 `created` 로 표시되고, `hasShippedEvidence()` 는 `shipped/completed/shippedAt` 만 봐서(FO `shippedAt` 은 전량 출고 시에만 세팅) 부분 출고에 false 를 반환 → 일부 상품이 이미 배송 중인 주문에 표시상 취소 액션이 열린다.

근본 원인: 배송 중/완료의 진실이 이제 FO 가 아니라 **shipment 레벨**(`shipped→in_transit→delivered`, 택배사 웹훅 projection)에 있는데, 표시 레이어는 여전히 FO status 만 읽는다. 선행 작업 15 는 `sales_orders.status` 측을 정리하고 "출고 진실은 FO+shipment 도출" 원칙을 세웠으나, `deriveFulfillmentStatus` 의 상태-집합 상수는 손대지 않아 이번에 마무리한다.

## 2. 목표 / 비목표

**목표**
- 고객에게 노출하는 대표 이행 상태를 5단계 표준 어휘로 단순화하고, V2 소스(출고 전=FO, 출고 후=shipment)에서 정확히 도출.
- 분할배송/합배송에서 대표 상태가 오표시되지 않고, 진행 요약(상자 카운트)으로 보완.
- 취소·반품·교환 게이트를 실제 출고/배송 상태와 일치.
- 도출 로직을 순수 함수로 분리해 유닛 테스트 가능하게.

**비목표**
- 배송조회 상세(`buildTrackingView` / `StoreOrderTrackingResponseDto`) 재설계 — 이미 shipment 기준이라 손대지 않는다. 대표 상태 도출은 그 tracking 도출 규칙과 **어휘·규칙을 통일**한다.
- admin 화면 이행 상태 도출 — 이 DTO 를 소비하지 않음(별도 Medusa admin 개념). 범위 밖.
- 부분 취소(미출고 라인만 취소) 신규 플로우 — 별도 워크스트림(사용자 결정 2026-07-18: 하나라도 출고되면 취소 불가).
- SO.status 측 도출 — 선행 작업 15 에서 완료됨.

## 3. 계약 변경 (DTO)

`store-order-actions.dto.ts` 의 `StoreFulfillmentStatus` 를 5값으로 축소:

```typescript
export type StoreFulfillmentStatus =
  | 'not_created'   // FO 없음 = 결제완료·출고대기 (ADR-0017 PAYMENT_COMPLETE)
  | 'preparing'     // 상품 준비 중 (예약/피킹/패킹/복구 등 출고 전 전부 흡수)
  | 'shipping'      // 배송 중 (하나 이상 상자 출고/이동, 전량 배송완료는 아님)
  | 'delivered'     // 배송 완료 (모든 활성 상자 배송완료)
  | 'canceled';     // 이행 취소 (모든 FO canceled)
```

제거: `awaiting_matching`, `created`, `picking`, `packed`, `shipped`. (`created` 의미는 `preparing`, `shipped` 는 `shipping` 으로 흡수. 결제확인중/결제완료 구분은 지금처럼 `orderStatus`(`so.status`)가 담당하므로 fulfillment 축엔 두지 않는다.)

**진행 요약 필드 추가** — 분할/합배송 문구용:

```typescript
export class ShipmentProgressDto {
  @ApiProperty() total: number;      // 활성 상자 수 (canceled/superseded 제외)
  @ApiProperty() shipped: number;    // shipped/in_transit/delivered 상자 수
  @ApiProperty() delivered: number;  // delivered 상자 수
}
// StoreOrderActionsResponseDto 에 추가:
@ApiPropertyOptional({ type: ShipmentProgressDto })
shipmentProgress?: ShipmentProgressDto;  // 활성 상자 0개면 생략
```

프론트는 `total > 1` 일 때 "N개 중 M개 배송 완료" 문구를 만들고, 단일 상자면 요약을 숨긴다. `@ApiProperty` enum 배열(`fulfillmentStatus`)의 값 목록도 5값으로 갱신.

## 4. 도출 규칙 (순수 함수)

**소스 원칙: 출고 전은 FO, 출고 후는 shipment.** 도출을 순수 함수로 분리하고 서비스는 DB 로딩·정규화만 담당한다 (`deriveOverallTrackingStatus` 와 같은 module-scope 순수 함수 패턴).

```typescript
interface FulfillmentPhaseInput {
  foCount: number;                 // 이 SO 의 FO 수
  allFoCanceled: boolean;          // FO 있으면서 전부 canceled
  activeShipmentStatuses: string[];// canceled/superseded 제외한 상자 status 목록
  dropShipStatuses: string[];      // 직배 FO 의 directShipStatus (상자 없음)
}
interface FulfillmentPhaseResult {
  phase: StoreFulfillmentStatus;
  progress: { total: number; shipped: number; delivered: number };
}
```

**상자 status → 단계 매핑**
- `draft`/`planned`/`recovery_required` → 준비(복구 중임은 고객에게 숨김)
- `shipped`/`in_transit` → 배송중
- `delivered` → 배송완료

**직배(drop-ship) status → 단계 매핑** (상자가 없으므로 `directShipStatus` 로)
- `pending` → 준비 / `forwarded` → 배송중 / `completed` → 배송완료 / `canceled` → (활성 목록에서 제외)

**대표 상태 = 합의(consensus) 규칙** — 기존 `deriveOverallTrackingStatus` 와 동일 규칙으로 통일:
1. FO 0개 → `not_created`
2. `allFoCanceled` → `canceled`
3. 활성 상자/직배 유닛 0개 (FO 는 있음) → `preparing`
4. **모든** 활성 유닛이 배송완료 → `delivered`
5. **하나 이상** 활성 유닛이 이동(배송중/배송완료) → `shipping`
6. 그 외 → `preparing`

> **승인된 설계(min)로부터의 개선 — 명시.** 브레인스토밍에서 "가장 뒤처진 상자(min)"로 합의했으나, 검토 중 기존 배송조회 도출 `deriveOverallTrackingStatus`(`store-sales-orders.service.ts:1426`)가 이미 위 합의 규칙을 쓰고 있음을 확인했다. 순수 min 은 "A 배송완료·B 준비중"을 `preparing` 으로 표시해 **이미 고객 손에 든 상자를 준비중으로 과소표시**한다. 합의 규칙은 "delivered 는 전량 합의 시에만"이라는 min 의 과대표시 방지 의도를 그대로 지키면서 이 과소표시만 고친다. 배송조회 상세와 대표 상태가 같은 규칙·어휘를 쓰게 되는 이점도 있어 합의 규칙으로 통일한다. (혼합 주문의 직배 유닛과 상자 유닛은 한 목록으로 합쳐 같은 규칙 적용.)

**진행 요약**: `total` = 활성 유닛 수, `shipped` = 이동(배송중+배송완료) 유닛 수, `delivered` = 배송완료 유닛 수.

## 5. 액션 게이트 변경

취소·반품·교환 게이트는 세 지점에서 제거 대상 `picking`/`packed` 값 또는 부정확한 출고 신호에 의존한다. 전부 V2 소스로 재배선한다.

**(a) `hasShippedEvidence` 재정의** — 부분 출고를 출고 증거로 인정(사용자 결정 3):
- 하나 이상 활성 상자가 이동 status(`shipped`/`in_transit`/`delivered`), **또는**
- 하나 이상 FOI `shippedQty > 0`, **또는**
- 직배 FO `directShipStatus ∈ {forwarded, completed}`.

부분 출고 시 FO `shippedAt` 은 null 이라 기존 신호로는 놓치던 것을, 상자 이동 status + FOI shippedQty 로 정확히 잡는다.

**(b) "피킹 시작" 판정 신규 헬퍼 `isPickingStarted(fos)`** — 제거되는 `picking`/`packed` 표시값을 대신할 V2 등가물. V2 에서 "피킹/패킹 시작"은 FO status `processing` 이다 (`fulfillment-progress.service.ts:24` "Picking, packing or inspection has begun"). 따라서 `isPickingStarted = fos.some(fo => fo.status === 'processing')`. 표시(`fulfillmentStatus`)는 `processing` 을 `preparing` 으로 흡수해 고객에게 내부 단계를 숨기지만, **취소 게이트는 raw FO status 를 읽어** "피킹 시작 후 셀프 취소 불가" 정책을 그대로 보존한다.

**(c) 취소 게이트 정책 (customer self-cancel)** — 우선순위 순:
1. `hasShippedEvidence` → `already_shipped` 로 차단 (사용자 결정 3: 하나라도 출고되면 셀프 취소 불가, CS 안내). **`hasV2OutstandingShipment` 예외 제거** — 현행(`:678`)은 활성 미출고 상자가 있으면 다른 상자가 출고됐어도 셀프 취소를 허용하는데, 이는 결정 3 과 정면 배치되므로 제거한다. `hasV2OutstandingShipment` 메서드(`:726`)는 이 제거로 미사용이 되어 함께 삭제.
2. `isPickingStarted` → `already_processing` 로 차단 ("피킹 시작 후 CS 문의", `:617` 표시 게이트 · `:675` throw 게이트 모두 이 헬퍼로 교체).
3. 그 외(`preparing` 이면서 미피킹, 즉 FO `created`/`partially_reserved`/`ready`) → 셀프 취소 허용.

`:678` 의 `so.status === 'shipped' || 'delivered'` 약한 폴백은 선행 작업 15 가 dead 로 확정한 값이라 함께 제거(도출은 FO/shipment 로 완결).

**(d) 반품/교환 게이트**: 대표 상태 `delivered`(= 모든 활성 유닛 배송완료)일 때만 (`:581` 유지, 이제 정확). 출고 직후 반품 버튼 노출 버그 해소.

## 6. 데이터 로딩 / 성능

`buildActionsView`(`:474-480`)는 현재 FO `status`+`shippedAt` 만 로드한다. 도출을 위해 다음이 추가로 필요:
- FO 행: `id`, `status`, `shippedAt`, `directShipStatus`, `fulfillmentMode` (직배 판정)
- FO → FOI(`id`, `shippedQty`) → `shipment_lines`(shipmentId) → `shipments`(status) 조인 — `buildTrackingView`(`:1039-1082`)의 로딩 패턴을 재사용/추출.

**N+1 주의**: `buildActionsView` 는 배치 액션 엔드포인트에서 SO당 `Promise.all`(≤100건, `:429-430`)로 호출된다. 상자 조인 추가는 SO당 쿼리를 늘린다. 기존 코드가 이미 남긴 precedent("느려지면 buildActionsView 쿼리 배치화", `:429`)를 따라 **이번엔 SO당 로딩 유지**하되, 아래 short-circuit 으로 다수 케이스에서 상자 로딩을 건너뛴다:

- FO status 가 전부 출고-이전(`created/partially_reserved/ready/processing`)이고 FOI `shippedQty=0` 이면 상자 로딩 없이 `preparing` 확정 (delivered/shipping 은 상자를 봐야만 구분되므로, 출고가 시작된 주문에서만 상자 로딩).

`buildTrackingView` 와의 공통 로딩(FO→FOI→shipment_lines→shipments)은 private 헬퍼로 추출해 두 경로가 공유한다.

## 7. Blast radius (외부 조정 필요)

- **Core (이 작업)**: `store-sales-orders.service.ts`, `store-order-actions.dto.ts`, 관련 spec.
- **외부 storefront (Medusa 몰 고객 UI)**: `POST /store/orders/by-channel-order/actions/batch` 와 단건 actions 엔드포인트의 `fulfillmentStatus` 를 소비. enum 값 변경이므로 **coordinated 배포 1건** 필요(운송장 재설계의 `StoreShipmentDto` 와 같은 패턴). 매핑 변경: `awaiting_matching/created/picking/packed → preparing`, `shipped → shipping`. 신규 `shipmentProgress` 는 옵셔널이라 미사용 시 무해.
- **admin-web**: 이 DTO 미소비(확인함 — `StoreOrderActionsResponseDto` import 0). 영향 없음.

## 8. 정리 대상 코드

- 삭제: `FO_DELIVERED_STATUSES`, `FO_SHIPPED_STATUSES`, `FO_PACKED_STATUSES`, `FO_PICKING_STATUSES` (`:42-45`).
- 교체: `deriveFulfillmentStatus`(`:993`), `hasShippedEvidence`(`:1005`) → §4·§5 순수 함수 + 서비스 로딩 헬퍼.
- 신규: `isPickingStarted(fos)` 헬퍼(§5b).
- `buildActionsView`(`:474`) 쿼리 확장 + short-circuit; `:617` 표시 취소 게이트를 `isPickingStarted` 로 교체.
- `processCancelRequest`(`:673-680`): `picking`/`packed` throw 게이트 → §5c 정책으로 재작성. `hasV2OutstandingShipment`(`:726`) 메서드 삭제, `so.status === 'shipped'||'delivered'` 폴백(`:678`) 제거.

## 9. 테스트

도출 순수 함수 유닛 테스트(`store-sales-orders.service.spec.ts` 확장 또는 신규 `derive-fulfillment-phase.spec.ts`):
- 단일 상자 정상 경로: draft→planned(preparing) / shipped(shipping) / delivered(delivered).
- 분할배송 부분 출고: A shipped·B preparing → `shipping` + progress{total:2, shipped:1, delivered:0}.
- 분할 부분 배송: A delivered·B shipped → `shipping` + {2,2,1}.
- 전량 배송완료: A·B delivered → `delivered` + {2,2,2}.
- 합배송: 두 SO 가 같은 상자 공유(각 SO 관점에서 그 상자만 활성) — 대표 상태·progress 정합.
- superseded 제외: 원본 superseded + 대체 상자 shipped → 대체만 카운트.
- 직배 단독: directShipStatus pending/forwarded/completed → preparing/shipping/delivered.
- 혼합(직배+창고): 창고 preparing·직배 forwarded → `shipping`.
- 전량 취소: 모든 FO canceled → `canceled`.
- recovery_required 숨김: 상자 recovery_required → `preparing`(고객에게 복구 노출 안 함).
- 취소 게이트: 부분 출고(FOI shippedQty>0) → `already_shipped`, 미출고 → cancel 허용.
- 반품/교환 게이트: 전량 delivered 에서만 열림.

기존 `store-sales-orders.service.spec.ts` / `store-order-tracking.integration.spec.ts` 의 깨지는 기대값을 5값 어휘로 갱신.

## 10. 미해결 / 확인 항목

- **직배 `completed` → `delivered` 간주 (확인 요청).** 직배는 배송 추적 웹훅이 없어 "업체 발송완료"를 배송완료로 간주하지 않으면 반품/교환 게이트가 영영 안 열린다. 본 설계는 `directShipStatus='completed'` 를 `delivered` 로 간주한다. 이 간주가 부적절하면(예: 직배는 반품/교환을 채널/CS 로만) 이 매핑만 조정하고 직배 유닛을 delivered 집계에서 빼면 된다.
- storefront 매핑 변경 PR 은 Core 배포와 순서 조율(신규 enum 을 옛 storefront 가 만나면 `?? status` 폴백 여부에 따라 raw 값 노출 가능). 옛 값 제거이므로 Core 먼저 배포 시 옛 storefront 가 신규 값을 모른다 — storefront 를 먼저 관용(tolerant)하게 배포하거나 동시 배포.
- **범위 밖 관찰(별건):** `cancelByWalletIntentAfterRefund`(`:219`)의 `so.status === 'shipped' || 'delivered'` 출고-가드는 dead SO.status 값(작업 15)이라 실효가 없다 — 즉 admin 환불승인 취소 경로에 사실상 출고 가드가 없다. 고객 표시 버그와 별개 정책 문제라 본 작업에서 고치지 않고 기록만 한다(수정하려면 이 경로가 출고완료 주문을 만났을 때의 정책 결정 필요).
