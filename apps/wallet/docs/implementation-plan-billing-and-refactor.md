# Wallet 결제 계층 리팩토링 + 빌링 기능 구현 계획

> 근거 문서: `docs/roadmap-2026-q1.md` 과제 1
> 작성 기준: 2026-03-30

---

## 1. 설계 결정 요약

로드맵 문서의 제안을 아래와 같이 구체화했다.

| # | 주제 | 결정 |
|---|------|------|
| 1 | `kind` 속성 위치 | `PaymentProvider` 인터페이스가 아닌 `ProviderRegistry` 메타데이터로 관리. 인터페이스 변경 없음 |
| 2 | Toss API 코드 공유 | Toss API 호출 전담 `TossApiClient` 서비스를 추출. `TossPaymentProvider`와 `TossBillingProvider` 양쪽이 주입받음 |
| 3 | CMS 결제수단 | Nicepay는 사용하지 않음. 효성FMS 배치 CMS(`CmsBatchProvider`)를 도입. 정기결제와 BNPL 상환에 사용 |
| 4 | 빌링키 저장 | 평문 저장 |
| 5 | Checkout Session 만료 | 1시간. 동일 subscriberRef 재요청 시 새 세션 생성 + 기존 만료 |
| 6 | billing.charge 실패 | 5xx만 재시도, 그 외(4xx, 비즈니스 오류)는 즉시 실패 이벤트 발행 |
| 7 | 관리자 대시보드 | 이 계획의 스코프 밖 |
| 8 | Outbox dispatch | Kafka 이벤트 발행만 담당. Medusa 웹훅 전달은 channel-adapter가 Kafka 이벤트를 구독하여 처리 |
| 9 | 배치 CMS 비동기 결과 | `PENDING_SETTLEMENT` Intent 상태 추가 + 결과 폴링 cron |
| 10 | 구독 연장 시점 | 결제 확정 후 연장. Membership이 미리 갱신 요청 |

---

## 2. 스키마 변경

### 2.1 Enum 변경

#### `payment_intent_status` — 값 추가

```
기존: CREATED, PROCESSING, REQUIRES_ACTION, AUTHORIZED, CAPTURED, SUCCEEDED, FAILED, CANCELED
추가: PENDING_SETTLEMENT, PARTIALLY_CAPTURED
```

- `PENDING_SETTLEMENT`: CMS 등 배치 결제수단의 결과 대기 상태. 사용자 행동 불필요, 시스템이 외부 결과를 폴링.
- `PARTIALLY_CAPTURED`: 복합결제에서 capture가 일부만 성공한 상태. 운영자 수동 해결 필요.

#### `payment_method_type` — 값 추가

```
기존: POINTS, CARD, BANK_TRANSFER, BNPL, TOSS, NICEPAY
추가: TOSS_BILLING, CMS_BATCH
```

#### 새 enum: `intent_purpose`

```sql
intent_purpose: PURCHASE, SUBSCRIPTION, REPAYMENT, PAYOUT
```

| Purpose | 의미 | 매출 집계 | 현금 흐름 집계 |
|---------|------|:---------:|:-----------:|
| PURCHASE | 일반 구매 결제 | O | O |
| SUBSCRIPTION | 정기결제 구매 | O | O |
| REPAYMENT | BNPL 상환 | X | O |
| PAYOUT | 정산/출금 (미래) | X | O |

#### 새 enum: `checkout_session_status`

```sql
checkout_session_status: PENDING, COMPLETED, EXPIRED, CANCELED
```

#### 새 enum: `billing_method_status`

```sql
billing_method_status: ACTIVE, REVOKED, DELETED, EXPIRED
```

#### 새 enum: `billing_agreement_status`

```sql
billing_agreement_status: ACTIVE, SUSPENDED, REVOKED
```

#### 새 enum: `cms_member_status`

```sql
cms_member_status: PENDING, REGISTERED, FAILED, DELETED
```

#### 새 enum: `cms_withdrawal_status`

```sql
cms_withdrawal_status: REQUESTED, PROCESSING, SUCCEEDED, FAILED, DELETED
```

### 2.2 테이블 변경

#### `payment_intents` — 컬럼 추가

```typescript
purpose: intentPurposeEnum('purpose').notNull().default('PURCHASE'),
```

기존 레코드는 전부 PURCHASE가 된다. 프로덕션 전이므로 별도 데이터 마이그레이션 불필요.

#### `outbox_events` — Medusa 전용 로직 제거

outbox_events 테이블 자체의 스키마 변경은 없다. 변경은 OutboxDispatcherService의 dispatch 로직에서 이루어진다:
- `MEDUSA_EVENT_TYPES` 필터와 Medusa HTTP POST 로직을 제거
- Kafka produce로 교체 (topic: `payment.events.v1`)
- channel-adapter가 이 토픽을 구독하여 Medusa 웹훅 등 외부 채널 전달을 담당

### 2.3 새 테이블

#### `billing_methods`

빌링키, CMS 인증 정보 등 반복 결제에 필요한 저장된 인증 정보를 통합 관리한다.

