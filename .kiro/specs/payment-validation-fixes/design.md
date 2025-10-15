# Design Document

## Overview

이 설계는 Wallet 결제 시스템의 3가지 핵심 검증 로직을 추가합니다. 기존 스키마와 API 구조를 유지하면서 서비스 레이어에 비즈니스 검증만 추가하는 최소 변경 방식입니다.

**설계 원칙**:

- 기존 코드 구조 유지 (CTO 스타일 준수)
- 스키마 변경 없음
- 새로운 API 추가 없음
- 서비스 레이어에서 `throw new Error()` 사용
- 컨트롤러에서 HTTP 에러로 변환

## Architecture

### 변경 대상 파일

```
apps/wallet/src/
├── services/
│   ├── refund.service.ts          # 수정: 누적 환불 검증 추가
│   └── tax-invoice.service.ts     # 수정: 발행 기한 검증 추가
└── controllers/
    └── payment.controller.ts       # 수정: 멱등성 키 적용
```

### 데이터 흐름

```
[Client Request]
      ↓
[Controller] ← 멱등성 키 체크 (Requirement 3)
      ↓
[Service] ← 비즈니스 검증 (Requirement 1, 2)
      ↓
[Database] ← 기존 스키마 그대로 사용
```

## Components and Interfaces

### 1. RefundService 수정

**위치**: `apps/wallet/src/services/refund.service.ts`

**변경 내용**: `refundPayment()` 메서드에 누적 환불 검증 추가

```typescript
async refundPayment(
  intentId: string,
  amount?: number,
  reason: string = 'CUSTOMER_REQUEST',
): Promise<{
  success: boolean;
  refunded: { points: number; cash: number; total: number };
  status: string;
}> {
  return this.db.db.transaction(async (tx) => {
    // 1. Intent 조회 및 잠금 (기존 코드)
    const intent = await tx
      .select()
      .from(schema.paymentIntents)
      .where(eq(schema.paymentIntents.id, intentId))
      .for('update')
      .then((rows) => rows[0]);

    if (!intent) {
      throw new Error(`Intent not found: ${intentId}`);
    }

    // 2. 환불 가능 상태 체크 (기존 코드)
    if (!['AUTHORIZED', 'CAPTURED'].includes(intent.status)) {
      throw new Error(`Cannot refund intent in ${intent.status} status`);
    }

    // ✅ 3. 누적 환불 검증 추가 (NEW)
    const existingRefunds = await tx
      .select()
      .from(schema.paymentRefunds)
      .where(eq(schema.paymentRefunds.intentId, intentId))
      .for('update'); // 동시성 제어

    const totalRefunded = existingRefunds.reduce(
      (sum, r) => sum + Number(r.amount),
      0,
    );

    const refundAmount = amount ?? Number(intent.amount);
    const totalAmount = Number(intent.totalAmount || intent.amount);

    if (totalRefunded + refundAmount > totalAmount) {
      throw new Error(
        `환불 가능 금액 초과: 이미 ${totalRefunded}원 환불됨, ` +
        `요청 ${refundAmount}원, 총액 ${totalAmount}원`,
      );
    }

    // 4. 기존 환불 로직 그대로 실행...
  });
}
```

**검증 로직 상세**:

- 기존 환불 이력을 `for('update')` 락으로 조회
- 누적 환불 금액 계산
- 요청 금액 + 누적 금액 > 총액이면 에러
- 에러 메시지에 구체적인 금액 정보 포함

### 2. TaxInvoiceService 수정

**위치**: `apps/wallet/src/services/tax-invoice.service.ts`

**변경 내용**: 발행 기한 검증 메서드 추가 및 적용

```typescript
// ✅ 새로운 private 메서드 추가
private validateIssuanceDeadline(supplyDate: string): void {
  const supply = new Date(supplyDate);
  const deadline = new Date(supply);

  // 익월 10일 계산
  deadline.setMonth(deadline.getMonth() + 1);
  deadline.setDate(10);
  deadline.setHours(23, 59, 59, 999); // 당일 23:59:59까지

  if (new Date() > deadline) {
    throw new Error(
      `세금계산서 발행 기한 초과: 공급일 ${supplyDate}, ` +
      `기한 ${deadline.toISOString().split('T')[0]}`,
    );
  }
}

// ✅ 기존 메서드에 검증 추가
async createTaxInvoice(dto: CreateTaxInvoiceDto, tx?: any) {
  // 발행 기한 검증 (NEW)
  this.validateIssuanceDeadline(dto.supplyDate);

  // 기존 생성 로직 그대로...
  const invoice = await (tx || this.db.db)
    .insert(schema.taxInvoices)
    .values({
      userId: dto.userId,
      externalOrderId: dto.externalOrderId,
      supplyDate: dto.supplyDate,
      totalAmount: dto.totalAmount,
      status: 'PENDING',
    })
    .returning();

  return invoice[0];
}

// ✅ 수정세금계산서 기한 검증 추가
async createRefundInvoice(
  originalInvoiceId: string,
  refundAmount: number,
  reason: string,
  tx?: any,
) {
  // 원본 세금계산서 조회
  const original = await (tx || this.db.db)
    .select()
    .from(schema.taxInvoices)
    .where(eq(schema.taxInvoices.id, originalInvoiceId))
    .then((rows) => rows[0]);

  if (!original) {
    throw new Error(`Original invoice not found: ${originalInvoiceId}`);
  }

  // ✅ 6개월 기한 검증 (NEW)
  const issueDate = new Date(original.createdAt);
  const deadline = new Date(issueDate);
  deadline.setMonth(deadline.getMonth() + 6);

  if (new Date() > deadline) {
    throw new Error(
      `수정세금계산서 발행 기한 초과: 원본 발행일 ${issueDate.toISOString().split('T')[0]}, ` +
      `기한 ${deadline.toISOString().split('T')[0]}`,
    );
  }

  // 기존 생성 로직 그대로...
}
```

