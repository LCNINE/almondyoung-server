# Design Document

## Overview

구독 취소 및 환불 기능을 이벤트 소싱 패턴으로 구현한다. 사용자는 구독을 취소할 수 있고, 무료 체험 기간 중 취소 시 전액 환불을 받을 수 있다. 어드민은 정책을 무시하고 강제 취소 및 환불 금액을 지정할 수 있다. 모든 구독 계약 변경은 이벤트로 기록되어 완벽한 감사 추적이 가능하다.

## Architecture

### Layered Architecture

```
Controller (HTTP)
    ↓
Service (Business Logic)
    ↓
Repository (Data Access)
    ↓
Database (PostgreSQL)
```

### Event Sourcing Pattern

- `subscriptionContractEvents`: 모든 변경 이벤트를 append-only로 저장
- `subscriptionContracts`: 현재 상태를 저장 (이벤트에서 재구성 가능하지만 성능을 위해 캐시)
- 이벤트와 상태는 같은 트랜잭션에서 업데이트

### MSA Bounded Context

- **Membership 서버**: 구독 생명주기, 정책 검증, 환불 자격 판단
- **Wallet 서버**: 실제 결제/환불 처리 (Kafka 이벤트로 통신)
- Membership은 환불 요청 여부와 완료 여부만 추적 (최소한의 결합)

## Data Models

### 1. cancellationReasons (취소 이유 마스터)

```typescript
{
  code: string (PK),              // 'TRIAL_PERIOD', 'PRICE_TOO_HIGH', etc.
  displayText: string,            // '더 나은 서비스를 위해 노력하겠습니다'
  category: string,               // 'TRIAL', 'PRICE', 'PRODUCT', 'SERVICE', 'OTHER'
  sortOrder: integer,             // UI 표시 순서
  isActive: boolean,              // 활성화 여부
  createdAt: timestamp,
  updatedAt: timestamp,
}
```

### 2. subscriptionContractEvents (이벤트 스트림)

```typescript
{
  id: serial (PK),
  contractId: uuid (FK),          // 어떤 계약의 이벤트인지
  eventType: string,              // 'CREATED', 'CANCELLED', 'REFUND_REQUESTED', 'REFUND_COMPLETED', 'REFUND_FAILED'
  userId: string,                 // 성능을 위한 중복 저장

  metadata: jsonb,                // 이벤트별 상세 정보
  /*
    CREATED: { planId, billingDate, trialDays }
    CANCELLED: { reason, reasonCode, isForced, adminId, adminNote }
    REFUND_REQUESTED: { amount, eligibleAmount }
    REFUND_COMPLETED: { amount, walletTransactionId }
    REFUND_FAILED: { errorMessage }
  */

  batchId: uuid (FK),             // eventBatches 참조
  causedBy: string,               // 'USER', 'ADMIN', 'SYSTEM'
  causedByUserId: string,         // 누가 실행했는지

  createdAt: timestamp,
}

Indexes:
- idx_contract_events_contract_id (contractId)
- idx_contract_events_user_id (userId)
- idx_contract_events_type (eventType)
```

### 3. subscriptionContracts (현재 상태 - 수정)

기존 필드에 추가:

```typescript
{
  // 기존 필드들...

  // 상태 관리
  status: string,                 // 'ACTIVE', 'CANCELLED', 'EXPIRED'

  // 취소 정보
  cancelledAt: timestamp,
  cancellationReasonCode: string, // cancellationReasons.code 참조

  // 환불 정보
  refundRequested: boolean,
  refundRequestedAt: timestamp,
  eligibleRefundAmount: integer,
  refundCompleted: boolean,
  refundCompletedAt: timestamp,
  walletReferenceId: string,      // Wallet 트랜잭션 ID

  // 이벤트 소싱 메타
  lastEventId: integer (FK),      // subscriptionContractEvents 참조

  updatedAt: timestamp,
}
```

### 4. 취소 정책 (하드코딩 테이블)

기존 `membership-policy-table.ts`에 취소 관련 정책 추가:

```typescript
// MembershipAction enum에 추가 (이미 존재)
CANCEL_SUBSCRIPTION = 'CANCEL_SUBSCRIPTION'

// MEMBERSHIP_POLICY_RULES에 추가
TRIAL_PERIOD_REFUND: {
  name: '무료 체험 기간 전액 환불',
  description: '무료 체험 기간 중 취소 시 전액 환불',
  validate: (context) => {
    // 환불 자격 확인 로직
    // 무료 체험 기간 중이면 전액 환불 가능
    return { isValid: true };
  }
}

// ACTION_POLICY_MAPPING에 이미 존재
[MembershipAction.CANCEL_SUBSCRIPTION]: ['MIN_SUBSCRIPTION_PERIOD']
```

참고: 실제 환불 자격 판단은 서비스 레이어에서 수행

## Components and Interfaces

### 1. CancellationReasonService

```typescript
interface CancellationReasonService {
  // 활성화된 취소 이유 목록 조회
  getActiveReasons(): Promise<CancellationReason[]>;

  // 취소 이유 코드로 조회
  getReasonByCode(code: string): Promise<CancellationReason | null>;
}
```

### 2. SubscriptionCancellationService

```typescript
interface SubscriptionCancellationService {
  // 일반 구독 취소
  cancelSubscription(
    userId: string,
    reasonCode: string,
    reasonText?: string,
  ): Promise<CancellationResult>;

  // 강제 구독 취소 (어드민)
  forceCancelSubscription(
    contractId: string,
    adminId: string,
    reason: string,
    refundType: 'FULL' | 'PARTIAL' | 'NONE',
    refundAmount?: number,
    adminNote?: string,
  ): Promise<CancellationResult>;

  // 환불 자격 확인
  checkRefundEligibility(contractId: string): Promise<RefundEligibility>;

  // 환불 금액 계산
  calculateRefundAmount(contractId: string): Promise<number>;
}

interface CancellationResult {
  contractId: string;
  status: 'CANCELLED';
  cancelledAt: Date;
  refundEligible: boolean;
  refundAmount: number;
  refundStatus: 'PENDING' | 'NOT_APPLICABLE';
}

interface RefundEligibility {
  eligible: boolean;
  reason: string;
  amount: number;
}
```

### 3. ContractEventService

```typescript
interface ContractEventService {
  // 이벤트 추가
  addEvent(
    contractId: string,
    eventType: string,
    metadata: object,
    causedBy: string,
    causedByUserId?: string,
  ): Promise<ContractEvent>;

  // 계약의 모든 이벤트 조회
  getContractEvents(contractId: string): Promise<ContractEvent[]>;

  // 특정 타입 이벤트 조회
  getEventsByType(
    contractId: string,
    eventType: string,
  ): Promise<ContractEvent[]>;
}
```

### 4. RefundEventHandler

```typescript
interface RefundEventHandler {
  // Wallet에서 환불 완료 이벤트 수신
  handleRefundCompleted(event: RefundCompletedEvent): Promise<void>;

  // Wallet에서 환불 실패 이벤트 수신
  handleRefundFailed(event: RefundFailedEvent): Promise<void>;
}

interface RefundCompletedEvent {
  contractId: string;
  userId: string;
  amount: number;
  walletTransactionId: string;
  completedAt: string;
}

interface RefundFailedEvent {
  contractId: string;
  userId: string;
  errorMessage: string;
}
```

## API Endpoints

### 1. 사용자 API

#### POST /subscriptions/cancel

구독 취소 요청

**Request:**

```typescript
{
  reasonCode: string,      // 'TRIAL_PERIOD', 'PRICE_TOO_HIGH', etc.
  reasonText?: string      // '기타' 선택 시 자유 입력
}
```

**Response:**

```typescript
{
  contractId: string,
  status: 'CANCELLED',
  cancelledAt: string,
  refundEligible: boolean,
  refundAmount: number,
  refundStatus: 'PENDING' | 'NOT_APPLICABLE',
  message: string
}
```

#### GET /cancellation-reasons

취소 이유 목록 조회

**Response:**

```typescript
{
  reasons: [
    {
      code: string,
      displayText: string,
      category: string,
    },
  ];
}
```

