# Sprint 3 - Refund, Compensation, Messaging

## 1. 목표

결제 후속 처리(환불/보상/정합성)와 메시지 입출력 체계를 완성한다.

- allocation 기반 환불 무결성
- 실패/만료/대체 보상 처리
- reconcile batch
- `payments.commands.v1` / `payments.events.v1` 계약 구현

## 2. 범위

### In Scope

- Refund API
  - `POST /v1/intents/{intentId}/refund-requests`
  - `GET /v1/refund-requests/{refundId}`
- 보상 오케스트레이션(cancel 우선, refund 후행)
- 수동 큐 등록 정책 연동
- reconcile 배치/재처리 기본 로직
- Command consumer / Event publisher / transactional outbox

### Out of Scope

- 관리자 화면 UX
- TOSS/BANK_TRANSFER 고급 복구 로직

## 3. 구현 작업

## 3.1 환불 무결성

- allocation 필수 강제(단일 결제 포함)
- `sum(allocation.amount) == refundAmount` 검증
- 캡처 leg 여부, 누적 환불 한도 검증
- 실패 코드 표준화(`ALLOCATION_INVALID`, `REFUND_LIMIT_EXCEEDED`)

## 3.2 보상/정합성

- 종료 경로별 보상 트리거
- 자동 보상 1회 시도
- 실패 시 `RECONCILE_REQUIRED` 및 queue item 생성
- reconcile batch(주기 + 수동 트리거)

## 3.3 메시지 계약

- Commands:
  - `CreatePaymentIntent`
  - `StartPaymentLeg`
  - `CancelPaymentIntent`
  - `RequestRefund`
  - `RetryReconcile`
- Events:
  - `PaymentIntentSucceeded|Failed|Expired|Cancelled|Superseded`
  - `PaymentReconcileRequired`
  - `RefundRequested|Completed|Failed`
- outbox dispatcher와 retry 정책 연결

## 4. 완료 조건 (Definition of Done)

- 환불 성공/실패/거절 경로 모두 상태 정합성 확보
- 보상 실패 건이 100% 수동 큐로 추적
- 상태/이벤트 커밋 원자성 보장(outbox pattern)
- 동일 intent 스트림 이벤트 순서 보장

## 5. 테스트 체크리스트

- `S-RFD-001~008`
- `S-CMP-001~008`
- `S-MSG-001~006`
- `S-DB-005~007`

## 6. 리스크와 대응

- 리스크: 환불 누적 계산 race condition
  - 대응: tx 락 + 합계 검증을 동일 트랜잭션 내 수행
- 리스크: outbox 누락으로 상태/이벤트 불일치
  - 대응: 전이 유틸에 outbox insert 강제 포함

## 7. 산출물

- refund/compensation/reconcile 서비스 코드
- command consumer + event publisher + outbox dispatcher
- integration/e2e 테스트 세트

