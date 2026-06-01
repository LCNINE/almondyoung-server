# 주문 후처리 액션 매트릭스

> 관련 ADR: `docs/adr/0017-order-status-action-matrix.md`

## 상태 소스 분리 원칙

고객/관리자 화면에 표시되는 모든 상태는 **단일 `order.status`로 결정하지 않는다.**
각 bounded context의 원 상태를 조합한 view model로 판단한다.

| 화면 표시 | 실제 소스 |
|-----------|-----------|
| 주문 상태 | Core `sales_orders.status` |
| 피킹/패킹/출고 상태 | Core `fulfillment_orders.status` + FO item + 송장/배송 이벤트 |
| 결제/환불 상태 | Wallet `payment_intents`, `charges`, `refunds` |
| 반품/교환 상태 | (미구현) 향후 `return_requests` / `exchange_requests` |
| 고객 가능 액션 | 위 상태들을 조합한 projection (store-facing API) |

## View Model

```ts
type StoreOrderLifecycleView = {
  orderId: string
  channelOrderId: string

  // SO 수준: 계약/수락/취소의 큰 상태
  orderStatus:
    | 'pending'
    | 'confirmed'
    | 'processing'
    | 'shipped'
    | 'delivered'
    | 'cancelled'
    | 'timeout'

  // FO 수준: 피킹/패킹/출고 진행 상태
  // 'not_created': 아직 출고주문 없음
  // 'awaiting_matching': 매칭 대기
  // 'picking' | 'packed': 출고 준비 중
  // 'shipped': 출고됨
  // 'delivered': 배송 완료
  // 'canceled': 출고 취소됨
  fulfillmentStatus:
    | 'not_created'
    | 'awaiting_matching'
    | 'created'
    | 'picking'
    | 'packed'
    | 'shipped'
    | 'delivered'
    | 'canceled'

  // Wallet 환불 상태
  // 복수의 refund가 있을 경우 가장 최근/중요 상태를 대표값으로
  refundStatus: 'none' | 'pending' | 'manual_pending' | 'succeeded' | 'failed'

  // 반품/교환 claim 상태 (Phase 4 이전에는 항상 'none')
  claimStatus:
    | 'none'
    | 'return_requested'
    | 'exchange_requested'
    | 'returning'
    | 'completed'

  // 현재 이 주문에서 가능한 액션
  // 클라이언트는 이 목록에 있는 버튼만 활성화한다
  availableActions: Array<'cancel' | 'track' | 'return' | 'exchange' | 'receipt'>

  // 취소 불가 사유 (cancel이 availableActions에 없을 때)
  cancelUnavailableReason?:
    | 'already_shipped'
    | 'already_cancelled'
    | 'channel_order' // 채널에서 직접 처리 필요
    | 'already_processing' // 피킹 시작 — 취소 불확실

  // 채널 주문인 경우 채널 직접 처리 안내
  channelInfo?: {
    channel: 'naver' | 'coupang' | '3pl'
    cancelUrl?: string
    returnUrl?: string
  }
}
```

## 매트릭스 작성 기준

1. **SO 상태**는 주문 계약/수락/취소의 큰 상태만 표현한다.
2. **피킹/패킹/출고 가능 여부**는 FO 상태로 판단한다. SO가 `confirmed`이더라도 FO에 shipped evidence가 있으면 전체 취소 불가.
3. **환불 진행 여부**는 Wallet refund 상태로 판단한다. SO가 `cancelled`여도 환불이 아직 완료되지 않았으면 `refundStatus: 'pending'`.
4. **고객 버튼**은 SO + FO + Wallet + Claim 상태를 조합해서 결정한다. 버튼 비활성화 사유도 함께 내려준다.
5. **출고 증거가 있으면** 고객 "주문취소"는 불가하고 "반품/교환"으로 전환한다.
6. **출고 전 취소**는 Wallet refund 생성까지 이어져야 고객에게 완료로 보일 수 있다. 취소만 되고 환불이 없으면 `refundStatus: 'none'`으로 표시하여 관리자가 인지한다.
7. **관리자 화면**은 각 bounded context의 원 상태와 연결 timeline을 모두 보여준다.

## 상태 조합 → availableActions 도출 규칙

