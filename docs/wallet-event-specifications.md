# Wallet Service - 이벤트/커맨드 명세서

> **작성일**: 2025-01-20  
> **버전**: 1.0.0  
> **상태**: 초안 (리뷰 대기)

## 📊 개요

Wallet 서비스는 결제, 환불, BNPL, 포인트, 세금계산서 등 금융 트랜잭션을 담당합니다.

### 토픽 구성

| 토픽명               | 파티션 수 | Aggregate Type   | 설명                         |
| -------------------- | --------- | ---------------- | ---------------------------- |
| `wallet.events.v1`   | 6         | `Payment`        | 결제/환불/BNPL/포인트 이벤트 |
| `wallet.commands.v1` | 3         | `PaymentCommand` | 결제 처리 커맨드 (선택)      |

---

## 🎯 1. wallet.events.v1 (Events Stream)

### 아키텍처 원칙

- **Event**: 이미 발생한 과거 사실 (과거형 동사)
- **불변성**: 이벤트는 발행 후 수정 불가
- **멱등성**: 동일 이벤트 중복 수신 시에도 안전하게 처리

---

## 💳 Payment 도메인 이벤트

### 1.1 `PaymentAuthorized` ⭐

**설명**: 결제 승인이 완료되었을 때 발행 (아직 확정 전, 예약 상태)

**발행자**: Wallet Service (PaymentService)

**구독자**:

- **Order Service**: 주문 상태를 "결제 승인됨"으로 업데이트
- **Notification**: 고객에게 결제 승인 알림
- **Analytics**: 결제 승인 통계

**비즈니스 컨텍스트**:

- Toss 같은 PG사에서 승인은 받았지만 아직 확정(capture)하지 않은 상태
- 취소 가능한 상태

**페이로드**:

```typescript
{
  intentId: string;              // Payment Intent ID
  paymentId: string;             // 실제 Payment ID
  customerId: string;            // 고객 ID
  amount: number;                // 결제 금액 (원)
  currency: string;              // 통화 (KRW)
  providerType: string;          // 'TOSS' | 'HMS_CARD' | 'HMS_BNPL'
  providerTransactionId?: string; // PG사 트랜잭션 ID
  orderId?: string;              // 주문 ID (있는 경우)
  metadata?: Record<string, any>; // 추가 메타데이터 (카드번호 등)
  authorizedAt: string;          // 승인 시각 (ISO 8601)
}
```

**Zod 스키마**:

```typescript
const PaymentAuthorizedSchema = z.object({
  intentId: z.string().min(1),
  paymentId: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  providerType: z.string().min(1),
  providerTransactionId: z.string().optional(),
  orderId: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  authorizedAt: z.string().datetime(),
});
```

---

### 1.2 `PaymentCaptured` ⭐⭐⭐ (가장 중요)

**설명**: 결제가 최종 확정되었을 때 발행 (실제 돈이 이동함)

**발행자**: Wallet Service (PaymentService)

**구독자**:

- **Order Service**: 주문 확정 처리 ✅ 필수
- **WMS**: 출고 프로세스 시작 ✅ 필수
- **Notification**: 결제 완료 알림 (고객/관리자)
- **Membership Service**: 멤버십 구독 활성화
- **Analytics**: 매출 통계

**비즈니스 컨텍스트**:

- 실제 결제가 완료된 시점
- 환불 요청만 가능, 결제 취소 불가
- 가장 중요한 이벤트로, 다른 서비스들이 이 이벤트를 기다림

**페이로드**:

```typescript
{
  intentId: string;
  paymentId: string;
  customerId: string;
  amount: number;
  currency: string;
  providerType: string;
  providerTransactionId?: string;
  orderId?: string;
  metadata?: Record<string, any>;
  capturedAt: string;            // 확정 시각 (ISO 8601)
}
```

**Zod 스키마**:

```typescript
const PaymentCapturedSchema = z.object({
  intentId: z.string().min(1),
  paymentId: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  providerType: z.string().min(1),
  providerTransactionId: z.string().optional(),
  orderId: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  capturedAt: z.string().datetime(),
});
```

---

### 1.3 `PaymentFailed`

**설명**: 결제가 실패했을 때 발행

