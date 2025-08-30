# Design Document

## Overview

The Wallet payment server is designed as a standalone NestJS application that integrates with Medusa.js e-commerce platform. The system follows event-sourcing principles where payment events are the source of truth, with read models (payment sessions) for fast queries. The architecture uses the adapter pattern for payment gateway integration and supports both immediate payments and BNPL functionality.

**Key Design Principles:**
- Event-driven architecture with payment events as source of truth
- Adapter pattern for payment gateway abstraction
- Simple service orchestration for MVP deployment
- KRW-only currency support for initial launch
- No webhooks - redirect-based payment confirmation

## Architecture

### High-Level Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Medusa.js     │    │  Wallet Server  │    │ Payment Gateway │
│   E-commerce    │◄──►│   (NestJS)      │◄──►│  (BatchCMS/PG)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │   PostgreSQL    │
                       │   (Drizzle ORM) │
                       └─────────────────┘
```

### Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Controllers                          │
│  payment-sessions │ payments │ refunds │ admin │ health │
├─────────────────────────────────────────────────────────┤
│                     Services                            │
│   payments.service │ refunds.service │ bnpl.service     │
│   batch.service │ idempotency.service                   │
├─────────────────────────────────────────────────────────┤
│                     Adapters                            │
│  batchcms.adapter │ mock.adapter │ adapter-registry     │
├─────────────────────────────────────────────────────────┤
│                 Shared Components                       │
│     database │ types │ utils │ errors                   │
└─────────────────────────────────────────────────────────┘
```

### Folder Structure

```
src/
  app/
    app.module.ts
    main.ts
  controllers/
    payment-sessions.controller.ts  # Separate controller for session management
    payments.controller.ts          # Payment operations (approve/capture/void)
    refunds.controller.ts
    admin.controller.ts
    health.controller.ts
  services/
    payments.service.ts             # Payment orchestration
    refunds.service.ts              # Refund processing
    bnpl.service.ts                 # BNPL holds/ledger management
    batch.service.ts                # Monthly settlement batch
    idempotency.service.ts          # Simple idempotency handling
  adapters/
    ports.ts                        # PaymentGatewayPort interface
    batchcms.adapter.ts             # BatchCMS API adapter
    mock.adapter.ts
    adapter-registry.ts
  shared/
    database/
      schema.ts                     # Drizzle schema (payments, events, holds...)
      index.ts
    types/                          # Domain-level types only
      payments.ts
      refunds.ts
      bnpl.ts
      admin.ts
      index.ts
    utils/
      errors.ts                     # Standard error codes
      time.ts
```

## Components and Interfaces

### Core Services

#### PaymentsService
**Responsibility:** Orchestrates payment lifecycle operations

```typescript
interface PaymentsService {
  createSession(request: CreateSessionRequest): Promise<PaymentSession>
  approvePayment(paymentId: string, paymentKey: string): Promise<Payment>
  capturePayment(paymentId: string, amount?: number): Promise<Payment>
  voidPayment(paymentId: string): Promise<Payment>
  getPaymentStatus(paymentId: string): Promise<PaymentStatus>
}
```

**Key Operations:**
- Session creation with checkout URL generation
- Payment approval with gateway integration
- Manual capture for BNPL payments
- Payment cancellation/void operations

#### RefundsService
**Responsibility:** Handles refund processing

```typescript
interface RefundsService {
  createRefund(paymentId: string, request: RefundRequest): Promise<Refund>
  getRefundStatus(refundId: string): Promise<RefundStatus>
}
```

#### BnplService
**Responsibility:** Manages BNPL accounts and holds

```typescript
interface BnplService {
  createAccount(userId: string, creditLimit: number): Promise<BnplAccount>
  createHold(accountId: string, amount: number): Promise<BnplHold>
  processMonthlySettlement(): Promise<SettlementResult>
}
```

### Payment Gateway Adapters

#### PaymentGatewayPort (Interface)
```typescript
interface PaymentGatewayPort {
  createPayment(request: PaymentRequest): Promise<PaymentResponse>
  approvePayment(paymentKey: string): Promise<ApprovalResponse>
  capturePayment(paymentKey: string, amount: number): Promise<CaptureResponse>
  refundPayment(paymentKey: string, amount: number): Promise<RefundResponse>
}
```

#### BatchCmsAdapter
**Responsibility:** Integrates with BatchCMS payment gateway
- Handles API authentication and request formatting
- Implements retry logic with exponential backoff
- Maps gateway responses to internal events

#### MockAdapter
**Responsibility:** Provides testing capabilities
- Simulates payment gateway responses
- Supports success/failure scenarios for testing
- No external API calls

### Data Models

#### Payment Session (Read Model)
```typescript
interface PaymentSession {
  id: string              // Wallet-generated ULID
  userId: string
  amount: number          // KRW amount
  status: PaymentStatus   // PENDING | AUTHORIZED | CAPTURED | FAILED | CANCELED
  orderId?: string        // External order reference
  metadata: object        // Medusa session mapping, etc.
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}
```

#### Payment Event (Source of Truth)
```typescript
interface PaymentEvent {
  id: string
  paymentSessionId: string
  paymentMethodId: string
  type: PaymentEventType  // REQUESTED | AUTHORIZED | CAPTURED | CANCELED | FAILED
  amount: number
  paymentKey?: string     // Gateway-provided key
  pgResponse: object      // Raw gateway response
  metadata: object
  createdAt: Date
}
```