```
orderStatus = 'cancelled' → availableActions = ['receipt']
orderStatus = 'timeout'   → availableActions = []

fulfillmentStatus = 'shipped' | 'delivered'
  → 'cancel' 불가
  → 'track' 가능
  → 'return' / 'exchange' 가능 (claimStatus = 'none' + orderStatus = 'delivered'인 경우)

fulfillmentStatus = 'picking' | 'packed'
  → 'cancel' 불확실 (시도 가능하지만 실패할 수 있음, cancelUnavailableReason = 'already_processing')

fulfillmentStatus = 'not_created' | 'created' | 'awaiting_matching'
  orderStatus = 'confirmed' | 'processing'
    → 'cancel' 가능

claimStatus != 'none'
  → 'return' / 'exchange' 추가 신청 불가
```

## 고객 액션 가능 여부 (채널별 차이 포함)

| orderStatus | fulfillmentStatus | 채널 | cancel | track | return | exchange |
|-------------|-------------------|------|:------:|:-----:|:------:|:--------:|
| confirmed | not_created / awaiting_matching | 자사몰 | ✅ | ❌ | ❌ | ❌ |
| confirmed / processing | not_created / awaiting_matching | 네이버/쿠팡 | ⚠️ 채널에서 취소 | ❌ | ❌ | ❌ |
| confirmed / processing | picking / packed | 자사몰 | ⚠️ 불확실 (시도 가능) | ❌ | ❌ | ❌ |
| shipped | shipped | 자사몰 | ❌ | ✅ | ❌ | ❌ |
| delivered | delivered | 자사몰 | ❌ | ✅ | ✅ (claimStatus=none) | ✅ (claimStatus=none) |
| cancelled | - | 자사몰 | ❌ | ❌ | ❌ | ❌ |
| cancelled | - | - (refund pending) | ❌ | ❌ | ❌ | ❌ |

> **주의**: `return` / `exchange`는 `claimStatus = 'none'` (진행 중인 claim 없음)이어야 가능. Phase 4 구현 전까지는 항상 'none'이므로 배송완료 주문은 무조건 신청 가능 상태로 표시됨.

## 관리자 액션 가능 여부

| orderStatus | fulfillmentStatus | 전체취소 | 부분취소 | 환불실행 | 환불수동완료 |
|-------------|-------------------|:--------:|:--------:|:--------:|:------------:|
| confirmed | no shipped evidence | ✅ | ✅ | ✅ | — |
| confirmed / processing | shipped evidence 있음 | ❌ | ✅ | ✅ | — |
| shipped | - | ❌ | ✅ | ✅ | — |
| delivered | - | ❌ | ✅ | ✅ | — |
| cancelled | - | ❌ | ❌ | ✅ (Wallet 미연결 시) | — |
| cancelled | - (refundStatus=manual_pending) | ❌ | ❌ | ❌ | ✅ (BANK_TRANSFER) |
| cancelled | - (refundStatus=succeeded) | ❌ | ❌ | ❌ | ❌ |

## 구현 로드맵

### 1단계 ✅
- Admin 환불/취소 안전성 (guard, lock, PENDING 처리)
- Core 취소 payload 전달 (lines, reasonCode, cancelledBy)
- Admin 취소 dialog (shipped 차단, 사유 입력)

### 2단계 ✅
- `GET /store/orders/:id/actions` — StoreOrderLifecycleView 반환
- `POST /store/orders/:id/cancel-request` — 고객 취소 요청
- Storefront 주문내역 버튼 조건부 노출

### 3단계 ✅
- Core cancellation → Wallet refund 자동 연결
- 배송조회 API (`GET /store/orders/:id/tracking`)
- Action projection 완성: `claimStatus` 추가, `return`/`exchange` 배송완료 시 허용
- Storefront 주 상태 텍스트 Core projection 우선 표시

### 4단계 (다음)
- `return_requests` / `exchange_requests` 테이블 + workflow
- 고객 반품/교환 신청 API
- 관리자 반품/교환 승인/거절/처리 화면
- `claimStatus` 실제 조회 연결 (현재는 항상 'none')

### 5단계
- Admin timeline 운영 UX (raw JSON → 사람이 읽는 타임라인)
- 채널 주문 취소/반품 안내 통합
