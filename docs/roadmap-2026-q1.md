# 단기-중기 개선 계획: 빌링 / 멤버십 / 분산 트레이싱

> 작성일: 2026-03-23 | 상태: Draft

---

## 목차

1. [과제 1: Wallet 결제 계층 리팩토링 + 빌링 기능 추가](#과제-1-wallet-결제-계층-리팩토링--빌링정기결제-기능-추가)
2. [과제 2: Membership 앱 완성](#과제-2-membership-앱-완성)
3. [과제 3: OpenTelemetry 분산 트레이싱 도입](#과제-3-opentelemetry-분산-트레이싱-도입)
4. [과제 간 의존 관계](#과제-간-의존-관계)
5. [실행 순서 제안](#실행-순서-제안)

---

## 과제 1: Wallet 결제 계층 리팩토링 + 빌링(정기결제) 기능 추가

### 1.1 현재 상태

Wallet은 **PaymentIntent 기반 단발성 결제**를 지원한다. 핵심 구조:

- `PaymentProvider` 인터페이스로 Toss, Points, BankTransfer를 추상화
- `authorize → capture` 2단계 흐름
- 복합결제(포인트 + 외부수단) 지원
- Transactional Outbox를 통한 이벤트 발행

빌링(정기결제)은 **"사용자 인증 없이 저장된 결제수단으로 반복 결제"**를 의미하며, 현재 이 기능은 없다.

### 1.2 문제 정의

정기결제를 구현하려면 아래 기능이 필요하다:

| 기능 | 설명 |
|------|------|
| **결제수단 등록** | 사용자가 빌링에 사용할 카드/계좌를 인증하고 billingKey(토큰)를 발급 |
| **빌링키 저장** | 발급된 billingKey를 안전하게 저장하고 사용자와 매핑 |
| **스케줄링 없는 승인** | 저장된 빌링키로 원하는 시점에 결제를 실행 (PG사는 스케줄링을 제공하지 않음) |
| **빌링키 관리** | 만료, 삭제, 갱신, 웹훅(BILLING_DELETED 등) 처리 |
| **실패 처리** | 잔고부족/한도초과 시 재시도(dunning) 로직 |

여기에 더해, 향후 BNPL(나중결제), CMS(자동이체), 선불잔액 등을 도입할 것을 고려하면 현재 구조로는 아래 문제가 발생한다:

1. **PointsLedgerService가 Points 전용**: BNPL도 거의 동일한 장부 로직(hold/capture/release/credit/debit)이 필요한데, 현재는 이를 재사용할 수 없어 중복 구현이 불가피
2. **BillingProvider를 별도 인터페이스로 두면**: PaymentProvider와 이중 계층이 되어 Orchestrator가 두 인터페이스를 따로 다뤄야 함
3. **Intent 용도 구분 부재**: 구매 결제와 BNPL 상환이 같은 intent인데 분석 시 이중계산 위험

이 시스템은 아직 프로덕션 전이므로, **기존 코드를 최대한 보존하면서 빌링/BNPL/다양한 결제수단을 자연스럽게 확장할 수 있는 구조로 개선**한다.

### 1.3 설계: Interface Segregation + Composition

#### 핵심 통찰

현재 Wallet이 하는 일은 근본적으로 두 가지다:

| 역할 | 설명 | 현재 구현 | 해당 수단 |
|------|------|----------|----------|
| **돈을 옮긴다** (Payment Gateway) | 외부 결제망을 통해 실제 금전 이동 | TossPaymentProvider, BankTransferProvider | 카드, 계좌이체, CMS, 빌링키 |
| **값을 추적한다** (Account Ledger) | 내부 장부에 잔고/한도를 기록 | PointsLedgerService (Points 전용) | 포인트, BNPL 신용, 선불잔액, 상품권 |

이 두 역할이 `PaymentProvider`라는 하나의 인터페이스에 섞여 있는 것은 문제다. 하지만 이를 해결하기 위해 **하나의 범용 장부 서비스(Generic Ledger)로 모든 장부형 수단을 통합하는 것은 과도한 일반화**다.

#### 왜 Generic Ledger가 아닌가

현재 `PointsLedgerService`의 `authorize()`를 보면, FIFO 기반 다중 lot 할당이 hold 연산에 **깊이 통합**되어 있다:

```
authorize() 내부:
  1. pg_advisory_xact_lock 획득
  2. 잔고 계산 (pointEvents 합산 - 예약 holds)
  3. lot별 가용량 SQL (pointEventDetails self-join + left join)
  4. FIFO 순서로 lot 할당
  5. pointHold + pointHoldDetails 삽입 (원자적)
```

이 로직을 Generic Ledger로 추출하면 세 가지 문제가 생긴다:

| 문제 | 설명 |
|------|------|
| **BNPL에 불필요한 복잡도** | BNPL은 lot 개념이 없는데, Generic Ledger가 lot 할당을 내장하면 BNPL 경로에 불필요한 분기가 유입된다 |
| **원자성 파손** | lot 할당을 Executor가 처리하고 Generic Ledger는 단순 hold만 하게 하면, 현재의 트랜잭션 원자성이 깨지거나 인터페이스가 오염된다 |
| **config 분기** | `accounts.config`에 `{ lotTracking: true }` 같은 JSON을 넣고 런타임에 분기하면, 타입 안전성이 없는 `if (type === 'POINTS')` 분기와 다를 바 없다 |

더 중요한 문제: BNPL은 **구매-상환 매핑**이 필요하다. 분쟁 처리, 부분 상환, 연체 관리를 위해 "이 상환이 어떤 구매를 커버하는지"를 추적해야 하는데, 이는 범용 hold/capture/credit/debit의 범위를 넘어서는 BNPL 고유 도메인 로직이다.

#### 설계 원칙

1. **PaymentProvider 인터페이스를 최소 확장** — `kind` 속성 추가 (분류 메타데이터)
2. **빌링키 관리를 독립 모듈로 분리** — Orchestrator는 빌링키의 존재를 모름
3. **Discount + Primary 슬롯 모델** — ConfirmService의 복합결제 분기를 2-슬롯 파이프라인으로 단순화
4. **장부형 수단의 공통 인터페이스(LedgerOperations)는 도입하지 않음** — BNPL 착수 시 실제 시그니처를 보고 판단 (YAGNI)
5. **기존 PointsLedgerService 코드 보존** — 잘 동작하는 코드를 건드리지 않음

#### 전체 구조

```
┌──────────────────────────────────────────────────────────────────┐
│                              Wallet                               │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  PaymentProvider (기존 인터페이스, 최소 확장)                  │ │
│  │                                                              │ │
│  │  interface PaymentProvider {                                 │ │
│  │    readonly providerType: string;                           │ │
│  │    readonly autoCapture: boolean;                           │ │
│  │    readonly kind: 'gateway' | 'ledger';  // NEW (분류용)    │ │
│  │                                                              │ │
│  │    authorize(params): Promise<ChargeResult>;                │ │
│  │    capture(params): Promise<ChargeResult>;                  │ │
│  │    cancel(params): Promise<ChargeResult>;                   │ │
│  │    refund(params): Promise<RefundResult>;                   │ │
│  │  }                                                           │ │
│  │                                                              │ │
│  │  Gateway 구현체:                                             │ │
│  │    TossCheckoutProvider  — 기존 (결제창)                      │ │
│  │    TossBillingProvider   — NEW (빌링키 즉시 승인)             │ │
│  │    BankTransferProvider  — 기존 (수동 입금)                   │ │
│  │    CmsAutoDebitProvider  — FUTURE (자동이체)                  │ │
│  │                                                              │ │
│  │  Ledger 구현체:                                              │ │
│  │    PointsProvider        — 기존 (PointsLedgerService 직접)   │ │
│  │    BnplProvider          — FUTURE (BnplLedgerService 직접)   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  BillingMethodService (독립 모듈)                            │ │
│  │                                                              │ │
│  │  billing_methods 테이블 CRUD                                 │ │
│  │  빌링키 발급 / 저장 / 삭제 / 웹훅 처리                        │ │
│  │                                                              │ │
│  │  → TossBillingProvider가 이 서비스를 주입받아 사용            │ │
│  │  → Orchestrator는 BillingMethodService를 직접 알지 못함      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  BillingAgreementService (독립 모듈)                         │ │
│  │                                                              │ │
│  │  billing_agreements 테이블 CRUD                              │ │
│  │  외부 서비스(Membership 등)의 구독 ↔ 빌링수단 매핑 관리       │ │
│  │                                                              │ │
│  │  → Kafka billing.charge command 수신 시 결제수단 조회에 사용  │ │
│  │  → Checkout Session 완료 시 자동 생성                        │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  ConfirmService: Discount + Primary 슬롯 모델                │ │
│  │                                                              │ │
│  │  ChargePlan {                                               │ │
│  │    discount?: ChargeSlot   // Points만 가능. 부분 차감.      │ │
│  │    primary:  ChargeSlot    // Toss, Billing, BNPL, BT 중 1  │ │
│  │  }                                                           │ │
│  │                                                              │ │
│  │  실행 순서: discount.authorize() → primary.authorize()       │ │
│  │  보상 순서: primary.cancel() → discount.release()            │ │
│  │  슬롯 위치가 실행 순서를 결정 — kind로 분기하지 않음           │ │
│  │                                                              │ │
│  │  규칙:                                                       │ │
│  │    - 빌링(자동 정기결제): discount 불가, primary만            │ │
│  │    - 일반 결제: discount(선택) + primary(필수)                │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

#### PaymentProvider: kind 속성 추가

기존 `PaymentProvider` 인터페이스에 `kind` 속성 하나만 추가한다. 단, `kind`는 **Orchestrator의 분기 기준이 아니라 분류 메타데이터**다. 실행 순서는 Discount + Primary 슬롯 위치가 결정한다.

`capabilities` 플래그 묶음을 도입하지 않는 이유:

- `userInteractionRequired`는 실행 시점에 동적으로 결정되는 값이다 (3DS 필요 여부 등). 정적 속성으로는 부적합.
- `storedCredential`, `ledgerBacked` 등의 플래그는 Orchestrator 안에서 `if (flag)` 분기를 만들 뿐, 타입 분기를 플래그 분기로 바꾼 것에 불과.
- `kind`는 Provider 목록 UI, 모니터링 라벨, 로깅 등 분류 목적으로만 사용한다.

```typescript
interface PaymentProvider {
  readonly providerType: string;
  readonly autoCapture: boolean;
  readonly kind: 'gateway' | 'ledger';  // NEW: 분류 메타데이터 (UI, 모니터링, 로깅용)

  // 기존 메서드 — 변경 없음
  getUserMethods(userId: string): Promise<PaymentMethod[]>;
  validateMethod(params: ValidateMethodParams): Promise<void>;
  deleteMethod(params: DeleteMethodParams): Promise<void>;

  authorize(params: ChargeParams): Promise<ChargeResult>;
  capture(params: ChargeParams): Promise<ChargeResult>;
  cancel(params: ChargeParams): Promise<ChargeResult>;
  refund(params: RefundParams): Promise<RefundResult>;
}
```

각 Provider의 동작:

| Provider | kind | authorize() | autoCapture |
|----------|------|-------------|:-----------:|
| `TossCheckoutProvider` | gateway | REQUIRES_ACTION (결제창) | true |
| `TossBillingProvider` | gateway | 빌링키로 즉시 승인 → SUCCEEDED | true |
| `CmsAutoDebitProvider` | gateway | 은행에 출금 요청 → SUCCEEDED or PENDING | true |
| `PointsProvider` | ledger | PointsLedgerService.authorize() → AUTHORIZED | true |
| `BnplProvider` | ledger | BnplLedgerService.authorize() → AUTHORIZED | true |
| `BankTransferProvider` | gateway | REQUIRES_ACTION (수동 입금) | true |

**Orchestrator 입장에서는 전부 `provider.authorize()`일 뿐이다.** 실행 순서는 `kind`가 아니라 ChargePlan의 슬롯 위치(discount → primary)가 결정한다.

#### ConfirmService: Discount + Primary 슬롯 모델

현재 ConfirmService는 `points-only / external-only / composite` 3가지 모드를 명시적으로 분기한다. 여기에 BNPL이 추가되면 모드가 더 늘어나는 문제가 있다. **슬롯 모델**은 모드 분기를 제거하고 항상 동일한 파이프라인을 실행한다.

```typescript
// ChargePlan: ConfirmService의 실행 단위
interface ChargePlan {
  discount?: ChargeSlot;   // Points만 가능. 항상 동기, REQUIRES_ACTION 불가.
  primary:  ChargeSlot;    // 어떤 Provider든 가능. REQUIRES_ACTION 가능.
}

interface ChargeSlot {
  provider: PaymentProvider;
  amount: number;
  paymentMethodId: string;
}
```

**규칙:**
- discount는 항상 ledger이고 항상 동기 (REQUIRES_ACTION 불가)
- primary는 gateway든 ledger(BNPL)든 상관없음
- 빌링 (자동 정기결제, Kafka command): discount 슬롯 불가, primary만
- 최소 하나의 슬롯은 존재해야 함

**실행 파이프라인:**

```
confirm(intent, params):
  plan = buildChargePlan(intent, params)

  // Step 1: Discount (있으면)
  if plan.discount:
    result = authorizeCharge(plan.discount)
    if FAILED → fail(intent), return

  // Step 2: Primary
  result = authorizeCharge(plan.primary)
  if FAILED:
    if plan.discount → cancelCharge(discount)   // 보상
    fail(intent), return
  if REQUIRES_ACTION:
    pendAction(intent, result), return           // 사용자 행동 대기

  // Step 3: 전부 성공
  handleAllAuthorized(intent)
```

**이 구조에서 모든 현재 + 계획 조합이 자연스럽게 처리된다:**

| 결제 유형 | discount | primary | 흐름 |
|-----------|----------|---------|------|
| 카드 단독 | — | Toss (REQUIRES_ACTION) | Step 2 → 결제창 |
| 포인트 단독 | — | Points (SUCCEEDED) | Step 2만 |
| 포인트+카드 | Points | Toss (REQUIRES_ACTION) | Step 1 → Step 2 → 결제창 |
| BNPL 단독 | — | BNPL (SUCCEEDED) | Step 2만 |
| 포인트+BNPL | Points | BNPL (SUCCEEDED) | Step 1 → Step 2 |
| 빌링 (자동) | — | TossBilling (SUCCEEDED) | Step 2만 |
| 무통장입금 | — | BankTransfer (REQUIRES_ACTION) | Step 2 → 입금 대기 |

기존 ConfirmService의 3-모드 분기 (points-only / external-only / composite)가 **단일 파이프라인**으로 통합된다. BNPL이나 CMS 등 새 Provider가 추가되어도 ConfirmService 코드 변경이 없다.

#### CaptureService: 부분 실패 처리 (PARTIALLY_CAPTURED)

복합결제에서 CaptureService는 charge를 순서대로 capture한다. 이때 **일부 charge만 capture에 성공하고 나머지가 실패하는 경우**가 발생할 수 있다:

```
CaptureService:
  charge[0] (Points)  → capture() → SUCCEEDED  ✓
  charge[1] (Toss)    → capture() → FAILED     ✗  ← 부분 실패
```

Points는 이미 REDEEM(잔고 차감)이 완료되었으나 Toss는 실패한 상태로, 금전 불일치가 발생한다.

**자동 보상(자동 refund)을 하지 않는 이유:**
- refund API 호출 자체도 실패할 수 있어, 보상의 보상이 필요한 무한 루프 위험
- capture 부분 실패는 빈도가 극히 낮음 (Provider authorize 성공 후 capture 실패는 네트워크 이슈 등 예외적 상황)
- 자동 보상 오동작 시 금전 손실이 수동 해결보다 위험

**처리 방식 (방안 A: PARTIALLY_CAPTURED 상태 + 수동 해결):**

```
capture(intent):
  results = []
  for charge in succeededAuthorizeCharges:
    result = provider.capture(charge)
    results.push(result)

  if 전부 성공:
    intent → CAPTURED (기존과 동일)
  else if 일부만 성공:
    intent → PARTIALLY_CAPTURED        // NEW 상태
    운영 알림 발행 (Slack/이메일 등)     // 수동 해결 필요
  else:
    intent → FAILED
```

`PARTIALLY_CAPTURED` 상태의 Intent는:
- 관리자 대시보드에 별도 필터로 노출
- 운영자가 실패한 charge를 수동 재시도하거나, 성공한 charge를 수동 환불하여 해결
- 해결 후 관리자가 `CAPTURED` 또는 `CANCELED`로 수동 전이

**상태 전이 규칙 추가:**

```
AUTHORIZED → PARTIALLY_CAPTURED     (capture 부분 실패)
PARTIALLY_CAPTURED → CAPTURED       (관리자 수동 해결 후)
PARTIALLY_CAPTURED → CANCELED       (관리자 수동 취소)
```

#### 왜 LedgerOperations 공통 인터페이스를 도입하지 않는가

`LedgerOperations` 인터페이스 (`hold/capture/release/credit/debit/getAvailable`)를 정의해 PointsLedger와 BnplLedger가 구현하게 하는 방안을 검토했으나, 도입하지 않는다.

**시그니처 불일치 문제:** 현재 `PointsLedgerService.authorize()`는 `PointsOperationRequest`를 받으며, 여기에는 `legId`, `intentId`, idempotency key 등 결제 시스템 고유 컨텍스트가 포함된다. `LedgerOperations.hold(accountId, amount, tx)`의 범용 시그니처로는 이 정보를 전달할 수 없다. 어댑터를 만들면 컨텍스트 주입을 위한 우회 로직이 필요해지고, 결국 `PointsProvider`는 어댑터를 거치지 않고 `PointsLedgerService`를 직접 호출하게 된다. 그러면 `LedgerOperations`는 BNPL에서만 쓰이는 인터페이스가 되어 추상화의 의미가 희석된다.

**YAGNI 원칙:** `PaymentProvider` 인터페이스가 이미 Orchestrator에게 다형성을 제공하고 있다. 내부 장부 서비스 간 공통 인터페이스는 BNPL이 실제로 착수될 때, 양쪽의 실제 시그니처를 비교한 뒤 의미 있는 공통 부분이 있으면 그때 추출한다.

**장부형 수단의 테이블 분리 원칙은 유지한다:**

```
               Points                          BNPL
            ─────────────                   ─────────────
장부          point_events                    bnpl_credit_events
hold 내부     lot별 FIFO 할당                  한도 내 예약 (lot 없음)
capture       REDEEM (잔고 ↓) + lot 소진      EXTEND (미상환 ↑) + 구매 기록
credit        EARN (적립)                      REPAY (상환) + 구매 매핑
추적 대상     적립 건별 소진 이력               구매 건별 상환 이력
```

행위는 비슷하지만 **추적하는 대상의 구조가 다르다**. Points는 "적립 건(lot)"을 추적하고, BNPL은 "구매 건(purchase)"을 추적한다. 하나의 테이블로 통합하면 config 분기로 복잡도만 올라갈 뿐 실질적 재사용이 없다.

#### OutboxDispatcherService: Dual Dispatch (HTTP + Kafka)

현재 OutboxDispatcherService는 Medusa HTTP 웹훅으로만 이벤트를 전송한다. 하지만 다른 서비스(Membership, Analytics 등)도 결제 이벤트를 구독해야 하며, Kafka가 이미 서비스 간 이벤트 버스로 사용되고 있다. **Medusa는 HTTP 웹훅을 필요로 하고, 나머지 서비스는 Kafka를 구독한다.** 따라서 두 채널 모두 필요하다.

`outbox_events` 테이블에 `channel` 컬럼을 추가하고, OutboxDispatcherService가 채널별로 적절한 target에 dispatch한다:

```typescript
// outbox_events 테이블에 channel 추가
channel: text('channel').notNull(),  // 'MEDUSA_WEBHOOK' | 'KAFKA'

// Dispatch target 추상화
interface OutboxTarget {
  dispatch(event: OutboxEvent): Promise<void>;
}

class MedusaWebhookTarget implements OutboxTarget {
  // 기존 HTTP POST 로직 유지
}

class KafkaTarget implements OutboxTarget {
  // Kafka produce (topic: payment.events.v1)
}
```

**하나의 상태 전이가 두 outbox 레코드를 생성한다:**

```
StateTransitionService.transitionIntent(intent, CAPTURED):
  // 원자적 트랜잭션 내에서:
  1. intent 상태 업데이트
  2. 전이 로그 기록
  3. outbox 레코드 삽입 (channel: MEDUSA_WEBHOOK)   ← Medusa용
  4. outbox 레코드 삽입 (channel: KAFKA)             ← 다른 서비스용
```

양쪽 모두 동일한 outbox 테이블, 동일한 at-least-once 보장, 동일한 재시도/DLQ 메커니즘을 공유한다. 수신측은 각자 멱등성 처리를 담당한다.

#### BillingMethodService: 빌링키를 독립 모듈로 분리

빌링키 관리(발급/저장/삭제/웹훅)는 결제 실행과 독립적인 관심사다. `TossBillingProvider`가 이 서비스를 내부적으로 사용하되, Orchestrator는 빌링키의 존재를 모른다.

```typescript
@Injectable()
class BillingMethodService {
  async issueBillingKey(userId: string, authKey: string, customerKey: string): Promise<BillingMethod> {
    // Toss API 호출 → billingKey 발급
    // billing_methods 레코드 생성 (billingKey 평문 저장)
  }

  async revoke(billingMethodId: string): Promise<void> {
    // billing_methods 상태 → REVOKED
  }

  async getBillingKey(billingMethodId: string): Promise<string> {
    // billing_methods에서 billingKey 조회 반환
  }

  async handleBillingDeletedWebhook(payload: TossWebhookPayload): Promise<void> {
    // BILLING_DELETED 웹훅 처리
    // billing_methods 상태 → DELETED
  }
}
```

`TossBillingProvider`의 구현:

```typescript
@Injectable()
class TossBillingProvider implements PaymentProvider {
  readonly providerType = 'TOSS_BILLING';
  readonly kind = 'gateway' as const;
  readonly autoCapture = true;

  constructor(private billingMethods: BillingMethodService) {}

  async authorize(params: ChargeParams): Promise<ChargeResult> {
    // billingMethodId는 ChargeParams.metadata에서 전달
    const billingKey = await this.billingMethods.getBillingKey(params.billingMethodId);
    const result = await this.tossApi.confirmBilling(billingKey, {
      amount: params.amount,
      orderId: params.orderId,
    });
    return { status: 'SUCCEEDED', providerTransactionId: result.paymentKey, raw: result };
  }

  // capture: no-op (Toss 빌링은 즉시 승인)
  // cancel, refund: 기존 TossPaymentProvider와 동일한 API 호출
}
```

**기존 ConfirmService의 변경이 최소화된다.** `TossBillingProvider.authorize()`가 `SUCCEEDED`를 즉시 반환하므로, `REQUIRES_ACTION` 분기를 타지 않고 외부 단독 결제의 happy path를 그대로 탄다.

#### Intent Purpose: 분석 시 이중계산 방지

`payment_intents` 테이블에 `purpose` 필드를 pgEnum으로 추가한다:

```typescript
// schema.ts
export const intentPurposeEnum = pgEnum('intent_purpose', [
  'PURCHASE',
  'SUBSCRIPTION',
  'REPAYMENT',
  'PAYOUT',
]);

// paymentIntents 테이블 정의 내
purpose: intentPurposeEnum('purpose').notNull().default('PURCHASE'),
```

| Purpose | 의미 | 매출 집계 | 현금 흐름 집계 |
|---------|------|:---:|:---:|
| `PURCHASE` | 일반 구매 결제 | O | O |
| `SUBSCRIPTION` | 정기결제 구매 | O | O |
| `REPAYMENT` | BNPL 상환 | **X** | O |
| `PAYOUT` | 정산/출금 (미래) | **X** | O |

이 구분이 필요한 이유: BNPL 구매 시 PaymentIntent(PURCHASE)가 하나, 상환 시 PaymentIntent(REPAYMENT)가 하나 생긴다. 실제 매출은 PURCHASE 하나뿐이므로, `purpose`로 필터링하지 않으면 이중계산된다.

### 1.4 빌링 등록 및 결제 흐름

#### Checkout Session: wallet-web 기반 결제 위임

외부 서비스(Membership 등)가 Wallet의 결제 API를 직접 호출하지 않는다. 대신 **Checkout Session**을 생성하고, 사용자를 wallet-web으로 리다이렉트하여 결제를 위임한다. wallet-web은 Wallet과 직접 통신하므로 모든 결제수단을 알고 있다.

```
[Membership FE]             [Wallet API]              [wallet-web]
     │                           │                         │
     │  1. POST /v1/checkout-sessions                      │
     │     { amount, currency,   │                         │
     │       purpose: SUBSCRIPTION,                        │
     │       metadata: {         │                         │
     │         subscriptionId,   │                         │
     │         planId },         │                         │
     │       successUrl,         │                         │
     │       cancelUrl,          │                         │
     │       allowComposite }    │                         │
     │  ────────────────────────►│                         │
     │                           │                         │
     │  2. { sessionId,          │                         │
     │       checkoutUrl }       │                         │
     │  ◄────────────────────────│                         │
     │                           │                         │
     │  3. redirect(checkoutUrl) │                         │
     │  ──────────────────────────────────────────────────►│
     │                           │                         │
     │                           │  4. wallet-web:         │
     │                           │     세션 로드            │
     │                           │     결제수단 UI 표시     │
     │                           │     사용자 선택/결제     │
     │                           │◄────────────────────────│
     │                           │                         │
     │                           │  5. 결제 성공 시:        │
     │                           │     billing_agreements  │
     │                           │     레코드 자동 생성     │
     │                           │     (subscriptionId ↔   │
     │                           │      billingMethodId)   │
     │                           │                         │
     │  6. redirect(successUrl)  │                         │
     │  ◄──────────────────────────────────────────────────│
     │                           │                         │
     │  7. Kafka: payment.intent.captured                  │
     │  ◄────────────────────────│                         │
     │                           │                         │
     │  8. Membership BE:        │                         │
     │     구독 활성화            │                         │
```

사용자가 wallet-web에서 빌링 결제수단을 선택하고 첫 결제를 완료하면, Wallet이 `billing_agreements` 테이블에 `subscriptionId ↔ billingMethodId` 매핑을 저장한다. **Membership은 billingMethodId를 전혀 모른다.**

#### billing_agreements 테이블

```sql
billing_agreements (
  id                UUID PRIMARY KEY,
  user_id           VARCHAR(128) NOT NULL,
  billing_method_id UUID NOT NULL REFERENCES billing_methods(id),
  subscriber_ref    VARCHAR(255) NOT NULL,   -- 외부 참조 (e.g., subscriptionId)
  subscriber_type   VARCHAR(64) NOT NULL,    -- "MEMBERSHIP", "OTHER_SERVICE"
  status            TEXT NOT NULL,            -- ACTIVE, SUSPENDED, REVOKED
  created_at        TIMESTAMP,
  updated_at        TIMESTAMP,
  UNIQUE(subscriber_type, subscriber_ref)
)
```

#### 빌링키 등록 (빌링키 발급)

빌링키는 `billing_methods` 테이블에 저장한다. 이 테이블은 PG사 빌링키뿐 아니라 CMS 인증 정보 등 **반복 결제에 필요한 저장된 인증 정보**를 통합 관리한다. 빌링키 등록은 wallet-web에서 수행된다.

```
[wallet-web]                  [Wallet Backend]              [Toss API]
    │                               │                           │
    │  1. Toss SDK                  │                           │
    │     requestBillingAuth()      │                           │
    │  ─────────────────────────────────────────────────────►   │
    │                               │                           │
    │  2. successUrl redirect       │                           │
    │     ?authKey=...&customerKey=.│..                         │
    │  ◄────────────────────────────│───────────────────────    │
    │                               │                           │
    │  3. POST /v1/billing-methods  │                           │
    │     { authKey, customerKey }  │                           │
    │  ────────────────────────────►│                           │
    │                               │  4. POST /v1/billing/     │
    │                               │     authorizations/issue  │
    │                               │  ────────────────────────►│
    │                               │                           │
    │                               │  5. { billingKey, card }  │
    │                               │  ◄────────────────────────│
    │                               │                           │
    │  6. { billingMethodId }       │  Store in billing_methods │
    │  ◄────────────────────────────│                           │
```

#### 자동 정기결제 (Kafka Command)

사용자 부재 상태의 자동 정기결제는 Kafka command로 처리한다. Membership은 `subscriberRef`(subscriptionId)만 전달하고, Wallet이 `billing_agreements`에서 결제수단을 조회하여 청구한다.

```
[Membership cron]                    [Wallet]                   [Toss API]
     │                                    │                          │
     │  1. billingDate == today인         │                          │
     │     계약 조회                       │                          │
     │                                    │                          │
     │  2. billing_requests 레코드 생성    │                          │
     │     (status: REQUESTED)            │                          │
     │                                    │                          │
     │  3. Kafka Command:                 │                          │
     │     wallet.commands.v1             │                          │
     │     type: billing.charge           │                          │
     │     { subscriberType: MEMBERSHIP,  │                          │
     │       subscriberRef: subId,        │                          │
     │       amount, currency,            │                          │
     │       purpose: SUBSCRIPTION,       │                          │
     │       idempotencyKey:              │                          │
     │         "sub_123_cycle_7" }        │                          │
     │  ─────────────────────────────────►│                          │
     │                                    │                          │
     │              4. billing_agreements에서                         │
     │                 subscriberRef로                                │
     │                 billingMethodId 조회                           │
     │                                    │                          │
     │              5. PaymentIntent 생성  │                          │
     │                 (purpose: SUBSCRIPTION)                       │
     │                                    │                          │
     │              6. TossBillingProvider │                          │
     │                 .authorize()       │                          │
     │                                    │  7. POST /v1/billing/    │
     │                                    │     {billingKey}/confirm │
     │                                    │  ───────────────────────►│
     │                                    │                          │
     │                                    │  8. Payment 200 OK       │
     │                                    │  ◄───────────────────────│
     │                                    │                          │
     │              9. Charge → SUCCEEDED │                          │
     │                 Intent → CAPTURED  │                          │
     │                                    │                          │
     │  10. Kafka Event:                  │                          │
     │      payment.intent.captured       │                          │
     │  ◄─────────────────────────────────│                          │
     │                                    │                          │
     │  11. billing_requests 상태 업데이트 │                          │
     │      (SUCCEEDED)                   │                          │
     │      nextBillingDate 갱신          │                          │
     │      entitlement 연장              │                          │
```

**billing method가 없거나 만료된 경우:** Wallet이 `payment.intent.failed` 이벤트를 발행하고, Membership은 dunning 큐에 넣는다. 사용자에게 "결제수단을 업데이트하세요" 알림을 보내고, wallet-web으로의 결제수단 변경 링크를 제공한다.

### 1.5 BNPL(나중결제) 흐름 — 이 구조에서 자연스럽게 지원됨

BNPL은 결제수단이 아니라 **신용 장부(credit ledger)**다. BNPL 전용 테이블을 사용하는 `BnplLedgerService`를 만들고, 이를 내부적으로 사용하는 `BnplProvider`(`PaymentProvider` 구현체)를 등록하면 된다. Discount + Primary 슬롯 모델에서 BNPL은 **primary 슬롯**에 배치된다 (카드 결제와 동일한 위치).

#### BNPL 구매 (거래 1: 신용 확장)

```
주문 PaymentIntent (purpose: PURCHASE)
  └─ Charge (provider: BnplProvider, primary 슬롯)
      └─ BnplProvider.authorize()
         → BnplLedgerService.authorize(tx, req)    // 한도 확인, 예약
      └─ BnplProvider.capture()
         → BnplLedgerService.capture(tx, req)      // EXTEND 기록 (미상환 ↑)
         → bnpl_purchases 레코드 생성               // 구매 건 추적
```

포인트+BNPL 복합결제의 경우:

```
주문 PaymentIntent (purpose: PURCHASE)
  ├─ Charge (provider: PointsProvider, discount 슬롯, amount: 3000)
  │    └─ PointsLedgerService.authorize() → hold
  └─ Charge (provider: BnplProvider, primary 슬롯, amount: 7000)
       └─ BnplLedgerService.authorize() → hold
```

#### BNPL 상환 (거래 2: 실제 돈 이동, 완전 별도 거래)

```
상환 PaymentIntent (purpose: REPAYMENT)
  └─ Charge (provider: CmsAutoDebitProvider, primary 슬롯)
      └─ CmsAutoDebitProvider.authorize()  → 은행에 출금 요청
      └─ CmsAutoDebitProvider.capture()    → 출금 확인
      └─ 성공 시 → BnplLedgerService.credit(tx, req)    // REPAY (미상환 ↓)
                  → bnpl_repayments에 구매 건 매핑        // 구매-상환 추적
```

두 PaymentIntent는 서로를 모른다. **BnplLedgerService(전용 테이블)가 둘을 연결하는 유일한 접점**이다. BNPL 전용 테이블(`bnpl_purchases`, `bnpl_repayments`)을 사용하므로, 구매-상환 간 명시적 매핑이 가능하다. 이는 분쟁 처리, 부분 상환, 연체 관리의 전제조건이다.

상환 수단은 어떤 PaymentProvider든 사용 가능:

| 상환 수단 | Provider |
|----------|----------|
| CMS 자동이체 | `CmsAutoDebitProvider` |
| 카드 빌링 | `TossBillingProvider` |
| 포인트 | `PointsProvider` |
| 수동 입금 | `BankTransferProvider` |
| 복합 (포인트 일부 + CMS) | Discount + Primary 슬롯 모델로 지원 |

### 1.6 필요한 변경 사항

#### 최소 확장 (기존 코드 변경)

| 구분 | 현재 | 변경 후 |
|------|------|--------|
| **Provider 인터페이스** | `PaymentProvider` (kind 없음) | `PaymentProvider` + `kind: 'gateway' \| 'ledger'` 속성 추가 (분류 메타데이터) |
| **기존 Provider** | TossPaymentProvider, BankTransferProvider, PointsPaymentProvider | 각각 `kind` 속성만 추가 (코드 변경 1줄) |
| **PointsPaymentProvider** | PointsLedgerService 직접 사용 | 변경 없음 — 기존 직접 호출 유지 |
| **Intent 스키마** | `purpose` 없음 | `purpose` pgEnum 필드 추가 |
| **ConfirmService** | 3-모드 분기 (points-only / external-only / composite) | Discount + Primary 슬롯 파이프라인으로 리팩토링 |
| **Intent 상태** | `CAPTURED` 직행 | `PARTIALLY_CAPTURED` 상태 추가 (복합결제 capture 부분 실패 대응) |
| **CaptureService** | capture 실패 시 처리 없음 | 부분 실패 시 `PARTIALLY_CAPTURED` 전이 + 운영 알림 발행 |
| **OutboxDispatcherService** | Medusa HTTP 웹훅만 지원 | `channel` 필드 기반 dual dispatch (HTTP 웹훅 + Kafka) |
| **outbox_events 테이블** | channel 없음 | `channel` 컬럼 추가 (`MEDUSA_WEBHOOK` \| `KAFKA`) |

#### 새로 추가

| 구분 | 내용 |
|------|------|
| **테이블** | `billing_methods` (id, userId, providerType, billingKey, customerKey, method, metadata, status, expiresAt) |
| **테이블** | `billing_agreements` (id, userId, billingMethodId, subscriberRef, subscriberType, status) |
| **테이블** | `checkout_sessions` (id, amount, currency, purpose, metadata, successUrl, cancelUrl, allowComposite, intentId, status, expiresAt) |
| **모듈** | `billing/` — BillingMethodService, BillingMethodController, BillingAgreementService |
| **모듈** | `checkout/` — CheckoutSessionService, CheckoutSessionController |
| **Provider** | `TossBillingProvider` (빌링키로 즉시 결제, BillingMethodService 사용) |
| **Kafka Consumer** | `wallet.commands.v1` — `billing.charge` command 처리 (billing_agreements 조회 → 결제 실행) |
| **웹훅** | `BILLING_DELETED` 웹훅 핸들러 |

#### BNPL 도입 시 추가 (미래)

| 구분 | 내용 |
|------|------|
| **테이블** | `bnpl_credit_events`, `bnpl_purchases`, `bnpl_repayments` |
| **서비스** | `BnplLedgerService` (구매-상환 매핑 포함, 전용 테이블 사용) |
| **Provider** | `BnplProvider` (장부 기반, BnplLedgerService 사용) |
| **Provider** | `CmsAutoDebitProvider` (자동이체) |

#### 유지 (변경 없음)

| 구분 | 이유 |
|------|------|
| PointsLedgerService 내부 구현 | lot 추적, FIFO 소진, 유효기간 — 전부 그대로 동작 |
| point_events/holds 테이블 | 테이블 rename이나 스키마 변경 없음 |
| PaymentIntent → Charge 구조 | 복합결제 모델링에 여전히 최적 |
| 상태머신 + 전이 로그 | 감사/디버깅에 필수 |
| Transactional Outbox 패턴 | 서비스 간 통신의 근간. dispatch target을 HTTP/Kafka로 확장하되, outbox 자체의 원자적 기록 패턴은 유지 |
| 멱등성 (Idempotency) | 결제 시스템의 기본 요건 |
| Auto-capture 메커니즘 | 그대로 유지 |
| 웹훅 수신/중복제거 | 그대로 유지 |

---

## 과제 2: Membership 앱 완성

### 2.1 현재 상태

Membership은 약 **70~75% 완성** 상태이다:

**완성된 것:**
- 구독 생성/업그레이드/다운그레이드/취소
- 정기결제 스케줄러 (RecurringBillingService, cron 동작)
- 일시정지/재개 (이벤트 소싱 기반)
- 혜택 추적 (30일 주기 할인 집계)
- 환영 멤버십 추적
- 이벤트 발행 (MembershipStatusChanged)
- PaymentClientService를 통한 Wallet 연동 (→ Kafka command 기반으로 교체 예정)

**미완성/부재:**
- 구독 만료 스케줄러 (entitlement 자동 만료)
- 정책 엔진 (테이블에 정의만 있고 실제 검증 로직 없음)
- 환불 개시 (이벤트 수신만 있고 Wallet에 환불 요청하는 로직 없음)
- Dunning 자동화 (큐는 있지만 max 초과 시 자동 정지/취소 없음)
- 프로덕션 cron 설정 (`*/1 * * * *` → 일 1회로 변경 필요)
- 트라이얼 재사용 방지
- 알림 연동 (결제 실패/환불 실패 시 notification 발행)
- PaymentClientService → Kafka command 전환 (Wallet 직접 호출 제거)
- billing_requests 추적 테이블 + Reconciliation Job
- Checkout Session 기반 결제 흐름 (wallet-web 리다이렉트)

### 2.2 설계 목표

Membership이 **이벤트 기반으로 자율적으로 동작**하는 서비스가 되는 것:

```
                         Kafka
                           │
          ┌────────────────┼─────────────────┐
          │                │                 │
          ▼                ▼                 ▼
    ┌───────────┐   ┌───────────┐    ┌───────────┐
    │   Wallet  │   │Membership │    │ 기타 앱   │
    │           │   │           │    │(PIM, WMS  │
    │ payment.  │   │membership.│    │ 등)       │
    │ events.v1 │   │ events.v1 │    │           │
    └───────────┘   └───────────┘    └───────────┘

Membership이 발행하는 이벤트:
  - SubscriptionCreated
  - SubscriptionActive (갱신 포함)
  - SubscriptionCancelled
  - SubscriptionExpired (NEW)
  - SubscriptionPaused
  - SubscriptionResumed
  - BillingCycleStarted (NEW)
  - PaymentCollected (NEW)
  - PaymentFailed (NEW)

Membership이 소비하는 이벤트:
  - payment.intent.captured → 결제 성공 확인
  - payment.intent.failed → 결제 실패 처리
  - gateway.refund.succeeded → 환불 완료 확인
  - gateway.refund.failed → 환불 실패 처리
```

### 2.3 Wallet 빌링과의 연동 설계

Membership은 Wallet의 결제 API를 **직접 호출하지 않는다**. 두 가지 흐름으로 분리한다:

1. **사용자 발의 결제** (가입, 수동 갱신, 플랜 변경): Checkout Session → wallet-web 리다이렉트
2. **자동 정기결제** (cron, 사용자 부재): Kafka command → Wallet 소비

기존 `PaymentClientService`는 제거하고, Membership ↔ Wallet 간 통신은 Kafka 이벤트/커맨드로 통일한다 (Reconciliation의 최후 수단 조회 API 제외).

#### 사용자 발의 결제: Checkout Session

사용자가 구독에 가입하거나 플랜을 변경할 때, Membership 프론트엔드가 Wallet API에 Checkout Session을 생성하고 wallet-web으로 리다이렉트한다. wallet-web이 결제수단 선택 UI를 제공하고 결제를 완료한다. 상세 흐름은 [섹션 1.4](#14-빌링-등록-및-결제-흐름)를 참조.

**Membership이 결제수단(billingMethodId)을 알 필요가 없다.** wallet-web에서 사용자가 선택하고, Wallet이 `billing_agreements`에 매핑을 저장한다.

#### 자동 정기결제: Kafka Command

```
[Membership cron]                    [Wallet]
     │                                    │
     │  1. billingDate == today인         │
     │     계약 조회                       │
     │                                    │
     │  2. billing_requests 레코드 생성    │
     │     (status: REQUESTED,            │
     │      requestedAt: now)             │
     │                                    │
     │  3. Kafka Command:                 │
     │     wallet.commands.v1             │
     │     type: billing.charge           │
     │     { subscriberType: MEMBERSHIP,  │
     │       subscriberRef: subId,        │
     │       amount, currency,            │
     │       purpose: SUBSCRIPTION,       │
     │       idempotencyKey:              │
     │         "sub_123_cycle_7" }        │
     │  ─────────────────────────────────►│
     │                                    │
     │            4. billing_agreements에서│
     │               subscriberRef로      │
     │               billingMethodId 조회 │
     │                                    │
     │            5. PaymentIntent 생성   │
     │               TossBillingProvider  │
     │               로 결제 승인          │
     │                                    │
     │  6. Kafka Event:                   │
     │     payment.intent.captured        │
     │     또는 .failed                   │
     │  ◄─────────────────────────────────│
     │                                    │
     │  7. billing_requests 상태 업데이트  │
     │     (SUCCEEDED / FAILED)           │
     │     nextBillingDate 갱신            │
     │     entitlement 연장               │
     │     SubscriptionActive 이벤트 발행  │
```

**Membership은 billingMethodId를 모른다.** `subscriberRef`(subscriptionId)만 전달하면, Wallet이 `billing_agreements`에서 매핑된 결제수단을 찾아 청구한다.

**billing method가 없거나 만료된 경우:** Wallet이 `payment.intent.failed` 이벤트를 발행하고, Membership은 dunning 큐에 넣는다. 사용자에게 "결제수단을 업데이트하세요" 알림과 wallet-web 결제수단 변경 링크를 제공한다.

#### Reconciliation Job: limbo 상태 방지

Kafka command를 발행했지만 5분 내에 결과 이벤트를 수신하지 못한 경우를 대비한다. Membership 측에 `billing_requests` 추적 테이블을 두고 5분 주기로 reconciliation을 수행한다.

```sql
billing_requests (
  id               UUID PRIMARY KEY,
  subscription_id  UUID NOT NULL,
  cycle_id         VARCHAR(128) NOT NULL,
  amount           INTEGER NOT NULL,
  idempotency_key  VARCHAR(255) UNIQUE NOT NULL,
  status           TEXT NOT NULL,     -- REQUESTED, SUCCEEDED, FAILED
  intent_id        UUID,              -- Wallet에서 반환된 intentId (이벤트 수신 시 채움)
  requested_at     TIMESTAMP NOT NULL,
  resolved_at      TIMESTAMP,
  created_at       TIMESTAMP
)
```

```typescript
// 매 5분 실행
@Cron('*/5 * * * *')
async reconcilePendingBillingRequests() {
  const stale = await this.findRequests({
    status: 'REQUESTED',
    requestedAt: lessThan(now - 5min),
  });

  for (const req of stale) {
    // 1단계 (5~10분): Kafka command 재발행 (Wallet 측 멱등성 보장)
    await this.republishBillingCommand(req);

    // 2단계 (10분+): Wallet API 직접 조회 (최후 수단)
    if (req.requestedAt < now - 10min) {
      const intent = await this.walletClient
        .getIntentByIdempotencyKey(req.idempotencyKey);

      if (intent?.status === 'CAPTURED' || intent?.status === 'SUCCEEDED') {
        await this.markSucceeded(req, intent.id);
      } else if (intent?.status === 'FAILED' || intent?.status === 'CANCELED') {
        await this.markFailed(req);
        await this.enterDunning(req.subscriptionId);
      }
      // intent가 없으면: Wallet이 command를 아직 처리하지 못한 것 → 다음 주기에 재시도
    }
  }
}
```

**단계적 에스컬레이션:**

| 경과 시간 | 조치 | 설명 |
|-----------|------|------|
| 0~5분 | 정상 대기 | Kafka 이벤트로 resolve 예상 |
| 5~10분 | Kafka command 재발행 | 소비 실패 대비 (멱등성으로 안전) |
| 10분+ | Wallet API 직접 조회 | 최후 수단 — 정상 운영 시 이 단계에 도달하지 않음 |

이 구조에서 Membership → Wallet 동기 HTTP 호출은 **reconciliation의 최후 수단으로만** 사용되므로, 정상 운영 시에는 완전 비동기다.

### 2.4 미완성 기능별 설계

#### 2.4.1 구독 만료 스케줄러

```typescript
// 매 시간 실행 (또는 매일 새벽)
@Cron('0 * * * *')
async expireSubscriptions() {
  // endsAt < now && isCurrent == true인 entitlement 조회
  // isCurrent = false 설정
  // contract status = EXPIRED (갱신 실패로 만료된 경우)
  // MembershipStatusChanged(EXPIRED) 이벤트 발행
}
```

#### 2.4.2 Dunning 자동화

```
결제 실패 → dunning_queue 추가 (attempts=0, max_attempts=3)
    │
    ├─ 1차 재시도 (1일 후) → 성공 → dunning 제거, 정상 갱신
    │                       → 실패 → attempts++
    ├─ 2차 재시도 (3일 후) → 성공 → ...
    │                       → 실패 → attempts++
    └─ 3차 재시도 (7일 후) → 성공 → ...
                            → 실패 → 구독 일시정지 또는 취소
                                     PaymentFailed 이벤트 발행
                                     알림 발송 (notification 서비스)
```

재시도 간격은 `subscription_policies`의 DUNNING_RETRY_INTERVALS 정책으로 관리.

#### 2.4.3 환불 개시

현재 `RefundEventHandler`가 환불 완료/실패 이벤트를 수신하지만, 환불을 **요청하는** 로직이 없다.

```
취소 요청 → SubscriptionCancellationService
    │
    ├─ refund 자격 확인 (사용일수, 혜택 사용량)
    ├─ eligible_refund_amount 계산
    ├─ contract.refund_requested = true
    │
    └─ Wallet API 호출: POST /v1/payment-intents/{lastIntentId}/refund
       또는 POST /v1/refunds { chargeId, amount }
       │
       └─ gateway.refund.succeeded 이벤트 수신 → contract.refund_completed = true
```

#### 2.4.4 정책 엔진 와이어링

`subscription_policies` 테이블에 정의된 정책들을 실제 검증에 연결:

| 정책 | 적용 위치 |
|------|----------|
| `PAUSE_MAX_COUNT` | PauseManager.pause() 시 월간 일시정지 횟수 검증 |
| `PAUSE_COOLDOWN_DAYS` | 마지막 일시정지 해제 후 재일시정지 제한 |
| `TRIAL_COOLDOWN_DAYS` | 트라이얼 종료 후 재가입 제한 |
| `PLAN_CHANGE_COOLDOWN_DAYS` | 플랜 변경 후 재변경 제한 |
| `REFUND_WINDOW_DAYS` | 취소 시 환불 가능 기간 |
| `DUNNING_MAX_ATTEMPTS` | 결제 실패 재시도 최대 횟수 |
| `DUNNING_RETRY_INTERVALS` | 재시도 간격 (JSON: [1, 3, 7]) |

구현 방식: `PolicyEnforcementService`를 만들어 각 Manager에서 검증 시 호출.

```typescript
class PolicyEnforcementService {
  async enforce(planId: string, ruleType: PolicyRuleType, context: Record<string, unknown>): Promise<void> {
    const rule = await this.policyReader.getRule(planId, ruleType);
    if (!rule) return; // 정책 없으면 통과
    // ruleType별 검증 로직
    // 위반 시 throw new Error('policy violation: ...')
  }
}
```

### 2.5 Membership 이벤트 계약 보강

현재 `MEMBERSHIP_STREAM`에 정의된 이벤트 타입을 확장해야 한다:

```typescript
// packages/event-contracts/streams/membership.stream.ts

// 기존
SubscriptionCreated
SubscriptionActive
SubscriptionCancelled
BillingCycleStarted
PaymentCollected

// 추가 필요
SubscriptionExpired      // 만료 (갱신 실패 또는 기간 종료)
SubscriptionPaused       // 일시정지
SubscriptionResumed      // 재개
SubscriptionUpgraded     // 업그레이드
SubscriptionDowngraded   // 다운그레이드
PaymentFailed            // 결제 실패 (dunning 중)
RefundCompleted          // 환불 완료
```

다른 서비스들의 사용 예:
- **PIM/Storefront**: `SubscriptionActive` → 멤버십 전용 상품 노출, 멤버 할인 적용
- **Notification**: `PaymentFailed` → 결제 실패 알림, `SubscriptionExpired` → 만료 안내
- **Analytics**: 모든 이벤트 → 멤버십 전환율, 이탈률 분석
- **Channel Adapter**: `SubscriptionActive/Cancelled` → 외부 채널 동기화

---

## 과제 3: OpenTelemetry 분산 트레이싱 도입

### 3.1 배경 및 개념 정리

**현재 상태:**
- `@app/events` 라이브러리에 `correlationId`, `causationId`, `chainId` 기반 이벤트 체인 추적이 있음
- 하지만 이건 **Kafka 이벤트 간 관계**만 추적하며, **HTTP 요청의 서비스 간 지연 시간(latency)은 측정하지 못함**
- OpenTelemetry 관련 의존성은 현재 전혀 없음

**OpenTelemetry란:**

```
사용자 요청 (브라우저)
    │
    ▼
┌─ Trace ────────────────────────────────────────────────┐
│                                                         │
│  Span: [admin-web] GET /orders/123          200ms       │
│    │                                                    │
│    └─ Span: [almondyoung-server] GET /api/orders/123    │
│         │                                    150ms      │
│         ├─ Span: [pim] GET /products/456     30ms       │
│         ├─ Span: [wms] GET /stock/456        45ms       │
│         └─ Span: [DB] SELECT * FROM orders   20ms       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

- **Trace**: 하나의 요청이 시스템을 통과하는 전체 경로
- **Span**: Trace 내의 개별 작업 단위 (HTTP 호출, DB 쿼리, Kafka publish 등)
- **Context Propagation**: Trace ID를 서비스 간 HTTP 헤더(`traceparent`)로 전파

OpenTelemetry는 이 데이터를 수집하는 **표준 SDK/API**이고, 수집된 데이터를 **시각화하는 백엔드**는 별도로 선택한다 (Jaeger, Grafana Tempo, Datadog 등).

### 3.2 아키텍처 설계

#### 전체 구성

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  admin-web   │  │  wallet-web  │  │  storefront  │
│  (Next.js)   │  │  (Next.js)   │  │  (외부)      │
│              │  │              │  │              │
│  OTel Web SDK│  │  OTel Web SDK│  │  OTel Web SDK│
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       │   traceparent 헤더 전파            │
       ▼                 ▼                 ▼
┌──────────────────────────────────────────────────────┐
│                   NestJS 백엔드 앱들                   │
│  almondyoung-server, wallet, membership, pim,        │
│  wms, user-service, notification, ...                │
│                                                       │
│  각 앱: @opentelemetry/sdk-node + auto-instrumentations│
│  - HTTP in/out 자동 계측                               │
│  - PostgreSQL(pg) 쿼리 자동 계측                       │
│  - Kafka producer/consumer 자동 계측                   │
│  - NestJS 라우트별 span 자동 생성                      │
└───────────────────────┬──────────────────────────────┘
                        │
                        │ OTLP (gRPC 또는 HTTP)
                        ▼
              ┌───────────────────┐
              │  OTel Collector   │  (선택사항 - 나중에 도입 가능)
              │  또는 직접 전송    │
              └─────────┬─────────┘
                        │
                        ▼
              ┌───────────────────┐
              │  트레이싱 백엔드   │
              │                   │
              │  Option A: Jaeger │  ← 셀프호스팅, 무료, 가벼움
              │  Option B: Tempo  │  ← Grafana 스택 연계
              │  Option C: SaaS   │  ← Datadog, Honeycomb 등
              └───────────────────┘
```

### 3.3 구현 단계

#### Phase 1: 백엔드 계측 (최소 설정으로 시작)

NestJS 앱에 OpenTelemetry를 붙이는 것은 생각보다 간단하다. **auto-instrumentation**이 대부분의 작업을 해준다.

**설치할 패키지:**

```bash
npm install @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions
```

**각 앱의 진입점에 추가 (main.ts 보다 먼저 로드):**

```typescript
// tracing.ts (각 앱 또는 공유 라이브러리)
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: process.env.SERVICE_NAME ?? 'unknown',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // HTTP, pg(PostgreSQL), kafkajs 등 자동 계측
      '@opentelemetry/instrumentation-fs': { enabled: false },  // 불필요한 파일시스템 계측 비활성화
    }),
  ],
});