```typescript
billingMethods = pgTable('billing_methods', {
  id:             uuid('id').defaultRandom().primaryKey(),
  userId:         varchar('user_id', { length: 128 }).notNull(),
  providerType:   varchar('provider_type', { length: 64 }).notNull(),  // 'TOSS_BILLING', 'CMS_BATCH'
  billingKey:     text('billing_key'),                                 // Toss billingKey (평문)
  customerKey:    varchar('customer_key', { length: 128 }),            // Toss customerKey
  cmsMemberId:    varchar('cms_member_id', { length: 20 }),            // 효성 memberId
  displayName:    varchar('display_name', { length: 255 }),            // "신한카드 **** 1234"
  method:         jsonb('method').$type<Record<string, unknown>>(),    // 카드/계좌 상세 (card.number 마스킹 등)
  status:         billingMethodStatusEnum('status').notNull().default('ACTIVE'),
  expiresAt:      timestamp('expires_at', { withTimezone: true }),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
// 인덱스: (user_id), (user_id, provider_type, status)
```

#### `billing_agreements`

외부 서비스의 구독과 빌링수단 간 매핑.

```typescript
billingAgreements = pgTable('billing_agreements', {
  id:              uuid('id').defaultRandom().primaryKey(),
  userId:          varchar('user_id', { length: 128 }).notNull(),
  billingMethodId: uuid('billing_method_id').notNull().references(() => billingMethods.id),
  subscriberRef:   varchar('subscriber_ref', { length: 255 }).notNull(),  // e.g. subscriptionId
  subscriberType:  varchar('subscriber_type', { length: 64 }).notNull(),  // "MEMBERSHIP" 등
  status:          billingAgreementStatusEnum('status').notNull().default('ACTIVE'),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
// UNIQUE(subscriber_type, subscriber_ref)
// 인덱스: (user_id), (billing_method_id)
```

#### `checkout_sessions`

외부 서비스가 wallet-web에 결제를 위임하기 위한 세션.

```typescript
checkoutSessions = pgTable('checkout_sessions', {
  id:              uuid('id').defaultRandom().primaryKey(),
  userId:          varchar('user_id', { length: 128 }).notNull(),
  amount:          integer('amount').notNull(),
  currency:        varchar('currency', { length: 3 }).notNull(),
  purpose:         intentPurposeEnum('purpose').notNull(),
  metadata:        jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  successUrl:      text('success_url').notNull(),
  cancelUrl:       text('cancel_url').notNull(),
  allowComposite:  boolean('allow_composite').notNull().default(false),
  intentId:        uuid('intent_id').references(() => paymentIntents.id),    // 결제 완료 시 채움
  status:          checkoutSessionStatusEnum('status').notNull().default('PENDING'),
  expiresAt:       timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
// 인덱스: (user_id, status), (status, expires_at)
```

#### `cms_members`

효성FMS 회원 등록 상태를 추적. billing_methods와 1:1 매핑.

```typescript
cmsMembers = pgTable('cms_members', {
  id:              uuid('id').defaultRandom().primaryKey(),
  billingMethodId: uuid('billing_method_id').notNull().references(() => billingMethods.id),
  userId:          varchar('user_id', { length: 128 }).notNull(),
  cmsMemberId:     varchar('cms_member_id', { length: 20 }).notNull(),  // 효성 memberId (고유)
  paymentCompany:  varchar('payment_company', { length: 3 }).notNull(), // 은행코드
  payerName:       varchar('payer_name', { length: 15 }).notNull(),
  payerNumber:     varchar('payer_number', { length: 10 }).notNull(),   // 생년월일/사업자번호
  status:          cmsMemberStatusEnum('status').notNull().default('PENDING'),
  resultCode:      varchar('result_code', { length: 16 }),              // 효성 응답 코드
  resultMessage:   text('result_message'),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
// UNIQUE(cms_member_id)
// 인덱스: (billing_method_id), (user_id), (status)
```

#### `cms_withdrawals`

효성FMS 출금신청 상태를 추적. 각 배치 CMS 결제 시도에 1:1 매핑.

```typescript
cmsWithdrawals = pgTable('cms_withdrawals', {
  id:              uuid('id').defaultRandom().primaryKey(),
  cmsMemberId:     varchar('cms_member_id', { length: 20 }).notNull(),
  transactionId:   varchar('transaction_id', { length: 30 }).notNull(),  // 효성 거래ID (고유)
  chargeId:        uuid('charge_id').notNull().references(() => charges.id),
  intentId:        uuid('intent_id').notNull().references(() => paymentIntents.id),
  paymentDate:     varchar('payment_date', { length: 8 }).notNull(),     // YYYYMMDD (출금일)
  amount:          integer('amount').notNull(),
  status:          cmsWithdrawalStatusEnum('status').notNull().default('REQUESTED'),
  resultCode:      varchar('result_code', { length: 16 }),
  resultMessage:   text('result_message'),
  actualAmount:    integer('actual_amount'),
  fee:             integer('fee'),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
// UNIQUE(transaction_id)
// 인덱스: (intent_id), (status, payment_date)
```

