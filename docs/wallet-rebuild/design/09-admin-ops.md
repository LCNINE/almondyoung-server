# Wallet Rebuild - Admin Ops (Draft)

## 1. Purpose

이 문서는 Wallet 관리자 전용 기능과 운영 API를 정의한다.
목표는 수동 처리, 정합성 복구, 감사 추적이 가능한 운영 표준을 확정하는 것이다.

## 2. Scope and Principles

- 본 문서는 `01~08` 문서를 전제로 한다.
- 관리자 API는 결제 도메인 상태를 변경할 수 있으므로 기본적으로 고위험(write) API로 취급한다.
- v1 원칙:
  - 변경성 관리자 API는 `Idempotency-Key` 필수
  - 모든 관리자 액션은 감사 로그 필수
  - 자동화 실패 건은 수동 큐로 이관 후 운영자 절차로 처리

## 3. Admin Capability Set

관리자 화면/백오피스에서 제공해야 하는 최소 기능:

1. 수동 취소 큐 조회/할당/처리
2. 무통장(수동확인형) 결제 확정/실패 처리
3. 환불 요청 승인/거절
4. 정합성 재처리(Reconcile Retry) 실행
5. Intent/Leg/Attempt/Refund 운영 검색
6. 상태 전이/운영 액션 감사 로그 조회

## 4. Authorization: Roles and Scopes (v1)

본 시스템의 권한 모델:

- `role`은 user-service가 토큰에 부여한다.
- `role -> scope` 매핑은 Wallet 서비스가 독자 관리한다.

### 4.1 Scope Naming Rule

v1 scope 형식:

- `wallet.<plane>.<resource>.<action>`
- `plane`: `admin` | `service`

v1 scope 카탈로그:

- `wallet.admin.read`
- `wallet.admin.audit.read`
- `wallet.admin.queue.write`
- `wallet.admin.manual_confirm.write`
- `wallet.admin.refund.write`
- `wallet.admin.reconcile.retry`
- `wallet.service.checkout.write`
- `wallet.service.intent.expire`

### 4.2 Role Set (Lowercase)

- `admin` (기존 전사 관리자 role)
- `wallet_admin`
- `wallet_viewer`
- `wallet_service`

### 4.3 Role -> Scope Mapping (Wallet Local)

| Role | Scopes |
| --- | --- |
| `admin` | `wallet.*` (전체 권한) |
| `wallet_admin` | `wallet.admin.read`, `wallet.admin.audit.read`, `wallet.admin.queue.write`, `wallet.admin.manual_confirm.write`, `wallet.admin.refund.write`, `wallet.admin.reconcile.retry` |
| `wallet_viewer` | `wallet.admin.read`, `wallet.admin.audit.read` |
| `wallet_service` | `wallet.service.checkout.write`, `wallet.service.intent.expire` |

권한 원칙:

- 조회 API: 최소 `wallet.admin.read`
- 상태변경 API: 대응 write scope 필수
- `wallet.admin.reconcile.retry`는 고위험 액션(재호출/재처리)이므로 분리 유지

## 5. Common API Conventions (Admin)

## 5.1 Base Path

- `/v1/admin`

## 5.2 Required Headers

- `Authorization` (관리자 인증 토큰)
- `Idempotency-Key` (변경성 API 필수)
- `X-Correlation-Id` (권장)

## 5.3 Write API Common Body Fields

- `reasonCode` (필수)
- `reasonMessage` (선택)
- `actorId` (서버 주입 권장; 클라이언트 전달값은 참고만)
- `metadata` (선택)

## 5.4 Error Codes (Admin-Extended)

- `ADMIN_FORBIDDEN`
- `QUEUE_ITEM_NOT_FOUND`
- `QUEUE_ITEM_STATE_INVALID`
- `MANUAL_CONFIRM_NOT_ALLOWED`
- `REFUND_APPROVAL_NOT_ALLOWED`
- `RECONCILE_RETRY_NOT_ALLOWED`
- `IDEMPOTENCY_KEY_CONFLICT`

## 6. Admin API Inventory (v1)

## 6.1 Manual Cancel Queue

| Method | Path | Scope | 설명 |
| --- | --- | --- | --- |
| `GET` | `/manual-cancel-queue` | `wallet.admin.read` | 수동 취소 큐 목록 조회 |
| `GET` | `/manual-cancel-queue/{itemId}` | `wallet.admin.read` | 큐 상세 조회 |
| `POST` | `/manual-cancel-queue/{itemId}/assign` | `wallet.admin.queue.write` | 담당자 할당 |
| `POST` | `/manual-cancel-queue/{itemId}/process` | `wallet.admin.queue.write` | 처리 시작 |
| `POST` | `/manual-cancel-queue/{itemId}/complete` | `wallet.admin.queue.write` | 처리 완료 |
| `POST` | `/manual-cancel-queue/{itemId}/fail` | `wallet.admin.queue.write` | 처리 실패 기록 |
| `POST` | `/manual-cancel-queue/{itemId}/close` | `wallet.admin.queue.write` | 정책상 종료 처리 |

### `GET /manual-cancel-queue` Query Filters (권장)

- `status` (다중)
- `priority`
- `assignedTo`
- `providerType`
- `referenceType`
- `referenceId`
- `createdFrom`, `createdTo`
- `page`, `pageSize`, `sort`

### `POST /manual-cancel-queue/{itemId}/assign` Body

- `assigneeId` (필수)
- `reasonCode` (필수)
- `reasonMessage` (선택)

### `POST /manual-cancel-queue/{itemId}/complete` Body

