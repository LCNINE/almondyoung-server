# Wallet Rebuild - Message Contracts (Draft)

## 1. Purpose

이 문서는 Wallet 서비스의 메시지 계약(Events / Commands)을 정의한다.
범위는 `payments.events.v1`, `payments.commands.v1`이며, 현재 합의된 v1 필수 메시지에 한정한다.

## 2. Scope Assumptions

- 현재 Wallet 사용 판매채널의 주문 SoT는 `Medusa`다.
- 따라서 결제 결과의 주문 측 1차 소비자는 `Medusa`로 본다.
- Wallet은 스토어프론트 주문 결제 외에도 내부 서비스(예: membership 정기결제)의 결제 지시를 처리한다.
- 내부 서비스 간 비동기 통신은 Kafka 기반 메시지 계약을 따른다.

## 3. Topics

| Topic | Partition | 설명 |
| --- | --- | --- |
| `payments.events.v1` | `6` | Wallet이 발행하는 결제/환불 사실 이벤트 |
| `payments.commands.v1` | `3` | Wallet이 구독하는 결제 처리 지시 커맨드 |

> 파티션 키는 기본적으로 `intentId`를 사용한다.

## 3.1 `referenceType` Enum (v1)

`referenceType`은 아래 두 값만 허용한다.

- `STORE_ORDER`
- `SUBSCRIPTION_BILLING`

## 4. Envelope Standard

모든 이벤트/커맨드는 `packages/event-contracts/types/envelope.types.ts`의 표준 Envelope를 따른다.

- 필수 필드:
  - `messageId`
  - `messageType`
  - `messageVersion`
  - `messageKind` (`event` | `command`)
  - `correlationId`
  - `timestamp`
  - `source`
  - `payload`
- Command 전용 필드:
  - `expiresAt` (선택, 권장)

## 5. Wallet Published Events (`payments.events.v1`)

아래 이벤트는 v1 필수 발행 대상으로 정의한다.

| messageType | 설명 | 주요 소비자 |
| --- | --- | --- |
| `PaymentIntentSucceeded` | 결제 의도 최종 성공 | Medusa, Notification, Analytics |
| `PaymentIntentFailed` | 결제 의도 최종 실패 | Medusa, Notification, Analytics |
| `PaymentIntentExpired` | 결제 의도 만료 종료 | Medusa, Notification |
| `PaymentIntentCancelled` | 사용자/시스템 취소 종료 | Medusa, Notification |
| `PaymentIntentSuperseded` | 기존 의도가 신규 의도로 대체됨 | Medusa, Analytics |
| `PaymentReconcileRequired` | 자동 보상/정리가 실패하여 수동 개입 필요 | Wallet Admin/Ops, Notification |
| `RefundRequested` | 환불 요청 생성됨 | Medusa, Wallet Admin/Ops |
| `RefundCompleted` | 환불 완료 | Medusa, Notification, Analytics |
| `RefundFailed` | 환불 실패(수동 처리 필요 가능) | Medusa, Wallet Admin/Ops, Notification |

### 5.1 Event Payload Minimum Fields

#### `PaymentIntent*` 계열 공통

- `intentId`
- `referenceType` (`STORE_ORDER` | `SUBSCRIPTION_BILLING`)
- `referenceId`
- `customerId`
- `status`
- `payableAmount`
- `currency`
- `occurredAt`

#### `Refund*` 계열 공통

- `refundId`
- `intentId`
- `referenceType`
- `referenceId`
- `customerId`
- `refundAmount`
- `currency`
- `allocation` (명시적 leg 배분 정보)
- `occurredAt`

#### 오류/수동개입 이벤트 추가 필드

- `reasonCode`
- `reasonMessage`
- `requiresManualAction`
- `manualQueueItemId` (해당 시)

## 6. Wallet Subscribed Commands (`payments.commands.v1`)

아래 커맨드는 v1 필수 구독 대상으로 정의한다.

| messageType | 설명 | 주요 발행자 |
| --- | --- | --- |
| `CreatePaymentIntent` | 결제 의도 생성 | Medusa, 내부 오케스트레이터 |
| `StartPaymentLeg` | 특정 Leg 결제 시작/승인 | Medusa, Wallet UI Backend |
| `ConfirmManualPaymentLeg` | 수동 결제수단(예: 무통장) 확인 | Wallet Admin |
| `CancelPaymentIntent` | 결제 의도 취소 | Medusa, Wallet Admin |
| `ExpirePaymentIntent` | 만료 처리 실행 | Scheduler, 운영 배치 |
| `SupersedePaymentIntent` | 기존 Intent 대체 시작 | Medusa, 내부 오케스트레이터 |
| `RequestRefund` | 환불 요청 생성 | Medusa, Wallet Admin |
| `ApproveRefund` | 환불 승인 | Wallet Admin, 외부 검수 시스템 |
| `RejectRefund` | 환불 거절 | Wallet Admin, 외부 검수 시스템 |
| `RetryReconcile` | 정합성 재처리 요청 | Wallet Admin/Ops |