### 2. 어드민 API

#### POST /admin/subscriptions/:contractId/force-cancel

강제 구독 취소

**Request:**

```typescript
{
  reason: string,
  refundType: 'FULL' | 'PARTIAL' | 'NONE',
  refundAmount?: number,   // PARTIAL일 때 필수
  adminNote?: string
}
```

**Response:**

```typescript
{
  contractId: string,
  status: 'CANCELLED',
  cancelledAt: string,
  refundAmount: number,
  refundStatus: 'PENDING' | 'NOT_APPLICABLE'
}
```

#### GET /admin/subscriptions/:contractId/events

계약 이벤트 이력 조회

**Response:**

```typescript
{
  contractId: string,
  events: [
    {
      id: number,
      eventType: string,
      metadata: object,
      causedBy: string,
      causedByUserId: string,
      createdAt: string
    }
  ]
}
```

## Business Logic

### 1. 취소 정책 검증

```typescript
// 무료 체험 기간 확인
function isInTrialPeriod(contract: Contract, plan: Plan): boolean {
  if (!plan.trialDays || plan.trialDays === 0) {
    return false;
  }

  const trialEndDate = addDays(contract.billingDate, plan.trialDays);
  const now = new Date();

  return now < trialEndDate;
}

// 환불 자격 확인
function checkRefundEligibility(
  contract: Contract,
  plan: Plan,
): RefundEligibility {
  if (isInTrialPeriod(contract, plan)) {
    return {
      eligible: true,
      reason: '무료 체험 기간 중 취소',
      amount: plan.price,
    };
  }

  return {
    eligible: false,
    reason: '무료 체험 기간이 지났습니다',
    amount: 0,
  };
}
```

### 2. 일반 취소 플로우

```typescript
async function cancelSubscription(userId: string, reasonCode: string) {
  return await db.transaction(async (tx) => {
    // 1. 활성 계약 조회
    const contract = await getActiveContract(tx, userId);
    const plan = await getPlan(tx, contract.planId);

    // 2. 환불 자격 확인
    const eligibility = checkRefundEligibility(contract, plan);

    // 3. 이벤트 배치 생성
    const batch = await createEventBatch(tx, 'SUBSCRIPTION_CANCELLED');

    // 4. CANCELLED 이벤트 추가
    const cancelEvent = await addContractEvent(tx, {
      contractId: contract.id,
      eventType: 'CANCELLED',
      metadata: {
        reason: reasonCode,
        isForced: false,
      },
      causedBy: 'USER',
      causedByUserId: userId,
      batchId: batch.id,
    });

    // 5. 환불 요청 이벤트 추가 (자격 있을 때만)
    if (eligibility.eligible) {
      await addContractEvent(tx, {
        contractId: contract.id,
        eventType: 'REFUND_REQUESTED',
        metadata: {
          amount: eligibility.amount,
          eligibleAmount: eligibility.amount,
        },
        causedBy: 'SYSTEM',
        batchId: batch.id,
      });
    }

    // 6. 계약 상태 업데이트
    await updateContract(tx, contract.id, {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancellationReasonCode: reasonCode,
      refundRequested: eligibility.eligible,
      refundRequestedAt: eligibility.eligible ? new Date() : null,
      eligibleRefundAmount: eligibility.amount,
      lastEventId: cancelEvent.id,
    });

    // 7. Entitlement 종료
    await terminateEntitlement(tx, userId, batch.id);

    return {
      contractId: contract.id,
      status: 'CANCELLED',
      cancelledAt: new Date(),
      refundEligible: eligibility.eligible,
      refundAmount: eligibility.amount,
      refundStatus: eligibility.eligible ? 'PENDING' : 'NOT_APPLICABLE',
    };
  });
}
```

### 3. 강제 취소 플로우

