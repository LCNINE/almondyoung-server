# Wallet Rebuild - State Machines (Draft)

## 1. Purpose

이 문서는 Wallet 재설계의 핵심 엔티티별 상태(state)와 상태 전이 규칙을 정의한다.
본 문서는 `01-scope-and-rules.md`를 전제로 하며, 구현 전에 상태머신을 고정하기 위한 문서다.

## 2. Entities Covered

- `PaymentIntent`
- `PaymentLeg`
- `PaymentAttempt`
- `RefundRequest`
- `ManualCancellationQueueItem`

## 3. PaymentIntent States

### 3.1 State Set

- `PENDING`: Intent 생성 완료, 결제 시작 전
- `IN_PROGRESS`: 하나 이상의 Leg가 결제 진행 중
- `PARTIALLY_CAPTURED`: 일부 Leg만 성공(CAPTURED)했고 전체는 미완료
- `SUCCEEDED`: 모든 필수 Leg가 성공하여 결제 완료
- `FAILED`: 결제 실패 및 보상 처리 완료
- `EXPIRED`: 만료(`72h`)로 종료, 보상 처리 완료
- `CANCELLED`: 사용자/시스템 취소로 종료, 보상 처리 완료
- `SUSPENDED`: supersede 처리 중으로 사용자 진행 중단 상태
- `SUPERSEDED`: 신규 Intent로 대체 완료, 보상 처리 완료
- `RECONCILING`: 보상/정리 트랜잭션 진행 중
- `SUPERSEDED_RECONCILE_REQUIRED`: supersede 보상 실패로 수동 정리 필요
- `RECONCILE_REQUIRED`: 일반 실패/만료/취소 보상 실패로 수동 정리 필요

### 3.2 State Set Classification

- `checkout-active`:
  - `PENDING`, `IN_PROGRESS`, `PARTIALLY_CAPTURED`
- `reference-blocking`:
  - `PENDING`, `IN_PROGRESS`, `PARTIALLY_CAPTURED`, `RECONCILING`
- `terminal`:
  - 성공 종료: `SUCCEEDED`
  - 정상 실패 종료: `FAILED`, `EXPIRED`, `CANCELLED`, `SUPERSEDED`
  - 수동 정리 필요 종료: `SUPERSEDED_RECONCILE_REQUIRED`, `RECONCILE_REQUIRED`

정책 메모:

- `SUSPENDED`는 `checkout-active`와 `reference-blocking` 모두에 포함하지 않는다.
- `RECONCILING`은 `checkout-active`에는 포함하지 않지만 `reference-blocking`에는 포함한다.
- `RECONCILE_REQUIRED`, `SUPERSEDED_RECONCILE_REQUIRED`는 `reference-blocking`에 포함하지 않는다.

### 3.3 State Semantics (Detailed)

| State | 핵심 의미 | checkout-active | reference-blocking | terminal |
| --- | --- | --- | --- | --- |
| `PENDING` | Intent 생성 완료, 결제 실행 전 | Y | Y | N |
| `IN_PROGRESS` | 하나 이상의 Leg가 실행 중 | Y | Y | N |
| `PARTIALLY_CAPTURED` | 일부 Leg 결제 성공, 전체는 미완료 | Y | Y | N |
| `SUCCEEDED` | 모든 필수 Leg 결제 성공으로 최종 완료 | N | N | Y |
| `FAILED` | 실패 종료 + 보상 완료 | N | N | Y |
| `EXPIRED` | 만료 종료 + 보상 완료 | N | N | Y |
| `CANCELLED` | 사용자/시스템 취소 종료 + 보상 완료 | N | N | Y |
| `SUSPENDED` | supersede 시작으로 기존 Intent를 사용자 흐름에서 중단 | N | N | N |
| `SUPERSEDED` | 새 Intent로 대체 완료 + 기존 Intent 보상 완료 | N | N | Y |
| `RECONCILING` | 자동 보상/정합성 복구 작업 진행 중 | N | Y | N |
| `SUPERSEDED_RECONCILE_REQUIRED` | supersede 경로 보상 실패, 수동 정리 필요 | N | N | Y |
| `RECONCILE_REQUIRED` | 일반 경로 보상 실패, 수동 정리 필요 | N | N | Y |