### 6.1 Command Payload Minimum Fields

#### 모든 커맨드 공통

- `requestedBy`
- `requestSource`
- `idempotencyKey`

#### `CreatePaymentIntent`

- `referenceType`
- `referenceId`
- `customerId`
- `currency`
- `payableAmount`
- `snapshotPayload`
- `signature`
- `signatureVersion`
- `signedAt`
- `billingContext` (선택, 정기결제 컨텍스트)

검증 규칙:

- `referenceType=STORE_ORDER`인 경우:
  - `referenceId`는 Medusa 주문 식별자여야 함
- `referenceType=SUBSCRIPTION_BILLING`인 경우:
  - `referenceId`는 구독 청구/인보이스 식별자여야 함
  - `billingContext` 권장
- 그 외 `referenceType`은 v1에서 거절

#### `StartPaymentLeg`

- `intentId`
- `legId`
- `providerType`
- `amount`

#### `RequestRefund`

- `intentId`
- `refundAmount`
- `allocation` (필수, 단일 결제수단도 동일)
- `reasonCode`

## 7. Wallet Subscribed Domain Events (Non-Command)

v1 확정:

- Wallet은 non-command 도메인 이벤트를 구독하지 않는다.
- 주문/환불/만료/대체 등 결제 관련 동작은 커맨드(`payments.commands.v1`)로만 지시한다.
- `UserDeleted` 같은 라이프사이클 이벤트 연동은 v2 후보로 남긴다.

> 주문 관련 동작(취소, 환불 요청, 만료 지시 등)은 이벤트가 아니라 커맨드로 보낸다.

## 7.1 Internal Service Billing Coverage

현재 구조는 내부 마이크로서비스 결제 지시를 그대로 커버한다.

- 내부 서비스는 `CreatePaymentIntent` + `StartPaymentLeg` 커맨드를 발행한다.
- Wallet은 `referenceType/referenceId`로 결제 대상을 식별한다.
- 예시:
  - `referenceType=SUBSCRIPTION_BILLING`
  - `referenceId=membership_invoice_2026_02_user123`

## 8. Ordering, Partition, Idempotency

### 8.1 Partition Key

- 기본 파티션 키: `intentId`
- `Refund*` 이벤트는 `intentId`를 기준으로 동일 파티션 유지

### 8.2 Ordering Rule

- 동일 `intentId` 스트림 내 이벤트 순서는 소비자가 신뢰할 수 있어야 한다.
- `PaymentIntentSucceeded` 이후 동일 intent에 대해 `PaymentIntentFailed`를 발행하지 않는다.

### 8.3 Idempotency Rule

- 모든 Command는 `idempotencyKey`를 필수로 가진다.
- Wallet은 `(messageType, idempotencyKey)` 기준으로 중복 처리 방지해야 한다.
- Event 소비자도 `messageId` 기준 중복 소비 방지를 구현해야 한다.

### 8.4 Command Expiration Policy (v1)

- `expiresAt`는 optional 필드로 유지한다.
- `expiresAt`가 존재하고 현재 시각이 이를 초과하면 stale command로 거절한다.
- `expiresAt`가 없으면 만료 검사 없이 처리한다.

## 9. Versioning Rule

- 초기 버전은 모두 `messageVersion = 1`
- 하위 호환 가능한 필드 추가: minor 성격으로 같은 버전 유지 가능
- 필드 의미 변경/삭제, 필수 필드 추가: 새 버전(`v2`)로 분리

## 10. Example Event Envelope

```json
{
  "messageId": "01JABCDEF1234567890XYZABCD",
  "messageType": "PaymentIntentSucceeded",
  "messageVersion": 1,
  "messageKind": "event",
  "correlationId": "corr_01JABCDEF...",
  "timestamp": "2026-02-13T12:00:00.000Z",
  "occurredAt": "2026-02-13T12:00:00.000Z",
  "source": {
    "service": "wallet",
    "aggregateType": "PaymentIntent",
    "aggregateId": "pi_01JABC..."
  },
  "payload": {
    "intentId": "pi_01JABC...",
    "referenceType": "STORE_ORDER",
    "referenceId": "medusa_order_123",
    "customerId": "cus_123",
    "status": "SUCCEEDED",
    "payableAmount": 10000,
    "currency": "KRW",
    "occurredAt": "2026-02-13T12:00:00.000Z"
  }
}
```

## 11. Open Decisions

- 현재 없음