sdk.start();
```

**이것만으로 자동 계측되는 것:**
- 모든 인바운드/아웃바운드 HTTP 요청
- PostgreSQL 쿼리 (postgres.js / pg 드라이버)
- KafkaJS producer/consumer
- DNS, net 등 저수준 네트워크

**공유 라이브러리로 만들기:**

```
libs/tracing/
├── src/
│   ├── tracing.module.ts     # NestJS 모듈 (선택사항)
│   ├── setup.ts              # NodeSDK 초기화
│   └── index.ts
├── tsconfig.lib.json
└── package.json
```

각 앱의 시작 스크립트에서:
```bash
node -r ./dist/libs/tracing/setup.js ./dist/apps/wallet/main.js
```
또는 main.ts 최상단에 `import '../../../libs/tracing/src/setup';`

#### Phase 2: 트레이싱 백엔드 선택

| 옵션 | 장점 | 단점 | 추천 시나리오 |
|------|------|------|-------------|
| **Jaeger** | 무료, Docker로 즉시 실행, 전용 UI | 장기 저장 시 추가 설정 필요 | 개발/스테이징, 빠른 시작 |
| **Grafana Tempo + Grafana** | 무료, 장기 저장 용이, 메트릭/로그 통합 | 초기 설정 복잡 | 이미 Grafana를 쓰는 경우 |
| **Datadog/Honeycomb** | 즉시 사용, 강력한 분석 | 비용 발생 | 운영 환경, 팀 규모가 클 때 |

**권장: Jaeger로 시작**

```bash
# docker-compose.yml에 추가
jaeger:
  image: jaegertracing/jaeger:2
  ports:
    - "16686:16686"   # Jaeger UI
    - "4318:4318"     # OTLP HTTP receiver
  environment:
    COLLECTOR_OTLP_ENABLED: "true"