#### `cms_agreements`

효성FMS 동의자료 등록 상태를 추적.

```typescript
cmsAgreements = pgTable('cms_agreements', {
  id:              uuid('id').defaultRandom().primaryKey(),
  cmsMemberId:     varchar('cms_member_id', { length: 20 }).notNull(),
  agreementKey:    varchar('agreement_key', { length: 64 }),            // 효성에서 반환
  fileType:        varchar('file_type', { length: 16 }).notNull(),      // '서면', '녹취', '전자서명'
  fileExtension:   varchar('file_extension', { length: 8 }).notNull(),
  status:          varchar('status', { length: 32 }).notNull(),         // '등록', '미등록', '실패'
  resultCode:      varchar('result_code', { length: 16 }),
  resultMessage:   text('result_message'),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
// 인덱스: (cms_member_id)
```

---

## 3. 상태 머신 변경

### 3.1 Intent 상태 전이

```
기존:
  CREATED → PROCESSING → AUTHORIZED → CAPTURED
                       → REQUIRES_ACTION → PROCESSING / AUTHORIZED / CREATED
                       → CREATED (backtrack)
                       → FAILED
  AUTHORIZED → CANCELED
  CREATED → CANCELED

추가:
  PROCESSING → PENDING_SETTLEMENT                (CMS authorize 후 배치 결과 대기)
  PENDING_SETTLEMENT → AUTHORIZED                (폴링 결과: 출금성공)
  PENDING_SETTLEMENT → FAILED                    (폴링 결과: 출금실패)
  PENDING_SETTLEMENT → CANCELED                  (관리자/시스템 취소)
  AUTHORIZED → PARTIALLY_CAPTURED                (capture 부분 실패)
  PARTIALLY_CAPTURED → CAPTURED                  (관리자 수동 해결)
  PARTIALLY_CAPTURED → CANCELED                  (관리자 수동 취소)
```

`state-transition.rules.ts` 변경:

```typescript
const paymentIntentTransitionRules: TransitionRules<PaymentIntentStatus> = {
  CREATED:              ['PROCESSING', 'CANCELED'],
  PROCESSING:           ['AUTHORIZED', 'FAILED', 'REQUIRES_ACTION', 'PENDING_SETTLEMENT', 'CREATED', 'CANCELED'],
  REQUIRES_ACTION:      ['PROCESSING', 'AUTHORIZED', 'FAILED', 'CREATED', 'CANCELED'],
  PENDING_SETTLEMENT:   ['AUTHORIZED', 'FAILED', 'CANCELED'],
  AUTHORIZED:           ['CAPTURED', 'PARTIALLY_CAPTURED', 'CANCELED'],
  PARTIALLY_CAPTURED:   ['CAPTURED', 'CANCELED'],
  SUCCEEDED:            ['CAPTURED', 'CANCELED'],
};
```

### 3.2 슬롯 파이프라인에서의 분기

ConfirmService 리팩토링 후 실행 파이프라인:

```
confirm(intent, params):
  plan = buildChargePlan(intent, params)

  // Step 1: Discount (있으면)
  if plan.discount:
    result = authorizeCharge(plan.discount)
    if FAILED → cancelDiscount 불필요, fail(intent), return

  // Step 2: Primary
  result = authorizeCharge(plan.primary)
  switch result.status:
    FAILED:
      if plan.discount → cancelCharge(discount)
      fail(intent), return
    REQUIRES_ACTION:
      pendAction(intent, result), return
    PENDING:
      pendSettlement(intent, result), return    // → PENDING_SETTLEMENT
    SUCCEEDED:
      handleAllAuthorized(intent)
```

discount 슬롯에는 ledger(Points)만 배치되고, ledger는 항상 동기 SUCCEEDED를 반환하므로 discount에서 REQUIRES_ACTION이나 PENDING이 발생하지 않는다.

---

## 4. 서비스/모듈 변경

### 4.1 ProviderRegistry — kind 메타데이터 추가

`PaymentProvider` 인터페이스는 변경하지 않는다. `ProviderRegistry`에 메타데이터 관리를 추가:

```typescript
// provider.registry.ts
type ProviderKind = 'gateway' | 'ledger';

interface ProviderMeta {
  kind: ProviderKind;
}

@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();
  private readonly metadata = new Map<string, ProviderMeta>();

  // register(provider, meta) 형태로 확장
  // getKind(providerType): ProviderKind
}
```

등록 시 메타데이터:

| Provider | kind |
|----------|------|
| PointsPaymentProvider | ledger |
| TossPaymentProvider | gateway |
| TossBillingProvider | gateway |
| BankTransferPaymentProvider | gateway |
| CmsBatchProvider | gateway |

### 4.2 TossApiClient 추출

현재 `TossPaymentProvider`에 있는 Toss API 호출 로직을 독립 서비스로 분리:

```
기존:
  TossPaymentProvider
    └─ 내부에 Toss REST API 호출 (confirm, cancel, refund)

변경 후:
  TossApiClient (서비스)
    ├─ confirmPayment(paymentKey, amount, orderId)
    ├─ cancelPayment(paymentKey, cancelReason, cancelAmount?)
    ├─ issueBillingKey(authKey, customerKey)
    ├─ confirmBilling(billingKey, amount, orderId, customerKey)
    └─ (공통: auth header, error handling, retry)

  TossPaymentProvider
    └─ 주입: TossApiClient

  TossBillingProvider (새로 추가)
    └─ 주입: TossApiClient, BillingMethodService
```

**파일 구조:**

```
providers/toss/
  toss-api.client.ts          ← 신규: Toss REST API 전담
  toss.provider.ts            ← 기존: API 호출 로직을 TossApiClient로 위임
  toss-billing.provider.ts    ← 신규: 빌링키 즉시 결제
```

### 4.3 ConfirmService 리팩토링 — 슬롯 모델

현재 3-모드 분기(`points-only`, `external-only`, `composite`)를 Discount + Primary 슬롯 파이프라인으로 교체한다.

```typescript
// charge-plan.ts
interface ChargePlan {
  discount?: ChargeSlot;   // Points만 가능
  primary:  ChargeSlot;    // 어떤 Provider든 가능
}

interface ChargeSlot {
  provider: PaymentProvider;
  amount: number;
  paymentMethodId: string;
}
```

**규칙:**
- discount 슬롯: ledger만 허용, 항상 동기 (REQUIRES_ACTION/PENDING 불가)
- primary 슬롯: gateway든 ledger든 가능
- 빌링 (Kafka command 경유 자동 정기결제): discount 불가, primary만
- discount만 단독 사용 가능 (포인트 전액 결제 = discount 없이 primary에 Points 배치)

**기존 모드와의 매핑:**

| 기존 모드 | 슬롯 모델 |
|-----------|----------|
| points-only | discount: 없음, primary: Points |
| external-only | discount: 없음, primary: Toss/BankTransfer/etc |
| composite | discount: Points, primary: Toss/BankTransfer/etc |

### 4.4 CaptureService — PARTIALLY_CAPTURED

```typescript
// capture.service.ts 변경
capture(intent):
  results = []
  for charge in succeededAuthorizeCharges:
    result = provider.capture(charge)
    results.push(result)

  if 전부 성공:
    intent → CAPTURED
  else if 일부만 성공:
    intent → PARTIALLY_CAPTURED
    운영 알림 발행 (notification 서비스 이벤트 또는 Slack webhook)
  else:
    intent → FAILED
```

PARTIALLY_CAPTURED 상태의 Intent는 관리자 API로만 CAPTURED 또는 CANCELED로 전이 가능. 관리자 대시보드 UI는 이 계획의 스코프 밖이지만, API 엔드포인트는 만든다 (`PaymentIntentAdminController`에 추가).

### 4.5 OutboxDispatcherService — Kafka 단일 채널

현재 `OutboxDispatcherService`에서 Medusa HTTP POST 관련 코드를 모두 제거하고 Kafka produce로 교체한다.

```
기존:
  OutboxDispatcherService
    ├─ MEDUSA_EVENT_TYPES 필터
    ├─ medusaWebhookUrl
    └─ HTTP POST to Medusa

변경:
  OutboxDispatcherService
    └─ Kafka produce (topic: payment.events.v1)

  channel-adapter (별도 앱):
    └─ Kafka consumer: payment.events.v1
       ├─ Medusa HTTP POST
       └─ (미래) Naver/Coupang 등
```

**변경 사항:**
- `MEDUSA_EVENT_TYPES` 상수, `medusaWebhookUrl`, HTTP POST 로직 제거
- `WALLET_MEDUSA_WEBHOOK_URL` 환경변수 제거
- Kafka producer 주입 + `payment.events.v1` 토픽으로 produce
- outbox_events 테이블 스키마 변경 없음
- 이벤트 발행 시 outbox 레코드 생성 로직 자체는 유지 (at-least-once 보장의 근간)

**channel-adapter 쪽 작업** (이 계획의 스코프):
- `payment.events.v1` Kafka consumer 추가
- 이벤트 타입별 외부 채널 라우팅 (현재는 Medusa만)
- 자체 재시도/DLQ 메커니즘 (channel-adapter의 기존 패턴을 따름)

### 4.6 결과 폴링 cron — CmsSettlementPollerService

배치 CMS의 `PENDING_SETTLEMENT` 상태 Intent를 주기적으로 확인한다.

```typescript
@Injectable()
export class CmsSettlementPollerService {
  // 매 30분 실행 (은행 영업시간 외에는 실행해도 무해, 결과가 없을 뿐)
  @Cron('0 */30 * * * *')
  async pollPendingSettlements(): Promise<void> {
    // 1. cms_withdrawals에서 status='REQUESTED' 또는 'PROCESSING'인 건 조회
    //    (paymentDate의 D+1 이상 경과한 건만 — 결과 확인 가능 시점)
    // 2. 효성 출금조회 API (GET /v1/payments/cms/{transactionId}) 호출
    // 3. 결과에 따라:
    //    - "출금성공": cms_withdrawal → SUCCEEDED, charge → SUCCEEDED, intent → AUTHORIZED → auto-capture
    //    - "출금실패": cms_withdrawal → FAILED, charge → FAILED, intent → FAILED + 이벤트 발행
    //    - "출금중"/"출금대기": 다음 주기에 재조회 (상태 변경 없음)
  }
}
```

