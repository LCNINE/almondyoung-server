# 🔍 Wallet 결제 시스템 MVP QA 리포트

**작성일**: 2025-10-15  
**대상 시스템**: Wallet MSA (연매출 20억원 규모 이커머스)  
**검토 범위**: Schema + Controller 기반 운영 가능성 분석

---

## 📊 Executive Summary

### ✅ 현재 구현된 기능

- 결제 Intent/Authorize/Capture 플로우 (Toss, HMS 카드/BNPL)
- 포인트 적립/사용/환불 (FIFO 복식부기)
- 전액/부분 환불 (포인트+현금 비율 계산)
- 세금계산서 생성/배치 발행/수정세금계산서
- BNPL 계정 관리 및 월별 청구 주기

### ⚠️ 운영상 주요 리스크

1. **부분환불 정합성 검증 부족** (중요도: 🔴 High)
2. **세무 규정 준수 미흡** (중요도: 🔴 High)
3. **환불 기한 제약 없음** (중요도: 🟡 Medium)
4. **동시성 제어 부족** (중요도: 🟡 Medium)

---

## 1️⃣ 부분환불 정합성 분석

### 현재 구현 상태

**파일**: `apps/wallet/src/services/refund.service.ts`

**구현된 기능:**

- ✅ 비율 기반 포인트/현금 분할 계산
- ✅ 트랜잭션 내 원자적 처리
- ✅ `PARTIALLY_REFUNDED` 상태 관리
- ✅ `SELECT FOR UPDATE`로 행 레벨 락

**코드 예시:**

```typescript
const ratio = refundAmount / totalAmount;
const pointsToRefund = Math.floor(discountsTotal * ratio);
const cashToRefund = refundAmount - pointsToRefund;
```

### 발견된 문제점

#### 🔴 Critical: 누적 환불 금액 검증 부재

**위치**: `refund.service.ts:169`

**문제:**

```typescript
const newRefundedAmount = Number(intent.refundedAmount) + refundAmount;
// ❌ newRefundedAmount > totalAmount 검증 없음
```

**시나리오:**

1. 고객이 10,000원 결제
2. 6,000원 부분 환불 성공
3. 악의적으로 5,000원 추가 환불 요청
4. **결과**: 총 11,000원 환불 (1,000원 손실)

**영향도**: 연매출 20억 기준, 0.1% 발생 시 연간 200만원 손실

#### 🔴 Critical: 최소 잔액 검증 부재

**문제:**

- 9,950원 환불 시 50원만 남는 경우 허용됨
- 소액 잔액으로 인한 정산 복잡도 증가

**권장 기준:**

- 잔액 100원 미만 시 전액 환불 강제
- 또는 최소 환불 단위 설정 (예: 100원 단위)

### 권장 조치사항

**우선순위 1 (즉시):**

```typescript
// refund.service.ts에 추가
const maxRefundable = totalAmount - Number(intent.refundedAmount || 0);
if (refundAmount > maxRefundable) {
  throw new Error(`Refund exceeds available: max ${maxRefundable}`);
}

const remaining = maxRefundable - refundAmount;
if (remaining > 0 && remaining < 100) {
  throw new Error(
    `Remaining ${remaining} is below minimum. Refund full amount.`,
  );
}
```

**우선순위 2 (1주 내):**

- E2E 테스트 추가 (동시 환불, 초과 환불)
- 모니터링 알림 설정 (환불 금액 이상치 감지)

---

## 2️⃣ 세무 규정 준수 분석

### 현재 구현 상태

**파일**: `apps/wallet/src/services/tax-invoice.service.ts`

**구현된 기능:**

- ✅ 세금계산서 생성 (공급가액 + 세액 분리)
- ✅ 배치 엑셀 export
- ✅ 수정세금계산서 생성 (`MODIFICATION` kind)
- ✅ 이벤트 이력 추적

### 발견된 문제점

#### 🔴 Critical: 배치 업데이트 버그

**위치**: `tax-invoice.service.ts:336`

**문제:**

```typescript
await tx
  .update(schema.taxInvoiceEventsDetails)
  .set({ batchId, batchExportedAt })
  .where(eq(schema.taxInvoiceEventsDetails.invoiceId, invoiceIds[0]));
// ❌ 첫 번째 ID만 업데이트됨
```

