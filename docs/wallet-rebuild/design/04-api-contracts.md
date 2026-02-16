# Wallet Rebuild - API Contracts (Draft)

## 1. Purpose

이 문서는 Wallet 서비스가 노출해야 하는 HTTP REST API 계약을 정의한다.
본 문서는 `01-scope-and-rules.md`, `02-state-machines.md`, `03-message-contracts.md`를 전제로 한다.

## 2. API Design Principles

- 변경성 API(`POST`, `PUT`, `PATCH`, `DELETE`)는 `Idempotency-Key` 헤더를 필수로 사용한다. (단, `POST /v1/webhooks/{providerType}` 제외)
- 내부 마이크로서비스는 가능하면 HTTP 대신 `payments.commands.v1`를 통해 결제를 지시한다.
- Medusa는 외부 판매채널로 간주하므로 Wallet HTTP API 직접 호출을 허용한다.
- `referenceType`은 v1에서 `STORE_ORDER`, `SUBSCRIPTION_BILLING`만 허용한다.
- Wallet은 결제 실행/결제 이력/정합성 처리에 집중하며, 구독 도메인 상태 SoT는 소유하지 않는다.
- v1에서는 클라이언트 자동 재시도 정책을 두지 않지만, 멱등성은 반드시 보장한다.

## 3. Common HTTP Conventions

### 3.1 Base Path

- 기본 경로: `/v1`

### 3.2 Required Headers

- `Idempotency-Key` (필수: 변경성 API, 단 `POST /v1/webhooks/{providerType}` 제외)
- `X-Correlation-Id` (권장)
- `Authorization` (API 종류별 인증 방식)

### 3.3 Idempotency Behavior

`Idempotency-Key`는 "첫 처리 결과 재사용" 용도로 동작한다.
본 절은 `POST /v1/webhooks/{providerType}`를 제외한 변경성 API에 적용한다.

- 첫 요청:
  - `Idempotency-Key` + 요청 본문 해시(`requestHash`)를 저장하고 처리 시작
  - 처리 완료 시 응답 상태코드/응답 본문 스냅샷 저장
- 재요청(동일 키 + 동일 본문):
  - 비즈니스 로직 재실행 없이 저장된 응답 재전송
- 재요청(동일 키 + 다른 본문):
  - `409 Conflict` (`IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`)
- 동일 키의 선행 요청이 아직 처리 중(`PENDING`):
  - `409 Conflict` (`IDEMPOTENCY_REQUEST_IN_PROGRESS`)

### 3.4 Response Envelope (권장)

```json
{
  "success": true,
  "data": {},
  "error": null,
  "timestamp": "2026-02-13T12:00:00.000Z"
}
```