### 4.7 Checkout Session 만료 처리

```typescript
@Injectable()
export class CheckoutSessionExpirationService {
  // lazy: 세션 조회 시 expiresAt 확인 → 만료면 즉시 EXPIRED 전이
  // cron: 10분마다 status='PENDING' AND expiresAt < now() 인 세션 일괄 EXPIRED
  @Cron('0 */10 * * * *')
  async expireStale(): Promise<void> { ... }
}
```

동일 subscriberRef 재요청 시:
1. 기존 PENDING 세션이 있으면 → EXPIRED로 전이
2. 새 세션 생성 (expiresAt = now + 1시간)

---

## 5. 새 모듈/서비스

### 5.1 billing/ 모듈

```
src/billing/
  billing.module.ts
  billing-method.service.ts          — 빌링수단 CRUD
  billing-method.controller.ts       — REST API (/v1/billing-methods)
  billing-agreement.service.ts       — 구독↔빌링수단 매핑 CRUD
  billing-agreement.controller.ts    — REST API (/v1/billing-agreements)
```

#### BillingMethodService

```typescript
@Injectable()
class BillingMethodService {
  // Toss 빌링키 발급
  async issueTossBillingKey(userId, authKey, customerKey): Promise<BillingMethod>
  // CMS 빌링수단 등록 (효성 회원등록 포함)
  async registerCmsBillingMethod(userId, dto): Promise<BillingMethod>
  // 빌링수단 비활성화
  async revoke(billingMethodId): Promise<void>
  // 빌링키 조회 (TossBillingProvider가 사용)
  async getBillingKey(billingMethodId): Promise<string>
  // 빌링수단 목록 조회
  async getUserBillingMethods(userId): Promise<BillingMethod[]>
  // BILLING_DELETED 웹훅 처리
  async handleBillingDeletedWebhook(payload): Promise<void>
}
```

#### BillingAgreementService

```typescript
@Injectable()
class BillingAgreementService {
  // Checkout Session 완료 시 자동 생성
  async create(userId, billingMethodId, subscriberRef, subscriberType): Promise<BillingAgreement>
  // subscriberRef로 조회 (billing.charge command 처리 시)
  async findBySubscriberRef(subscriberType, subscriberRef): Promise<BillingAgreement | null>
  // 빌링수단 변경
  async updateBillingMethod(agreementId, newBillingMethodId): Promise<void>
  // 해지
  async revoke(agreementId): Promise<void>
}
```

### 5.2 checkout/ 모듈

```
src/checkout/
  checkout.module.ts
  checkout-session.service.ts
  checkout-session.controller.ts     — REST API (/v1/checkout-sessions)
  checkout-session-expiration.service.ts
```

#### CheckoutSessionService

```typescript
@Injectable()
class CheckoutSessionService {
  // 세션 생성 (기존 PENDING 세션 만료 처리 포함)
  async create(dto: CreateCheckoutSessionDto): Promise<CheckoutSession>
  // 세션 조회 (wallet-web이 로드)
  async get(sessionId): Promise<CheckoutSession>
  // 결제 완료 처리 (intentId 연결, billing_agreement 자동 생성)
  async complete(sessionId, intentId, billingMethodId?): Promise<void>
}
```

**CreateCheckoutSessionDto:**

```typescript
{
  userId: string;
  amount: number;
  currency: string;
  purpose: IntentPurpose;
  metadata: {
    subscriberRef?: string;     // e.g. subscriptionId
    subscriberType?: string;    // e.g. "MEMBERSHIP"
    [key: string]: unknown;
  };
  successUrl: string;
  cancelUrl: string;
  allowComposite?: boolean;     // default: false
}
```

### 5.3 cms/ 모듈

```
src/cms/
  cms.module.ts
  cms-api.client.ts                  — 효성FMS REST API 전담
  cms-member.service.ts              — 회원 등록/수정/삭제/조회
  cms-agreement.service.ts           — 동의자료 등록/조회
  cms-agreement.controller.ts        — REST API (/v1/cms-agreements) — wallet-web이 사용
  cms-batch.provider.ts              — PaymentProvider 구현체
  cms-settlement-poller.service.ts   — 결과 폴링 cron
  cms-member-poller.service.ts       — 회원등록 결과 폴링 cron
```

#### CmsApiClient

효성FMS API 호출 전담. Authorization 헤더, SSL, 에러 핸들링 공통 처리.