```typescript
async function forceCancelSubscription(
  contractId: string,
  adminId: string,
  reason: string,
  refundType: 'FULL' | 'PARTIAL' | 'NONE',
  refundAmount?: number,
  adminNote?: string,
) {
  return await db.transaction(async (tx) => {
    // 1. 계약 조회
    const contract = await getContract(tx, contractId);
    const plan = await getPlan(tx, contract.planId);

    // 2. 환불 금액 계산
    let finalRefundAmount = 0;
    if (refundType === 'FULL') {
      finalRefundAmount = plan.price;
    } else if (refundType === 'PARTIAL') {
      finalRefundAmount = refundAmount || 0;
    }

    // 3. 이벤트 배치 생성
    const batch = await createEventBatch(
      tx,
      'SUBSCRIPTION_FORCE_CANCELLED',
      adminId,
    );

    // 4. CANCELLED 이벤트 추가 (강제)
    const cancelEvent = await addContractEvent(tx, {
      contractId: contract.id,
      eventType: 'CANCELLED',
      metadata: {
        reason,
        isForced: true,
        adminId,
        adminNote,
        refundType,
      },
      causedBy: 'ADMIN',
      causedByUserId: adminId,
      batchId: batch.id,
    });

    // 5. 환불 요청 이벤트 추가 (금액이 있을 때만)
    if (finalRefundAmount > 0) {
      await addContractEvent(tx, {
        contractId: contract.id,
        eventType: 'REFUND_REQUESTED',
        metadata: {
          amount: finalRefundAmount,
          eligibleAmount: finalRefundAmount,
          isForced: true,
        },
        causedBy: 'ADMIN',
        causedByUserId: adminId,
        batchId: batch.id,
      });
    }

    // 6. 계약 상태 업데이트
    await updateContract(tx, contract.id, {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancellationReasonCode: 'ADMIN_FORCED',
      refundRequested: finalRefundAmount > 0,
      refundRequestedAt: finalRefundAmount > 0 ? new Date() : null,
      eligibleRefundAmount: finalRefundAmount,
      lastEventId: cancelEvent.id,
    });

    // 7. Entitlement 종료
    await terminateEntitlement(tx, contract.userId, batch.id);

    return {
      contractId: contract.id,
      status: 'CANCELLED',
      cancelledAt: new Date(),
      refundAmount: finalRefundAmount,
      refundStatus: finalRefundAmount > 0 ? 'PENDING' : 'NOT_APPLICABLE',
    };
  });
}
```

### 4. Wallet 이벤트 처리

```typescript
// 환불 완료 이벤트 수신
async function handleRefundCompleted(event: RefundCompletedEvent) {
  await db.transaction(async (tx) => {
    // 0. 계약 존재 여부 확인
    const contract = await getContract(tx, event.contractId);
    if (!contract) {
      throw new Error('Contract not found');
    }

    // 멱등성 체크: 이미 환불 완료된 경우 스킵
    if (contract.refundCompleted) {
      return; // 이미 처리됨
    }

    // 1. REFUND_COMPLETED 이벤트 추가
    const refundEvent = await addContractEvent(tx, {
      contractId: event.contractId,
      eventType: 'REFUND_COMPLETED',
      metadata: {
        amount: event.amount,
        walletTransactionId: event.walletTransactionId,
      },
      causedBy: 'SYSTEM',
    });

    // 2. 계약 상태 업데이트
    await updateContract(tx, event.contractId, {
      refundCompleted: true,
      refundCompletedAt: new Date(event.completedAt),
      walletReferenceId: event.walletTransactionId,
      lastEventId: refundEvent.id,
    });
  });
}

// 환불 실패 이벤트 수신
async function handleRefundFailed(event: RefundFailedEvent) {
  await db.transaction(async (tx) => {
    // 0. 계약 존재 여부 확인
    const contract = await getContract(tx, event.contractId);
    if (!contract) {
      throw new Error('Contract not found');
    }

    // 1. REFUND_FAILED 이벤트 추가
    const failEvent = await addContractEvent(tx, {
      contractId: event.contractId,
      eventType: 'REFUND_FAILED',
      metadata: {
        errorMessage: event.errorMessage,
      },
      causedBy: 'SYSTEM',
    });

    // 2. 계약 상태 업데이트
    await updateContract(tx, event.contractId, {
      lastEventId: failEvent.id,
    });

    // 3. 알림 발송 (어드민) - 추후 구현
    // TODO: await notifyAdmin({ ... });
  });
}
```