**발행자**: Wallet Service (PaymentService)

**구독자**:

- **Order Service**: 주문 취소 또는 재시도 처리
- **Notification**: 결제 실패 알림 (고객)
- **Monitoring**: 결제 실패 모니터링 및 알림

**비즈니스 컨텍스트**:

- 승인 실패, 잔액 부족, 카드 오류 등
- 재시도 가능한 경우와 불가능한 경우 구분 필요

**페이로드**:

```typescript
{
  intentId: string;
  paymentId?: string;            // 실패 시점에 따라 없을 수 있음
  customerId: string;
  amount: number;
  currency: string;
  providerType: string;
  errorCode: string;             // 'INSUFFICIENT_BALANCE' | 'CARD_EXPIRED' 등
  errorMessage: string;          // 사용자에게 표시할 메시지
  orderId?: string;
  isRetryable?: boolean;         // 재시도 가능 여부
  failedAt: string;
}
```

**Zod 스키마**:

```typescript
const PaymentFailedSchema = z.object({
  intentId: z.string().min(1),
  paymentId: z.string().optional(),
  customerId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  providerType: z.string().min(1),
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
  orderId: z.string().optional(),
  isRetryable: z.boolean().optional(),
  failedAt: z.string().datetime(),
});
```

---

### 1.4 `PaymentCancelled`

**설명**: 결제가 취소되었을 때 발행 (승인 후 확정 전에만 가능)

**발행자**: Wallet Service (PaymentService)

**구독자**:

- **Order Service**: 주문 취소 처리
- **Notification**: 결제 취소 알림
- **Analytics**: 취소율 통계

**비즈니스 컨텍스트**:

- PaymentAuthorized 상태에서만 가능
- PaymentCaptured 이후는 Refund로 처리해야 함

**페이로드**:

```typescript
{
  intentId: string;
  paymentId: string;
  customerId: string;
  amount: number;
  currency: string;
  reason: string;                // 취소 사유
  cancelledBy?: string;          // 취소자 (고객/관리자/시스템)
  orderId?: string;
  cancelledAt: string;
}
```

---

## 💰 Refund 도메인 이벤트

### 2.1 `RefundRequested`

**설명**: 환불이 요청되었을 때 발행

**발행자**: Wallet Service (RefundService)

**구독자**:

- **Order Service**: 주문 상태를 "환불 요청됨"으로 업데이트
- **WMS**: 반품 입고 대기 상태로 변경 (상품 반품인 경우)
- **Notification**: 환불 요청 접수 알림 (고객/CS팀)
- **Approval Service**: 환불 승인 프로세스 시작 (고액인 경우)

**비즈니스 컨텍스트**:

- PaymentCaptured 이후에만 가능
- 전액 환불 / 부분 환불 구분
- 환불 승인이 필요한 경우와 자동 처리 구분

**페이로드**:

```typescript
{
  refundId: string;
  paymentId: string;
  intentId: string;
  customerId: string;
  amount: number;                // 환불 금액
  currency: string;
  reason: string;                // 'CUSTOMER_REQUEST' | 'OUT_OF_STOCK' | 'DEFECTIVE' 등
  reasonDetail?: string;         // 상세 사유
  orderId?: string;
  requestedBy?: string;          // 요청자
  requiresApproval?: boolean;    // 승인 필요 여부
  requestedAt: string;
}
```

---

### 2.2 `RefundCompleted` ⭐

**설명**: 환불이 완료되었을 때 발행

**발행자**: Wallet Service (RefundService)

**구독자**:

- **Order Service**: 주문 상태를 "환불 완료"로 업데이트 ✅ 필수
- **WMS**: 재고 복원 처리
- **Notification**: 환불 완료 알림 (고객)
- **Membership Service**: 멤버십 구독 취소/환급 처리
- **Point Service**: 포인트 회수 처리 (포인트 사용했던 경우)
- **Analytics**: 환불 통계

**비즈니스 컨텍스트**:

- PG사에서 환불 처리 완료됨
- 실제 돈이 고객에게 돌아감

**페이로드**:

