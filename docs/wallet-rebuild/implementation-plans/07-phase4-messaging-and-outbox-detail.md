# Phase 4 - Messaging and Outbox Detail Plan

## 1. 목적

이 문서는 Wallet rebuild의 Phase 4(메시지 계약 + Outbox)의 상세 실행 계획을 정의한다.  
Sprint 3에서 환불/보상/정합성 구현을 우선 완료한 뒤, 메시징 안정화 항목을 분리한 실행 문서다.

핵심 목표:

- `payments.commands.v1` 소비 안정화
- `payments.events.v1` 발행 계약 정합성 강화
- transactional outbox의 원자성/순서/재시도 정책 확정
- `S-MSG-*` P0 시나리오를 출시 게이트 수준으로 고정

---

## 2. 현재 상태 요약 (코드 기준)

이미 구현된 항목:

- Command consumer:
  - `CreatePaymentIntent`
  - `StartPaymentLeg`
  - `CancelPaymentIntent`
  - `ExpirePaymentIntent`
  - `SupersedePaymentIntent`
  - `RequestRefund`
  - `RetryReconcile`
- 이벤트 발행:
  - `PaymentIntentSucceeded|Failed|Expired|Cancelled|Superseded`
  - `PaymentReconcileRequired`
  - `RefundRequested|Completed|Failed`
- Outbox dispatcher:
  - cron dispatch
  - `PENDING -> PROCESSING -> PUBLISHED|FAILED` 상태 관리
  - exponential backoff 재시도
  - stuck `PROCESSING` 재큐잉

Phase 4에서 추가 하드닝이 필요한 항목:

- 동일 `intentId`(동일 partition key) 이벤트 순서 보장 강화
- 이벤트 payload 계약 누락 방지(필수 필드 회귀 차단)
- 상태/이벤트 원자성을 테스트로 강제
- 운영 관측 포인트(지연/실패/적체) 명확화

---

## 3. 범위

### In Scope

- Command consumer 검증/멱등/stale command 처리 정책 고정
- Event payload contract strict check
- Outbox dispatch ordering hardening
- Outbox retry/failure/poison 이벤트 정책 정리
- 메시징 통합 테스트 세트 강화 (`S-MSG-001~006`)

### Out of Scope

- Admin API 기능 확장
- Webhook 수신 경계 구현 (`S-MSG-008~009`, Sprint 4 범위)
- 새로운 Provider(TOSS/BANK_TRANSFER) 메시징 시나리오 확대

---

## 4. 불변식 (Phase 4)

- 상태 변경 트랜잭션에서 `state row + transition log + outbox row`는 반드시 원자적으로 커밋된다.
- 동일 `intentId` 스트림에서 이벤트 순서는 역전되지 않는다.
- `PaymentIntentSucceeded` 이후 동일 intent에 `PaymentIntentFailed`가 발행되지 않는다.
- 이벤트 payload는 `packages/event-contracts` 필수 필드를 항상 만족한다.
- Command는 `idempotencyKey` 기준으로 중복 처리된다.

---

## 5. 작업 패키지

## 5.1 Command Consumer Hardening

대상 파일:

- `apps/wallet/src/messaging/payments-command.consumer.ts`
- `apps/wallet/src/domain/idempotency/idempotency.service.ts`

작업:

- 커맨드별 payload 필수값 재검증(도메인 레벨 방어)
- `expiresAt` 처리 정책을 로그/메트릭 포함 형태로 고정
- 실패 스냅샷 포맷 표준화 (`error`, `message`, `commandType`, `correlationId`)
- 중복 커맨드 replay 케이스 테스트 보강

완료 기준:

- `S-MSG-001`, `S-MSG-002` 재현 테스트 통과
- stale command 처리 정책이 문서/코드/테스트로 일치

## 5.2 Event Payload Contract Hardening

대상 파일:

- `apps/wallet/src/intents/intents.service.ts`
- `apps/wallet/src/reconcile/reconcile.service.ts`
- `apps/wallet/src/messaging/outbox-dispatcher.service.ts`
- `packages/event-contracts/streams/payments-v1.stream.ts`

작업:

- 이벤트 생성 로직을 공통 팩토리/빌더로 정리하여 payload 누락 방지
- `PaymentIntent*` 공통 필드:
  - `intentId`, `referenceType`, `referenceId`, `customerId`,
    `status`, `payableAmount`, `currency`, `occurredAt`
- `Refund*` 공통 필드:
  - `refundId`, `intentId`, `referenceType`, `referenceId`, `customerId`,
    `refundAmount`, `currency`, `allocation`, `occurredAt`