```typescript
@Injectable()
class CmsApiClient {
  // 회원관리
  async createMember(dto): Promise<CmsMemberResponse>
  async updateMember(memberId, dto): Promise<CmsMemberResponse>
  async deleteMember(memberId): Promise<void>
  async getMember(memberId): Promise<CmsMemberResponse>

  // 동의자료관리
  async uploadAgreement(custId, memberId, file): Promise<CmsAgreementResponse>
  async getAgreement(custId, agreementKey): Promise<CmsAgreementResponse>

  // 출금관리
  async requestWithdrawal(dto): Promise<CmsWithdrawalResponse>
  async updateWithdrawal(transactionId, dto): Promise<CmsWithdrawalResponse>
  async deleteWithdrawal(transactionId): Promise<void>
  async getWithdrawal(transactionId): Promise<CmsWithdrawalResponse>
  async searchWithdrawals(params): Promise<CmsWithdrawalSearchResponse>
}
```

#### CmsBatchProvider

```typescript
@Injectable()
class CmsBatchProvider implements PaymentProvider {
  readonly providerType = 'CMS_BATCH';
  readonly autoCapture = true;

  constructor(
    private readonly cmsApi: CmsApiClient,
    private readonly cmsMemberService: CmsMemberService,
  ) {}

  async authorize(params: ChargeParams): Promise<ChargeResult> {
    // 1. billingMethod에서 cmsMemberId 조회
    // 2. 회원 상태 확인 (신청완료인지)
    // 3. 동의자료 등록 여부 확인
    // 4. 출금일 계산 (다음 영업일 — 마감시간 D-1 17:00 고려)
    // 5. 효성 출금신청 API 호출
    // 6. cms_withdrawals 레코드 생성
    // 7. return { status: 'PENDING', providerTransactionId: transactionId }
  }

  async capture(params: ChargeParams): Promise<ChargeResult> {
    // CMS는 autoCapture=true + 출금 완료가 곧 capture
    // 폴링 cron에서 처리하므로 여기서는 no-op (SUCCEEDED 반환)
    return { status: 'SUCCEEDED' };
  }

  async cancel(params: ChargeParams): Promise<ChargeResult> {
    // 마감 전이면 효성 출금삭제 API 호출
    // 마감 후면 취소 불가 → FAILED
  }

  async getStatus(params: GetStatusParams): Promise<ChargeStatusResult> {
    // 효성 출금조회 API 호출 → 상태 매핑
    // 출금성공 → SUCCEEDED
    // 출금실패 → FAILED
    // 출금중/출금대기 → PENDING
  }

  // refund: CMS는 환불 개념이 없음. 별도 입금으로 처리해야 함.
  // getUserMethods, validateMethod, deleteMethod: BillingMethodService 경유
}
```

#### CmsMemberPollerService

회원등록은 영업일 12:00 마감, 결과는 D+1에 확인 가능. 이를 폴링한다.

```typescript
@Injectable()
class CmsMemberPollerService {
  @Cron('0 0 9,12,15 * * 1-5')  // 평일 09:00, 12:00, 15:00
  async pollPendingMembers(): Promise<void> {
    // cms_members에서 status='PENDING'인 건 조회
    // 효성 회원조회 API로 결과 확인
    // 신청완료 → REGISTERED, 신청실패 → FAILED
  }
}
```

#### CMS 동의자료 REST API

wallet-web에서 결제 시도 전 동의자료 등록 여부를 확인하고, 미등록이면 업로드 UI를 제공한다.

```
POST   /v1/cms-agreements          — 동의자료 업로드 (multipart/form-data)
GET    /v1/cms-agreements/:key     — 동의자료 조회
```

### 5.4 TossBillingProvider

```typescript
@Injectable()
class TossBillingProvider implements PaymentProvider {
  readonly providerType = 'TOSS_BILLING';
  readonly autoCapture = true;

  constructor(
    private readonly tossApi: TossApiClient,
    private readonly billingMethods: BillingMethodService,
  ) {}

  async authorize(params: ChargeParams): Promise<ChargeResult> {
    // 1. billingMethodId → billingKey 조회
    // 2. TossApiClient.confirmBilling(billingKey, amount, orderId, customerKey)
    // 3. return { status: 'SUCCEEDED', providerTransactionId: paymentKey }
  }

  async capture(params): Promise<ChargeResult> {
    // Toss 빌링은 즉시 승인이므로 no-op
    return { status: 'SUCCEEDED' };
  }

  async cancel(params): Promise<ChargeResult> {
    return this.tossApi.cancelPayment(params.providerTransactionId, ...);
  }

  async refund(params): Promise<RefundResult> {
    return this.tossApi.cancelPayment(params.providerTransactionId, ...);
  }
}
```

### 5.5 Kafka consumer — billing.charge command