### 3.4 Transitions

- `PENDING -> IN_PROGRESS`
  - 첫 Leg 결제 시작 시
- `IN_PROGRESS -> PARTIALLY_CAPTURED`
  - 일부 Leg 성공, 나머지 미완료 시
- `IN_PROGRESS -> SUCCEEDED`
  - 모든 필수 Leg 성공 시
- `PARTIALLY_CAPTURED -> SUCCEEDED`
  - 남은 필수 Leg 성공 시
- `PENDING|IN_PROGRESS|PARTIALLY_CAPTURED -> EXPIRED`
  - 만료 시점 도달 + 보상 완료
- `PENDING|IN_PROGRESS|PARTIALLY_CAPTURED -> CANCELLED`
  - 사용자/시스템 취소 + 보상 완료
- `PENDING|IN_PROGRESS|PARTIALLY_CAPTURED -> SUSPENDED`
  - 동일 `referenceType + referenceId`의 새 Intent 생성(supersede 시작)
- `SUSPENDED -> SUPERSEDED`
  - 기존 Intent 보상 완료
- `SUSPENDED -> SUPERSEDED_RECONCILE_REQUIRED`
  - 기존 Intent 보상 실패
- `IN_PROGRESS|PARTIALLY_CAPTURED -> RECONCILING`
  - 실패/만료/취소에 따른 보상 트랜잭션 시작
- `RECONCILING -> FAILED|EXPIRED|CANCELLED`
  - 보상 완료
- `RECONCILING -> RECONCILE_REQUIRED`
  - 보상 실패

## 4. PaymentLeg States

### 4.1 State Set

- `PLANNED`: Intent 생성 시 금액 배분만 된 상태
- `READY`: 실행 가능한 상태(사전 검증 통과)
- `PROCESSING`: Provider 연동 처리 중
- `REQUIRES_CUSTOMER_ACTION`: 고객 추가행동 필요(예: 리다이렉트/인증)
- `REQUIRES_ADMIN_CONFIRMATION`: 관리자 수동 확인 필요(무통장 등)
- `AUTHORIZED`: 승인 완료(캡처 전)
- `CAPTURED`: 최종 결제 성공
- `FAILED`: 결제 실패(재시도 불가/중단)
- `EXPIRED`: 유효기간 만료
- `CANCELING`: 자동 취소/보상 실행 중
- `CANCELLED`: 취소 완료
- `REFUNDING`: 환불 실행 중
- `REFUNDED`: 환불 완료
- `RECONCILE_REQUIRED`: 자동 보상/환불 실패, 수동 처리 필요

### 4.2 Terminal States

- 정상 종료: `FAILED`, `EXPIRED`, `CANCELLED`, `REFUNDED`
- 수동 정리 필요: `RECONCILE_REQUIRED`

주의:

- `CAPTURED`는 결제 확정 상태이지만 terminal state가 아니다.
- 환불이 발생하면 `CAPTURED -> REFUNDING -> REFUNDED`로 전이될 수 있다.

### 4.3 Transitions

- `PLANNED -> READY`
  - 금액/Provider/Capability 검증 통과
- `READY -> PROCESSING`
  - authorize 시작
- `PROCESSING -> AUTHORIZED`
  - authorize 성공
- `PROCESSING -> REQUIRES_CUSTOMER_ACTION`
  - 사용자 인증/추가 수행 필요
- `PROCESSING -> REQUIRES_ADMIN_CONFIRMATION`
  - 수동 확인 결제수단
- `PROCESSING|REQUIRES_CUSTOMER_ACTION|REQUIRES_ADMIN_CONFIRMATION -> FAILED`
  - 실패 확정
- `AUTHORIZED -> CAPTURED`
  - capture 성공
- `READY|PROCESSING|REQUIRES_CUSTOMER_ACTION|REQUIRES_ADMIN_CONFIRMATION|AUTHORIZED -> EXPIRED`
  - Intent 만료
- `AUTHORIZED|CAPTURED -> CANCELING`
  - supersede/실패 보상으로 취소/환불 필요
- `CANCELING -> CANCELLED|REFUNDED`
  - 보상 완료
- `CANCELING|REFUNDING -> RECONCILE_REQUIRED`
  - 자동 보상 실패
