# Wallet App — CLAUDE.md

## 역할과 경계

### 책임지는 것
- **결제 인텐트(Payment Intent)** 전체 라이프사이클: 생성 → 확인 → 승인 → 캡처 → 성공/실패/취소
- **복합 결제**: 포인트 + 외부 PG(카드/계좌이체)를 하나의 인텐트에서 동시 처리
- **포인트 원장(Points Ledger)**: 적립, 차감, 홀드(예약), 캡처, 환불 — lot 기반 FIFO 할당
- **환불**: 전액/부분 환불, PG 연동 포함
- **결제 수단 관리**: 사용자별 결제 수단 등록/조회/삭제
- **Outbox 이벤트 발행**: 결제 상태 변경 시 Kafka/Medusa로 이벤트 전파
- **멱등성(Idempotency)**: SHA256 기반 요청 중복 방지
- **상태 전이 감사(Audit)**: 모든 엔티티의 상태 변경 이력 기록

### 책임지지 않는 것
- 사용자 인증/계정 관리 → `user-service`
- 주문 관리, 상품 정보 → `medusa`, `pim`
- 구독/멤버십 과금 로직 → `membership`
- 알림 발송 → `notification`

## Source of Truth (SoT)

| 데이터 | 설명 |
|--------|------|
| `payment_intents` + 하위 items/discounts | 결제 요청의 금액·상태·메타데이터 |
| `charges` | 개별 PG 승인/캡처/취소 기록 |
| `refunds` | 환불 기록 |
| `point_events` + `point_event_details` | 포인트 원장 (적립/차감/취소의 진실 원천) |
| `point_holds` + `point_hold_details` | 포인트 홀드(예약) — lot별 할당 추적 |
| `payment_state_transitions` | 모든 상태 전이 감사 로그 |
| `outbox_events` | 미발행 이벤트 큐 |
| `provider_webhook_receipts` | PG 웹훅 수신 중복 방지 |
| `idempotency_keys` | 요청 멱등성 키 |

## 핵심 설계 패턴

### Two-Phase Confirmation
인텐트 확인(confirm)은 2단계로 분리된다:
1. **Phase 1 (TX 내)**: 인텐트 잠금, 상태 검증, charge 레코드 생성, outbox 이벤트 적재
2. **Phase 2 (TX 외)**: 각 PG provider의 authorize 실행 (비동기 가능)

### Provider Registry
`PaymentProvider` 인터페이스(authorize/capture/cancel/refund/getStatus)를 구현하는 5개 provider:
- **POINTS** — 내부 포인트 원장 (lot 기반 FIFO 할당)
- **TOSS** — 토스페이먼츠 (클라이언트 checkout → 서버 approve → 웹훅)
- **NICEPAY** — 나이스페이 (Toss와 유사한 플로우)
- **BANK_TRANSFER** — 무통장입금 (수동 확인, PG API 없음)
- **BNPL** — 스텁

`ProviderRegistry`에 등록되어 DI로 주입된다.

### 포인트 원장 (Lot-based FIFO)
- `point_events`가 진실 원천 — balance = SUM(amount)
- `point_event_details`가 lot 단위 추적 (EARN detail ↔ REDEEM detail 연결)
- `point_holds`는 authorize 시 예약, capture 시 REDEEM 이벤트로 확정
- 사용 가능 잔액 = 확정 잔액 - AUTHORIZED 상태의 홀드 합계

### Outbox Pattern (자체 구현)
- `@app/events`의 outbox와 별도로, wallet 자체 `outbox_events` 테이블 사용
- `OutboxDispatcherService`가 크론으로 PENDING 이벤트를 폴링하여 Kafka 발행
- 지수 백오프(base 5s, max 300s, max 10회) + Dead Letter 지원
- `messageId`로 중복 발행 방지

### State Machine
`StateTransitionService`가 합법적 상태 전이만 허용하고, 모든 전이를 `payment_state_transitions`에 기록한다.
- Intent: CREATED → PROCESSING → AUTHORIZED → CAPTURED → SUCCEEDED (터미널: SUCCEEDED, FAILED, CANCELED)
- Charge: CREATED → PENDING → REQUIRES_ACTION → SUCCEEDED → CANCELED/REFUNDED
- Refund: PENDING → SUCCEEDED/FAILED

