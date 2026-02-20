# Wallet Rebuild - Data Model (Draft)

## 1. Purpose

이 문서는 Wallet v1의 데이터 모델(엔티티, 테이블, 제약조건, 인덱스, 상태변경 기록 정책)을 정의한다.
본 문서는 `01~04` 문서를 전제로 한다.

## 2. State Persistence Strategy

결론: v1은 **완전 이벤트소싱**이 아니라 **하이브리드 모델**을 사용한다.

- 현재 상태 조회 성능을 위해 각 엔티티의 `status` 컬럼을 유지한다.
- 감사/추적/복구를 위해 상태변경 이력은 append-only 테이블에 누적한다.
- 상태 변경 트랜잭션에서 아래를 원자적으로 수행한다.
  - 현재 상태 row `UPDATE`
  - 상태 전이 로그 `INSERT`
  - outbox 이벤트 `INSERT`

### 2.1 Why Not Full Event Sourcing in v1

- 조회가 많은 운영 화면에서 projection 의존도가 높아 초기 복잡도가 커진다.
- 재생(replay)/snapshot/버전 관리까지 함께 설계해야 하므로 개발 범위가 크게 증가한다.
- 현재 목표(MVP + 안정 운영)에 비해 과하다.

### 2.2 Why Hybrid is Fit

- 운영 API는 단순하고 빠르다 (`status` 직접 조회).
- 감사와 포렌식이 가능하다 (전이 로그 전부 보관).
- 추후 필요 시 전이 로그 기반 projection 확장으로 full ES에 단계적으로 접근 가능하다.

## 3. Core Tables

## 3.1 `payment_intents`

결제 대상(주문/내부 청구) 단위의 루트 엔티티.

주요 컬럼:

- `id` (PK)
- `reference_type` (`STORE_ORDER` | `SUBSCRIPTION_BILLING`)
- `reference_id`
- `user_id`
- `currency`
- `payable_amount`
- `status` (`PaymentIntentStatus`)
- `expires_at`
- `version` (optimistic lock)
- `metadata` (jsonb)
- `created_at`, `updated_at`

핵심 제약:

- `reference_type` + `reference_id` + reference-blocking-status 유니크 (Partial Unique Index)
  - reference-blocking-status 확정값: `PENDING`, `IN_PROGRESS`, `PARTIALLY_CAPTURED`, `RECONCILING`
- `payable_amount >= 0`

운영 조회용 상태 집합(애플리케이션 규칙):

- checkout-active-status: `PENDING`, `IN_PROGRESS`, `PARTIALLY_CAPTURED`
- `SUSPENDED`, `RECONCILE_REQUIRED`, `SUPERSEDED_RECONCILE_REQUIRED`는 reference-blocking-status에 포함하지 않는다.

인덱스:

- `(reference_type, reference_id)`
- `(user_id, created_at desc)`
- `(status, expires_at)`

## 3.2 `payment_legs`

Intent를 결제수단 단위로 분할한 엔티티.

주요 컬럼:

- `id` (PK)
- `intent_id` (FK -> `payment_intents.id`)
- `provider_type`
- `amount`
- `status` (`PaymentLegStatus`)
- `is_required`
- `sequence_no`
- `version`
- `metadata` (jsonb)
- `created_at`, `updated_at`

핵심 제약:

- `amount > 0` (0원 leg 금지)
- `UNIQUE(intent_id, sequence_no)`
- `ZERO_VALUE`는 leg로 모델링하지 않음
  - v1 확정: `payable_amount == 0`이면 intent-level fast path로 즉시 완료 처리
  - 따라서 `payment_legs`에는 `ZERO_VALUE` 레코드가 존재하지 않음

인덱스:

- `(intent_id, status)`
- `(provider_type, status)`

## 3.3 `payment_attempts`

각 leg의 실제 결제 시도 이력.

주요 컬럼:

- `id` (PK)
- `intent_id` (FK)
- `leg_id` (FK)
- `attempt_no`
- `status` (`PaymentAttemptStatus`)
- `provider_transaction_id` (nullable)
- `provider_request_id` (nullable)
- `idempotency_key` (nullable)
- `error_code`, `error_message` (nullable)
- `request_payload` (jsonb, nullable)
- `response_payload` (jsonb, nullable)
- `created_at`, `updated_at`

