# Phase 5A - Payment Safety Refactor Plan (Webhook Deferred)

## 1. 문서 목적

이 문서는 현재 `wallet` 코드베이스의 구조적 리스크 중 아래 4개를 해결하기 위한 상세 리팩토링 실행 계획이다.

- 외부 결제 호출 exactly-once 보장 부족
- idempotency 처리 원자성 부족
- outbox partition head-of-line 영구 정지 위험
- `IntentsService` 과대화로 인한 변경 안정성 저하

중요: `webhook controller` 추가/구현은 본 문서 범위에서 제외한다. (추후 별도 스프린트)

---

## 2. 범위

## 2.1 In Scope

- Provider 호출 경로의 중복 실행 방지(especially `CAPTURE`)
- HTTP/Command idempotency begin/complete 원자화
- Outbox dispatch liveness 보장(terminal failure 이후 파티션 진행 가능)
- Intent/Refund/Compensation orchestration 서비스 분해

## 2.2 Out of Scope

- `POST /v1/webhooks/{provider}` 컨트롤러 구현
- `provider_webhook_receipts` 실처리 경계 구현
- 신규 provider(TOSS/BANK_TRANSFER) 확장

---

## 3. 현재 문제와 목표 상태

| ID | 문제 | 현재 증상 | 목표 상태 |
| --- | --- | --- | --- |
| P1 | Provider exactly-once 부족 | 같은 business action에서 중복 provider call 가능 | 동일 액션은 동일 provider idempotency key 재사용 + active attempt 중복 차단 |
| P2 | Idempotency 원자성 부족 | `find -> insert/update` race, command FAILED 자동 재시작 | 행 잠금 기반 begin/complete, FAILED 자동 재시작 제거 |
| P3 | Outbox HOL 영구 정지 | 선행 이벤트 `FAILED` 시 같은 partition 후속 이벤트 정체 가능 | poison 이벤트는 terminal 처리 후 파티션 진행 허용 |
| P4 | IntentsService 과대화 | 단일 파일에서 유스케이스/보상/큐 로직 과집중 | 유스케이스별 서비스 분리 + 기존 API 호환 유지 |

---

## 4. 고정 설계 결정 (Context Compression Anchor)

아래 결정은 구현 중 변경하지 않는 기본 합의사항이다.

- `D-000`: Webhook 구현은 defer. 본 문서 범위에서 다루지 않는다.
- `D-101`: 모든 provider write 호출(`AUTHORIZE`, `CAPTURE`, `CANCEL`, `REFUND`)은 idempotency key를 필수로 전달한다.
- `D-102`: 동일 `legId + operation`에 대해 active attempt는 1개만 허용한다.
- `D-103`: provider 응답 불확실(네트워크/timeout) 실패는 즉시 재시도보다 `PENDING_PROVIDER`/정합성 처리 경로를 우선한다.
- `D-201`: idempotency begin/complete는 단일 트랜잭션 + row lock 기준으로 동작한다.
- `D-202`: command idempotency `FAILED` 레코드를 자동으로 `PENDING` 재시작하지 않는다.
- `D-301`: outbox는 "엄격한 무한 대기"보다 "관측 가능한 terminal 처리 + 후속 진행"을 우선한다.
- `D-401`: `IntentsService` 분해는 "Facade 유지 -> 내부 위임 전환 -> 최종 정리" 순으로 점진 전환한다.

---

## 5. 워크스트림 상세 계획

## 5.1 WS-1 Provider Exactly-Once Hardening

### 5.1.1 데이터 모델 변경

대상 파일:
- `apps/wallet/src/schema.ts`
- `apps/wallet/src/types.ts`
- `apps/wallet/src/domain/state-transition/state-transition.rules.ts`
- `apps/wallet/src/domain/state-transition/state-transition.service.ts`
- drizzle migration 파일

변경안:
- `payment_attempts`에 `operation` 컬럼 추가 (enum: `AUTHORIZE|CAPTURE|CANCEL|REFUND|MANUAL_CONFIRM`)
- `payment_attempts`에 `provider_idempotency_key` 컬럼 추가 (not null)
- `payment_attempts`에 partial unique index 추가:
  - `uq_payment_attempts_active_leg_operation`
  - key: `(leg_id, operation)`
  - condition status in (`CREATED`, `SENT`, `PENDING_PROVIDER`, `REQUIRES_ACTION`, `CANCEL_REQUESTED`, `REFUND_REQUESTED`)