- `resolutionType` (`CANCELLED` | `REFUNDED` | `NO_ACTION_REQUIRED`)
- `providerTransactionId` (선택)
- `reasonCode` (필수)
- `reasonMessage` (선택)

### `POST /manual-cancel-queue/{itemId}/fail` Body

- `retryable` (`true` | `false`)
- `reasonCode` (필수)
- `reasonMessage` (선택)

## 6.2 Manual Confirmation (Bank Transfer)

| Method | Path | Scope | 설명 |
| --- | --- | --- | --- |
| `POST` | `/intents/{intentId}/legs/{legId}/manual-confirm` | `wallet.admin.manual_confirm.write` | 수동 결제 확정 |
| `POST` | `/intents/{intentId}/legs/{legId}/manual-confirm-fail` | `wallet.admin.manual_confirm.write` | 수동 결제 실패 확정 |

### `POST /intents/{intentId}/legs/{legId}/manual-confirm` Body

- `proofType` (예: `BANK_TRANSFER_RECEIPT`)
- `proofRef` (증적 참조값)
- `confirmedAmount` (필수)
- `reasonCode` (필수)
- `reasonMessage` (선택)

검증 규칙:

- 대상 Leg 상태가 `REQUIRES_ADMIN_CONFIRMATION`이어야 함
- `confirmedAmount`는 leg amount와 정책상 일치해야 함
- 성공 시 Leg는 `CAPTURED` 전이

## 6.3 Refund Approval

| Method | Path | Scope | 설명 |
| --- | --- | --- | --- |
| `POST` | `/refund-requests/{refundId}/approve` | `wallet.admin.refund.write` | 환불 승인 |
| `POST` | `/refund-requests/{refundId}/reject` | `wallet.admin.refund.write` | 환불 거절 |

### `POST /refund-requests/{refundId}/approve` Body

- `reasonCode` (필수)
- `reasonMessage` (선택)

### `POST /refund-requests/{refundId}/reject` Body

- `reasonCode` (필수)
- `reasonMessage` (필수 권장)

검증 규칙:

- 승인/거절은 `REQUESTED|VALIDATED` 상태에서만 허용
- 이미 종결(`COMPLETED|REJECTED|FAILED`)된 요청은 거절

## 6.4 Reconcile Retry

| Method | Path | Scope | 설명 |
| --- | --- | --- | --- |
| `POST` | `/intents/{intentId}/reconcile/retry` | `wallet.admin.reconcile.retry` | Intent 단위 재처리 |
| `POST` | `/legs/{legId}/reconcile/retry` | `wallet.admin.reconcile.retry` | Leg 단위 재처리 |

### `POST /intents/{intentId}/reconcile/retry` Body

- `reasonCode` (필수)
- `reasonMessage` (선택)
- `force` (선택, 기본 `false`)

동작:

- 내부적으로 `RetryReconcile` 커맨드를 발행하거나 동일 도메인 핸들러를 호출
- 처리 결과는 동기 완료를 보장하지 않을 수 있음(accepted + async)

## 6.5 Ops Query APIs

| Method | Path | Scope | 설명 |
| --- | --- | --- | --- |
| `GET` | `/intents` | `wallet.admin.read` | 운영 검색 |
| `GET` | `/intents/{intentId}` | `wallet.admin.read` | 인텐트 상세 |
| `GET` | `/intents/{intentId}/timeline` | `wallet.admin.read` | 상태/시도/이벤트 타임라인 |
| `GET` | `/refund-requests` | `wallet.admin.read` | 환불 요청 검색 |
| `GET` | `/audit-logs` | `wallet.admin.audit.read` | 감사 로그 검색 |

## 7. State Transition Guardrails

관리자 API는 상태 전이 가드를 반드시 적용한다.

- 현재 상태 검증 실패 시 `409 Conflict`
- optimistic lock 버전 충돌 시 `409 Conflict`
- terminal 상태 대상의 재처리는 정책 허용 범위 내에서만 가능

## 8. Audit Log Policy

모든 관리자 write API는 아래를 감사 로그로 남긴다.

- `actorId`
- `action`
- `targetType` / `targetId`
- `beforeStatus` / `afterStatus`
- `reasonCode` / `reasonMessage`
- `correlationId`
- `idempotencyKey`
- `createdAt`

감사 로그는 append-only로 관리한다.
감사 로그 보관 기간은 무기한이며, TTL purge/hard delete를 허용하지 않는다.

## 9. Pagination and Sorting Standard

조회 API 공통:

- `page` (기본 1)
- `pageSize` (기본 20, 최대 100)
- `sort` (`createdAt:desc` 기본)

응답 공통:

```json
{
  "success": true,
  "data": {
    "items": [],
    "page": 1,
    "pageSize": 20,
    "totalCount": 0
  },
  "error": null,
  "timestamp": "2026-02-14T00:00:00.000Z"
}
```

## 10. Security and Safety Controls

- 관리자 write API는 기본적으로 rate limit 적용
- 민감 필드(계좌번호, 결제식별자 일부)는 마스킹 후 응답
- 고위험 액션(환불 승인, 수동확정)은 추가 MFA/step-up 인증 고려
- `actorId`는 토큰 기반 서버 추출을 우선, body 값은 신뢰하지 않음

## 11. Event and Command Integration

- 관리자 액션 결과에 따라 표준 이벤트 발행:
  - `RefundCompleted`, `RefundFailed`
  - `PaymentReconcileRequired`
  - `PaymentIntentCancelled|Failed|Superseded` (해당 시)
- 재처리 실행은 표준 커맨드 재사용:
  - `RetryReconcile`
  - `ConfirmManualPaymentLeg` (적용 시)

## 12. Open Decisions

- 현재 없음