```typescript
{
  refundId: string;
  paymentId: string;
  intentId: string;
  customerId: string;
  amount: number;
  currency: string;
  providerRefundId?: string;     // PG사 환불 ID
  orderId?: string;
  completedAt: string;
}
```

---

### 2.3 `RefundApproved` ⭐ (Phase 2)

**설명**: 환불이 승인되었을 때 발행 (반품 검수 완료)

**발행자**: Wallet Service (RefundService) 또는 WMS

**구독자**:

- **Wallet Service**: 실제 환불 처리 시작 ✅ 필수
- **Order Service**: 환불 승인 상태 업데이트
- **Notification**: 환불 승인 알림 (고객)

**비즈니스 컨텍스트**:

- 배송 이후 반품의 경우, WMS에서 반품 검수 완료 후 발행
- 배송 이전 취소의 경우, 자동 승인
- 승인 후 실제 PG사 환불 처리 진행

**페이로드**:

```typescript
{
  refundId: string;
  paymentId: string;
  intentId: string;
  customerId: string;
  amount: number;
  currency: string;
  orderId?: string;
  returnId?: string;             // 반품 ID (있는 경우)
  approvedBy?: string;           // 승인자
  approvalReason?: string;       // 승인 사유
  approvedAt: string;
}
```

---

### 2.4 `RefundRejected` (Phase 2)

**설명**: 환불이 거부되었을 때 발행

**발행자**: Wallet Service (RefundService) 또는 WMS

**구독자**:

- **Order Service**: 환불 거부 상태 업데이트 ✅ 필수
- **Notification**: 환불 거부 알림 (고객/CS팀)

**비즈니스 컨텍스트**:

- 반품 검수 불합격
- 정책 위반으로 환불 거부
- 고객과 협의 필요

**페이로드**:

```typescript
{
  refundId: string;
  paymentId: string;
  intentId: string;
  customerId: string;
  amount: number;
  currency: string;
  orderId?: string;
  returnId?: string;
  rejectionReason: string;       // 거부 사유
  rejectionDetail?: string;      // 상세 사유
  rejectedBy?: string;           // 거부자
  requiresCustomerContact: boolean; // 고객 연락 필요 여부
  rejectedAt: string;
}
```

---

### 2.5 `RefundFailed`

**설명**: 환불 처리가 실패했을 때 발행

**발행자**: Wallet Service (RefundService)

**구독자**:

- **CS Service**: 수동 처리 대기열에 추가 ✅ 필수
- **Notification**: CS팀에게 긴급 알림
- **Monitoring**: 환불 실패 모니터링

**비즈니스 컨텍스트**:

- PG사 시스템 오류, 계좌 오류 등
- 대부분 수동 처리 필요

**페이로드**:

```typescript
{
  refundId: string;
  paymentId: string;
  intentId: string;
  customerId: string;
  amount: number;
  currency: string;
  errorCode: string;
  errorMessage: string;
  orderId?: string;
  requiresManualProcessing: boolean;  // 수동 처리 필요 여부
  failedAt: string;
}
```

---

## 🏦 BNPL (후불결제) 도메인 이벤트

### 3.1 `BnplAccountCreated`

**설명**: BNPL 계정이 생성되었을 때 발행

**발행자**: Wallet Service (BnplService)

**구독자**:

- **Notification**: BNPL 계정 생성 완료 알림
- **Analytics**: BNPL 가입 통계

**비즈니스 컨텍스트**:

- HMS BNPL 등록 완료
- 초기 신용 한도 설정

**페이로드**:

```typescript
{
  accountId: string;
  userId: string;
  creditLimit: number; // 신용 한도
  availableCredit: number; // 사용 가능 한도
  currency: string;
  status: string; // 'ACTIVE' | 'SUSPENDED' | 'CLOSED'
  provider: string; // 'HMS_BNPL' 등
  createdAt: string;
}
```

---

### 3.2 `BnplCreditUsed`

**설명**: BNPL 크레딧이 사용되었을 때 발행

**발행자**: Wallet Service (BnplService)

**구독자**:

- **Order Service**: BNPL 결제 완료 처리
- **Notification**: BNPL 사용 알림
- **Analytics**: BNPL 사용 통계

**비즈니스 컨텍스트**:

- 후불 결제 사용
- 정산 대기 상태