```

이것만으로 `http://localhost:16686`에서 트레이스 검색/시각화가 가능하다.

#### Phase 3: 기존 이벤트 체인과 통합

현재 `@app/events`의 `correlationId`와 OpenTelemetry의 `traceId`를 연결:

```typescript
// 이벤트 발행 시 현재 trace context를 metadata에 포함
import { trace } from '@opentelemetry/api';

const span = trace.getActiveSpan();
const traceId = span?.spanContext().traceId;

await this.publisher.publishEvent({
  eventType: 'PaymentCaptured',
  payload: { ... },
  metadata: {
    traceId,  // MessageEnvelope.metadata.traceId
  },
});
```

```typescript
// 이벤트 소비 시 traceId를 span에 연결
@OnEvent('payments.events.v1', 'PaymentCaptured')
async handle(@EventEnvelope() envelope: MessageEnvelope) {
  // 자동 계측이 Kafka consumer span을 생성하지만,
  // 원본 HTTP 요청의 traceId와 연결하려면:
  const parentTraceId = envelope.metadata?.traceId;
  // span에 attribute로 추가하여 Jaeger에서 검색 가능
  const currentSpan = trace.getActiveSpan();
  currentSpan?.setAttribute('messaging.origin_trace_id', parentTraceId);
}
```