**영향**: 배치 내 2번째 이후 세금계산서는 `PENDING` 상태로 남음

**수정:**

```typescript
import { inArray } from 'drizzle-orm';

await tx
  .update(schema.taxInvoiceEventsDetails)
  .set({ batchId, batchExportedAt, batchPeriod: dto.batchPeriod })
  .where(inArray(schema.taxInvoiceEventsDetails.invoiceId, invoiceIds));
```

#### 🔴 High: 발행 기한 검증 부재

**법적 요구사항:**

- 공급일이 속한 달의 다음 달 10일까지 발행
- 예: 2025-01-15 공급 → 2025-02-10까지 발행

**현재 상태**: 기한 검증 로직 없음

**권장 추가:**

```typescript
const issueDeadline = new Date(supplyDate);
issueDeadline.setMonth(issueDeadline.getMonth() + 1);
issueDeadline.setDate(10);
issueDeadline.setHours(23, 59, 59);

if (new Date() > issueDeadline) {
  throw new Error(
    `Issue deadline ${issueDeadline.toISOString().split('T')[0]} exceeded`,
  );
}
```

#### 🟡 Medium: 수정세금계산서 사유 코드 누락

**현재**: `reason` 필드에 자유 텍스트만 저장

**국세청 요구사항**: 표준 사유 코드 필요

- `01`: 기재사항 착오·정정
- `02`: 공급가액 변동
- `03`: 환입
- `04`: 계약 해제
- `05`: 내국신용장 사후개설
- `06`: 착오에 의한 이중발급

**권장 수정:**

```typescript
export const TAX_MODIFICATION_REASON_CODES = {
  ERROR_CORRECTION: '01',
  AMOUNT_CHANGE: '02',
  RETURN: '03',
  CONTRACT_CANCEL: '04',
  LC_RETROACTIVE: '05',
  DUPLICATE_ERROR: '06',
} as const;

// schema.ts에 추가
reasonCode: varchar('reason_code', { length: 2 }),
```

### 권장 조치사항

**즉시 (Hot Fix):**

1. 배치 업데이트 버그 수정 (`inArray` 사용)
2. 발행 기한 검증 추가

**1주 내:**

1. 수정세금계산서 사유 코드 표준화
2. 기한 초과 세금계산서 모니터링 대시보드

**1개월 내:**

1. 국세청 전자세금계산서 API 연동 검토
2. 자동 발행 스케줄러 구현

---

## 3️⃣ 환불 기한 제약

### 현재 구현 상태

**파일**: `apps/wallet/src/services/refund.service.ts:62`

```typescript
if (!['AUTHORIZED', 'CAPTURED'].includes(intent.status)) {
  throw new Error(`Cannot refund intent in ${intent.status} status`);
}
// ❌ 시간 기반 검증 없음
```

### 권장 정책

**일반 결제:**

- 결제일로부터 1년 이내 환불 가능
- 1년 초과 시 고객센터 승인 필요

**BNPL:**

- 청구 확정 전: 무제한 환불
- 청구 확정 후: 3개월 이내

**구현 예시:**

```typescript
const paymentDate = new Date(intent.createdAt);
const daysSince = Math.floor((Date.now() - paymentDate.getTime()) / 86400000);

if (daysSince > 365) {
  throw new Error(`Refund period expired: ${daysSince} days since payment`);
}

// BNPL 특별 처리
if (attempt.provider === 'HMS_BNPL') {
  const billingConfirmed = await checkBnplBillingStatus(intent.id);
  if (billingConfirmed && daysSince > 90) {
    throw new Error('BNPL refund period expired (90 days after billing)');
  }
}
```

---

## 4️⃣ 동시성 제어

### 현재 구현 상태

**긍정적:**

- ✅ `SELECT FOR UPDATE` 사용 (행 레벨 락)
- ✅ 트랜잭션 내 처리
- ✅ Idempotency 서비스 존재

**개선 필요:**

- ⚠️ 멱등성 키가 선택사항 (`@Headers('Idempotency-Key') idemKey?`)
- ⚠️ 환불 API에서 멱등성 키 미사용