```typescript
// billing-charge.consumer.ts
@Injectable()
class BillingChargeConsumer {
  // Topic: wallet.commands.v1
  // Message type: billing.charge

  async handle(command: BillingChargeCommand): Promise<void> {
    // 1. billing_agreements에서 subscriberRef로 billingMethodId 조회
    // 2. billingMethod의 providerType으로 Provider 결정
    //    - TOSS_BILLING → TossBillingProvider
    //    - CMS_BATCH → CmsBatchProvider
    // 3. PaymentIntent 생성 (purpose: command.purpose)
    // 4. ChargePlan 구성 (discount 없음, primary만)
    // 5. ConfirmService 슬롯 파이프라인 실행
    // 6. 결과에 따라 이벤트 발행
    //    - SUCCEEDED/AUTHORIZED → payment.intent.captured
    //    - PENDING → (CMS: PENDING_SETTLEMENT, 폴링 cron이 후속 처리)
    //    - FAILED → payment.intent.failed
  }
}
```

**실패 처리:**
- PG 5xx / 타임아웃: 예외를 던져서 `@app/events` DLQ 재시도 경로를 탐
- PG 4xx / 비즈니스 오류 (잔고부족 등): 예외를 던지지 않고, 즉시 `payment.intent.failed` 이벤트 발행

---

## 6. API 엔드포인트 요약

### 새 엔드포인트

| Method | Path | 설명 | 호출자 |
|--------|------|------|--------|
| POST | `/v1/checkout-sessions` | Checkout Session 생성 | 외부 FE (Membership 등) |
| GET | `/v1/checkout-sessions/:id` | 세션 조회 | wallet-web |
| POST | `/v1/checkout-sessions/:id/complete` | 결제 완료 처리 | wallet-web |
| POST | `/v1/billing-methods/toss` | Toss 빌링키 발급 | wallet-web |
| POST | `/v1/billing-methods/cms` | CMS 빌링수단 등록 | wallet-web |
| GET | `/v1/billing-methods` | 빌링수단 목록 | wallet-web |
| DELETE | `/v1/billing-methods/:id` | 빌링수단 비활성화 | wallet-web |
| GET | `/v1/billing-agreements` | 빌링 계약 목록 | wallet-web |
| PUT | `/v1/billing-agreements/:id/billing-method` | 빌링수단 변경 | wallet-web |
| POST | `/v1/cms-agreements` | CMS 동의자료 업로드 | wallet-web |
| GET | `/v1/cms-agreements/:key` | CMS 동의자료 조회 | wallet-web |

### 변경 엔드포인트

| Method | Path | 변경 내용 |
|--------|------|----------|
| POST | `/v1/admin/payment-intents/:id/resolve` | PARTIALLY_CAPTURED → CAPTURED/CANCELED 수동 전이 추가 |

### Kafka

| Topic | Direction | 설명 |
|-------|-----------|------|
| `wallet.commands.v1` | Consumer | `billing.charge` command 처리 |
| `payment.events.v1` | Producer | 결제 이벤트 발행 (Outbox → Kafka) |

---

## 7. 구현 순서

의존 관계를 고려한 Phase 분할. 각 Phase 내 작업은 의존성이 없으면 병렬 가능.

### Phase 1: 기반 작업 (의존성 없음, 병렬 가능)

| # | 작업 | 파일 | 비고 |
|---|------|------|------|
| 1-1 | 스키마: 새 enum 추가 + `payment_intents.purpose` 컬럼 | `schema.ts` | DB migration 생성 |
| 1-2 | 스키마: 새 테이블 추가 (billing_methods, billing_agreements, checkout_sessions, cms_*) | `schema.ts` | DB migration 생성 |
| 1-3 | 상태 머신: `PENDING_SETTLEMENT`, `PARTIALLY_CAPTURED` 전이 규칙 | `state-transition.rules.ts` | |
| 1-4 | TossApiClient 추출 | `providers/toss/toss-api.client.ts` | TossPaymentProvider 리팩토링 포함 |
| 1-5 | CmsApiClient 구현 | `cms/cms-api.client.ts` | 효성FMS API 래핑 |
| 1-6 | ProviderRegistry kind 메타데이터 | `providers/provider.registry.ts` | |

### Phase 2: 핵심 리팩토링

| # | 작업 | 의존 | 비고 |
|---|------|------|------|
| 2-1 | ConfirmService 슬롯 모델 리팩토링 | 1-3 | 기존 3-모드 → 슬롯 파이프라인. PENDING 분기 포함 |
| 2-2 | CaptureService PARTIALLY_CAPTURED | 1-3 | 부분 실패 처리 + 운영 알림 |
| 2-3 | OutboxDispatcherService Kafka 전환 | - | Medusa HTTP POST 제거, Kafka produce |
| 2-4 | Admin API: PARTIALLY_CAPTURED 수동 전이 | 1-3 | PaymentIntentAdminController 확장 |

### Phase 3: 빌링 모듈

| # | 작업 | 의존 | 비고 |
|---|------|------|------|
| 3-1 | BillingMethodService + Controller | 1-2, 1-4 | Toss 빌링키 발급 포함 |
| 3-2 | BillingAgreementService + Controller | 1-2 | |
| 3-3 | TossBillingProvider | 1-4, 3-1 | TossApiClient + BillingMethodService 사용 |
| 3-4 | CheckoutSessionService + Controller | 1-2, 3-1, 3-2 | 세션 생성/조회/완료 + 만료 cron |
| 3-5 | Toss BILLING_DELETED 웹훅 핸들러 | 3-1 | TossWebhookController 확장 |