#### Phase 4: 프론트엔드 계측 (선택사항, 중기)

```typescript
// admin-web, wallet-web에 추가
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';

const provider = new WebTracerProvider({
  resource: new Resource({ [ATTR_SERVICE_NAME]: 'admin-web' }),
});

provider.addSpanProcessor(
  new BatchSpanProcessor(
    new OTLPTraceExporter({ url: '/api/otel/v1/traces' })  // 프록시 경유
  )
);

provider.register({
  contextManager: new ZoneContextManager(),
});

registerInstrumentations({
  instrumentations: [
    new FetchInstrumentation({
      propagateTraceHeaderCorsUrls: [/api\.almondyoung\.com/],  // 백엔드 URL
    }),
  ],
});
```

프론트엔드 → 백엔드 요청에 `traceparent` 헤더가 자동으로 붙어, 하나의 Trace로 연결된다.

### 3.4 도입 순서 요약

```
Week 1: libs/tracing 공유 라이브러리 생성 + Jaeger Docker 추가
         ↓
Week 1: 주요 앱 2~3개에 먼저 적용 (wallet, almondyoung-server, membership)
         ↓
Week 2: 나머지 백엔드 앱에 적용 + Kafka 계측 확인
         ↓
Week 2: correlationId ↔ traceId 연결
         ↓
Week 3+: 프론트엔드 Web SDK 적용 (admin-web 먼저)
         ↓
이후:    Jaeger → Grafana Tempo 마이그레이션 (필요 시)
```