### 권장 개선

**1. 환불 API 멱등성 키 필수화:**

```typescript
@Post(':intentId/refund')
async refundPayment(
  @Param('intentId') intentId: string,
  @Body() dto: RefundPaymentDto,
  @Headers('Idempotency-Key') idemKey: string,  // 필수
) {
  if (!idemKey) {
    throw new BadRequestException('Idempotency-Key required for refund');
  }

  return runInTransaction(this.db, async (tx) => {
    const { hit, response } = await this.idempotencyService.checkOrCreate(
      tx, idemKey, dto.userId, dto, 'v2/payments/:intentId/refund'
    );
    if (hit) return response;

    const result = await this.refundService.refundPayment(intentId, dto.amount);
    await this.idempotencyService.complete(tx, idemKey, result);
    return result;
  });
}
```

**2. 분산 락 고려 (향후):**

- Redis 기반 분산 락 (다중 인스턴스 환경)
- 락 타임아웃 설정 (30초)

---

## 5️⃣ 보안 점검

### ✅ 양호한 부분

1. **민감 정보 처리**
   - 카드 정보는 HMS API로만 전달 (DB 미저장)
   - 환경 변수로 API 키 관리

2. **입력 검증**
   - Zod 스키마 기반 DTO 검증
   - `ZodValidationPipe` 사용

### 🔴 발견된 보안 이슈

#### Critical: 하드코딩된 DB 연결 문자열

**위치**: 여러 파일에서 발견

- `apps/wallet/drizzle.config.ts:15`
- `apps/wallet/src/app.module.ts:54`
- `apps/wallet/src/services/__tests__/*.spec.ts`

**문제:**

```typescript
process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler...';
// ❌ 실제 DB 자격증명이 코드에 노출됨
```

**영향:**

- GitHub 등 공개 저장소에 푸시 시 DB 접근 권한 노출
- 내부 직원도 프로덕션 DB 접근 가능

**즉시 조치:**

```bash
# 1. 노출된 DB 비밀번호 즉시 변경
# 2. Git 히스토리에서 민감 정보 제거
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch apps/wallet/drizzle.config.ts" \
  --prune-empty --tag-name-filter cat -- --all

# 3. .env 파일로 이동
DATABASE_URL=postgresql://user:pass@host/db
```

**코드 수정:**

```typescript
// drizzle.config.ts
export default {
  dbCredentials: {
    url: process.env.DATABASE_URL, // fallback 제거
  },
};

// 환경 변수 없으면 명확한 에러
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}
```

#### High: Toss API 키 하드코딩

**위치**: `apps/wallet/src/providers/toss.charge.ts:61`

```typescript
const secretKey =
  process.env.TOSS_SECRET_KEY || 'test_sk_ALnQvDd2VJxMDd5NLwna8Mj7X41m';
// ⚠️ 테스트 키라도 하드코딩 지양
```

**권장:**

```typescript
const secretKey = process.env.TOSS_SECRET_KEY;
if (!secretKey) {
  throw new PaymentError(
    'PROVIDER_CONFIG_ERROR',
    'TOSS_SECRET_KEY must be set in environment',
  );
}
```

#### Medium: 카드 비밀번호 로깅 위험

**위치**: `apps/wallet/src/controllers/payment.controller.ts:565`

```typescript
password: '12',  // 카드 비밀번호 앞 2자리
```

**권장:**

- 로그에서 `password` 필드 자동 마스킹
- Winston/Pino 등 로거에 민감 필드 필터 설정

```typescript
// logger.config.ts
const sensitiveFields = ['password', 'cardNumber', 'cvv'];
logger.addFilter((log) => {
  sensitiveFields.forEach((field) => {
    if (log[field]) log[field] = '***';
  });
  return log;
});
```

### 권장 보안 강화 조치

**즉시 (Hot Fix):**

1. ✅ 하드코딩된 DB 자격증명 제거
2. ✅ 노출된 DB 비밀번호 변경
3. ✅ `.env.example` 파일 생성 (실제 값 제외)

**1주 내:**