**페이로드**:

```typescript
{
  accountId: string;
  userId: string;
  transactionId: string;
  amount: number;                // 사용 금액
  currency: string;
  remainingCredit: number;       // 남은 한도
  orderId?: string;
  settlementDueDate?: string;    // 정산 예정일
  usedAt: string;
}
```

---

### 3.3 `BnplSettlementCompleted` ⭐

**설명**: BNPL 정산이 완료되었을 때 발행 (CMS 자동이체 완료)

**발행자**: Wallet Service (BnplSettlementService)

**구독자**:

- **Order Service**: 정산 완료 표시
- **Notification**: 정산 완료 알림
- **Analytics**: 정산 통계

**비즈니스 컨텍스트**:

- CMS 배치 처리 완료
- 실제 돈이 HMS로 입금됨
- 신용 한도는 Wallet 내부에서 자동 복원

**페이로드**:

```typescript
{
  settlementId: string;
  accountId: string;
  userId: string;
  amount: number;                // 정산 금액
  currency: string;
  orderId?: string;
  cmsTransactionId?: string;     // CMS 트랜잭션 ID
  restoredCredit: number;        // 복원된 한도
  completedAt: string;
}
```

---

### 3.4 `BnplSettlementFailed`

**설명**: BNPL 정산이 실패했을 때 발행

**발행자**: Wallet Service (BnplSettlementService)

**구독자**:

- **CS Service**: 수동 처리 대기열 ✅ 필수
- **User Service**: 계정 상태 업데이트 (정지 등)
- **Notification**: CS팀 긴급 알림, 고객 알림
- **Retry Service**: 재시도 스케줄링

**비즈니스 컨텍스트**:

- CMS 자동이체 실패 (잔액 부족 등)
- 재시도 필요
- 일정 횟수 실패 시 계정 정지

**페이로드**:

```typescript
{
  settlementId: string;
  accountId: string;
  userId: string;
  amount: number;
  currency: string;
  errorCode: string;             // 'INSUFFICIENT_BALANCE' | 'ACCOUNT_CLOSED' 등
  errorMessage: string;
  orderId?: string;
  retryCount: number;            // 재시도 횟수
  nextRetryAt?: string;          // 다음 재시도 시각
  requiresSuspension: boolean;   // 계정 정지 필요 여부
  failedAt: string;
}
```

---

## 🎯 Point 도메인 이벤트

> **설계 결정**: 포인트는 Wallet 서비스 내부에서 완전히 관리되므로, 외부 이벤트 발행을 최소화합니다.
> 포인트 적립/사용은 결제 프로세스의 일부로 처리되며, 별도 이벤트가 필요하지 않을 수 있습니다.

### 4.1 `PointsEarned` (선택적)

**설명**: 포인트가 적립되었을 때 발행

**발행자**: Wallet Service (PointService)

**구독자**:

- **Analytics**: 포인트 적립 통계 (선택적)

**비즈니스 컨텍스트**:

- 구매 완료 후 포인트 적립
- 이벤트 참여 포인트 지급
- 리뷰 작성 포인트 지급
- **주의**: 포인트는 Wallet 내부 관리이므로, 외부 알림이나 동기화가 필요 없다면 이벤트 발행 불필요

**페이로드**:

```typescript
{
  pointId: string;
  partnerId: string;             // 파트너 ID (포인트 오너)
  userId?: string;               // 고객 ID (있는 경우)
  amount: number;                // 적립 포인트
  reason: string;                // 'PURCHASE' | 'REVIEW' | 'EVENT' | 'REFUND_CANCEL' 등
  orderId?: string;
  expiresAt?: string;            // 만료일
  earnedAt: string;
}
```

**구현 결정 필요**:

- 포인트 적립 이벤트를 발행할지 여부 확인 필요
- Analytics나 Notification이 실제로 필요한지 확인

---

### 4.2 `PointsRedeemed` (선택적)

**설명**: 포인트가 사용되었을 때 발행

**발행자**: Wallet Service (PointService)

**구독자**:

- **Analytics**: 포인트 사용 통계 (선택적)

**비즈니스 컨텍스트**:

- 결제 시 포인트 사용
- 즉시 차감됨
- **주의**: 포인트 사용은 PaymentCaptured 이벤트에 포함될 수 있으므로, 별도 이벤트가 불필요할 수 있음

**페이로드**:

```typescript
{
  pointId: string;
  partnerId: string;
  userId?: string;
  amount: number;                // 사용 포인트
  reason: string;                // 'PAYMENT' | 'GIFT' 등
  orderId?: string;
  redeemedAt: string;
}
```

**구현 결정 필요**:

- 포인트 사용 이벤트를 발행할지 여부 확인 필요
- Order Service가 포인트 사용 정보를 알아야 하는지 확인

---

### 4.3 `PointsCancelled` (선택적)

**설명**: 포인트가 취소되었을 때 발행 (적립 취소 또는 사용 취소)

**발행자**: Wallet Service (PointService)

**구독자**:

- **Analytics**: 포인트 취소 통계 (선택적)

**비즈니스 컨텍스트**:

- 환불로 인한 적립 포인트 회수
- 결제 취소로 인한 사용 포인트 복원
- **주의**: 환불 프로세스의 일부로 처리되므로, 별도 이벤트가 불필요할 수 있음

**페이로드**:

```typescript
{
  pointId: string;
  partnerId: string;
  userId?: string;
  amount: number;
  reason: string;                // 'REFUND' | 'PAYMENT_CANCEL' 등
  orderId?: string;
  cancelledAt: string;
}
```

---

### 4.4 `PointsExpired` (Phase 3)

**설명**: 포인트가 만료되었을 때 발행

**발행자**: Wallet Service (PointService - 배치 작업)

**구독자**:

- **Notification**: 포인트 만료 알림 (만료 직전/만료 시)
- **Analytics**: 포인트 만료 통계

**비즈니스 컨텍스트**:

- 포인트 유효기간 만료
- 배치 작업으로 주기적 처리
- **주의**: 만료 전 알림이 필요하다면 이벤트 발행 필요

**페이로드**:

```typescript
{
  pointId: string;
  partnerId: string;
  userId?: string;
  amount: number;                // 만료된 포인트
  earnedAt: string;              // 원래 적립일
  expiredAt: string;             // 만료일
}
```

---

## 🧾 Tax Invoice 도메인 이벤트

### 5.1 `TaxInvoiceIssued` ⭐

**설명**: 세금계산서가 발급되었을 때 발행

**발행자**: Wallet Service (TaxInvoiceService)

**구독자**:

- **Order Service**: 세금계산서 발급 완료 표시 ✅ 필수
- **User Service**: 사업자 정보 업데이트
- **Notification**: 세금계산서 발급 알림 (이메일)
- **Accounting Service**: 회계 처리

**비즈니스 컨텍스트**:

- 국세청 전자세금계산서 발급 완료
- OMS(주문관리시스템)를 통해 발급

**페이로드**:

```typescript
{
  invoiceId: string;
  customerId: string;
  orderId?: string;
  paymentId?: string;
  amount: number;                // 공급가액
  taxAmount: number;             // 세액
  totalAmount: number;           // 합계 (공급가액 + 세액)
  issueDate: string;             // 발급일 (YYYYMMDD)
  businessNumber: string;        // 사업자등록번호
  businessName?: string;         // 상호
  email?: string;                // 이메일 (전송용)
  omsInvoiceId?: string;         // OMS 세금계산서 ID
  issuedAt: string;
}
```

---

### 5.2 `TaxInvoiceFailed`

**설명**: 세금계산서 발급이 실패했을 때 발행

**발행자**: Wallet Service (TaxInvoiceService)

**구독자**:

- **CS Service**: 수동 처리 대기열 ✅ 필수
- **Order Service**: 세금계산서 발급 실패 표시
- **Notification**: CS팀 알림, 고객 알림
- **Monitoring**: 세금계산서 발급 실패 모니터링

**비즈니스 컨텍스트**:

- OMS API 오류
- 사업자번호 오류
- 국세청 시스템 오류

**페이로드**:

```typescript
{
  invoiceId: string;
  customerId: string;
  orderId?: string;
  paymentId?: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  errorCode: string;             // 'INVALID_BUSINESS_NUMBER' | 'OMS_API_ERROR' 등
  errorMessage: string;
  businessNumber: string;
  failedAt: string;
}
```

