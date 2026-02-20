# Wallet Rebuild - Points Ledger + Auth/Capture Integration (Draft)

## 1. Purpose

이 문서는 `POINTS` 결제수단을 Wallet의 `AUTHORIZE -> CAPTURE -> CANCEL/REFUND` 흐름과 통합하기 위한 설계를 정의한다.
핵심 목표는 다음 두 가지다.

- 개인 단위(`user_id`) 포인트 원장 모델 유지
- 결제 오케스트레이션의 상태머신/멱등/보상 정책과 충돌 없이 동작

## 2. Scope

- 포함:
  - 포인트 원장 데이터 모델
  - `PaymentProvider` 연동 방식
  - `available/confirmed` 잔액 계산 규칙
  - `AUTHORIZE/CAPTURE/CANCEL/REFUND` 매핑
- 제외:
  - 포인트 만료 정책
  - 추천/정산/인출 기능
  - 타 결제수단(`TOSS`, `BANK_TRANSFER`) 상세 구현

## 3. Terminology Mapping

- API/Wallet 도메인 입력: `userId`
- 포인트 원장 내부 키: `user_id`
- v1 정책:
  - 원장 테이블 컬럼명은 `user_id` 사용
  - Provider 경계에서 `userId -> user_id`로 매핑

## 4. Ledger Model

기본 철학은 "헤더 이벤트 + lot 상세" 2계층 모델이다.

- `point_events`: 이벤트 헤더(총액, 취소 참조, 결제 연계 식별자)
- `point_event_details`: lot 단위 상세(FIFO 차감/복원 근거)

이벤트 타입은 기존 4종을 유지한다.

- `EARN`
- `REDEEM`
- `EARN_CANCEL`
- `REDEEM_CANCEL`

## 5. Proposed Tables

## 5.1 `point_events`

- `id uuid` (v7 권장, 애플리케이션 생성)
- `user_id varchar(128) not null`
- `event_type point_event_type not null`
- `amount bigint not null` (signed)
- `original_event_id uuid null` (취소 대상 이벤트)
- `intent_id uuid null`
- `leg_id uuid null`
- `attempt_id uuid null`
- `provider_idempotency_key varchar(255) not null`
- `reason_code varchar(128) null`
- `reason_message text null`
- `metadata jsonb not null default '{}'`
- `created_at timestamptz not null default now()`

제약/인덱스:

- `unique(provider_idempotency_key)`
- `index(user_id, created_at)`
- `index(intent_id, leg_id, created_at)`
- `check(event_type/amount 부호 일관성)`

## 5.2 `point_event_details`

- `id uuid` (v7 권장)
- `point_event_id uuid not null` FK -> `point_events.id`
- `user_id varchar(128) not null`
- `event_type point_event_type not null`
- `amount bigint not null` (signed)
- `earned_event_detail_id uuid null` FK -> `point_event_details.id`
- `original_event_detail_id uuid null` FK -> `point_event_details.id`
- `created_at timestamptz not null default now()`

제약/인덱스:

- `index(user_id, earned_event_detail_id, created_at)`
- `index(point_event_id, created_at)`

## 5.3 `point_holds`

`AUTHORIZE` 단계의 예약 금액을 분리 추적하는 테이블.