**검증 로직 상세**:

- `validateIssuanceDeadline()`: 익월 10일 23:59:59까지 체크
- `createTaxInvoice()`: 생성 전 기한 검증
- `createRefundInvoice()`: 원본 발행일로부터 6개월 체크

### 3. PaymentController 수정

**위치**: `apps/wallet/src/controllers/payment.controller.ts`

**변경 내용**: 환불 API에 멱등성 키 적용

```typescript
@Post(':intentId/refund')
async refundPayment(
  @Param('intentId') intentId: string,
  @Body(new ZodValidationPipe(RefundPaymentSchema)) dto: RefundPaymentDto,
  @Headers('Idempotency-Key') idemKey?: string, // ✅ 추가
) {
  try {
    this.logger.log(
      `환불 요청: Intent ${intentId}, Amount ${dto.amount || 'FULL'}, ` +
      `Reason ${dto.reason}, IdemKey ${idemKey || 'none'}`,
    );

    // ✅ 멱등성 키 처리 추가 (NEW)
    return await runInTransaction(this.db, async (tx) => {
      // 멱등성 키 체크
      const { hit, response } = await this.idempotencyService.checkOrCreate(
        tx,
        idemKey,
        intentId,
        dto,
        `v2/payments/${intentId}/refund`,
      );

      if (hit) {
        this.logger.log(`멱등성 키 히트: ${idemKey}, 기존 결과 반환`);
        return response;
      }

      // 환불 처리
      const result = await this.refundService.refundPayment(
        intentId,
        dto.amount,
        dto.reason || 'CUSTOMER_REQUEST',
      );

      // 멱등성 키 완료 처리
      await this.idempotencyService.complete(tx, idemKey, result);

      this.logger.log(`🎯 환불 결과:`, JSON.stringify(result));
      return result;
    });
  } catch (error) {
    this.handleError(error, '결제 환불');
  }
}
```

**멱등성 키 처리 흐름**:

1. `Idempotency-Key` 헤더 수신 (선택적)
2. `checkOrCreate()`: 기존 키 확인
3. 히트 시 → 기존 결과 반환
4. 미스 시 → 환불 처리 후 `complete()` 호출

## Data Models

### 기존 스키마 활용 (변경 없음)

**payment_intents**:

```typescript
{
  id: string;
  amount: number;
  totalAmount: number;
  refundedAmount: number; // ✅ 누적 환불 금액 (기존 필드 활용)
  status: 'AUTHORIZED' | 'CAPTURED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  // ...
}
```

**payment_refunds**:

```typescript
{
  id: string;
  intentId: string;
  amount: number; // ✅ 각 환불 금액 (기존 필드 활용)
  status: 'COMPLETED' | 'FAILED';
  // ...
}
```

**tax_invoices**:

```typescript
{
  id: string;
  supplyDate: Date; // ✅ 공급일 (기존 필드 활용)
  createdAt: Date; // ✅ 발행일 (기존 필드 활용)
  // ...
}
```

**idempotency_keys**:

```typescript
{
  id: string; // Idempotency-Key 값
  userId: string;
  requestPath: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED'; // ✅ 기존 테이블 활용
  responseBody: string;
  // ...
}
```

## Error Handling

### 서비스 레이어 에러 (CTO 스타일)

```typescript
// RefundService
throw new Error(
  '환불 가능 금액 초과: 이미 10000원 환불됨, 요청 5000원, 총액 12000원',
);
throw new Error('Intent not found: intent_123');
throw new Error('Cannot refund intent in FAILED status');

// TaxInvoiceService
throw new Error(
  '세금계산서 발행 기한 초과: 공급일 2024-09-15, 기한 2024-10-10',
);
throw new Error(
  '수정세금계산서 발행 기한 초과: 원본 발행일 2024-04-01, 기한 2024-10-01',
);
throw new Error('Original invoice not found: inv_123');
```

### 컨트롤러 에러 변환

```typescript
// PaymentController.handleError()
private handleError(error: unknown, context: string): never {
  const message = error instanceof Error ? error.message : String(error);

  // "not found" → 404
  if (message.includes('not found')) {
    throw new HttpException(message, HttpStatus.NOT_FOUND);
  }

  // "초과", "exceeds", "invalid" → 400
  if (
    message.includes('초과') ||
    message.includes('exceeds') ||
    message.includes('invalid')
  ) {
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
  }

  // 기타 → 500
  throw new HttpException(
    '서버 내부 오류가 발생했습니다.',
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
```