### 3.5 기대 효과

적용 후 Jaeger UI에서:
- **"주문 생성이 왜 3초 걸리는가?"** → Trace에서 각 서비스의 소요시간을 Gantt 차트로 확인
- **"어떤 DB 쿼리가 병목인가?"** → Span에서 SQL 쿼리와 실행시간 확인
- **"Kafka 이벤트가 늦게 소비되는가?"** → Producer span → Consumer span 간 gap 확인

---

## 과제 간 의존 관계

```
┌─────────────────────────────────┐
│ 과제 3: OpenTelemetry            │ ← 독립적, 언제든 시작 가능
│ (분산 트레이싱)                   │
└─────────────────────────────────┘

┌─────────────────────────────────┐     ┌──────────────────────────────┐
│ 과제 1: Wallet 확장               │────►│ 과제 2: Membership 완성       │
│                                  │     │                              │
│ Phase 1: Provider kind 추가 +    │     │ 빌링 외 기능은 Phase 1과      │
│          LedgerOperations 추출   │     │ 병렬 진행 가능                │
│ Phase 2: TossBilling + billing   │     │                              │
│          _methods 구현           │     │ 빌링 연동은 Phase 2 이후      │
│ Phase 3: Intent purpose 추가     │     │                              │
└─────────────────────────────────┘     └──────────────────────────────┘
```