- payload 회귀 테스트 추가

완료 기준:

- `S-MSG-006` 통과
- 필수 필드 누락 회귀 테스트 0건

## 5.3 Transactional Outbox Invariant Enforcement

대상 파일:

- `apps/wallet/src/domain/state-transition/state-transition.service.ts`
- `apps/wallet/src/intents/intents.service.ts`
- `apps/wallet/src/reconcile/reconcile.service.ts`

작업:

- 상태 전이 도중 outbox insert 실패 시 전체 롤백 검증 테스트 추가
- 서비스 레벨 수동 outbox insert 지점을 최소화/일관화
- outbox row 생성 시 `messageId`, `partitionKey`, `eventType` 필수 검증

완료 기준:

- `S-MSG-005` 통과
- 상태/이벤트 불일치 재현 테스트에서 불일치 0건

## 5.4 Outbox Dispatch Ordering Hardening

대상 파일:

- `apps/wallet/src/messaging/outbox-dispatcher.service.ts`

작업:

- head-of-line 정책 추가:
  - 동일 `partition_key`에서 가장 오래된 미발행 이벤트만 처리 대상
- 앞선 이벤트 실패 시 같은 partition의 후속 이벤트 발행 차단
- 멀티 인스턴스에서 `skip locked` 사용 시에도 partition 내 순서 보존되도록 쿼리/락 전략 보완
- retry/backoff와 ordering의 상호작용을 테스트로 고정

완료 기준:

- `S-MSG-003`, `S-MSG-004` 통과
- 동일 intent 이벤트 순서 역전 재현 케이스 차단

## 5.5 Observability and Ops

대상:

- 메트릭/로그/알람

작업:

- 메트릭 추가:
  - `wallet_outbox_pending_count`
  - `wallet_outbox_processing_count`
  - `wallet_outbox_failed_count`
  - `wallet_outbox_publish_latency_ms`
  - `wallet_command_consume_failed_total{messageType}`
- 공통 로그 필드:
  - `messageId`, `messageType`, `correlationId`, `intentId`, `partitionKey`, `outboxEventId`
- 알람 기준:
  - outbox `FAILED` 누적 급증
  - pending 적체 임계치 초과

완료 기준:

- 장애 발생 시 “어떤 메시지가 왜 실패했는지” 1 hop 추적 가능

---

## 6. 테스트 계획

필수 시나리오:

- `S-MSG-001`: `CreatePaymentIntent` command 수신 처리
- `S-MSG-002`: command 중복 전달 방어
- `S-MSG-003`: 동일 intent 이벤트 순서 보장
- `S-MSG-004`: 성공 후 실패 이벤트 역전 금지
- `S-MSG-005`: outbox 원자성
- `S-MSG-006`: `RefundCompleted` payload 검증

추가 권장 시나리오:

- 같은 `intentId`에 대해 첫 outbox 이벤트 실패 시 2번째 이벤트 발행 차단
- dispatcher 재기동 후 ordering 유지
- schema 통과/실패 케이스 발행 검증

---

## 7. PR 분할 제안

1. PR-A: 이벤트 payload 빌더 도입 + 계약 필드 정리
2. PR-B: outbox ordering hardening + 관련 통합테스트
3. PR-C: command consumer 하드닝 + idempotency 보강 테스트
4. PR-D: 메트릭/로그 + 운영 runbook 반영

---

## 8. Definition of Done (Phase 4)

- `S-MSG-001~006` P0 100% 통과
- 동일 intent 이벤트 순서 역전 0건
- 상태/이벤트 불일치 0건
- outbox 실패/재시도/적체 관측이 운영에서 즉시 가능
- 구현/테스트/문서(`design/03`, 본 문서) 간 계약 불일치 0건

---

## 9. 리스크와 대응

- 리스크: ordering 강제로 처리량 저하
  - 대응: partition 단위 head-of-line만 강제, 배치 크기/cron 튜닝
- 리스크: outbox poison 이벤트로 스트림 정체
  - 대응: `FAILED` 상태 전환 + 알람 + 운영 재처리 절차
- 리스크: payload 필드 누락 회귀
  - 대응: 이벤트 빌더 단일화 + 계약 테스트 고정

---

## 10. 산출물

- 메시징/Outbox 상세 실행 문서(본 문서)
- command consumer 하드닝 코드 + 테스트
- outbox ordering 하드닝 코드 + 테스트
- 이벤트 payload 계약 검증 테스트
- 운영 메트릭/알람 설정 초안