1. Secrets 관리 도구 도입 (AWS Secrets Manager / HashiCorp Vault)
2. 로그 민감 정보 자동 마스킹
3. 환경 변수 검증 미들웨어 추가

**1개월 내:**

1. 정기 보안 스캔 자동화 (Snyk, SonarQube)
2. API 키 로테이션 정책 수립
3. 접근 제어 감사 로그

---

## 6️⃣ 타입 정의 검증

### 현재 타입 안정성

**긍정적:**

- ✅ TypeScript strict 모드 사용
- ✅ Zod 스키마로 런타임 검증
- ✅ Drizzle ORM 타입 안전성

**개선 필요:**

#### 타입 불일치 발견

**1. PaymentResult.transactionId 옵셔널 처리**

```typescript
// payment-provider.interface.ts
export interface PaymentResult {
  success: boolean;
  transactionId?: string; // 옵셔널
}

// 하지만 사용처에서는 필수로 가정
await provider.refund.refund({
  transactionId: attempt.transactionId || undefined,
  // ❌ null 체크 없이 사용
});
```

**권장:**

```typescript
if (!attempt.transactionId) {
  throw new Error('Transaction ID required for refund');
}
await provider.refund.refund({
  transactionId: attempt.transactionId,
});
```

**2. 금액 타입 불일치**

```typescript
// schema에서는 numeric
amount: numeric('amount', { precision: 10, scale: 2 });

// 코드에서는 number로 변환
const refundAmount = amount ?? Number(intent.amount);
// ⚠️ numeric → string → number 변환 과정에서 정밀도 손실 가능
```

**권장:**

```typescript
// Decimal.js 사용
import Decimal from 'decimal.js';

const refundAmount = amount ? new Decimal(amount) : new Decimal(intent.amount);

const ratio = refundAmount.div(totalAmount);
const pointsToRefund = discountsTotal.mul(ratio).floor();
```

---

## 7️⃣ 종합 권장사항

### 우선순위별 로드맵

#### 🔴 즉시 조치 (Hot Fix - 24시간 내)

1. **보안 이슈 해결**
   - [ ] 하드코딩된 DB 자격증명 제거
   - [ ] 노출된 DB 비밀번호 변경
   - [ ] Git 히스토리 정리

2. **Critical 버그 수정**
   - [ ] 세금계산서 배치 업데이트 버그 (`inArray` 사용)
   - [ ] 환불 금액 초과 검증 추가

#### 🟡 1주 내 조치

1. **정합성 검증 강화**
   - [ ] 부분환불 누적 금액 검증
   - [ ] 최소 잔액 검증
   - [ ] 환불 기한 검증

2. **테스트 추가**
   - [ ] 부분환불 E2E 테스트
   - [ ] 동시 환불 요청 테스트
   - [ ] 세금계산서 발행 기한 테스트

3. **문서화**
   - [ ] API 문서 업데이트 (환불 정책)
   - [ ] 운영 가이드 작성

#### 🟢 1개월 내 조치

1. **세무 규정 준수**
   - [ ] 발행 기한 검증 로직
   - [ ] 수정세금계산서 사유 코드 표준화
   - [ ] 국세청 API 연동 검토

2. **모니터링 강화**
   - [ ] 환불 금액 이상치 알림
   - [ ] 세금계산서 발행 지연 알림
   - [ ] 동시성 이슈 감지

3. **성능 최적화**
   - [ ] 환불 처리 성능 프로파일링
   - [ ] DB 인덱스 최적화
   - [ ] 캐싱 전략 수립

### 예상 효과

**보안 강화:**

- DB 접근 권한 통제
- API 키 노출 위험 제거

**재무 리스크 감소:**

- 연간 200만원 이상 손실 방지 (환불 초과 방지)
- 세무 과태료 위험 제거

**운영 효율성:**

- 세금계산서 발행 자동화
- 환불 처리 시간 단축
- 고객 문의 감소

---

## 8️⃣ 결론

### MVP 운영 가능성 평가

**현재 상태**: ⚠️ **조건부 운영 가능**

**강점:**

- ✅ 핵심 결제 플로우 구현 완료
- ✅ 트랜잭션 관리 양호
- ✅ 타입 안전성 확보