### 3.5 Error Response (권장)

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "INTENT_NOT_FOUND",
    "message": "Payment intent not found"
  },
  "timestamp": "2026-02-13T12:00:00.000Z"
}
```

## 4. Checkout APIs

Wallet Front, Medusa Payment Provider가 주로 사용하는 엔드포인트다.

| Method | Path | 설명 | 주요 호출자 |
| --- | --- | --- | --- |
| `POST` | `/v1/intents` | 결제 의도 생성 | Medusa, Wallet Front Backend |
| `GET` | `/v1/intents/{intentId}` | 결제 의도 상세/상태 조회 | Medusa, Wallet Front Backend |
| `PUT` | `/v1/intents/{intentId}/legs` | 결제수단 분할(legs) 구성/수정 | Wallet Front Backend |
| `POST` | `/v1/intents/{intentId}/legs/{legId}/authorize` | 특정 Leg 승인 시작 | Wallet Front Backend, Medusa |
| `POST` | `/v1/intents/{intentId}/legs/{legId}/capture` | 특정 Leg 캡처 실행(필요 시) | Wallet Front Backend, Medusa |
| `POST` | `/v1/intents/{intentId}/cancel` | 결제 의도 취소 | Medusa, Wallet Front Backend |
| `POST` | `/v1/intents/{intentId}/supersede` | 동일 reference 기존 Intent 대체 | Medusa, Wallet Front Backend |

### 4.1 `POST /v1/intents` Minimum Body

- `referenceType`
- `referenceId`
- `customerId`
- `currency`
- `payableAmount`
- `snapshotPayload`
- `signature`
- `signatureVersion`
- `signedAt`
- `billingContext` (선택, `referenceType=SUBSCRIPTION_BILLING`)

검증 규칙:

- `referenceType=STORE_ORDER`면 `referenceId`는 Medusa 주문 식별자여야 함
- `referenceType=SUBSCRIPTION_BILLING`이면 `referenceId`는 구독 청구/인보이스 식별자여야 함
- `referenceType`의 허용값 외에는 요청 거절
- 동일 `referenceType + referenceId`에 `SUCCEEDED` Intent가 이미 존재하면 요청 거절 (`409 Conflict`, `REFERENCE_ALREADY_PAID`)

## 5. Refund APIs

| Method | Path | 설명 | 주요 호출자 |
| --- | --- | --- | --- |
| `POST` | `/v1/intents/{intentId}/refund-requests` | 환불 요청 생성 | Medusa, Wallet Admin |
| `GET` | `/v1/refund-requests/{refundId}` | 환불 요청 상태 조회 | Medusa, Wallet Admin |

### 5.1 `POST /v1/intents/{intentId}/refund-requests` Minimum Body

- `refundAmount`
- `allocation` (필수, 단일/복합 결제 동일)
- `reasonCode`
- `reasonMessage` (선택)

검증 규칙:

- `sum(allocation.amount) == refundAmount`
- allocation의 각 항목은 실제 캡처된 Leg를 참조해야 함
- Leg별 누적 환불 가능 금액 초과 시 거절

## 6. Admin APIs

관리자 API의 단일 SoT는 `09-admin-ops.md`를 사용한다.
본 문서에서는 관리자 API 목록/상세 스키마를 중복 정의하지 않는다.

## 7. Provider Webhook API

외부 결제수단 상태 변경을 Wallet이 수신하는 엔드포인트다.

| Method | Path | 설명 |
| --- | --- | --- |
| `POST` | `/v1/webhooks/{providerType}` | Provider 웹훅 수신 |

요구사항:

- Provider별 서명 검증 필수
- 웹훅 엔드포인트는 `Idempotency-Key`를 사용하지 않는다.
- 중복 웹훅 처리 멱등성 보장 필수:
  - Provider Adapter는 `providerEventId`를 추출해야 한다.
  - `provider_webhook_receipts`에 `(providerType, providerEventId)`를 유니크 키로 기록한다.
  - 동일 `(providerType, providerEventId)` 재수신은 no-op 처리하고 `2xx`를 반환한다.
- 권장 처리 순서:
  - 서명 검증 -> `providerEventId` 추출 -> receipt insert 시도
  - insert 성공 시에만 상태 전이/이벤트 발행 로직 진행
  - 유니크 충돌 시 비즈니스 로직 재실행 없이 `2xx` 반환
- 내부 처리 결과에 따라 Attempt/Leg/Intent 상태 전이

## 8. Ops APIs

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/v1/health` | 프로세스 헬스체크 |
| `GET` | `/v1/ready` | 의존성 포함 준비 상태 체크 |

## 9. HTTP vs Command Boundary

- 내부 서비스 결제 지시는 기본적으로 `payments.commands.v1`를 우선한다.
- 단, 외부 채널 Medusa 연동은 HTTP 직접 호출을 허용한다.
- 동일 기능이 HTTP와 Command 모두 존재하는 경우, 도메인 규칙은 동일해야 한다.

## 10. Suggested Error Codes

- `INVALID_REFERENCE_TYPE`
- `INVALID_SIGNATURE`
- `INTENT_NOT_FOUND`
- `INTENT_NOT_ACTIVE`
- `INTENT_EXPIRED`
- `LEG_NOT_FOUND`
- `LEG_STATE_INVALID`
- `ALLOCATION_INVALID`
- `REFUND_LIMIT_EXCEEDED`
- `IDEMPOTENCY_KEY_CONFLICT`
- `REFERENCE_ALREADY_PAID`
- `RECONCILE_REQUIRED`

## 11. Open Decisions

- 현재 없음