- `id uuid` (v7 권장)
- `user_id varchar(128) not null`
- `intent_id uuid not null`
- `leg_id uuid not null`
- `attempt_id uuid not null`
- `provider_idempotency_key varchar(255) not null`
- `amount bigint not null` (positive)
- `status point_hold_status not null` (`AUTHORIZED`, `CAPTURED`, `CANCELLED`, `EXPIRED`)
- `captured_event_id uuid null` FK -> `point_events.id`
- `cancelled_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

제약/인덱스:

- `unique(provider_idempotency_key)`
- `unique(leg_id) where status='AUTHORIZED'`
- `index(user_id, status, created_at)`

## 5.4 `point_hold_details`

예약(hold)도 FIFO lot 근거를 남겨 capture/refund에서 재사용한다.

- `id uuid` (v7 권장)
- `hold_id uuid not null` FK -> `point_holds.id`
- `earned_event_detail_id uuid not null` FK -> `point_event_details.id`
- `amount bigint not null` (positive)
- `created_at timestamptz not null default now()`

제약/인덱스:

- `unique(hold_id, earned_event_detail_id)`
- `index(earned_event_detail_id)`

## 6. Balance Definitions

- `confirmed_balance(user_id)`:
  - `sum(point_events.amount)`
- `reserved_balance(user_id)`:
  - `sum(point_holds.amount where status='AUTHORIZED')`
- `available_balance(user_id)`:
  - `confirmed_balance - reserved_balance`

## 7. Operation Mapping

## 7.1 `AUTHORIZE`

1. `user_id` 단위 락 획득
2. `available_balance >= requested_amount` 검증
3. FIFO로 lot 배분(`point_hold_details` 생성)
4. `point_holds(status='AUTHORIZED')` 생성
5. Provider 결과: `AUTHORIZED`

원장(`point_events`)에는 아직 확정 차감을 기록하지 않는다.

## 7.2 `CAPTURE`

1. 활성 hold 조회(`leg_id` or `provider_idempotency_key`)
2. `REDEEM` 이벤트 1건 생성 (`amount = -hold.amount`)
3. hold detail 기반으로 `point_event_details` N건 생성 (각 lot 차감)
4. hold 상태 `CAPTURED`로 갱신, `captured_event_id` 연결
5. Provider 결과: `CAPTURED`

## 7.3 `CANCEL` / `EXPIRE`

1. 활성 hold 조회
2. hold 상태 `CANCELLED` 또는 `EXPIRED`로 갱신
3. 원장 이벤트 추가 없음 (확정 차감이 없었기 때문)
4. Provider 결과: `CANCELLED`

## 7.4 `REFUND`

1. 환불 대상 `REDEEM` 이벤트 식별
2. `REDEEM_CANCEL` 이벤트 생성 (`amount > 0`)
3. 원본 `REDEEM` detail을 기준으로 역분개 detail 생성
4. Provider 결과: `REFUNDED`

## 8. FIFO Rule

- `REDEEM`/`AUTHORIZE`는 항상 가장 오래된 적립 lot부터 소비
- lot 가용량은 `point_event_details` 누적으로 계산
- 부분 환불은 해당 `REDEEM`이 실제로 소비한 lot를 기준으로 역분개

## 9. Idempotency and Recovery

- 모든 provider 호출은 이미 Wallet의 `providerIdempotencyKey`를 사용한다.
- Points 원장/hold 테이블도 같은 키로 unique 제약을 둔다.
- 중복 호출 시 기존 결과를 재조회해 동일 응답을 반환한다.
- `getTransaction`은 `point_holds` + `point_events`를 조회해 최종 상태를 반환한다.

## 10. Concurrency Control

`user_id`별 직렬화가 필요하다. v1 권장안:

- 각 Points operation 트랜잭션 시작 시 `pg_advisory_xact_lock(hash(user_id))` 획득
- 동일 사용자 동시 authorize/capture/refund의 잔액 레이스 차단

## 11. Integration with Current Wallet Services

- `PaymentProvider` 기본 인터페이스는 유지한다.
- 구현 구조:
  - `providers/points/points.provider.ts`: capability + command adapter
  - `providers/points/points-ledger.service.ts`: 원장/hold 트랜잭션 로직
  - `providers/points/points-ledger.repository.ts`: SQL/Drizzle 접근

서비스 계층(`leg-execution`, `intent-termination`, `refund-orchestration`)은 기존처럼 `provider.execute()`만 호출한다.

## 12. Implementation Phases

1. 스키마 추가: `point_events`, `point_event_details`, `point_holds`, `point_hold_details`
2. Points ledger service 구현 + unit test
3. `PointsPaymentProvider`를 skeleton에서 실제 원장 구현으로 교체
4. 통합 테스트:
   - authorize/capture/cancel/refund 성공 경로
   - 중복 호출(idempotency) 경로
   - 동시 authorize 경쟁 경로
   - reconcile polling 복구 경로

## 13. Open Decisions

- `EARN`/`EARN_CANCEL`의 API 노출 방식(관리자 명령 vs 이벤트 소비)
- `REDEEM_CANCEL` 환불 시 lot 복원 순서(정방향/역방향)
- v1에서 `uuid v7` 생성 책임(애플리케이션 계층 vs DB 함수)