**즉시 해결 필요:**

- 🔴 보안 이슈 (DB 자격증명 노출)
- 🔴 환불 정합성 검증 부족
- 🔴 세금계산서 배치 버그

**권장 조치:**

1. Hot Fix 배포 (보안 + Critical 버그)
2. 1주 내 정합성 검증 강화
3. 1개월 내 세무 규정 완전 준수

**운영 시작 조건:**

- ✅ Hot Fix 완료 후
- ✅ E2E 테스트 통과
- ✅ 모니터링 대시보드 구축

---

**작성자**: Kiro AI Code Reviewer  
**검토 완료일**: 2025-10-15  
**다음 리뷰 예정**: 2025-10-22 (Hot Fix 후)

<function_calls>
<invoke name="grepSearch">
<parameter name="explanation">환경 변수 및 민감 정보 사용 패턴을 검색합니다.

**RefundService.refundPayment()** 분석:

```typescript
// 비율 계산 (소수점 버림)
const ratio = refundAmount / totalAmount;
const pointsToRefund = Math.floor(discountsTotal * ratio);
const cashToRefund = refundAmount - pointsToRefund;
```

#### ✅ 잘 구현된 부분

- 포인트:현금 비율 계산 로직 존재
- 트랜잭션 내에서 포인트 복원 + 현금 환불 처리
- `refundedAmount` 누적 관리

#### ❌ 문제점

**1. 누적 환불 검증 부재**

```typescript
// 현재 코드에는 이 검증이 없음
if (newRefundedAmount > totalAmount) {
  throw new Error('환불 금액이 결제 금액을 초과합니다');
}
```

**2. 부분환불 이력 추적 불가**

- `payment_refunds` 테이블에 여러 환불 기록이 쌓이지만
- Intent 조회 시 환불 이력을 함께 반환하지 않음
- 고객센터에서 "이미 얼마 환불했는지" 확인 어려움

**3. 포인트 복원 검증 부족**

```typescript
// 실제 사용한 포인트보다 많이 복원될 위험
const pointDiscount = discounts.find((d: any) => d.type === 'POINTS');
// ⚠️ pointDiscount.amount와 누적 환불 포인트 비교 없음
```

### 🔧 권장 수정사항

**Priority 1: 누적 환불 검증 추가**

```typescript
// RefundService.refundPayment() 내부
const existingRefunds = await tx
  .select()
  .from(schema.paymentRefunds)
  .where(eq(schema.paymentRefunds.intentId, intentId));

const totalRefunded = existingRefunds.reduce(
  (sum, r) => sum + Number(r.amount),
  0,
);

if (totalRefunded + refundAmount > totalAmount) {
  throw new Error(
    `환불 가능 금액 초과: 이미 ${totalRefunded}원 환불됨, ` +
      `요청 ${refundAmount}원, 총액 ${totalAmount}원`,
  );
}
```

**Priority 2: 환불 이력 조회 API 추가**

```typescript
@Get('intents/:intentId/refunds')
async getRefundHistory(@Param('intentId') intentId: string) {
  // payment_refunds 조회 + 포인트/현금 분해 정보 반환
}
```

---

## 2️⃣ 세무 규정 준수 분석

### 현재 구현 상태

**세금계산서 스키마**:

- `tax_invoices`: 마스터 테이블 (10개 필드)
- `tax_invoice_events`: 이벤트 로그
- `tax_invoice_events_details`: 상세 정보 (1:1)

**지원 기능**:

- 일반 세금계산서 생성
- 수정세금계산서 (환불용)
- 배치 엑셀 export (홈택스 업로드용)

#### ✅ 잘 구현된 부분

- 수정세금계산서 생성 API 존재 (`POST /:invoiceId/refund`)
- `originalInvoiceId` 참조로 원본 추적 가능
- 배치 발행 결과 반영 API 존재

#### ❌ 문제점

**1. 발행 기한 검증 없음**

```typescript
// 국세청 규정: 공급일로부터 익월 10일까지 발행
// 현재 코드에는 이 검증이 없음
```

**실제 리스크**:

- 1개월 전 구매 → 세금계산서 미발행 → 가산세 (공급가액의 1%)
- 연매출 20억 기준, 월 1.6억 × 1% = 160만원 가산세 위험

**2. 공급일자 자동 설정 로직 부재**

```typescript
// TaxInvoiceService.createTaxInvoice()에서
supplyDate: dto.supplyDate; // ⚠️ 외부에서 받음, 검증 없음
```

**올바른 처리**:

- 주문 확정일 = 공급일
- 배송 완료일 = 공급일 (배송 상품의 경우)
- 디지털 상품 = 결제 완료일

**3. 수정세금계산서 발행 기한 검증 없음**

```typescript
// 국세청 규정: 원본 발행일로부터 6개월 이내
// 현재 코드에는 이 검증이 없음
```

### 🔧 권장 수정사항

**Priority 1: 발행 기한 검증 추가**

```typescript
// TaxInvoiceService.createTaxInvoice()
const supplyDate = new Date(dto.supplyDate);
const deadline = new Date(supplyDate);
deadline.setMonth(deadline.getMonth() + 1);
deadline.setDate(10); // 익월 10일

if (new Date() > deadline) {
  throw new Error(
    `세금계산서 발행 기한 초과: 공급일 ${supplyDate.toISOString().split('T')[0]}, ` +
      `기한 ${deadline.toISOString().split('T')[0]}`,
  );
}
```

**Priority 2: 수정세금계산서 기한 검증**

```typescript
// TaxInvoiceService.createRefundInvoice()
const original = await tx
  .select()
  .from(schema.taxInvoices)
  .where(eq(schema.taxInvoices.id, originalInvoiceId))
  .then((rows) => rows[0]);

const issueDate = new Date(original.createdAt);
const deadline = new Date(issueDate);
deadline.setMonth(deadline.getMonth() + 6);

if (new Date() > deadline) {
  throw new Error(
    `수정세금계산서 발행 기한 초과: 원본 발행일 ${issueDate.toISOString().split('T')[0]}, ` +
      `기한 ${deadline.toISOString().split('T')[0]}`,
  );
}
```

**Priority 3: 공급일자 자동 계산**

```typescript
// PaymentService.capturePaymentByIntent() 내부
// 캡처 완료 시 세금계산서 자동 생성
await this.taxInvoiceService.createTaxInvoice({
  userId: intent.customerId,
  externalOrderId: intent.id,
  supplyDate: new Date().toISOString().split('T')[0], // 오늘 날짜
  totalAmount: Number(intent.finalAmount),
  // ...
});
```

---

## 3️⃣ 환불 기한 제약 분석

### 현재 구현 상태

**RefundService.refundPayment()**:

- 환불 기한 검증 없음
- `AUTHORIZED` 또는 `CAPTURED` 상태면 언제든 환불 가능

#### ❌ 문제점

**1. 무제한 환불 허용**

```typescript
// 1년 전 결제도 환불 가능
// PG사 정책: 보통 1년 이내만 환불 가능
```

**실제 리스크**:

- PG사 환불 API 호출 실패 → 시스템에서는 환불 완료 처리
- 고객에게는 환불 안내 → 실제로는 환불 안됨
- 수동 정산 필요 → 운영 부담 증가

**2. BNPL 청구 주기 고려 부족**

```typescript
// BNPL은 월별 청구 주기가 있음
// 이미 CMS 출금된 건은 환불 불가 (또는 별도 처리 필요)
```

### 🔧 권장 수정사항

**Priority 1: 환불 기한 검증 추가**

```typescript
// RefundService.refundPayment()
const capturedAt = intent.capturedAt || intent.authorizedAt;
if (!capturedAt) {
  throw new Error('결제 완료 시각을 확인할 수 없습니다');
}

const daysSinceCaptured = Math.floor(
  (Date.now() - new Date(capturedAt).getTime()) / (1000 * 60 * 60 * 24),
);

// PG사별 환불 기한 (설정으로 관리)
const refundDeadlineDays = 365; // 1년

if (daysSinceCaptured > refundDeadlineDays) {
  throw new Error(
    `환불 기한 초과: 결제일로부터 ${daysSinceCaptured}일 경과 ` +
      `(기한: ${refundDeadlineDays}일)`,
  );
}
```