#### BNPL Account
```typescript
interface BnplAccount {
  id: string
  userId: string
  status: BnplStatus      // ACTIVE | SUSPENDED | CLOSED
  creditLimitMinor: number
  currentBalanceMinor: number
  billingCycleDay: number // 1-28
  createdAt: Date
  updatedAt: Date
}
```

## Data Models

### Event Sourcing Pattern

The system uses event sourcing where:
- **Payment Events** are the single source of truth
- **Payment Sessions** are read models updated from events
- All state changes are recorded as immutable events
- Event replay can reconstruct current state

### Database Schema Key Points

1. **UUIDv7 for all IDs** - Time-ordered, better for indexing
2. **KRW amounts as bigint** - Stored in minor units (원)
3. **JSONB for flexible data** - Gateway responses, metadata
4. **Event-driven updates** - Sessions updated from events
5. **Optimistic concurrency** - Version fields where needed

## Error Handling

### Error Categories

```typescript
enum ErrorCode {
  // Validation Errors
  VALIDATION_INVALID_AMOUNT = 'VALIDATION_INVALID_AMOUNT',
  VALIDATION_MISSING_FIELD = 'VALIDATION_MISSING_FIELD',
  VALIDATION_INVALID_CURRENCY = 'VALIDATION_INVALID_CURRENCY',
  
  // Payment Gateway Errors
  PG_TIMEOUT = 'PG_TIMEOUT',
  PG_NETWORK = 'PG_NETWORK',
  PG_DECLINED = 'PG_DECLINED',
  PG_UNKNOWN = 'PG_UNKNOWN',
  
  // Business Logic Errors
  PAYMENT_NOT_FOUND = 'PAYMENT_NOT_FOUND',
  PAYMENT_ALREADY_CAPTURED = 'PAYMENT_ALREADY_CAPTURED',
  INSUFFICIENT_BNPL_LIMIT = 'INSUFFICIENT_BNPL_LIMIT',
  BNPL_ONBOARDING_REQUIRED = 'BNPL_ONBOARDING_REQUIRED',
  
  // System Errors
  IDEMPOTENCY_CONFLICT = 'IDEMPOTENCY_CONFLICT',
  DATABASE_ERROR = 'DATABASE_ERROR'
}
```

### Error Response Format

```typescript
interface ErrorResponse {
  error: {
    code: string
    message: string
    details?: object
  }
  timestamp: string
  path: string
}
```

## Testing Strategy

### Integration Testing
- Controller endpoints with MockAdapter
- Database operations with test database
- Event sourcing workflows
- Idempotency behavior

### Test Data Strategy
- Use MockAdapter for predictable responses
- Test both success and failure scenarios
- Verify event creation and state transitions
- Test BNPL limit enforcement

## API Design

### Payment Session Creation
```
POST /payment-sessions
Content-Type: application/json
Idempotency-Key: unique-key-123

{
  "paymentId": "pay_...",
  "amount": { "amount": 129000, "currency": "KRW" },
  "paymentMethodId": "pm_...",
  "returnUrl": "https://shop.com/pay/redirect",
  "cancelUrl": "https://shop.com/checkout",
  "requiresManualCapture": true,
  "metadata": { "medusaPaymentSessionId": "ps_medusa_123" }
}

Response:
{
  "sessionId": "ps_wallet_...",
  "checkout": { "url": "https://wallet/checkout/..." },
  "phase": "PENDING"
}
```

### Payment Operations
```
POST /payments/approve
{
  "paymentId": "ps_wallet_...",
  "paymentKey": "pg_key_from_gateway"
}
Response: { "phase": "AUTHORIZED|CAPTURED", "paymentKey": "..." }

POST /payments/:id/capture
{
  "amount": { "amount": 129000, "currency": "KRW" }
}
Response: { "phase": "CAPTURED", "capturedAmount": 129000 }

POST /payments/:id/void
Response: { "phase": "CANCELED" }
```

### Refund Operations
```
POST /payments/:id/refunds
{
  "amount": { "amount": 30000, "currency": "KRW" },
  "reason": "return"
}
Response: { "refundId": "rf_...", "status": "SUCCESS", "phase": "REFUNDED" }
```

### Admin Operations
```
GET /admin/payments?userId=user123&status=AUTHORIZED&limit=50
GET /admin/payments/:id  # Payment timeline with events
POST /admin/payments/:id/capture|void|refunds
POST /admin/batch/capture/run  # Manual BNPL settlement
```

## Security Considerations

### Data Protection
- No storage of raw card numbers or sensitive payment data
- PaymentKey from gateway stored securely for reference
- Structured logging without sensitive information

### API Security
- Idempotency keys prevent duplicate operations
- Input validation on all endpoints
- Proper error messages without information leakage

### Audit Trail
- All payment operations logged with context
- Event sourcing provides complete audit history
- Admin operations tracked with operator ID

## Deployment Considerations

### Environment Configuration
- Database connection settings
- Payment gateway credentials
- Logging configuration
- Health check endpoints

### Monitoring
- Structured logging with payment context
- Health check endpoint for load balancer
- Basic error rate monitoring
- Payment gateway response time tracking

### Scalability Notes
- Stateless service design for horizontal scaling
- Database connection pooling
- Event-driven architecture supports async processing
- Payment locks commented out for future concurrency needs