---

## 실행 순서 제안

### 병렬 트랙 구성

```
Track A (Wallet 확장 → 빌링 → 멤버십):
  A1. PaymentProvider 인터페이스 확장
      - kind: 'gateway' | 'ledger' 속성 추가
      - 기존 3개 Provider에 kind 속성 추가 (변경 최소)
  A2. LedgerOperations 인터페이스 추출
      - LedgerOperations 인터페이스 정의
      - PointsLedger 어댑터 생성 (기존 PointsLedgerService를 감싸기)
  A3. BillingMethodService + TossBillingProvider
      - billing_methods 테이블 생성
      - BillingMethodService (발급/암호화/삭제/웹훅)
      - TossBillingProvider 구현
      - BILLING_DELETED 웹훅 핸들러
  A4. Intent purpose 추가
      - payment_intents 스키마에 purpose 필드 추가
  A5. Membership: 빌링 연동
      - PaymentClientService를 빌링 API로 전환
      - 프로덕션 cron 설정
  A6. Membership: 미완성 기능 구현
      - 만료 스케줄러, dunning 자동화, 정책 엔진, 환불 개시
  A7. Membership: 이벤트 계약 확장 + 소비자 구현

Track B (트레이싱, 독립):
  B1. libs/tracing 공유 라이브러리 생성
  B2. Jaeger Docker Compose 추가
  B3. 주요 앱 3개 적용 (wallet, almondyoung-server, membership)
  B4. 전체 백엔드 앱 적용
  B5. (중기) 프론트엔드 Web SDK 적용
```

### 우선순위

| 순위 | 작업 | 이유 |
|------|------|------|
| 1 | B1~B3 (트레이싱 기본) | 독립적이고 빠르게 가치를 제공. 병목 파악에 즉시 도움 |
| 2 | A1~A2 (Provider 확장 + LedgerOperations) | 빌링의 전제조건이지만 변경 범위가 작아 빠르게 완료 가능 |
| 3 | A6 중 독립 기능 (만료 스케줄러, 정책 엔진) | Wallet 작업과 병렬 진행 가능 |
| 4 | A3~A4 (빌링 구현) | 인터페이스 확장 완료 후 진행 |
| 5 | A5, A7 (멤버십 빌링 연동 + 이벤트) | 빌링 완성 후 진행 |
| 6 | B4~B5 (트레이싱 확장) | 기본 트레이싱 안정화 후 |