### 멱등성
- HTTP `Idempotency-Key` 헤더 → SHA256(body)와 조합하여 `idempotency_keys` 테이블에 기록
- 동일 키로 재요청 시 캐시된 응답 반환 (24h TTL)

## 인증/인가

`WalletAuthGuard`가 3가지 인증 모드를 지원:
- **API Key** (`WALLET_API_KEY`): 머천트 서버 → wallet 서버 간 호출. 대부분의 엔드포인트 기본값
- **JWT** (`@WalletJwtAuth()`): 브라우저 facing 엔드포인트 (쿠키 `accessToken` 또는 Authorization 헤더)
- **Admin JWT** (`@WalletAdminAuth()`): admin/master 역할 필요, API Key 폴백 없음

## 다른 앱과의 의존/연동

### 인바운드
| 호출자 | 방식 | 용도 |
|--------|------|------|
| `medusa` | HTTP (API Key) | 결제 인텐트 생성, 캡처, 환불 |
| `ugc-service` | Kafka (`UGC_COMMAND_STREAM`) | 리뷰 작성 시 포인트 적립 요청 (`EarnPointsRequested`) |

### 아웃바운드
| 대상 | 방식 | 용도 |
|------|------|------|
| 토스페이먼츠 | HTTP API | 결제 승인, 취소, 환불 |
| 나이스페이 | HTTP API | 결제 승인, 취소, 환불 |
| Kafka | Outbox → Producer | 결제 상태 이벤트 발행 (`payment.intent.*`, `gateway.charge.*`, `gateway.refund.*`) |
| `medusa` (옵션) | HTTP Webhook (`WALLET_MEDUSA_WEBHOOK_URL`) | 결제 인텐트 상태 변경 알림 |

## 스키마 구조 요약

```
┌─ payment_intents ──────────────┐
│  payableAmount, status, userId │
│  clientSecret, version, ...    │
├────────┬───────────────────────┤
│        ├─ payment_intent_items (lineId, unitPrice, quantity, baseAmount, payableAmount)
│        │   └─ payment_intent_item_discounts (kind: ITEM_PER_UNIT|ITEM_FLAT, amount)
│        └─ payment_intent_order_discounts (kind: ORDER, amount)
│
├─ charges (operation: AUTHORIZE|CAPTURE|CANCEL|REFUND, status, providerTransactionId)
│   └─ refunds (amount, status, providerRefundId)
│
└─ payment_state_transitions (entityType, previousStatus → newStatus, correlationId)

┌─ point_events (userId, eventType: EARN|REDEEM|EARN_CANCEL|REDEEM_CANCEL, amount ±)
│   └─ point_event_details (lot 단위 추적, earnedEventDetailId로 FIFO 연결)
│
├─ point_holds (userId, intentId, legId, amount, status: AUTHORIZED|CAPTURED|CANCELLED)
│   └─ point_hold_details (holdId ↔ earnedEventDetailId, lot별 할당량)
│
├─ outbox_events (eventType, payload, status, attempts, 지수 백오프)
├─ provider_webhook_receipts (providerType, providerEventId — 웹훅 중복 방지)
└─ idempotency_keys (requestHash, status, responseCode, responseBody)

payment_methods (userId, type: POINTS|CARD|BANK_TRANSFER|BNPL|TOSS|NICEPAY, providerData)
```

### 주요 제약 조건
- `charges`: intent당 동일 operation에 활성 charge는 하나만 (partial unique index)
- `point_holds`: legId당 AUTHORIZED 상태 홀드는 하나만 (partial unique index)
- 금액 필드: 대부분 non-negative 또는 positive check constraint
- `point_events`: eventType과 amount 부호 일치 강제 (EARN/REDEEM_CANCEL > 0, REDEEM/EARN_CANCEL < 0)

## Drizzle 설정

- 스키마: `apps/wallet/src/schema.ts` + `libs/events/src/outbox/outbox.schema.ts` + `libs/events/src/tracking/tracking.schema.ts`
- 스키마 필터: `public`, `event`
- 마이그레이션 출력: `apps/wallet/drizzle/`
- `strict: true` 설정됨