- `payment_attempts`에 unique index 추가:
  - `uq_payment_attempts_provider_idempotency_key`

마이그레이션/backfill:
1. nullable로 컬럼 추가
2. 기존 row backfill:
   - `operation`: `request_payload->>'operation'` 매핑
   - `provider_idempotency_key`: deterministic fallback (`wallet:legacy:{attempt_id}`)
3. backfill 완료 후 not null + index 적용

### 5.1.2 애플리케이션 로직 변경

대상 파일:
- `apps/wallet/src/intents/intents.service.ts`
- `apps/wallet/src/providers/payment-provider.types.ts`
- `apps/wallet/src/providers/*.ts`
- `apps/wallet/src/reconcile/reconcile.service.ts`

변경안:
- `createAttempt`에서 `operation`, `provider_idempotency_key`를 생성/저장
- provider request에 `idempotencyKey` 필수 전달
- `authorize/capture/cancel/refund` 호출 전 active attempt 조회
  - active 존재 시 새 attempt를 만들지 않고 기존 attempt를 재사용 또는 충돌 반환
- `capture` 경로 보강:
  - 호출 불확실 실패는 `FAILED_RETRYABLE` 즉시 확장 대신 `PENDING_PROVIDER`로 전환
  - 재호출은 reconciliation 우선 정책 적용
- `reconcile`이 `UNKNOWN`뿐 아니라 `PENDING_PROVIDER`, `REQUIRES_ACTION` attempt를 포함하도록 확장

### 5.1.3 테스트/검증

필수 테스트:
- 동시 `captureLeg` 2회 호출 시 provider 호출 1회만 발생
- provider timeout 이후 동일 `capture` 재호출 시 새 외부 결제 생성이 차단됨
- partial unique index로 active attempt 중복이 DB 레벨에서 차단됨
- reconcile 완료 후 동일 leg 재처리 가능

완료 기준:
- 외부 결제 중복 생성 재현 시나리오 0건
- `CAPTURE` 중복 트리거 시 동일 provider idempotency key만 사용

---

## 5.2 WS-2 Idempotency Atomicity Hardening

### 5.2.1 저장소 인터페이스 재설계

대상 파일:
- `apps/wallet/src/domain/idempotency/idempotency.repository.ts`
- `apps/wallet/src/domain/idempotency/idempotency.service.ts`
- `apps/wallet/src/domain/idempotency/idempotency.schema.ts`

변경안:
- repository에 트랜잭션/락 지향 메서드 추가:
  - `findByIdForUpdate(tx, id)`
  - `insertOrSelect(tx, newRecord)` 또는 동등한 upsert helper
  - `completeIfPending(tx, id, status, response...)`
- `completeSuccess/completeFailure`는 `WHERE id=? AND status='PENDING'` 조건부 업데이트
- `idempotency_keys`에 `updatedAt` 컬럼 추가

### 5.2.2 begin/complete 알고리즘

`begin` 알고리즘(HTTP/COMMAND 공통):
1. transaction 시작
2. row lock 조회 (`FOR UPDATE`)
3. row 없음 -> insert `PENDING`
4. row 존재 + 만료 -> guarded reset (`expires_at <= now`)
5. row 존재 + 해시 mismatch -> `409`
6. row 존재 + `PENDING`:
   - HTTP: `409 IN_PROGRESS`
   - COMMAND: `202 IN_PROGRESS` replay
7. row 존재 + terminal -> replay

`complete` 알고리즘:
1. transaction 시작
2. `PENDING` 조건부 update
3. update 0건이면 no-op + warning log (이미 terminal 처리된 race)

### 5.2.3 command 재시도 정책 변경

대상 파일:
- `apps/wallet/src/domain/idempotency/idempotency.service.ts`
- `apps/wallet/src/messaging/payments-command.consumer.ts`

변경안:
- command에서 기존 `FAILED -> PENDING` 자동 재시작 제거
- 재시도는 새 idempotency key 또는 별도 운영 retry command로만 허용

### 5.2.4 테스트/검증

