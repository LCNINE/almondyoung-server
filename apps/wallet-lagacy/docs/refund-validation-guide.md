# 환불 검증 로직 가이드

## 개요

Wallet 결제 시스템의 환불 처리 시 적용되는 검증 로직을 설명합니다.

**적용 버전**: v2.1.0 (2025-10-15)  
**관련 파일**: `apps/wallet/src/services/refund.service.ts`

---

## 1. 누적 환불 금액 검증

### 목적

부분 환불 시 누적 환불 금액이 원래 결제 금액을 초과하지 않도록 방지합니다.

### 검증 로직

```typescript
// 1. 기존 환불 이력 조회 (동시성 제어)
const existingRefunds = await tx
  .select()
  .from(schema.paymentRefunds)
  .where(eq(schema.paymentRefunds.intentId, intentId))
  .for('update'); // 락 적용

// 2. 누적 환불 금액 계산
const totalRefunded = existingRefunds.reduce(
  (sum, r) => sum + Number(r.amount),
  0,
);

// 3. 초과 여부 검증
if (totalRefunded + refundAmount > totalAmount) {
  throw new Error(
    `환불 가능 금액 초과: 이미 ${totalRefunded}원 환불됨, ` +
      `요청 ${refundAmount}원, 총액 ${totalAmount}원`,
  );
}
```

### 시나리오 예시

#### ✅ 정상 케이스

```
결제 금액: 10,000원
1차 환불: 3,000원 → 성공 (잔액 7,000원)
2차 환불: 5,000원 → 성공 (잔액 2,000원)
3차 환불: 2,000원 → 성공 (잔액 0원)
```

#### ❌ 에러 케이스

```
결제 금액: 10,000원
1차 환불: 7,000원 → 성공 (잔액 3,000원)
2차 환불: 5,000원 → 실패 (초과)

에러 메시지:
"환불 가능 금액 초과: 이미 7000원 환불됨, 요청 5000원, 총액 10000원"
```

---

## 2. 동시성 제어

### 문제 상황

동시에 여러 환불 요청이 들어올 경우 중복 환불 위험이 있습니다.

```
시간 T1: 요청 A (5,000원 환불) 시작
시간 T2: 요청 B (5,000원 환불) 시작
시간 T3: 요청 A 완료 (잔액 5,000원)
시간 T4: 요청 B 완료 (잔액 0원) ← 문제!
```

### 해결 방법

**1. Intent 락**

```typescript
const intent = await tx
  .select()
  .from(schema.paymentIntents)
  .where(eq(schema.paymentIntents.id, intentId))
  .for('update'); // Intent 락
```

**2. 환불 이력 락**

```typescript
const existingRefunds = await tx
  .select()
  .from(schema.paymentRefunds)
  .where(eq(schema.paymentRefunds.intentId, intentId))
  .for('update'); // 환불 이력 락
```

**3. 트랜잭션 격리**

```typescript
return this.db.db.transaction(async (tx) => {
  // 모든 작업이 하나의 트랜잭션 내에서 실행
});
```

### 동작 방식

```
시간 T1: 요청 A가 Intent 락 획득
시간 T2: 요청 B가 Intent 락 대기
시간 T3: 요청 A 완료, 커밋, 락 해제
시간 T4: 요청 B가 Intent 락 획득
시간 T5: 요청 B가 환불 이력 조회 (A의 환불 포함)
시간 T6: 요청 B가 검증 실패 (초과) → 에러
```

---

## 3. 멱등성 보장

### Controller 레벨 처리

```typescript
@Post(':intentId/refund')
async refundPayment(
  @Param('intentId') intentId: string,
  @Body() dto: RefundPaymentDto,
  @Headers('Idempotency-Key') idemKey?: string,
) {
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
      return response; // 기존 결과 반환
    }

    // 환불 처리
    const result = await this.refundService.refundPayment(
      intentId,
      dto.amount,
      dto.reason,
    );

    // 멱등성 키 완료 처리
    await this.idempotencyService.complete(tx, idemKey, result);
    return result;
  });
}
```

### 사용 예시

```bash
# 1차 요청
curl -X POST /v2/payments/intent_123/refund \
  -H "Idempotency-Key: refund_20250115_001" \
  -d '{"amount": 5000}'
# → 환불 처리

# 2차 요청 (네트워크 재시도)
curl -X POST /v2/payments/intent_123/refund \
  -H "Idempotency-Key: refund_20250115_001" \
  -d '{"amount": 5000}'
# → 기존 결과 반환 (중복 환불 방지)
```

---

## 4. 에러 처리

### Service Layer (CTO 스타일)

```typescript
// ❌ 금지: HttpException 사용
throw new BadRequestException('환불 초과');

// ✅ 권장: 일반 Error 사용
throw new Error('환불 가능 금액 초과: ...');
```

### Controller Layer

```typescript
try {
  return await this.refundService.refundPayment(intentId, dto.amount);
} catch (e: any) {
  const msg = (e?.message ?? '').toLowerCase();

  if (msg.includes('not found')) {
    throw new NotFoundException(e.message);
  }

  if (msg.match(/초과|exceeds|invalid|already/)) {
    throw new BadRequestException(e.message);
  }

  throw new InternalServerErrorException(e.message);
}
```

---

## 5. 모니터링

### 로그 포인트

```typescript
// 1. 환불 요청 시작
this.logger.log(`환불 처리 시작: intentId=${intentId}, amount=${refundAmount}`);

// 2. 검증 통과
this.logger.log(
  `환불 검증 통과: 누적 ${totalRefunded}원, 요청 ${refundAmount}원`,
);

// 3. 환불 완료
this.logger.log(`환불 처리 완료: intentId=${intentId}, status=${newStatus}`);
```

### 알림 설정 (권장)

**Slack 알림**:

- "환불 가능 금액 초과" 에러 발생 시
- 일일 환불 건수 10건 이상 시

**대시보드 메트릭**:

- 시간당 환불 요청 수
- 환불 실패율
- 평균 환불 금액

---

## 6. 향후 개선 사항

### Priority 1: 최소 잔액 검증

```typescript
const remaining = totalAmount - (totalRefunded + refundAmount);
if (remaining > 0 && remaining < 100) {
  throw new Error(
    `잔액 ${remaining}원은 최소 금액 미만입니다. 전액 환불을 진행하세요.`,
  );
}
```

### Priority 2: 환불 기한 검증

```typescript
const daysSinceCaptured = Math.floor(
  (Date.now() - new Date(capturedAt).getTime()) / (1000 * 60 * 60 * 24),
);

if (daysSinceCaptured > 365) {
  throw new Error(`환불 기한 초과: 결제일로부터 ${daysSinceCaptured}일 경과`);
}
```

---

## 참고 문서

- [QA Report MVP](./QA_REPORT_MVP.md)
- [Payment Validation Fixes Spec](../../.kiro/specs/payment-validation-fixes/)
- [Wallet Architecture](./wallet-v4-payment-architecture.md)

**작성일**: 2025-10-15  
**작성자**: Wallet Team
