# Event Sourcing BNPL 시스템 구현 - Design

## Overview

Event Sourcing 패턴을 적용한 BNPL 시스템의 설계 문서입니다. 기존의 상태 기반 시스템에서 이벤트 기반 시스템으로 전환하여 데이터 일관성, 감사 추적성, 그리고 시스템 안정성을 향상시킵니다.

## Architecture

### Event Sourcing Pattern
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Commands      │───▶│   Events        │───▶│  Projections    │
│                 │    │                 │    │                 │
│ - PaymentRequest│    │ - PaymentEvent  │    │ - CurrentBalance│
│ - RefundRequest │    │ - RefundEvent   │    │ - CreditInfo    │
│ - SettleRequest │    │ - SettleEvent   │    │ - Statistics    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Domain Separation
```
┌─────────────────────────────────────────────────────────────┐
│                    BNPL Domain                              │
├─────────────────┬─────────────────┬─────────────────────────┤
│ Invoice Domain  │ Transaction     │ Payment Event Domain    │
│                 │ Domain          │                         │
│ - Invoice       │ - BnplAccount   │ - PaymentEvent         │
│ - InvoiceEvent  │ - BnplTransaction│ - RefundEvent          │
│                 │ (Event Stream)  │ - HMS Integration      │
└─────────────────┴─────────────────┴─────────────────────────┘
```

## Components and Interfaces

### Core Services

#### 1. BnplAccountService
```typescript
class BnplAccountService {
  // Event Sourcing 기반 잔액 계산
  private async calculateCurrentBalance(accountId: string): Promise<number>
  
  // 계정 조회 (실시간 잔액 포함)
  async getAccountById(accountId: string): Promise<BnplAccount>
  
  // 거래 내역 조회
  async getTransactionHistory(accountId: string): Promise<Transaction[]>
}
```

#### 2. BnplPaymentService
```typescript
class BnplPaymentService {
  // 결제 요청 이벤트 생성
  async requestPayment(payload: RequestPaymentPayload): Promise<PaymentEvent>
  
  // 결제 상태 업데이트 (이벤트 기반)
  async authorizePayment(payload: AuthorizePaymentPayload): Promise<PaymentEvent>
  async capturePayment(payload: CapturePaymentPayload): Promise<PaymentEvent>
  async failPayment(payload: FailPaymentPayload): Promise<PaymentEvent>
}
```

#### 3. BnplPartialPaymentService
```typescript
class BnplPartialPaymentService {
  // 부분결제 처리 (DEBIT 이벤트 생성)
  async processPartialPayment(request: PartialPaymentRequest): Promise<PartialPaymentResult>
  
  // DB에 BNPL Transaction 이벤트 저장
  private async createBnplTransaction(data: CreateBnplTransactionData): Promise<Transaction>
}
```

#### 4. BnplPartialRefundService
```typescript
class BnplPartialRefundService {
  // 부분환불 처리 (CREDIT 이벤트 생성)
  async processPartialRefund(request: PartialRefundRequest): Promise<PartialRefundResult>
  
  // 환불 Transaction 이벤트 저장
  private async createBnplRefundTransaction(data: CreateBnplRefundTransactionData): Promise<Transaction>
}
```

## Data Models

### Event Sourcing 기반 스키마