필수 테스트:
- 만료 레코드 동시 갱신 race에서 단일 요청만 `STARTED`
- complete double-submit race에서 상태 역전/덮어쓰기 없음
- command `FAILED` 재전달 시 자동 재실행되지 않음

완료 기준:
- idempotency race 재현 테스트에서 중복 실행 0건

---

## 5.3 WS-3 Outbox Liveness Hardening

### 5.3.1 dispatch 정책 변경

대상 파일:
- `apps/wallet/src/messaging/outbox-dispatcher.service.ts`
- `apps/wallet/src/schema.ts`

변경안:
- acquire 쿼리의 선행 이벤트 blocking 조건을 "미발행 중 진행중 이벤트"로 제한
  - block statuses: `PENDING`, `PROCESSING`
  - terminal statuses(`PUBLISHED`, `FAILED`/`DEAD_LETTER`)는 block에서 제외
- terminal failure를 명확히 분리
  - 옵션 A: 기존 `FAILED` 재사용
  - 옵션 B(권장): `DEAD_LETTER` 상태 추가 + `dead_lettered_at`/reason 보존

권장 선택:
- 옵션 B (`DEAD_LETTER`) 적용
- 이유: 운영 관측과 재처리 경로 분리가 명확함

### 5.3.2 운영 보강

- dead-letter 누적 알람 추가
- partition별 pending age 모니터링
- 이벤트 단건 재큐잉 스크립트 추가 (`scripts/wallet/requeue-outbox-event.ts`)

### 5.3.3 테스트/검증

필수 테스트:
- 선행 이벤트 terminal 실패 후 후속 이벤트가 발행 진행됨
- 동일 partition 내 `PENDING/PROCESSING` 이벤트는 순서가 역전되지 않음
- dead-letter 발생 시 로그/메트릭으로 즉시 추적 가능

완료 기준:
- outbox poison 이벤트 1건이 전체 partition을 영구 정지시키지 않음

---

## 5.4 WS-4 IntentsService Decomposition

### 5.4.1 목표 구조

대상 디렉토리(제안):
- `apps/wallet/src/intents/application/`
- `apps/wallet/src/intents/support/`

서비스 분해안:
- `IntentCreationService`: create/configure
- `LegExecutionService`: authorize/capture
- `IntentTerminationService`: cancel/supersede/expire + compensation
- `RefundOrchestrationService`: refund request + allocation 실행
- `IntentQueryService`: getIntent/getRefundRequest
- `AttemptService`(support): attempt 생성/영속
- `ManualActionQueueService`(support): manual queue upsert/state log (reconcile와 공유)

### 5.4.2 전환 방식 (Facade-first)

1단계:
- 기존 `IntentsService` 유지
- private method를 신규 서비스로 이동하고 위임만 수행

2단계:
- controller/consumer가 신규 유스케이스 서비스를 직접 사용하도록 점진 전환

3단계:
- `IntentsService`를 얇은 facade로 축소 또는 제거

핵심 원칙:
- API contract/응답 shape 불변
- 상태전이/이벤트 contract 불변

### 5.4.3 공통 로직 통합

- `manualCancelQueue` upsert 로직 중복 제거
  - 현재 `IntentsService`와 `ReconcileService` 중복 구현을 `ManualActionQueueService`로 통합
- attempt persistence/에러 마킹 로직 통합

### 5.4.4 테스트/검증

필수 테스트:
- 기존 intents/refund/reconcile 통합 시나리오 회귀 0건
- manual queue 생성/중복/재시도 카운트 동작 동일

완료 기준:
- `IntentsService` 파일 크기 대폭 축소
- 주요 유스케이스 파일별 책임이 명확히 분리

---

## 6. 실행 순서 (권장)

## Wave 0 - 준비

- [ ] baseline 문서/ADR 등록
- [ ] migration dry-run 계획 수립

## Wave 1 - DB 선행 변경

- [ ] `payment_attempts` 신규 컬럼/인덱스 추가 및 backfill
- [ ] `idempotency_keys.updated_at` 추가
- [ ] outbox `DEAD_LETTER` 상태(선택안 B) 추가

## Wave 2 - Exactly-once + Idempotency 원자화

- [ ] provider request `idempotencyKey` 필수화
- [ ] active attempt 중복 차단 로직 적용
- [ ] idempotency begin/complete row-lock 기반 전환
- [ ] command FAILED 자동재시작 제거