핵심 제약:

- `UNIQUE(leg_id, attempt_no)`
- `provider_transaction_id`는 nullable unique 인덱스 권장 (provider별 충돌 방지)

인덱스:

- `(leg_id, created_at desc)`
- `(intent_id, created_at desc)`
- `(status, created_at desc)`

## 3.4 `refund_requests`

환불 요청 루트 엔티티.

주요 컬럼:

- `id` (PK)
- `intent_id` (FK)
- `reference_type`
- `reference_id`
- `status` (`RefundRequestStatus`)
- `refund_amount`
- `currency`
- `reason_code`
- `reason_message` (nullable)
- `requested_by`
- `approved_by` (nullable)
- `rejected_by` (nullable)
- `metadata` (jsonb)
- `created_at`, `updated_at`

핵심 제약:

- `refund_amount > 0`
- `refund_amount <= refundable_cap` (DB만으로 완전 보장 어려움, 트랜잭션 검증 필수)

인덱스:

- `(intent_id, created_at desc)`
- `(status, created_at asc)`

## 3.5 `refund_allocations`

환불 요청의 leg별 배분 상세.

주요 컬럼:

- `id` (PK)
- `refund_request_id` (FK)
- `intent_id` (FK)
- `leg_id` (FK)
- `amount`
- `created_at`

핵심 제약:

- `amount > 0`
- `UNIQUE(refund_request_id, leg_id)`

정합성 규칙(애플리케이션 검증):

- `SUM(refund_allocations.amount) == refund_requests.refund_amount`
- 각 leg별 누적 환불 금액 상한 초과 금지

## 3.6 `manual_cancel_queue_items`

자동 취소/보상 실패 건의 수동 처리 큐.

주요 컬럼:

- `id` (PK)
- `intent_id` (FK)
- `leg_id` (FK, non-null)
- `action_type` (`CANCEL` | `REFUND` | `MANUAL_CONFIRM`)
- `status` (`ManualCancellationQueueStatus`)
- `reason_code`
- `reason_message` (nullable)
- `assigned_to` (nullable)
- `priority` (default normal)
- `retry_count`
- `last_error_code` (nullable)
- `last_error_message` (nullable)
- `created_at`, `updated_at`

핵심 제약:

- `leg_id`는 필수다. (`manual_cancel_queue_items`는 leg-level 항목만 허용)

인덱스:

- `(status, priority, created_at)`
- `(assigned_to, status)`
- `(intent_id, status)`
- partial unique index (open 상태 전용):
  - `UNIQUE(intent_id, leg_id) WHERE status IN ('QUEUED', 'ASSIGNED', 'PROCESSING', 'FAILED_RETRYABLE')`
  - 의미: open 상태에서는 동일 `intent_id + leg_id` 중복 금지, closed 상태에서는 이력 누적 허용

## 4. Cross-Cutting Tables

## 4.1 `payment_state_transitions` (append-only)

상태가 있는 모든 엔티티의 전이 이력 저장 테이블.

주요 컬럼:

- `id` (PK)
- `entity_type` (`INTENT` | `LEG` | `ATTEMPT` | `REFUND_REQUEST` | `MANUAL_CANCEL_QUEUE_ITEM`)
- `entity_id`
- `previous_status` (nullable, 최초 생성 시)
- `new_status`
- `reason_code` (nullable)
- `reason_message` (nullable)
- `triggered_by_type` (`SYSTEM` | `USER` | `ADMIN` | `WEBHOOK` | `COMMAND`)
- `triggered_by_id` (nullable)
- `correlation_id`
- `causation_id` (nullable)
- `occurred_at`
- `payload` (jsonb, nullable)

인덱스:

- `(entity_type, entity_id, occurred_at desc)`
- `(correlation_id, occurred_at asc)`

규칙:

- `UPDATE`/`DELETE` 금지 (append-only)

## 4.2 `outbox_events`