#### Drizzle Schema
```typescript
// ❌ 제거된 필드: currentBalance (Event Sourcing 원칙)
export const bnplAccount = pgTable('bnpl_account', {
  id: varchar('id', { length: 21 }).primaryKey().$defaultFn(() => newMemberId()), // TSID
  userId: varchar('user_id', { length: 64 }).notNull(),
  paymentMethodId: varchar('payment_method_id', { length: 26 }).notNull(),
  creditLimit: numeric('credit_limit', { precision: 18, scale: 2 }).notNull(),
  approvedLimit: numeric('approved_limit', { precision: 18, scale: 2 }).notNull(),
  // currentBalance 필드 제거됨 - Event Sourcing으로 실시간 계산
});

// 이벤트 스트림
export const bnplTransaction = pgTable('bnpl_transaction', {
  id: varchar('id', { length: 26 }).primaryKey().$defaultFn(() => ulid()), // ULID
  bnplAccountId: varchar('bnpl_account_id', { length: 21 }).notNull(),
  invoiceId: varchar('invoice_id', { length: 64 }).notNull(),
  transactionType: text('transaction_type').$type<'DEBIT' | 'CREDIT'>().notNull(),
  status: text('status').$type<'AUTHORIZED' | 'CAPTURED' | 'VOIDED'>().notNull(),
  amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Payment Events (메타데이터 지원)
export const paymentEvents = pgTable('payment_events', {
  id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),
  invoiceId: varchar('invoice_id', { length: 26 }).notNull(),
  paymentMethodId: varchar('payment_method_id', { length: 26 }).notNull(),
  amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
  status: varchar('status', { length: 255 }).notNull(),
  metadata: text('metadata'), // JSON 문자열로 저장
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});
```

#### Zod Schema (타입 정합성 보장)
```typescript
export const PaymentEventSchema = z.object({
  id: ID.ULID,
  invoiceId: ID.InvoiceId,
  paymentMethodId: ID.ULID,
  amount: AmountSchema,
  status: PaymentStatusEnum,
  pgTransactionId: z.string().max(255).nullable().optional(),
  pgResponse: z.string().nullable().optional(), // Drizzle과 일치
  actor: ActorEnum,
  errorMessage: z.string().max(255).nullable().optional(),
  metadata: z.string().nullable().optional(), // DB에는 JSON 문자열로 저장
  createdAt: z.date(),
  updatedAt: z.date().nullable().optional(), // Drizzle과 일치
});

// 서비스 레이어용 (메타데이터를 객체로 받음)
export const RequestPaymentPayloadSchema = z.object({
  invoiceId: ID.InvoiceId,
  paymentMethodId: ID.ULID,
  amount: AmountSchema,
  actor: ActorEnum,
  metadata: z.record(z.any()).optional(), // 서비스에서는 객체로 받음
});
```

## Error Handling

### 타입 정합성 에러 방지
```typescript
// 메타데이터 처리 패턴
const dbPayload = {
  ...payload,
  metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
  // 다른 필드들도 Drizzle 스키마와 정확히 일치하도록 변환
};
```

### Event Sourcing 에러 방지
```typescript
// ❌ 금지된 패턴
await db.update(bnplAccount).set({ currentBalance: newBalance });

// ✅ 권장 패턴
await db.insert(bnplTransaction).values({
  transactionType: 'DEBIT',
  amount: paymentAmount,
});
const currentBalance = await calculateCurrentBalance(accountId);
```

## Testing Strategy

### Event Sourcing 테스트
1. **이벤트 생성 테스트**: 각 비즈니스 액션이 올바른 이벤트를 생성하는지 확인
2. **상태 계산 테스트**: 이벤트 스트림에서 현재 상태가 올바르게 계산되는지 확인
3. **불변성 테스트**: 생성된 이벤트가 수정되지 않는지 확인

### 타입 정합성 테스트
1. **빌드 테스트**: `npm run build`가 성공하는지 확인
2. **스키마 일치 테스트**: Drizzle과 Zod 스키마가 일치하는지 확인
3. **메타데이터 직렬화 테스트**: JSON 변환이 올바르게 작동하는지 확인

### 통합 테스트
1. **부분결제 플로우**: 전체 부분결제 프로세스 테스트
2. **부분환불 플로우**: 전체 부분환불 프로세스 테스트
3. **정산 플로우**: 정산 배치 처리 테스트

## Performance Considerations

### Event Stream 최적화
- 인덱스 최적화: `bnplAccountId`, `createdAt` 필드에 인덱스 설정
- 페이지네이션: 대량의 이벤트 조회 시 페이지네이션 적용
- 캐싱: 자주 조회되는 잔액 정보에 대한 캐싱 전략

### 실시간 계산 최적화
- 배치 처리: 여러 계정의 잔액을 한 번에 계산
- 병렬 처리: 독립적인 계산들을 병렬로 처리
- 메모리 최적화: 대량 데이터 처리 시 스트리밍 방식 사용