---

### 5.3 `TaxInvoiceCancelled`

**설명**: 세금계산서가 취소되었을 때 발행

**발행자**: Wallet Service (TaxInvoiceService)

**구독자**:

- **Order Service**: 세금계산서 취소 표시
- **Notification**: 세금계산서 취소 알림
- **Accounting Service**: 회계 처리 취소

**비즈니스 컨텍스트**:

- 환불로 인한 세금계산서 취소
- 발급 오류로 인한 취소

**페이로드**:

```typescript
{
  invoiceId: string;
  customerId: string;
  orderId?: string;
  reason: string;                // 'REFUND' | 'ERROR_CORRECTION' 등
  reasonDetail?: string;
  cancelledBy?: string;
  cancelledAt: string;
}
```

---

## 🔧 2. wallet.commands.v1 (Commands Stream) - 선택적

### 커맨드 vs 이벤트 구분

- **Command**: 미래에 실행할 명령 (명령형)
- **Event**: 이미 발생한 사실 (과거형)

Wallet 서비스는 대부분 자체적으로 결제를 처리하므로, 커맨드가 많이 필요하지 않을 수 있습니다.  
**외부 서비스가 Wallet에게 작업을 지시해야 하는 경우**에만 커맨드를 사용합니다.

---

### C1. `ProcessRefund` (Command)

**설명**: 환불 처리를 지시하는 커맨드

**발행자**:

- **Order Service**: 주문 취소 시 환불 요청
- **CS Service**: 수동 환불 처리

**처리자**: Wallet Service (RefundService)

**응답 이벤트**: `RefundCompleted` 또는 `RefundFailed`

**페이로드**:

```typescript
{
  commandId: string;             // 커맨드 고유 ID (멱등성)
  paymentId: string;
  amount: number;
  reason: string;
  requestedBy: string;
  orderId?: string;
  expiresIn?: number;            // 커맨드 만료 시간 (ms)
}
```

---

### C2. `IssueTaxInvoice` (Command)

**설명**: 세금계산서 발급을 지시하는 커맨드

**발행자**:

- **Order Service**: 주문 완료 후 세금계산서 자동 발급
- **CS Service**: 수동 세금계산서 발급

**처리자**: Wallet Service (TaxInvoiceService)

**응답 이벤트**: `TaxInvoiceIssued` 또는 `TaxInvoiceFailed`

**페이로드**:

```typescript
{
  commandId: string;
  orderId: string;
  paymentId: string;
  businessNumber: string;
  businessName: string;
  email?: string;
  issueDate?: string;            // 생략 시 오늘 날짜
  expiresIn?: number;
}
```

---

### C3. `SettleBnplAccount` (Command) - 선택적

**설명**: BNPL 정산을 지시하는 커맨드 (스케줄러가 발행)

**발행자**:

- **Scheduler Service**: 정산 스케줄링

**처리자**: Wallet Service (BnplSettlementService)

**응답 이벤트**: `BnplSettlementCompleted` 또는 `BnplSettlementFailed`

**페이로드**:

```typescript
{
  commandId: string;
  accountId: string;
  settlementDate: string;        // 정산일
  expiresIn?: number;
}
```

---

## 📊 이벤트 우선순위

### 🔴 Phase 1: 필수 이벤트 (MVP)

가장 중요한 이벤트들입니다. 이것들이 없으면 시스템이 작동하지 않습니다.

1. **PaymentAuthorized** ⭐⭐ - 결제 승인 (Toss 등)
2. **PaymentCaptured** ⭐⭐⭐ - 결제 확정 (가장 중요)
3. **PaymentFailed** ⭐⭐ - 결제 실패
4. **RefundRequested** ⭐ - 환불 요청 (승인 프로세스 시작)
5. **RefundCompleted** ⭐⭐ - 환불 완료
6. **RefundFailed** ⭐ - 환불 실패
7. **TaxInvoiceIssued** ⭐⭐ - 세금계산서 발급
8. **TaxInvoiceFailed** ⭐ - 세금계산서 실패

