# 단기-중기 개선 계획: 빌링 / 멤버십 / 분산 트레이싱

> 작성일: 2026-03-23 | 상태: Draft

---

## 목차

1. [과제 1: Wallet 빌링(정기결제) 기능 추가](#과제-1-wallet-빌링정기결제-기능-추가)
2. [과제 2: Membership 앱 완성](#과제-2-membership-앱-완성)
3. [과제 3: OpenTelemetry 분산 트레이싱 도입](#과제-3-opentelemetry-분산-트레이싱-도입)
4. [과제 간 의존 관계](#과제-간-의존-관계)
5. [실행 순서 제안](#실행-순서-제안)

---

## 과제 1: Wallet 빌링(정기결제) 기능 추가

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

**핵심 설계 질문**: 빌링 기능을 어떤 수준에서 추상화할 것인가?

### 1.3 설계 대안

#### 대안 A: Wallet 내부에서 자체 빌링 레이어 구축

기존 PaymentIntent 흐름 위에 빌링 전용 레이어를 얹는 방식.

```
┌─────────────────────────────────────────────┐
│                  Wallet App                  │
│                                              │
│  ┌─────────────────────────────────────────┐ │
│  │         BillingService (NEW)            │ │
│  │  - registerBillingMethod()              │ │
│  │  - chargeBilling()                      │ │
│  │  - cancelBillingMethod()                │ │
│  └──────────────┬──────────────────────────┘ │
│                 │                             │
│  ┌──────────────▼──────────────────────────┐ │
│  │       BillingProvider 인터페이스         │ │
│  │  - issueBillingKey(authData)            │ │
│  │  - charge(billingKey, amount, orderInfo)│ │
│  │  - deleteBillingKey(billingKey)         │ │
│  │  - handleWebhook(event)                │ │
│  └──────────┬──────────┬──────────────────┘ │
│             │          │                     │
│  ┌──────────▼─┐  ┌────▼───────┐  ┌───────┐ │
│  │TossBilling │  │StripeBill. │  │Custom │ │
│  │Provider    │  │Provider    │  │(미래) │ │
│  └────────────┘  └────────────┘  └───────┘ │
│                                              │
│  ┌─────────────────────────────────────────┐ │
│  │    기존 PaymentIntent / Charge 흐름      │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

**흐름:**

1. 프론트엔드에서 Toss SDK `requestBillingAuth()` 호출 → 사용자 카드 인증
2. 성공 시 `authKey` + `customerKey`를 백엔드로 전달
3. `BillingService.registerBillingMethod()` → `TossBillingProvider.issueBillingKey()` → Toss API로 billingKey 발급
4. billingKey를 `billing_methods` 테이블에 저장 (userId, billingKey, customerKey, provider, metadata)
5. 정기결제 시점: `BillingService.chargeBilling(userId, billingMethodId, amount, orderInfo)` → `TossBillingProvider.charge()` → Toss 자동결제 승인 API 호출
6. 결과를 PaymentIntent/Charge로 기록하고 이벤트 발행

**장점:**
- 기존 PaymentIntent 인프라(상태머신, 감사로그, 이벤트 발행)를 재사용
- 빌링 실행 결과가 동일한 Charge로 기록되어 환불/조회 로직 통합
- Provider 교체가 용이 (Toss → Stripe 마이그레이션 시 BillingProvider만 교체)

**단점:**
- Wallet에 빌링 도메인 로직이 추가되어 복잡도 증가
- 빌링키 관리 + 기존 결제수단 관리가 혼재

#### 대안 B: PG사 빌링 기능에 완전 위임 (Thin Wrapper)

토스페이먼츠의 빌링 API를 직접 호출하되, Wallet의 PaymentIntent 흐름은 건드리지 않는 방식.

```
┌──────────────────────────────────┐
│         Membership 등 호출자      │
│  billingService.charge(...)      │
└──────────┬───────────────────────┘
           │
┌──────────▼───────────────────────┐
│    Wallet: TossBillingGateway    │
│  - issueBillingKey()             │
│  - approveBilling()  ──────────────► Toss API POST /v1/billing/{billingKey}
│  - deleteBillingKey()            │
│  - handleBillingWebhook()        │
└──────────────────────────────────┘
           │
           ▼
  billing_keys 테이블 (billingKey, customerKey, userId, status)
  + 결과를 billing_transactions 테이블에 기록
```

**장점:**
- 구현이 단순하고 빠름
- Toss가 제공하는 빌링 흐름을 그대로 사용

**단점:**
- 기존 PaymentIntent/Charge 인프라와 분리되어 이중 관리
- 환불 시 별도 로직 필요
- Provider 교체 시 호출자(Membership 등)도 수정 필요
- 복합결제(포인트 + 빌링) 처리가 어려움

#### 대안 C: BillingProvider + PaymentIntent 통합 (권장)

**BillingProvider 인터페이스**를 정의하되, 빌링 결제 실행 시 내부적으로 PaymentIntent를 생성하여 기존 인프라를 재사용하는 하이브리드 방식.

```
┌──────────────────────────────────────────────────────┐
│                     Wallet App                        │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │              billing/ 모듈 (NEW)                 │ │
│  │                                                  │ │
│  │  BillingMethodService        BillingChargeService│ │
│  │  - register(authData)        - charge(params)    │ │
│  │  - delete(id)                - refund(chargeId)  │ │
│  │  - list(userId)                                  │ │
│  └──────┬─────────────────────────┬─────────────────┘ │
│         │                         │                    │
│  ┌──────▼──────────┐   ┌─────────▼──────────────────┐│
│  │ BillingProvider  │   │  PaymentIntent 흐름 재사용  ││
│  │ 인터페이스       │   │  (BILLING type intent)      ││
│  │                  │   │  - confirm → authorize      ││
│  │  Toss  │ Stripe  │   │  - auto-capture             ││
│  │  │     │  │      │   │  - 이벤트 발행              ││
│  └──┴─────┴──┴──────┘   └───────────────────────────┘│
│                                                       │
│  billing_methods 테이블                                │
│  ├─ id, userId, providerType                          │
│  ├─ billingKey (encrypted), customerKey               │
│  ├─ method (CARD/TRANSFER), metadata (카드정보 등)     │
│  └─ status (ACTIVE/EXPIRED/DELETED), expiresAt        │
└──────────────────────────────────────────────────────┘
```

**빌링 등록 흐름:**

```
[Frontend]                    [Wallet Backend]              [Toss API]
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

**빌링 결제(charge) 흐름:**

```
[Membership/Scheduler]        [Wallet: BillingChargeService]    [Toss API]
    │                               │                              │
    │  1. Kafka Command 또는         │                              │
    │     API: charge billing       │                              │
    │  ────────────────────────────►│                              │
    │                               │                              │
    │                   2. PaymentIntent 생성                       │
    │                      (type: BILLING,                         │
    │                       billingMethodId 참조)                   │
    │                               │                              │
    │                   3. Charge 생성 (AUTHORIZE)                  │
    │                      provider = TOSS_BILLING                 │
    │                               │                              │
    │                               │  4. POST /v1/billing/        │
    │                               │     {billingKey}/confirm     │
    │                               │  ───────────────────────────►│
    │                               │                              │
    │                               │  5. Payment 200 OK           │
    │                               │  ◄───────────────────────────│
    │                               │                              │
    │                   6. Charge → SUCCEEDED                      │
    │                      Intent → CAPTURED → SUCCEEDED           │
    │                      이벤트: payment.intent.captured         │
    │                               │                              │
    │  7. 이벤트 수신               │                              │
    │  ◄────────────────────────────│                              │
```

**BillingProvider 인터페이스:**

```typescript
interface BillingProvider {
  readonly providerType: string;  // 'TOSS_BILLING', 'STRIPE_BILLING'

  // 빌링키 발급
  issueBillingKey(params: {
    authKey: string;
    customerKey: string;
  }): Promise<{
    billingKey: string;
    method: 'CARD' | 'TRANSFER';
    metadata: Record<string, unknown>;  // 카드 정보, 은행 정보 등
    expiresAt?: Date;
  }>;

  // 빌링키로 결제 승인 (PaymentProvider.authorize()와 유사)
  charge(params: {
    billingKey: string;
    customerKey: string;
    amount: number;
    orderId: string;
    orderName: string;
  }): Promise<{
    providerTransactionId: string;  // paymentKey
    status: 'SUCCEEDED' | 'FAILED';
    approvedAt?: string;
    failure?: { code: string; message: string };
  }>;

  // 빌링키 삭제
  deleteBillingKey(billingKey: string): Promise<void>;

  // 웹훅 처리 (BILLING_DELETED 등)
  handleWebhook(event: BillingWebhookEvent): Promise<void>;
}
```

**장점:**
- 빌링 결제도 PaymentIntent/Charge로 기록 → 환불, 조회, 이벤트 발행 모두 기존 인프라 재사용
- BillingProvider 인터페이스로 Toss/Stripe 등 교체 가능
- 복합결제(포인트 차감 + 빌링 결제) 자연스럽게 지원 가능
- 호출자(Membership 등)는 "빌링 결제 요청" 이벤트/API만 사용하면 됨

**단점:**
- 대안 B보다 구현량이 많음
- PaymentIntent에 BILLING 타입을 추가해야 함 (기존 흐름과의 분기)

### 1.4 권장안: 대안 C

**이유:**
1. **일관성**: 빌링이든 단발이든 모든 결제가 PaymentIntent → Charge → Event 흐름을 따름
2. **재사용**: 환불, 상태머신, 감사로그, 이벤트 발행, 멱등성을 새로 만들 필요 없음
3. **확장성**: Stripe Billing, 네이버페이 정기결제 등 추가 시 BillingProvider만 구현
4. **복합결제**: Membership에서 "포인트 일부 + 카드 빌링"을 지원해야 할 때 기존 composite payment 로직 활용 가능

### 1.5 필요한 변경 사항

**새로 추가할 것:**

| 구분 | 내용 |
|------|------|
| **테이블** | `billing_methods` (id, userId, providerType, billingKey(암호화), customerKey, method, metadata, status, expiresAt) |
| **모듈** | `billing/` — BillingMethodService, BillingChargeService, BillingMethodController |
| **Provider** | `TossBillingProvider` (implements BillingProvider) |
| **이벤트** | `billing.method.registered`, `billing.method.deleted` (선택) |
| **Enum** | PaymentIntentType에 `BILLING` 추가, PaymentMethodType에 `TOSS_BILLING` 추가 |
| **웹훅** | `BILLING_DELETED` 웹훅 핸들러 |

**기존 수정:**

| 구분 | 내용 |
|------|------|
| **PaymentIntent** | `type` 필드 추가 (`ONE_TIME` / `BILLING`), `billingMethodId` 참조 추가 |
| **ConfirmService** | BILLING 타입일 때 사용자 인증 없이 billingKey로 바로 authorize |
| **ProviderRegistry** | `TOSS_BILLING` provider 등록 |

### 1.6 빌링키 보안

- billingKey는 AES-256-GCM 등으로 **암호화 저장** (DB에 평문 저장 금지)
- customerKey는 UUID v4로 생성, 사용자별 고유
- billingKey + customerKey 쌍이 있어야 결제 가능 (Toss 측 보안)
- 빌링키 접근 로그 기록 (감사 추적)

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
- PaymentClientService를 통한 Wallet 연동

**미완성/부재:**
- 구독 만료 스케줄러 (entitlement 자동 만료)
- 정책 엔진 (테이블에 정의만 있고 실제 검증 로직 없음)
- 환불 개시 (이벤트 수신만 있고 Wallet에 환불 요청하는 로직 없음)
- Dunning 자동화 (큐는 있지만 max 초과 시 자동 정지/취소 없음)
- 프로덕션 cron 설정 (`*/1 * * * *` → 일 1회로 변경 필요)
- 트라이얼 재사용 방지
- 알림 연동 (결제 실패/환불 실패 시 notification 발행)

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

Membership은 현재 `PaymentClientService`로 Wallet API를 직접 호출하고 있다. 빌링 도입 후 두 가지 연동 방식을 고려할 수 있다:

#### 방식 A: 이벤트/커맨드 기반 (권장)

```
[Membership]                          [Wallet]
     │                                    │
     │  1. RecurringBillingService         │
     │     billingDate == today인 계약 조회 │
     │                                    │
     │  2. Kafka Command:                  │
     │     billing.charge.requested        │
     │     { userId, billingMethodId,      │
     │       amount, orderId, metadata }   │
     │  ──────────────────────────────────►│
     │                                    │
     │                    3. BillingChargeService │
     │                       PaymentIntent 생성   │
     │                       빌링키로 결제 승인    │
     │                                    │
     │  4. payment.intent.captured         │
     │  ◄──────────────────────────────────│
     │                                    │
     │  5. 결제 성공 처리                   │
     │     nextBillingDate 갱신             │
     │     entitlement 연장                │
     │     SubscriptionActive 이벤트 발행   │
```

**장점:**
- Membership과 Wallet이 완전 비동기 결합
- Wallet 다운 시 Membership이 영향 안 받음 (커맨드 큐에 남아 있다가 나중에 처리)
- 재시도/DLQ가 이벤트 인프라에서 자동 처리

**단점:**
- 결과를 비동기로 받아야 해서 상태 관리 복잡
- "결제 요청 → 결과 확인" 사이에 contract가 중간 상태에 놓임

#### 방식 B: 동기 API + 이벤트 확인

```
[Membership]                          [Wallet]
     │                                    │
     │  1. HTTP POST /v1/billing/charge    │
     │     { billingMethodId, amount, ... }│
     │  ──────────────────────────────────►│
     │                                    │
     │  2. { intentId, status }            │
     │  ◄──────────────────────────────────│
     │                                    │
     │  (status가 SUCCEEDED면 즉시 처리)    │
     │  (PROCESSING이면 이벤트 대기)        │
     │                                    │
     │  3. payment.intent.captured         │
     │  ◄──────────────────────────────────│
```

**장점:**
- 즉시 결과를 알 수 있어 흐름이 단순
- 대부분의 빌링 결제는 동기적으로 성공/실패 (카드 빌링은 즉시 승인)

**단점:**
- Wallet과의 동기적 의존성 발생

#### 권장: 방식 B (동기 API) + 이벤트 확인 보조

Toss 빌링 결제는 API 호출 시 즉시 승인 결과가 돌아온다 (DONE 또는 FAILED). 비동기 흐름이 불필요하게 복잡도를 올리는 경우에 해당하므로, 동기 API를 기본으로 하되 이벤트도 발행하여 다른 서비스들이 반응할 수 있게 한다.

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
┌─────────────────────────┐
│ 과제 3: OpenTelemetry    │ ← 독립적, 언제든 시작 가능
│ (분산 트레이싱)           │
└─────────────────────────┘

┌─────────────────────────┐     ┌─────────────────────────┐
│ 과제 1: Wallet 빌링      │────►│ 과제 2: Membership 완성  │
│ (BillingProvider 구현)   │     │ (빌링 연동 + 미완성 기능)│
└─────────────────────────┘     └─────────────────────────┘
         │
         │ 과제 2는 과제 1의 빌링 API에 의존
         │ (단, 빌링 외 기능은 독립적으로 진행 가능)
```

---

## 실행 순서 제안

### 병렬 트랙 구성

```
Track A (빌링 → 멤버십):
  A1. Wallet billing_methods 테이블 + BillingProvider 인터페이스 설계/구현
  A2. TossBillingProvider 구현 (빌링키 발급/결제/삭제)
  A3. BillingChargeService → PaymentIntent 통합
  A4. Membership: PaymentClientService를 빌링 API로 전환
  A5. Membership: 미완성 기능 구현 (만료 스케줄러, dunning 자동화, 정책 엔진, 환불 개시)
  A6. Membership: 이벤트 계약 확장 + 소비자 구현

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
| 2 | A1~A3 (빌링 구현) | Membership 완성의 전제조건 |
| 3 | A5 중 독립 기능 (만료 스케줄러, 정책 엔진) | 빌링 없이도 진행 가능 |
| 4 | A4~A6 (빌링 연동 + 이벤트) | 빌링 완성 후 진행 |
| 5 | B4~B5 (트레이싱 확장) | 기본 트레이싱 안정화 후 |