**Priority 2: BNPL 청구 주기 검증**

```typescript
// BNPL 환불 시
if (attempt.provider === 'HMS_BNPL') {
  const bnplEvent = await tx
    .select()
    .from(schema.bnplEvents)
    .where(eq(schema.bnplEvents.paymentIntentId, intentId))
    .then((rows) => rows[0]);

  if (bnplEvent?.cmsStatus === 'PROCESSED') {
    throw new Error('BNPL 청구가 이미 처리되었습니다. 고객센터로 문의하세요.');
  }
}
```

---

## 4️⃣ 동시성 제어 분석

### 현재 구현 상태

**트랜잭션 사용**:

- `runInTransaction()` 헬퍼 사용
- `for('update')` 락 사용 (RefundService)

#### ✅ 잘 구현된 부분

- 환불 시 Intent에 `for('update')` 락 적용
- 트랜잭션 내에서 포인트 복원 + 현금 환불 처리

#### ❌ 문제점

**1. 중복 환불 방지 부족**

```typescript
// 동시에 2개의 환불 요청이 들어오면?
// Intent 락은 있지만, 환불 이력 조회는 락 없음
```

**시나리오**:

1. 요청 A: 10,000원 환불 시작 (Intent 락 획득)
2. 요청 B: 10,000원 환불 시작 (Intent 락 대기)
3. 요청 A: 환불 완료, 커밋
4. 요청 B: Intent 락 획득, 환불 이력 조회 (A의 환불 보임)
5. 요청 B: 검증 통과, 또 10,000원 환불 → **중복 환불**

**2. 포인트 동시성 제어 부족**

```typescript
// PointService.addPoints()에서
// partner 잔액 조회 시 락 없음
```

### 🔧 권장 수정사항

**Priority 1: 멱등성 키 활용**

```typescript
// PaymentController.refundPayment()
@Post(':intentId/refund')
async refundPayment(
  @Param('intentId') intentId: string,
  @Body() dto: RefundPaymentDto,
  @Headers('Idempotency-Key') idemKey?: string, // ✅ 추가
) {
  return runInTransaction(this.db, async (tx) => {
    // 멱등성 키 체크
    const { hit, response } = await this.idempotencyService.checkOrCreate(
      tx,
      idemKey,
      intentId,
      dto,
      `v2/payments/${intentId}/refund`,
    );
    if (hit) return response;

    const result = await this.refundService.refundPayment(
      intentId,
      dto.amount,
      dto.reason,
    );

    await this.idempotencyService.complete(tx, idemKey, result);
    return result;
  });
}
```

**Priority 2: 환불 이력 조회 시 락 적용**

```typescript
// RefundService.refundPayment()
const existingRefunds = await tx
  .select()
  .from(schema.paymentRefunds)
  .where(eq(schema.paymentRefunds.intentId, intentId))
  .for('update'); // ✅ 락 추가
```

---

## 5️⃣ 기타 운영 이슈

### 5.1 환불 계좌 관리

**현재 상태**:

- `user_refund_accounts` 테이블 존재
- `isDefault` 플래그로 기본 계좌 관리

**문제점**:

- 환불 시 계좌 검증 로직 없음
- 계좌 소유주 확인 없음 (보이스피싱 위험)

**권장 사항**:

```typescript
// 환불 전 계좌 검증
if (refundAccountId) {
  const account = await tx
    .select()
    .from(schema.userRefundAccounts)
    .where(
      and(
        eq(schema.userRefundAccounts.id, refundAccountId),
        eq(schema.userRefundAccounts.userId, intent.customerId),
      ),
    )
    .then((rows) => rows[0]);

  if (!account) {
    throw new Error('환불 계좌를 찾을 수 없거나 권한이 없습니다');
  }
}
```

### 5.2 환불 알림

**현재 상태**:

- 환불 완료 후 알림 로직 없음

**권장 사항**:

- Kafka 이벤트 발행: `payment.refund.completed`
- Notification 서비스에서 SMS/이메일 발송
- 고객센터 대시보드에 환불 이력 표시

### 5.3 환불 통계