## Wave 3 - Outbox liveness

- [ ] dispatch acquire 쿼리 정책 수정
- [ ] dead-letter 처리/알람/재큐잉 도구 반영

## Wave 4 - 서비스 분해

- [x] support 서비스 분리(Attempt/ManualQueue)
- [x] orchestration 서비스 분리
- [x] IntentsService facade 최소화

---

## 7. PR 분할 제안

1. `PR-1`: schema migration + backfill + 타입 반영
2. `PR-2`: provider exactly-once path + active attempt guard
3. `PR-3`: idempotency atomic begin/complete + consumer 정책 변경
4. `PR-4`: outbox liveness/dead-letter + 운영 도구
5. `PR-5`: intents/reconcile service decomposition

각 PR 완료 시 필수:
- 통합 테스트
- 회귀 영향 문서화
- 롤백 방법 명시

---

## 8. Feature Flag / Rollout 전략

권장 플래그:
- `WALLET_PROVIDER_EXACTLY_ONCE_ENABLED`
- `WALLET_IDEMPOTENCY_ATOMIC_ENABLED`
- `WALLET_OUTBOX_DEAD_LETTER_ENABLED`
- `WALLET_INTENTS_REFACTOR_FACADE_ENABLED`

롤아웃:
1. flag off 배포
2. staging partial on
3. production canary on
4. 전체 on

롤백:
- 기능 플래그 즉시 off
- 데이터 스키마는 forward-compatible 유지

---

## 9. 검증 시나리오 매트릭스

필수 시나리오:
- `EX1`: capture 동시요청 중복 외부호출 방지
- `EX2`: provider timeout 후 중복 capture 방지 + reconcile 복구
- `ID1`: HTTP begin race 단일 STARTED 보장
- `ID2`: complete race 상태 역전 없음
- `ID3`: command FAILED 자동 재시작 차단
- `OB1`: poison 이벤트 이후 같은 partition 후속 이벤트 진행
- `OB2`: partition 내 진행중 이벤트 순서 역전 없음
- `RF1`: cancel/supersede/expire/refund 보상 경로 회귀 없음
- `RF2`: manual queue dedupe/retryCount 회귀 없음

---

## 10. Definition of Done

- P1~P4 리스크 항목이 코드/테스트/문서에서 모두 닫힘
- provider 중복 결제 재현 시나리오 0건
- idempotency race로 인한 중복 실행 0건
- outbox terminal failure 1건이 후속 발행을 영구 차단하지 않음
- `IntentsService` 책임 분리 완료(유스케이스별 서비스로 이관)

---

## 11. 리스크와 대응

- 리스크: 상태머신 확장으로 예상치 못한 전이 충돌
  - 대응: 상태전이 룰 테스트 먼저 보강 후 구현
- 리스크: 마이그레이션 시 기존 attempt 데이터 정합성
  - 대응: backfill 검증 쿼리 + 배포 전 샘플링 검증
- 리스크: dead-letter 허용으로 다운스트림 gap 인지 필요
  - 대응: dead-letter 이벤트 모니터링/알람과 수동 재처리 절차 동시 배포
- 리스크: 서비스 분해 중 회귀
  - 대응: facade-first, PR 소분, 각 단계마다 통합 시나리오 고정

---

## 12. 컨텍스트 압축용 요약 (필수 보존 항목)

컨텍스트가 압축되더라도 아래 12개는 유지한다.

1. Webhook은 이번 범위에서 제외.
2. Provider write 호출은 idempotency key 필수.
3. 동일 leg+operation active attempt 1개 원칙.
4. capture 불확실 실패는 즉시 재호출보다 reconcile 우선.
5. `payment_attempts`에 `operation`/`provider_idempotency_key` 도입.
6. Idempotency begin/complete는 row lock 트랜잭션으로 원자화.
7. Command `FAILED -> PENDING` 자동 재시작 제거.
8. Outbox poison 이벤트는 terminal 처리 후 파티션 진행 허용.
9. `DEAD_LETTER` 상태와 관측/재처리 절차를 함께 도입.
10. `IntentsService`는 facade-first로 점진 분해.
11. manual queue 중복 로직은 공통 서비스로 통합.
12. PR은 schema -> exactly-once -> idempotency -> outbox -> decomposition 순서.