### Phase 4: CMS 모듈

| # | 작업 | 의존 | 비고 |
|---|------|------|------|
| 4-1 | CmsMemberService | 1-2, 1-5 | 회원 등록/조회 + 폴링 cron |
| 4-2 | CmsAgreementService + Controller | 1-5, 4-1 | 동의자료 CRUD + REST API |
| 4-3 | CmsBatchProvider | 1-5, 4-1, 2-1 | 출금신청 + PENDING 반환 |
| 4-4 | CmsSettlementPollerService | 4-3 | 결과 폴링 + 상태 전이 |

### Phase 5: 통합

| # | 작업 | 의존 | 비고 |
|---|------|------|------|
| 5-1 | BillingChargeConsumer (Kafka) | 3-2, 3-3, 4-3, 2-1 | billing.charge command 처리 |
| 5-2 | channel-adapter: payment.events.v1 consumer | 2-3 | Medusa 웹훅 전달 |
| 5-3 | WalletModule 통합 | 전체 | 모든 Provider/Service/Controller 등록 |
| 5-4 | 통합 테스트 | 전체 | 주요 결제 흐름 E2E |

### Phase 간 병렬화

```
Phase 1 (전부 병렬)
  ├─→ Phase 2 (2-1, 2-2, 2-3, 2-4 병렬)
  │     └─→ Phase 5-1, 5-2
  ├─→ Phase 3 (3-1→3-3→3-4, 3-2 병렬)
  │     └─→ Phase 5-1
  └─→ Phase 4 (4-1→4-2→4-3→4-4)
        └─→ Phase 5-1
```

Phase 2와 Phase 3/4는 병렬 진행 가능하다. Phase 5-1(BillingChargeConsumer)이 모든 Phase의 산출물을 통합하는 최종 지점이다.

---

## 8. 유지 (변경 없음)

| 구분 | 이유 |
|------|------|
| PaymentProvider 인터페이스 | 시그니처 변경 없음. kind는 Registry 메타데이터로 |
| PointsLedgerService | lot 추적, FIFO 소진, 유효기간 — 전부 그대로 |
| point_events/holds 테이블 | 스키마 변경 없음 |
| PaymentIntent → Charge 구조 | 복합결제 모델링에 여전히 최적 |
| 상태머신 + 전이 로그 | 새 상태 추가만, 기존 전이 유지 |
| Transactional Outbox 패턴 | dispatch target을 Kafka로 단일화하되, outbox의 원자적 기록 패턴 자체는 유지 |
| 멱등성 (Idempotency) | 기존 메커니즘 유지 |
| Auto-capture 메커니즘 | 유지 |
| 웹훅 수신/중복제거 | 유지. Toss BILLING_DELETED 웹훅 타입만 추가 |

---

## 9. 테스트 전략

| 레벨 | 대상 | 방식 |
|------|------|------|
| 단위 | ChargePlan 빌드 로직, 상태 전이 규칙, 출금일 계산 | Jest mock |
| 단위 | BillingMethodService, BillingAgreementService | Jest + DB mock |
| 단위 | CmsBatchProvider.authorize() 반환값 검증 | Jest + CmsApiClient mock |
| 통합 | ConfirmService 슬롯 파이프라인 (모든 결제 유형 조합) | itdoc + 실제 DB |
| 통합 | Checkout Session 생성 → 결제 완료 → billing_agreement 생성 | itdoc + 실제 DB |
| 통합 | billing.charge Kafka command → 결제 실행 → 이벤트 발행 | itdoc + Kafka testcontainer |
| 통합 | CMS 폴링 cron → 상태 전이 | itdoc + CmsApiClient mock |
| E2E | Toss 빌링: 빌링키 발급 → 즉시 결제 → 이벤트 발행 | Toss 테스트 환경 |
| E2E | CMS: 회원등록 → 동의자료 → 출금신청 → 결과 조회 | 효성 테스트 환경 |

---

## 10. 환경변수 추가

```bash
# Toss Billing (기존 Toss 환경변수에 추가 또는 공유)
TOSS_BILLING_SECRET_KEY=        # 빌링 전용 시크릿키 (기존과 동일할 수 있음)

# 효성 FMS
HYOSUNG_CMS_API_URL=https://api.hyosungcms.co.kr      # 운영
HYOSUNG_CMS_ADD_URL=https://add.hyosungcms.co.kr       # 동의자료 전용 호스트
HYOSUNG_CMS_SW_KEY=                                     # 연동기관 키
HYOSUNG_CMS_CUST_KEY=                                   # 이용기관 키
HYOSUNG_CMS_CUST_ID=                                    # 업체 ID (동의자료 API에 사용)

# Kafka (기존 + 토픽 추가)
WALLET_KAFKA_PAYMENT_EVENTS_TOPIC=payment.events.v1
WALLET_KAFKA_COMMANDS_TOPIC=wallet.commands.v1
```
