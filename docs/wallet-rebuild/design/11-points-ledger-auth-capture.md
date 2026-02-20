# Wallet Rebuild - Points Ledger + Auth/Capture Integration (Wallet-Aligned Draft)

## 1. Purpose

이 문서는 `POINTS` 결제수단을 Wallet의 현재 코드 구조에 맞게 `AUTHORIZE -> CAPTURE -> CANCEL/REFUND` 흐름으로 통합하는 설계를 정의한다.

핵심 목표:

- 사용자 단위 포인트 원장(`user_id`) 유지
- Wallet 오케스트레이션(상태머신, attempt, 멱등, reconcile)과 충돌 없는 Provider 구현

## 2. Scope

- 포함:
  - Points 원장/hold 데이터 모델
  - `PaymentProvider` 연동 계약
  - `available/confirmed/reserved` 잔액 계산 규칙
  - `AUTHORIZE/CAPTURE/CANCEL/REFUND/getTransaction` 동작
- 제외:
  - 포인트 만료 정책
  - 추천/정산/인출
  - `TOSS`, `BANK_TRANSFER` 상세 구현

## 3. Wallet Contract Alignment (Current Code)

이 문서는 현재 Wallet 코드 계약을 기준으로 한다.

- Provider 인터페이스: `apps/wallet/src/providers/payment-provider.types.ts`
- Registry/Capability 검증: `apps/wallet/src/providers/provider.registry.ts`
- Provider 구현 위치: `apps/wallet/src/providers/points/points.provider.ts`

### 3.1 Provider Public Contract

`POINTS` Provider는 다음 public 계약을 따른다.

- `getStaticCapabilities()`
- `resolveRuntimeCapabilities(ctx)`
- `supports(capability, ctx)`
- `validateLeg(req)`
- `execute(cmd)`
- `getTransaction(req)` (`PollablePaymentProvider`)

v1은 `execute(cmd)` 단일 커맨드 방식(`op: AUTHORIZE|CAPTURE|CANCEL|REFUND|MANUAL_CONFIRM`)을 유지한다.

### 3.2 Points v1 Capability Set

`POINTS`는 v1에서 아래 capability를 선언한다.

- `AUTHORIZE`
- `CAPTURE`
- `CANCEL`
- `REFUND`
- `PARTIAL_REFUND`
- `POLL_STATUS`
- `AUTO_COMPENSATE`

`MANUAL_CONFIRM`, `WEBHOOK`, `CUSTOMER_ACTION`은 미지원이다.

### 3.3 Provider Result Contract

`execute()` 결과(`resultStatus`)는 아래 표준 값만 사용한다.

- `AUTHORIZED`
- `CAPTURED`
- `CANCELLED`
- `REFUNDED`
- `FAILED`
- 필요 시: `REQUIRES_CUSTOMER_ACTION`, `REQUIRES_ADMIN_CONFIRMATION`

`POINTS` v1에서는 일반적으로 `REQUIRES_*`를 사용하지 않는다.

## 4. Monetary Unit and Type Policy (v1 Fixed)

Wallet 현재 구현은 금액을 `integer`(minor unit)로 처리한다.

- Provider request의 `amount`는 정수(`number`)이다.
- v1 Points 원장/hold 금액 컬럼도 `integer`로 맞춘다.
- 모든 금액은 KRW 소수점 없는 minor unit으로 해석한다.

제약:

- 금액은 `> 0`(개별 operation amount)
- 음수/양수 의미는 event type으로 구분하거나, signed amount를 쓰더라도 체크 제약으로 일관성 보장

## 5. Ledger Model

기본 구조는 유지하되 Wallet attempt/멱등과 연결 가능하도록 컬럼을 보강한다.

### 5.1 `point_events`

이벤트 헤더(확정 회계 단위).

권장 컬럼:

- `id uuid` (애플리케이션 생성)
- `user_id varchar(128) not null`
- `event_type point_event_type not null` (`EARN`, `REDEEM`, `EARN_CANCEL`, `REDEEM_CANCEL`)
- `amount integer not null` (signed or unsigned+type 정책 중 하나로 고정)
- `original_event_id uuid null`
- `intent_id uuid null`
- `leg_id uuid null`
- `attempt_id uuid null`
- `provider_idempotency_key varchar(255) not null`
- `provider_transaction_id varchar(128) null`
- `reason_code varchar(128) null`
- `reason_message text null`
- `metadata jsonb not null default '{}'`
- `created_at timestamptz not null default now()`

제약/인덱스:

- `unique(provider_idempotency_key)`
- `index(user_id, created_at)`
- `index(intent_id, leg_id, created_at)`
- `check(event_type/amount 일관성)`

### 5.2 `point_event_details`

lot 단위 상세(FIFO 근거).

권장 컬럼:

- `id uuid`
- `point_event_id uuid not null` FK -> `point_events.id`
- `user_id varchar(128) not null`
- `event_type point_event_type not null`
- `amount integer not null`
- `earned_event_detail_id uuid null` FK -> `point_event_details.id`
- `original_event_detail_id uuid null` FK -> `point_event_details.id`
- `created_at timestamptz not null default now()`

제약/인덱스:

- `index(user_id, earned_event_detail_id, created_at)`
- `index(point_event_id, created_at)`

### 5.3 `point_holds`

`AUTHORIZE` 예약 상태를 추적한다.

권장 컬럼:

- `id uuid`
- `user_id varchar(128) not null`
- `intent_id uuid not null`
- `leg_id uuid not null`
- `authorize_attempt_id uuid not null`
- `authorize_provider_idempotency_key varchar(255) not null`
- `amount integer not null` (positive)
- `status point_hold_status not null` (`AUTHORIZED`, `CAPTURED`, `CANCELLED`)
- `captured_event_id uuid null` FK -> `point_events.id`
- `capture_attempt_id uuid null`
- `capture_provider_idempotency_key varchar(255) null`
- `cancel_attempt_id uuid null`
- `cancel_provider_idempotency_key varchar(255) null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

제약/인덱스:

- `unique(authorize_provider_idempotency_key)`
- `unique(capture_provider_idempotency_key)` where not null
- `unique(cancel_provider_idempotency_key)` where not null
- `unique(leg_id) where status='AUTHORIZED'`
- `index(user_id, status, created_at)`

### 5.4 `point_hold_details`

hold 생성 시점 lot 배분 근거를 저장한다.

권장 컬럼:

- `id uuid`
- `hold_id uuid not null` FK -> `point_holds.id`
- `earned_event_detail_id uuid not null` FK -> `point_event_details.id`
- `amount integer not null` (positive)
- `created_at timestamptz not null default now()`

제약/인덱스:

- `unique(hold_id, earned_event_detail_id)`
- `index(earned_event_detail_id)`

## 6. Balance Definitions

- `confirmed_balance(user_id)`: `sum(point_events.amount)`
- `reserved_balance(user_id)`: `sum(point_holds.amount where status='AUTHORIZED')`
- `available_balance(user_id)`: `confirmed_balance - reserved_balance`

## 7. Operation Mapping (Wallet Flow Compatible)

### 7.1 `validateLeg`

- `amount > 0` 확인
- `currency == KRW` 확인
- 필요 시 provider-specific metadata 검증

### 7.2 `AUTHORIZE`

입력: Wallet이 전달한 `attemptId`, `idempotencyKey(providerIdempotencyKey)`, `userId`, `intentId`, `legId`, `amount`.

처리:

1. `pg_advisory_xact_lock`으로 `user_id` 단위 직렬화
2. 동일 `authorize_provider_idempotency_key` 존재 시 기존 결과 재반환
3. `available_balance >= amount` 검증
4. FIFO로 lot 배분(`point_hold_details`) 생성
5. `point_holds(status='AUTHORIZED')` 생성
6. `ProviderOperationResult { resultStatus: 'AUTHORIZED' }` 반환

실패 규칙:

- 비즈니스 거절(잔액 부족 등): `resultStatus: 'FAILED'` 반환
- 시스템/DB 불확실 오류: exception throw (Wallet에서 재시도/정리 경로로 처리)

### 7.3 `CAPTURE`

처리:

1. `user_id` 락 획득
2. 대상 hold 조회 (`leg_id` + `status='AUTHORIZED'` 우선)
3. 이미 같은 `capture_provider_idempotency_key`로 처리되었으면 기존 결과 재반환
4. `REDEEM` 이벤트 생성 (`amount = -hold.amount`)
5. hold detail 기반 `point_event_details` 생성
6. hold 상태를 `CAPTURED`로 전이
7. `resultStatus: 'CAPTURED'` 반환

예외:

- hold 없음/상태 불일치: `FAILED` 또는 이미 처리 상태(`CAPTURED`) 재반환 정책 중 하나로 고정
- v1 권장: 같은 leg가 이미 capture 완료면 `CAPTURED` 재반환

### 7.4 `CANCEL` (Intent cancel/expire/supersede compensation)

처리:

1. `user_id` 락 획득
2. `AUTHORIZED` hold 조회
3. 동일 cancel idempotency key 중복 처리 방지
4. hold 상태를 `CANCELLED`로 전이
5. 원장 이벤트 추가 없음
6. `resultStatus: 'CANCELLED'` 반환

주의:

- Wallet 보상 서비스는 `AUTHORIZED` leg에 대해 `CANCEL`을 호출한다.
- `CAPTURED` leg는 보상에서 `REFUND`를 호출한다.

### 7.5 `REFUND`

처리:

1. `user_id` 락 획득
2. 환불 대상 `REDEEM` 이벤트/lot 식별
3. 동일 refund idempotency key 중복 처리 방지
4. `REDEEM_CANCEL` 이벤트 생성(양수)
5. 원본 `REDEEM` detail 기준 역분개 detail 생성
6. `resultStatus: 'REFUNDED'` 반환

부분 환불:

- Wallet은 allocation 기반 부분 환불을 실행하므로 Points는 부분 환불을 지원해야 한다.

## 8. Reconcile Contract (`getTransaction`)

`ReconcileService`는 `getTransaction()`의 `status` 문자열을 Wallet 규칙으로 해석한다.

v1에서 Points는 아래 canonical status를 반환한다.

- `AUTHORIZED`
- `CAPTURED`
- `CANCELLED`
- `REFUNDED`

operation별 해석 규칙(현재 코드 기준):

- AUTHORIZE attempt: `AUTHORIZED` 또는 `CAPTURED`면 해소
- CAPTURE attempt: `CAPTURED`면 해소
- CANCEL attempt: `CANCELLED` 또는 `REFUNDED`면 해소
- REFUND attempt: `REFUNDED`면 해소

그 외 상태는 unresolved로 간주되어 Wallet이 `RECONCILE_REQUIRED`로 남길 수 있다.

## 9. Idempotency and Recovery

Wallet은 각 attempt마다 `providerIdempotencyKey`를 발급한다.

- 패턴: `wallet:attempt:{legId}:{operation}:{attemptNo}`
- Points ledger/hold도 이 키를 unique 제약으로 사용한다.

규칙:

- 같은 key 재호출 시 기존 결과를 그대로 재반환
- 같은 key로 신규 event/hold를 다시 생성하지 않음
- `providerTransactionId`는 재반환 시 동일 값 유지

복구:

- 중간 실패(커밋 불확실) 이후 재호출 시 key 기반 재조회로 최종 상태를 복원
- `getTransaction`은 hold/event를 조회해 canonical status를 반환

## 10. Concurrency Control

`user_id` 단위 직렬화가 필수다.

v1 권장:

- operation 트랜잭션 시작 시 `pg_advisory_xact_lock(hashtext('POINTS_LEDGER'), hashtext(user_id))`
- hold/event row는 필요한 경우 `FOR UPDATE`로 잠금

목표:

- 동시 authorize로 인한 잔액 레이스 방지
- capture/cancel/refund 중복 처리 방지

## 11. Error Handling Policy

Wallet 오케스트레이션과 정합성을 위해 오류를 두 가지로 구분한다.

- 비즈니스 실패(확정 실패): `resultStatus: FAILED`
  - 예: 잔액 부족, 환불 가능 금액 초과
- 불확실 실패(시스템 장애): exception throw
  - Wallet이 attempt를 `FAILED_RETRYABLE` 또는 `PENDING_PROVIDER`/`RECONCILE_REQUIRED`로 이동시킬 수 있음

## 12. Integration with Current Wallet Services

서비스 계층은 기존처럼 `provider.execute()`와 `provider.getTransaction()`만 사용한다.

- `intent-creation`: `AUTHORIZE` capability 검증 + `validateLeg`
- `leg-execution`: `AUTHORIZE`, `CAPTURE`
- `intent-termination`: 보상 `CANCEL`/`REFUND`
- `refund-orchestration`: allocation 기반 `REFUND`
- `reconcile`: `POLL_STATUS` + `getTransaction`

구현 구조:

- `apps/wallet/src/providers/points/points.provider.ts`: capability + command adapter
- `apps/wallet/src/providers/points/points-ledger.service.ts`: 트랜잭션 유즈케이스
- `apps/wallet/src/providers/points/points-ledger.repository.ts`: Drizzle/SQL 접근

## 13. Implementation Phases

1. 스키마 추가
   - `point_events`, `point_event_details`, `point_holds`, `point_hold_details`
2. ledger service/repository 구현
3. `PointsPaymentProvider`를 mock/skeleton에서 실제 ledger 호출로 교체
4. 통합 테스트
   - authorize/capture/cancel/refund 성공
   - 중복 호출(idempotency)
   - 동시 authorize 경쟁
   - reconcile polling 복구
   - 보상 실패 후 manual queue 연계

## 14. v1 Fixed Decisions

- Provider 공개 계약은 현재 코드와 동일하게 `execute(cmd)` 단일 진입점 사용
- 금액 타입은 Wallet과 동일하게 `integer` minor unit 사용
- `POINTS`는 v1에서 `MANUAL_CONFIRM`, `WEBHOOK`, `CUSTOMER_ACTION` 미지원
- 부분 환불은 지원(`PARTIAL_REFUND` capability)

## 15. Open Decisions

- `EARN`/`EARN_CANCEL` 공급 경로
  - 관리자 명령 기반으로 시작할지, 외부 이벤트 소비 기반으로 시작할지
- `REDEEM_CANCEL` lot 복원 순서
  - 원본 소비 순서 역순/정순 중 운영 관점에서 고정 필요
- UUID 생성 책임
  - 애플리케이션 생성 vs DB 함수 생성