- `CAPTURED -> REFUNDING -> REFUNDED`
  - 환불 요청 처리

### 4.4 Zero Amount Fast Path

- `payableAmount === 0`은 Leg 상태머신 범위가 아니다.
- 처리 원칙:
  - Provider 결제수단/Leg를 생성하지 않음
  - Intent-level fast path로 즉시 완료
  - 외부 Provider 호출 없음

## 5. PaymentAttempt States

### 5.1 State Set

- `CREATED`: 시도 레코드 생성
- `SENT`: Provider 호출 시작
- `PENDING_PROVIDER`: Provider 비동기 응답 대기
- `REQUIRES_ACTION`: 사용자/외부 액션 대기
- `AUTHORIZED`: 승인 성공
- `CAPTURED`: 캡처 성공
- `FAILED_RETRYABLE`: 재시도 가능 실패
- `FAILED_FINAL`: 재시도 불가 실패
- `CANCEL_REQUESTED`: 취소 요청 발행
- `CANCELLED`: 취소 성공
- `REFUND_REQUESTED`: 환불 요청 발행
- `REFUNDED`: 환불 성공
- `UNKNOWN`: 응답 불명확(타임아웃 등)
- `RECONCILE_REQUIRED`: 자동 복구 실패

### 5.2 Notes

- Attempt는 재시도 이력을 남기는 엔티티다.
- 동일 Leg에서 여러 Attempt가 발생할 수 있다.
- `UNKNOWN` 상태는 재조회/웹훅 수신/운영자 확인으로 종결해야 한다.

## 6. RefundRequest States

### 6.1 State Set

- `REQUESTED`: 환불 요청 수신 (allocation 포함)
- `VALIDATED`: allocation/한도/중복 검증 완료
- `PROCESSING`: Leg별 환불 실행 중
- `PARTIALLY_COMPLETED`: 일부 Leg 환불 완료, 나머지 진행/실패
- `COMPLETED`: 요청 환불 금액 전체 완료
- `REJECTED`: 검증/정책 위반으로 거절
- `FAILED`: 자동 처리 실패(복구 완료)
- `RECONCILE_REQUIRED`: 자동 처리 실패(수동 정리 필요)

### 6.2 Validation Constraints

- 단일 결제수단 환불 포함 모든 환불 요청에 allocation 명시 필수
- `sum(allocation.amount) == refundAmount`
- 각 allocation 대상 Leg는 `CAPTURED` 상태여야 함
- Leg별 누적 환불 한도 초과 시 거절

## 7. ManualCancellationQueueItem States

### 7.1 State Set

- `QUEUED`: 자동 취소 실패 항목 등록
- `ASSIGNED`: 운영자 할당
- `PROCESSING`: 운영자 처리 중
- `COMPLETED`: 수동 취소/환불 완료
- `FAILED_RETRYABLE`: 재처리 가능 실패
- `FAILED_FINAL`: 재처리 불가 실패
- `CLOSED`: 정책상 종료 처리(예: 무효/중복)

### 7.2 Ownership

- 큐 소유: Wallet 서비스
- 운영 경로: Wallet 관리자 페이지 + 관리자 API

### 7.3 Transitions

- `QUEUED -> ASSIGNED`
  - 담당자 할당
- `QUEUED|ASSIGNED -> PROCESSING`
  - 운영자 처리 시작
- `PROCESSING -> COMPLETED`
  - 수동 취소/환불/확인 완료
- `PROCESSING -> FAILED_RETRYABLE`
  - 재시도 가능한 처리 실패
- `PROCESSING -> FAILED_FINAL`
  - 재시도 불가 처리 실패
- `FAILED_RETRYABLE -> ASSIGNED|PROCESSING`
  - 재처리 재개
- `QUEUED|ASSIGNED|FAILED_RETRYABLE|FAILED_FINAL -> CLOSED`
  - 정책상 종료 처리

## 8. Cross-Entity Consistency Rules

- `PaymentIntent.status = SUCCEEDED`가 되려면 모든 필수 Leg가 `CAPTURED`여야 한다.
- `PaymentIntent.status`가 `EXPIRED|FAILED|CANCELLED|SUPERSEDED`로 종료되면, `CAPTURED`였던 Leg는 `REFUNDED` 또는 `RECONCILE_REQUIRED`가 되어야 한다.
- `PaymentLeg.status = CAPTURED`가 발생하면 최소 1개 `PaymentAttempt`가 `CAPTURED`여야 한다.
- `RefundRequest.status = COMPLETED`가 되려면 allocation의 모든 Leg 환불 합계가 정확히 일치해야 한다.