## Testing Strategy

### 단위 테스트 (서비스 레이어)

**RefundService 테스트**:

```typescript
describe('RefundService.refundPayment', () => {
  it('누적 환불 금액이 총액을 초과하면 에러', async () => {
    // Given: 10,000원 결제, 이미 7,000원 환불됨
    // When: 5,000원 환불 요청
    // Then: "환불 가능 금액 초과" 에러
  });

  it('정상 범위 내 부분 환불은 성공', async () => {
    // Given: 10,000원 결제, 이미 3,000원 환불됨
    // When: 5,000원 환불 요청
    // Then: 환불 성공, refundedAmount = 8,000원
  });
});
```

**TaxInvoiceService 테스트**:

```typescript
describe('TaxInvoiceService.createTaxInvoice', () => {
  it('발행 기한 초과 시 에러', async () => {
    // Given: 공급일 2024-09-01 (기한: 2024-10-10)
    // When: 2024-10-11에 생성 요청
    // Then: "발행 기한 초과" 에러
  });

  it('기한 내 생성은 성공', async () => {
    // Given: 공급일 2024-10-01 (기한: 2024-11-10)
    // When: 2024-10-05에 생성 요청
    // Then: 생성 성공
  });
});
```

### 통합 테스트 (컨트롤러)

**환불 API 멱등성 테스트**:

```typescript
describe('POST /v2/payments/:intentId/refund', () => {
  it('동일한 멱등성 키로 재요청 시 기존 결과 반환', async () => {
    // Given: 환불 완료된 요청
    // When: 동일한 Idempotency-Key로 재요청
    // Then: 200 OK, 동일한 결과 반환
  });

  it('멱등성 키 없이도 정상 동작', async () => {
    // Given: Idempotency-Key 헤더 없음
    // When: 환불 요청
    // Then: 200 OK, 환불 성공
  });
});
```

## Performance Considerations

### 쿼리 최적화

**환불 이력 조회**:

```typescript
// ✅ 인덱스 활용 (기존 인덱스 사용)
// idx_payment_refunds_intent_id ON payment_refunds(intent_id)

const existingRefunds = await tx
  .select()
  .from(schema.paymentRefunds)
  .where(eq(schema.paymentRefunds.intentId, intentId))
  .for('update');
```

**예상 성능**:

- 환불 이력 조회: ~5ms (인덱스 스캔)
- 날짜 계산: ~1ms (메모리 연산)
- 전체 오버헤드: ~10ms 이하

### 동시성 제어

**락 전략**:

- Intent: `for('update')` (기존 코드)
- Refunds: `for('update')` (추가)
- 트랜잭션 격리 수준: READ COMMITTED (기본값)

**예상 처리량**:

- 동시 환불 요청: 순차 처리 (락으로 보호)
- 다른 Intent 환불: 병렬 처리 가능

## Security Considerations

### 입력 검증

**이미 구현됨**:

- Zod 스키마 검증 (컨트롤러)
- 금액 범위 검증 (서비스)

**추가 검증**:

- 누적 환불 금액 검증 (Requirement 1)
- 발행 기한 검증 (Requirement 2)

### 권한 검증

**현재 상태**:

- Intent의 customerId 검증 없음 (향후 개선 필요)

**이번 작업 범위 외**:

- 사용자 인증/인가는 별도 작업

## Deployment

### 배포 전략

**Zero-downtime 배포 가능**:

- 스키마 변경 없음
- 기존 API 호환성 유지
- 점진적 롤아웃 가능

### 롤백 계획

**롤백 시나리오**:

1. 검증 로직 버그 발견
2. 이전 버전으로 롤백
3. 데이터 정합성 유지 (스키마 변경 없으므로)

### 모니터링

**추가 로그**:

```typescript
this.logger.log(
  `환불 검증: 누적 ${totalRefunded}원, 요청 ${refundAmount}원, 총액 ${totalAmount}원`,
);
this.logger.log(`세금계산서 기한 체크: 공급일 ${supplyDate}, 기한 ${deadline}`);
this.logger.log(`멱등성 키 히트: ${idemKey}`);
```

**알림 설정**:

- "환불 가능 금액 초과" 에러 → Slack 알림
- "발행 기한 초과" 에러 → 세무팀 이메일

## Migration Plan

### Phase 1: 코드 배포 (1일)

- RefundService 수정
- TaxInvoiceService 수정
- PaymentController 수정
- 단위 테스트 작성

### Phase 2: 통합 테스트 (0.5일)

- 스테이징 환경 배포
- E2E 테스트 실행
- 성능 테스트

### Phase 3: 프로덕션 배포 (0.5일)

- 카나리 배포 (10% 트래픽)
- 모니터링 (1시간)
- 전체 배포

**총 소요 시간**: 2일 (개발 1일 + 테스트/배포 1일)