### 🟡 Phase 2: 중요 이벤트

비즈니스 운영에 필요하지만, 초기에는 없어도 되는 이벤트들입니다.

9. **RefundApproved** - 환불 승인 완료 (검수 완료)
10. **RefundRejected** - 환불 거부
11. PaymentCancelled - 결제 취소 (승인 후 확정 전)
12. BnplSettlementCompleted - BNPL 정산 완료
13. BnplSettlementFailed - BNPL 정산 실패
14. TaxInvoiceCancelled - 세금계산서 취소

### 🟢 Phase 3: 부가 기능 (선택적)

나중에 추가해도 되는 이벤트들입니다.

15. BnplAccountCreated
16. BnplCreditUsed
17. PointsExpired - 포인트 만료 (알림용)

### ⚪ 보류: 포인트 이벤트 (구현 결정 필요)

다음 이벤트들은 실제 필요성을 검토한 후 구현 여부를 결정합니다:

- PointsEarned (적립)
- PointsRedeemed (사용)
- PointsCancelled (취소)

**이유**: 포인트는 Wallet 내부 관리이며, PaymentCaptured 이벤트에 포함 가능

---

## 🔗 다른 서비스와의 연동

### Order Service ← Wallet

- `PaymentCaptured` → 주문 확정
- `RefundCompleted` → 주문 환불 완료
- `PaymentFailed` → 주문 취소 또는 재시도
- `TaxInvoiceIssued` → 세금계산서 발급 완료

### WMS ← Wallet

- `PaymentCaptured` → 출고 프로세스 시작
- `RefundCompleted` → 재고 복원

### Notification ← Wallet

- 모든 주요 이벤트 → 고객/관리자 알림

### Analytics ← Wallet

- 모든 이벤트 → 통계 및 분석

---

## 💡 설계 결정 사항 ✅

### ✅ 확정 사항 (리뷰 완료)

1. **PaymentAuthorized와 PaymentCaptured 구분**: 필요함 ✅
   - Toss 등 PG사에서 승인/확정 프로세스 분리 필요
2. **환불 승인 프로세스**: 필요함 ✅
   - RefundRequested → RefundApproved/RefundRejected → RefundCompleted
   - 배송 이후 반품은 검수 필요

3. **Command Stream**: 필요함 ✅
   - 외부 서비스에서 Wallet에 작업 지시 필요
   - `wallet.commands.v1` 토픽 생성

4. **Point 이벤트 포함**: Wallet에 포함 ✅
   - 포인트는 Wallet 도메인의 일부
   - 단, 외부 발행은 최소화 (내부 관리 중심)

5. **BNPL Settlement 이벤트**: 성공/실패만 ✅
   - BnplSettlementCompleted, BnplSettlementFailed
   - 세분화 불필요 (Started, Retrying 등 제외)

6. **Metadata 필드**: Payment 이벤트에만 포함 ✅
   - 카드 정보, 할부 정보 등 결제 관련 메타데이터
   - 다른 이벤트는 필요 시 개별 필드로 명시

### 🎯 핵심 아키텍처 원칙

1. **Event 중심**: 대부분 Event로 구성, Command는 필요한 경우만
2. **Stream 통합**: 하나의 `wallet.events.v1` 토픽에 모든 이벤트 포함
3. **Outbox 패턴**: 트랜잭션 일관성 보장 필수
4. **멱등성**: 모든 Consumer는 중복 수신을 안전하게 처리
5. **최소 발행**: Wallet 내부 상태는 외부에 최소한만 공개

---

## 📋 다음 단계

1. **이 명세서 리뷰 및 피드백**
2. **우선순위 확정** (Phase 1 이벤트 먼저 구현)
3. **Zod 스키마 코드 작성**
4. **Stream Config 작성**
5. **Outbox 패턴 구현**
6. **Publisher 코드 작성** (각 서비스에 통합)
7. **Consumer 코드 작성** (다른 서비스)
8. **테스트 작성**

---

## 📝 변경 이력

| 버전  | 날짜       | 작성자       | 변경 내용 |
| ----- | ---------- | ------------ | --------- |
| 1.0.0 | 2025-01-20 | AI Assistant | 초안 작성 |