## 9. Suggested Enum Names (Implementation Hint)

관리자 UI에는 아래 한국어 번역어를 기본 표시값으로 사용한다.

### 9.1 `PaymentIntentStatus`

| Enum | 관리자 표시 번역 |
| --- | --- |
| `PENDING` | 결제 대기 |
| `IN_PROGRESS` | 결제 진행 중 |
| `PARTIALLY_CAPTURED` | 부분 결제 완료 |
| `SUCCEEDED` | 결제 완료 |
| `FAILED` | 결제 실패 |
| `EXPIRED` | 만료 |
| `CANCELLED` | 취소됨 |
| `SUSPENDED` | 일시중단됨 |
| `SUPERSEDED` | 대체 완료 |
| `RECONCILING` | 정합성 정리 중 |
| `SUPERSEDED_RECONCILE_REQUIRED` | 대체 건 수동 정리 필요 |
| `RECONCILE_REQUIRED` | 수동 정리 필요 |

### 9.2 `PaymentLegStatus`

| Enum | 관리자 표시 번역 |
| --- | --- |
| `PLANNED` | 결제수단 계획됨 |
| `READY` | 결제 준비 완료 |
| `PROCESSING` | 결제 처리 중 |
| `REQUIRES_CUSTOMER_ACTION` | 고객 추가 인증 필요 |
| `REQUIRES_ADMIN_CONFIRMATION` | 관리자 확인 필요 |
| `AUTHORIZED` | 승인 완료 |
| `CAPTURED` | 결제 확정 완료 |
| `FAILED` | 결제 실패 |
| `EXPIRED` | 만료 |
| `CANCELING` | 취소 처리 중 |
| `CANCELLED` | 취소 완료 |
| `REFUNDING` | 환불 처리 중 |
| `REFUNDED` | 환불 완료 |
| `RECONCILE_REQUIRED` | 수동 정리 필요 |

### 9.3 `PaymentAttemptStatus`

| Enum | 관리자 표시 번역 |
| --- | --- |
| `CREATED` | 시도 생성됨 |
| `SENT` | 결제 요청 전송됨 |
| `PENDING_PROVIDER` | 결제사 응답 대기 |
| `REQUIRES_ACTION` | 추가 조치 필요 |
| `AUTHORIZED` | 승인 성공 |
| `CAPTURED` | 확정 성공 |
| `FAILED_RETRYABLE` | 실패(재시도 가능) |
| `FAILED_FINAL` | 실패(재시도 불가) |
| `CANCEL_REQUESTED` | 취소 요청됨 |
| `CANCELLED` | 취소 성공 |
| `REFUND_REQUESTED` | 환불 요청됨 |
| `REFUNDED` | 환불 성공 |
| `UNKNOWN` | 상태 미확정 |
| `RECONCILE_REQUIRED` | 수동 정리 필요 |

### 9.4 `RefundRequestStatus`

| Enum | 관리자 표시 번역 |
| --- | --- |
| `REQUESTED` | 환불 요청됨 |
| `VALIDATED` | 환불 검증 완료 |
| `PROCESSING` | 환불 처리 중 |
| `PARTIALLY_COMPLETED` | 부분 환불 완료 |
| `COMPLETED` | 환불 완료 |
| `REJECTED` | 환불 거절됨 |
| `FAILED` | 환불 실패 |
| `RECONCILE_REQUIRED` | 수동 정리 필요 |

### 9.5 `ManualCancellationQueueStatus`

| Enum | 관리자 표시 번역 |
| --- | --- |
| `QUEUED` | 대기열 등록됨 |
| `ASSIGNED` | 담당자 할당됨 |
| `PROCESSING` | 수동 처리 중 |
| `COMPLETED` | 처리 완료 |
| `FAILED_RETRYABLE` | 처리 실패(재시도 가능) |
| `FAILED_FINAL` | 처리 실패(재시도 불가) |
| `CLOSED` | 종료됨 |