## Error Handling

### Service Layer

서비스에서는 일반 Error만 던진다:

```typescript
throw new Error('Active subscription not found');
throw new Error('Refund not eligible');
throw new Error('Contract already cancelled');
throw new Error('Invalid refund type');
```

### Controller Layer

컨트롤러에서 HTTP 예외로 변환:

```typescript
try {
  return await this.cancellationService.cancelSubscription(userId, dto);
} catch (e: any) {
  const msg = (e?.message ?? '').toLowerCase();
  if (msg.includes('not found')) {
    throw new NotFoundException(e.message);
  }
  if (msg.includes('not eligible') || msg.includes('already cancelled')) {
    throw new BadRequestException(e.message);
  }
  throw new InternalServerErrorException(e.message);
}
```

## Database Migrations

### Migration 1: Add cancellationReasons table

```sql
CREATE TABLE cancellation_reasons (
  code TEXT PRIMARY KEY,
  display_text TEXT NOT NULL,
  category TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 초기 데이터
INSERT INTO cancellation_reasons (code, display_text, category, sort_order) VALUES
  ('TRIAL_PERIOD', '더 나은 서비스를 위해 노력하겠습니다', 'TRIAL', 1),
  ('PRICE_TOO_HIGH', '가격이 저렴하지 않습니다', 'PRICE', 2),
  ('NO_PRODUCTS', '살만한 제품이 없습니다', 'PRODUCT', 3),
  ('DELIVERY_SLOW', '배송이 느립니다', 'SERVICE', 4),
  ('DELIVERY_MANY', '오배송이 많습니다', 'SERVICE', 5),
  ('SITE_SLOW', '사이트가 느립니다', 'SERVICE', 6),
  ('PAYMENT_ISSUE', '결제가 불편합니다', 'SERVICE', 7),
  ('DISSATISFIED', '불친절합니다', 'SERVICE', 8),
  ('OTHER', '기타', 'OTHER', 9);
```

### Migration 2: Add subscriptionContractEvents table

```sql
CREATE TABLE subscription_contract_events (
  id SERIAL PRIMARY KEY,
  contract_id UUID NOT NULL REFERENCES subscription_contracts(id),
  event_type TEXT NOT NULL,
  user_id VARCHAR NOT NULL,
  metadata JSONB NOT NULL,
  batch_id UUID REFERENCES event_batches(id),
  caused_by TEXT NOT NULL,
  caused_by_user_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contract_events_contract_id ON subscription_contract_events(contract_id);
CREATE INDEX idx_contract_events_user_id ON subscription_contract_events(user_id);
CREATE INDEX idx_contract_events_type ON subscription_contract_events(event_type);
```

### Migration 3: Alter subscriptionContracts table

```sql
ALTER TABLE subscription_contracts
  ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN cancelled_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN cancellation_reason_code TEXT REFERENCES cancellation_reasons(code),
  ADD COLUMN refund_requested BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN refund_requested_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN eligible_refund_amount INTEGER,
  ADD COLUMN refund_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN refund_completed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN wallet_reference_id TEXT,
  ADD COLUMN last_event_id INTEGER REFERENCES subscription_contract_events(id),
  ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
```

## Testing Strategy

### Unit Tests (Service Layer)

- 환불 자격 확인 로직
- 환불 금액 계산 로직
- 이벤트 메타데이터 생성

### Integration Tests (Controller + Service)

- 일반 구독 취소 플로우
- 강제 구독 취소 플로우
- 환불 완료 이벤트 처리
- 환불 실패 이벤트 처리

### E2E Tests

- POST /subscriptions/cancel (무료 체험 기간 중)
- POST /subscriptions/cancel (무료 체험 기간 후)
- POST /admin/subscriptions/:id/force-cancel
- GET /admin/subscriptions/:id/events

## Implementation Notes

- Kafka 이벤트 발행은 추후 CTO가 추가 (현재는 스킵)
- Redis 캐싱은 현재 단계에서 불필요
- 낙관적 락(version)은 현재 단계에서 불필요
- 테스트는 핵심 기능만 작성 (과도한 테스트 지양)