**현재 상태**:

- 환불 통계 조회 API 없음

**권장 사항**:

```typescript
@Get('refunds/stats')
async getRefundStats(
  @Query('startDate') startDate: string,
  @Query('endDate') endDate: string,
) {
  // 일별 환불 건수, 금액
  // 환불 사유별 통계
  // 환불율 (환불 금액 / 결제 금액)
}
```

---

## 📋 우선순위별 액션 아이템

### 🔴 High Priority (MVP 출시 전 필수)

1. **부분환불 누적 검증 추가** (2시간)
   - `RefundService.refundPayment()` 수정
   - 기존 환불 이력 조회 + 검증 로직 추가

2. **세금계산서 발행 기한 검증** (3시간)
   - `TaxInvoiceService.createTaxInvoice()` 수정
   - 익월 10일 기한 체크 로직 추가
   - 경고 알림 시스템 구축 (발행 기한 3일 전)

3. **환불 멱등성 키 적용** (1시간)
   - `PaymentController.refundPayment()` 수정
   - 중복 환불 방지

### 🟡 Medium Priority (출시 후 1개월 내)

4. **환불 기한 검증 추가** (2시간)
   - PG사별 환불 기한 설정
   - BNPL 청구 주기 고려

5. **환불 이력 조회 API** (3시간)
   - `GET /intents/:intentId/refunds`
   - 고객센터용 대시보드 연동

6. **수정세금계산서 기한 검증** (2시간)
   - 원본 발행일로부터 6개월 체크

### 🟢 Low Priority (출시 후 3개월 내)

7. **환불 계좌 검증 강화** (4시간)
   - 계좌 소유주 확인 API 연동
   - 보이스피싱 방지 로직

8. **환불 통계 대시보드** (8시간)
   - 일별/월별 환불 현황
   - 환불 사유 분석

9. **자동 세금계산서 발행** (6시간)
   - 캡처 완료 시 자동 생성
   - 배치 발행 스케줄러

---

## 💰 세무 리스크 요약

### 현재 상태에서 발생 가능한 가산세

**시나리오**: 월 1.6억원 매출, 세금계산서 발행 누락

| 항목            | 금액     | 가산세율 | 연간 리스크               |
| --------------- | -------- | -------- | ------------------------- |
| 미발행 가산세   | 1.6억/월 | 1%       | 192만원/월 = 2,304만원/년 |
| 지연발행 가산세 | 1.6억/월 | 0.5%     | 96만원/월 = 1,152만원/년  |

**권장 조치**:

1. 발행 기한 검증 로직 추가 (High Priority #2)
2. 발행 기한 3일 전 알림 시스템
3. 자동 발행 스케줄러 구축 (Low Priority #9)

---

## ✅ 결론

### 현재 시스템 평가

**기술적 완성도**: ⭐⭐⭐⭐☆ (4/5)

- 결제 플로우는 잘 구현됨
- 포인트 복식부기 시스템 우수
- 트랜잭션 관리 양호

**운영 준비도**: ⭐⭐⭐☆☆ (3/5)

- 부분환불 검증 부족
- 세무 규정 준수 미흡
- 동시성 제어 보완 필요

### MVP 출시 가능 여부

**✅ 출시 가능하지만, High Priority 3개 항목은 반드시 수정 필요**

1. 부분환불 누적 검증 (2시간)
2. 세금계산서 발행 기한 검증 (3시간)
3. 환불 멱등성 키 적용 (1시간)

**총 소요 시간**: 6시간 (1일 작업)

### 출시 후 모니터링 포인트

1. **환불 건수 모니터링**
   - 일 10건 이상 → 환불 사유 분석 필요
   - 부분환불 비율 → 정합성 검증 강화

2. **세금계산서 발행율**
   - 목표: 익월 5일까지 95% 이상 발행
   - 미발행 건 → 자동 알림 발송

3. **PG사 환불 실패율**
   - 목표: 1% 미만
   - 실패 건 → 수동 정산 프로세스

---

**작성자**: Kiro AI  
**검토 대상**: Wallet MSA v2 (apps/wallet)  
**다음 리뷰**: MVP 출시 후 1개월