도메인 이벤트 발행을 위한 transactional outbox.

주요 컬럼(권장):

- `id`, `event_type`, `aggregate_type`, `aggregate_id`
- `partition_key` (`intent_id`)
- `payload`, `status`, `attempts`
- `next_attempt_at`, `published_at`, `created_at`, `updated_at`

## 4.3 `idempotency_keys`

변경성 API/커맨드의 중복 처리 방지.

v1 결정:

- 기존 Wallet의 공용 `idempotency_keys` 테이블을 재사용한다.
- 단, 키 충돌/오용 방지를 위해 scope/operation/요청주체 축을 포함해 식별한다.

주요 컬럼:

- `idempotency_key`
- `scope` (`HTTP` | `COMMAND`)
- `operation` (`CreatePaymentIntent` 등)
- `actor_id` (요청 주체 식별자: `userId` 또는 내부 서비스명)
- `request_hash`
- `request_method` (HTTP scope에서 사용)
- `request_path` (HTTP scope에서 사용)
- `response_snapshot` (nullable)
- `response_code` (nullable)
- `status`
- `expires_at`
- `created_at`

핵심 제약:

- `UNIQUE(scope, operation, actor_id, idempotency_key)`

동작 규칙:

- 동일 `(scope, operation, actor_id, idempotency_key)` + 동일 `request_hash`:
  - 기존 `response_snapshot`/`response_code` 재사용
- 동일 키 + 다른 `request_hash`:
  - 요청 거절 (`409 Conflict`)
- 상태 `PENDING`인 동일 키 재요청:
  - 요청 거절 (`409 Conflict`, in-progress)

## 4.4 `provider_webhook_receipts`

Provider 웹훅 중복 수신 방지를 위한 수신 이력 테이블.

주요 컬럼:

- `id` (PK)
- `provider_type`
- `provider_event_id`
- `payload_hash` (nullable)
- `status` (`RECEIVED` | `PROCESSED` | `IGNORED_DUPLICATE` | `FAILED`)
- `received_at`
- `processed_at` (nullable)
- `last_error_code` (nullable)
- `last_error_message` (nullable)
- `created_at`, `updated_at`

핵심 제약:

- `UNIQUE(provider_type, provider_event_id)`

인덱스:

- `(provider_type, received_at desc)`
- `(status, received_at asc)`

동작 규칙:

- 웹훅 핸들러는 상태 전이 전에 receipt insert를 먼저 시도한다.
- 유니크 충돌이면 중복 웹훅으로 간주하고 no-op `2xx`를 반환한다.
- 최초 insert 성공 건만 상태 전이/이벤트 발행 로직을 수행한다.

## 5. Transaction Pattern

상태 변경 로직은 다음 순서를 강제한다.

1. 대상 row 락 획득 (`SELECT ... FOR UPDATE`)
2. 현재 상태와 전이 가능성 검증
3. 상태 row 업데이트 (`status`, `version`, `updated_at`)
4. `payment_state_transitions`에 전이 로그 insert
5. 필요 시 `outbox_events` insert
6. 커밋

## 6. Data Retention Policy (v1)

- 결제 도메인 데이터는 무기한 보관한다.
- 아래 테이블군에는 TTL purge/hard delete를 적용하지 않는다.
  - `payment_intents`, `payment_legs`, `payment_attempts`
  - `refund_requests`, `refund_allocations`
  - `manual_cancel_queue_items`
  - `payment_state_transitions`, `outbox_events`
  - `idempotency_keys`, `provider_webhook_receipts`
- `expires_at`는 데이터 삭제 시점이 아니라 비즈니스 유효성 검증용 필드다.
- 저장소 최적화가 필요하면 삭제가 아니라 보관 계층 분리(archive partition/tiering)로 처리한다.

## 7. Optional Table (Future)

`payment_mandates`는 정기결제 수단 동의/해지 추적이 필요해질 때 추가한다.

- v1에서는 필수 아님
- 단, provider가 recurring token/billing key를 요구하면 `payment_profiles` 확장으로 우선 처리 가능

## 8. Open Decisions

- 현재 없음
