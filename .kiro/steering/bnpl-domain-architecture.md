---
inclusion: always
---

# BNPL Domain Architecture

## 🏗️ Core Domain Separation

### 📋 Invoice Domain (결제 요청 관리)
**Purpose**: 사용자가 결제페이지에 진입할 때 발행되는 결제 요청 관리

**Key Entities**:
- `Invoice`: 결제 요청서 (사용자가 결제페이지 진입 시 생성)
- `InvoiceEvent`: Invoice 상태 변화 추적

**Lifecycle**:
```
User enters payment page → Invoice created → InvoiceEvent (issued)
                                        ↓
                                   [Time passes]
                                        ↓
                              InvoiceEvent (overdue) ← No payment made
                                   OR
                              InvoiceEvent (paid) ← Payment completed
```

**Important Characteristics**:
- Invoice 생성 ≠ 실제 결제 처리
- `overdue` 상태 관리 필요
- BNPL 거래 없이도 독립적으로 존재 가능

### 💳 BNPL Transaction Domain (신용 관리)
**Purpose**: 사용자의 신용 잔액, 한도, 신용 사용량 관리

**Key Entities**:
- `BnplTransaction`: 신용 거래 기록
- `BnplAccount`: 신용 계좌 정보

**Responsibilities**:
- 신용 한도 추적
- 잔액 계산 (정밀한 소수점 연산)
- 부분결제/부분환불 처리
- 신용 사용량 모니터링

**Creation Timing**: 사용자가 실제로 BNPL 결제 API를 호출할 때

### 🏦 Payment Event Domain (실제 금융 거래)
**Purpose**: 은행/PG사와의 실제 금융 거래 기록

**Key Entities**:
- `PaymentEvent`: 실제 돈의 이동 기록
- HMS 연동 거래 추적

**Responsibilities**:
- 실제 금융 거래 추적
- HMS API 호출 결과 기록
- 결제 상태 관리 (신청 → 처리완료)
- 감사 추적 (audit trail)

## 🔄 Domain Interaction Flow

```
1. Invoice Creation (결제페이지 진입)
   └── Invoice + InvoiceEvent (issued)

2. BNPL Payment Selection (사용자가 BNPL 선택)
   └── BnplTransaction (신용 사용)
   └── PaymentEvent (HMS 거래 시작)

3. HMS Processing (실제 금융 처리)
   └── PaymentEvent (상태 업데이트)
   └── BnplTransaction (잔액 업데이트)
   └── InvoiceEvent (paid)
```

## 💡 Development Guidelines

### Timing Considerations
- **Invoice 발급 시점** ≠ **BNPL 결제 API 호출 시점**
- Invoice는 overdue 상태로 오래 존재할 수 있음
- BNPL Transaction은 실제 결제 의도가 있을 때만 생성

### Event Sourcing Principles
- **NO DIRECT UPDATES**: Never update balances, statuses, or aggregates directly
- **EVENT-ONLY WRITES**: All state changes create new immutable events
- **CALCULATED STATE**: All current state is calculated from event streams
- **IMMUTABLE EVENTS**: Once created, events are never modified or deleted

### Data Consistency
- 각 도메인은 독립적인 생명주기를 가짐
- 도메인 간 참조는 ID를 통해서만 (loose coupling)
- 트랜잭션 경계는 도메인별로 분리
- **Balance/Status는 저장하지 않고 실시간 계산**

### Error Handling
- Invoice 만료 ≠ BNPL 거래 실패
- HMS 거래 실패 시 BNPL 잔액 롤백 필요
- 각 도메인별로 독립적인 에러 처리 전략

## 🔧 Implementation Notes

### Database Design (Event Sourcing 적용됨)
```sql
-- Invoice Domain
invoices (id VARCHAR(26), user_id, amount, status, created_at, expires_at)
invoice_events (id VARCHAR(26), invoice_id, event_type, created_at)

-- BNPL Domain (Event Sourcing)
bnpl_accounts (id VARCHAR(21), user_id, credit_limit, approved_limit) -- currentBalance 제거됨
bnpl_transactions (id VARCHAR(26), account_id, type, amount, created_at) -- 이벤트만 저장

-- Payment Domain
payment_events (id VARCHAR(26), invoice_id, payment_method_id, status, amount, metadata TEXT)
```

### Event Sourcing Implementation (새로 추가됨)
```typescript
// ❌ 기존 방식: 직접 잔액 업데이트
await db.update(bnplAccount).set({ currentBalance: newBalance });

// ✅ Event Sourcing: 이벤트만 생성
await db.insert(bnplTransaction).values({
  transactionType: 'DEBIT', // 또는 'CREDIT'
  amount: paymentAmount,
  // 잔액은 저장하지 않음
});

// 잔액은 실시간 계산
const currentBalance = await calculateCurrentBalance(accountId);
```

### Service Boundaries
- `InvoiceService`: Invoice 생명주기 관리
- `BnplService`: 신용 관리 및 부분결제/환불
- `PaymentEventService`: HMS 연동 및 실제 거래 처리

### API Design
```
POST /invoices                    # Invoice 생성
POST /bnpl/partial-payments       # BNPL 부분결제
POST /bnpl/partial-refunds        # BNPL 부분환불
GET  /payment-events/{id}         # HMS 거래 상태 확인
```