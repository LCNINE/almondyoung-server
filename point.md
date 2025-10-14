# 포인트 통합 결제 시스템 - 구현 명세서 (MVP, 레거시 없음)

## 0. 스펙 기반 개발 원칙

> **"이 문서는 구현의 유일한 진실입니다. 모든 결제는 AUTHORIZE → CAPTURE 2단계로 명확히 구분되며, 스펙에 없는 코드는 작성하지 않습니다."**

## 1. 핵심 설계 원칙

### 1.1 결제 플로우 명확화

```typescript
// 모든 결제는 2단계
1. authorize() - 승인 (홀드)
2. capture()    - 정산 (실제 돈 이동)

// 예외: 포인트 전액은 authorize 시점에 바로 CAPTURED
```

### 1.2 상태 전이 규칙

```
PENDING → PROCESSING → AUTHORIZED → CAPTURED
                    ↘ FAILED      ↘ REFUNDED
```

## 2. 데이터 모델 (신규)

### 2.1 PaymentIntent 스키마

```typescript
// shared/database/schema/payment-intents.ts
export const paymentIntents = pgTable('payment_intents', {
  id: varchar('id', { length: 26 }).primaryKey(),
  customerId: varchar('customer_id', { length: 26 }).notNull(),

  // 금액 필드
  totalAmount: decimal('total_amount').notNull(), // 원래 금액
  discounts: jsonb('discounts').default([]).$type<DiscountLine[]>(),
  discountsTotal: decimal('discounts_total').default(0),
  finalAmount: decimal('final_amount').notNull(), // 실제 결제액

  // 상태 필드
  status: varchar('status').$type<PaymentStatus>().notNull(),
  type: varchar('type').$type<PaymentType>().notNull(),

  // 메타데이터
  metadata: jsonb('metadata'),

  // 타임스탬프
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  capturedAt: timestamp('captured_at'), // 정산 시점
});

// 타입 정의
interface DiscountLine {
  type: 'POINTS';
  amount: number;
  pointEventId: number;
  appliedAt: Date;
}

type PaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'FAILED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';
```

### 2.2 PaymentAttempt 스키마

```typescript
export const paymentAttempts = pgTable('payment_attempts', {
  id: varchar('id', { length: 26 }).primaryKey(),
  intentId: varchar('intent_id').references(() => paymentIntents.id),

  provider: varchar('provider').$type<ProviderType>().notNull(),
  amount: decimal('amount').notNull(),
  status: varchar('status').$type<AttemptStatus>().notNull(),

  transactionId: varchar('transaction_id'),
  eventContext: jsonb('event_context'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

type AttemptStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'FAILED'
  | 'REFUNDED';
```

## 3. 서비스 구현

### 3.1 PaymentOrchestratorService (완전 재작성)

```typescript
@Injectable()
export class PaymentOrchestratorService {
  constructor(
    private readonly db: DbService<typeof walletSchema>,
    private readonly paymentExecutor: PaymentExecutorService,
    private readonly pointService: PointService,
  ) {}

  /**
   * Step 1: 결제 승인 (Authorization)
   * - 포인트 차감
   * - 외부 결제 승인
   * - 즉시결제는 바로 capture까지
   *
   * ✅ provider는 optional: 포인트 전액 결제 시 불필요
   */
  async authorizePayment(
    intentId: string,
    provider: ProviderType | null, // ✅ null 허용
    options: {
      usePoints?: number;
      profileId?: string;
      instrumentRef?: string;
      idempotencyKey: string;
    },
  ): Promise<AuthorizeResult> {
    // 멱등성 체크 (idempotencyKeys 테이블 활용)
    const existing = await this.db.db.query.idempotencyKeys.findFirst({
      where: eq(schema.idempotencyKeys.id, options.idempotencyKey),
    });
    if (existing && existing.status === 'SUCCESS') {
      return JSON.parse(existing.responseBody);
    }

    return this.db.db.transaction(async (tx) => {
      // 1. Intent 조회 및 잠금
      const intent = await tx
        .select()
        .from(schema.paymentIntents)
        .where(eq(schema.paymentIntents.id, intentId))
        .for('UPDATE')
        .then((rows) => rows[0]);

      if (!intent) throw new Error('Intent not found');
      if (intent.status !== 'PENDING') {
        throw new Error(`Invalid status: ${intent.status}`);
      }

      // 2. PROCESSING 상태로 변경
      await tx
        .update(schema.paymentIntents)
        .set({ status: 'PROCESSING' })
        .where(eq(schema.paymentIntents.id, intentId));

      // 3. 포인트 처리
      let pointEventId: number | null = null;
      let finalAmount = Number(intent.totalAmount);

      if (options.usePoints && options.usePoints > 0) {
        // 포인트 잔액 체크
        const balance = await this.pointService.getBalance(
          Number(intent.customerId),
        );
        if (balance < options.usePoints) {
          throw new Error('INSUFFICIENT_POINTS');
        }

        // ⚠️ 중요: 포인트 차감은 동일 트랜잭션에서 실행되어야 함
        // 외부 결제 실패 시 포인트도 함께 롤백되도록 tx 전달
        const redeemResult = await this.pointService.redeem(
          {
            partnerId: Number(intent.customerId),
            amount: options.usePoints,
            reason: 'PAYMENT',
            memo: `Intent: ${intentId}`,
          },
          tx, // ✅ 상위 트랜잭션 전파
        );

        pointEventId = redeemResult.eventId;

        // 할인 정보 업데이트
        const discounts: DiscountLine[] = [
          {
            type: 'POINTS',
            amount: options.usePoints,
            pointEventId,
            appliedAt: new Date(),
          },
        ];

        finalAmount = Number(intent.totalAmount) - options.usePoints;

        await tx
          .update(schema.paymentIntents)
          .set({
            discounts,
            discountsTotal: options.usePoints,
            finalAmount,
          })
          .where(eq(schema.paymentIntents.id, intentId));
      }

      // 4. 외부 결제 처리
      let attemptId: string | null = null;
      let transactionId: string | null = null;
      let finalStatus: PaymentStatus;
      let capturedAt: Date | null = null;

      if (finalAmount === 0) {
        // ✅ 포인트 전액 결제 - provider 불필요, 바로 CAPTURED
        finalStatus = 'CAPTURED';
        capturedAt = new Date();
      } else {
        // ✅ 외부 결제 필요 - provider 필수 검증
        if (!provider) {
          throw new Error('PROVIDER_REQUIRED_FOR_EXTERNAL_PAYMENT');
        }

        attemptId = generateUUIDv7();

        const paymentRequest: PaymentRequest = {
          intentId,
          attemptId,
          amount: finalAmount,
          paymentType: intent.type as PaymentType,
          userId: intent.customerId,
          instrumentType: options.profileId ? 'PROFILE' : 'ONE_TIME',
          profileId: options.profileId,
          instrumentRef: options.instrumentRef,
          metadata: {},
        };

        // PaymentExecutor로 위임
        const execResult = await this.paymentExecutor.authorize(
          paymentRequest,
          provider,
          { ...intent, amount: finalAmount },
          { tx },
        );

        if (!execResult.success) {
          throw new Error(execResult.message || 'PAYMENT_FAILED');
        }

        transactionId = execResult.transactionId;

        // Provider별 처리 분기
        if (provider === ProviderType.HMS_BNPL) {
          // BNPL: authorize만
          await tx.insert(schema.paymentAttempts).values({
            id: attemptId,
            intentId,
            provider,
            amount: finalAmount,
            status: 'AUTHORIZED',
            transactionId,
          });

          finalStatus = 'AUTHORIZED';
        } else {
          // 즉시결제: authorize 후 바로 capture
          const captureResult = await this.paymentExecutor.capture(
            attemptId,
            provider,
            finalAmount,
            { tx },
          );

          if (!captureResult.success) {
            throw new Error('CAPTURE_FAILED');
          }

          await tx.insert(schema.paymentAttempts).values({
            id: attemptId,
            intentId,
            provider,
            amount: finalAmount,
            status: 'CAPTURED',
            transactionId,
          });

          finalStatus = 'CAPTURED';
          capturedAt = new Date();
        }
      }

      // 5. Intent 최종 상태 업데이트
      await tx
        .update(schema.paymentIntents)
        .set({
          status: finalStatus,
          capturedAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentIntents.id, intentId));

      // 6. 결과 구성 및 멱등성 저장
      const result = {
        success: true,
        intentId,
        status: finalStatus,
        attemptId,
        transactionId,
        pointEventId,
        breakdown: {
          totalAmount: Number(intent.totalAmount),
          pointsUsed: options.usePoints || 0,
          finalAmount,
        },
      };

      // 멱등성 키 저장 (idempotencyKeys 테이블)
      await tx
        .insert(schema.idempotencyKeys)
        .values({
          id: options.idempotencyKey,
          userId: intent.customerId,
          requestPath: `/payments/authorize`,
          requestHash: '', // 필요시 요청 해시 계산
          responseCode: 200,
          responseBody: JSON.stringify(result),
          status: 'SUCCESS',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24시간 후 만료
        })
        .onConflictDoNothing();

      return result;
    });
  }

  /**
   * Step 2: 결제 정산 (Capture)
   * BNPL 월말 정산시 사용
   */
  async capturePayment(
    intentId: string,
    attemptId: string,
  ): Promise<CaptureResult> {
    return this.db.db.transaction(async (tx) => {
      // Intent와 Attempt 조회
      const intent = await tx
        .select()
        .from(schema.paymentIntents)
        .where(eq(schema.paymentIntents.id, intentId))
        .then((rows) => rows[0]);

      const attempt = await tx
        .select()
        .from(schema.paymentAttempts)
        .where(eq(schema.paymentAttempts.id, attemptId))
        .then((rows) => rows[0]);

      // 검증
      if (intent.status !== 'AUTHORIZED') {
        throw new Error(`Intent not in AUTHORIZED status: ${intent.status}`);
      }
      if (attempt.status !== 'AUTHORIZED') {
        throw new Error(`Attempt not in AUTHORIZED status: ${attempt.status}`);
      }

      // 외부 capture 실행
      const result = await this.paymentExecutor.capture(
        attemptId,
        attempt.provider as ProviderType,
        Number(attempt.amount),
        { tx },
      );

      if (!result.success) {
        throw new Error('CAPTURE_FAILED');
      }

      // 상태 업데이트
      await tx
        .update(schema.paymentAttempts)
        .set({
          status: 'CAPTURED',
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentAttempts.id, attemptId));

      await tx
        .update(schema.paymentIntents)
        .set({
          status: 'CAPTURED',
          capturedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentIntents.id, intentId));

      return {
        success: true,
        intentId,
        attemptId,
        capturedAt: new Date(),
      };
    });
  }
}
```

### 3.2 RefundService (신규)

```typescript
@Injectable()
export class RefundService {
  constructor(
    private readonly db: DbService<typeof walletSchema>,
    private readonly pointService: PointService,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async refundPayment(
    intentId: string,
    amount?: number,
    reason: string = 'CUSTOMER_REQUEST',
  ): Promise<RefundResult> {
    return this.db.db.transaction(async (tx) => {
      // Intent 조회
      const intent = await tx
        .select()
        .from(schema.paymentIntents)
        .where(eq(schema.paymentIntents.id, intentId))
        .for('UPDATE')
        .then((rows) => rows[0]);

      // 환불 가능 상태 체크
      if (!['AUTHORIZED', 'CAPTURED'].includes(intent.status)) {
        throw new Error(`Cannot refund intent in ${intent.status} status`);
      }

      const refundAmount = amount ?? Number(intent.totalAmount);

      // 비율 계산 (소수점 버림)
      const ratio = refundAmount / Number(intent.totalAmount);
      const pointsToRefund = Math.floor(Number(intent.discountsTotal) * ratio);
      const cashToRefund = refundAmount - pointsToRefund;

      // 1. 포인트 복원
      if (pointsToRefund > 0) {
        await this.pointService.earn(
          {
            partnerId: Number(intent.customerId),
            amount: pointsToRefund,
            reason: 'REFUND',
            orderId: intentId,
            memo: reason,
          },
          tx, // ✅ 상위 트랜잭션 전파
        );
      }

      // 2. 현금 환불
      if (cashToRefund > 0) {
        const attempt = await tx
          .select()
          .from(schema.paymentAttempts)
          .where(eq(schema.paymentAttempts.intentId, intentId))
          .orderBy(desc(schema.paymentAttempts.createdAt))
          .limit(1)
          .then((rows) => rows[0]);

        if (attempt) {
          const provider = this.providerRegistry.get(
            attempt.provider as ProviderType,
          );

          if (
            intent.status === 'AUTHORIZED' &&
            attempt.provider === 'HMS_BNPL'
          ) {
            // BNPL 미정산건: void 처리
            await provider.cancel?.cancel({
              transactionId: attempt.transactionId,
              amount: cashToRefund,
            });
          } else {
            // 정산완료건: refund 처리
            await provider.refund?.refund({
              transactionId: attempt.transactionId,
              amount: cashToRefund,
              reason,
            });
          }

          // Attempt 상태 업데이트
          await tx
            .update(schema.paymentAttempts)
            .set({ status: 'REFUNDED' })
            .where(eq(schema.paymentAttempts.id, attempt.id));
        }
      }

      // 3. Intent 상태 업데이트
      const newStatus =
        refundAmount === Number(intent.totalAmount)
          ? 'REFUNDED'
          : 'PARTIALLY_REFUNDED';

      await tx
        .update(schema.paymentIntents)
        .set({
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentIntents.id, intentId));

      return {
        success: true,
        refunded: {
          points: pointsToRefund,
          cash: cashToRefund,
          total: refundAmount,
        },
        status: newStatus,
      };
    });
  }
}
```

### 3.3 BNPL 정산 처리 (기존 BnplBillingScheduler 활용)

**참고**: BNPL 정산은 이미 `BnplBillingScheduler`에 구현되어 있습니다.

**기존 구현**:

- `apps/wallet/src/services/bnpl-billing.scheduler.ts`
- 매일 02:00 출금 신청 (`@Cron('0 2 * * *')`)
- 매일 10:00 결과 조회 (`@Cron('0 10 * * *')`)
- HMS CMS API 연동하여 배치 처리

**동작 흐름**:

1. `processBnplBilling()`: 미정산 BNPL 금액을 집계하여 CMS 출금 신청
2. `processCmsResultCheck()`: CMS 결과 조회 후 성공시 `PaymentOrchestratorService.capturePayment()` 호출
3. AUTHORIZED → CAPTURED 상태 전환

**포인트 통합 시 주의사항**:

- 포인트가 차감된 결제도 finalAmount 기준으로 정산됨
- 환불 시 포인트는 비율 계산으로 복원됨

## 4. API 레이어

```typescript
@Controller('payments')
export class PaymentController {
  /**
   * 결제 승인
   * POST /payments/authorize
   *
   * ✅ provider는 optional: 포인트 전액 결제 시 생략 가능
   */
  @Post('authorize')
  async authorizePayment(@Body() dto: AuthorizeDto) {
    return this.orchestrator.authorizePayment(
      dto.intentId,
      dto.provider || null,
      {
        usePoints: dto.usePoints,
        profileId: dto.profileId,
        instrumentRef: dto.instrumentRef,
        idempotencyKey: dto.idempotencyKey,
      },
    );
  }

  /**
   * 결제 정산 (BNPL용)
   * POST /payments/capture
   */
  @Post('capture')
  async capturePayment(@Body() dto: CaptureDto) {
    return this.orchestrator.capturePayment(dto.intentId, dto.attemptId);
  }

  /**
   * 환불
   * POST /payments/{intentId}/refund
   */
  @Post(':intentId/refund')
  async refundPayment(
    @Param('intentId') intentId: string,
    @Body() dto: RefundDto,
  ) {
    return this.refundService.refundPayment(intentId, dto.amount, dto.reason);
  }
}

// DTOs
class AuthorizeDto {
  @IsString()
  intentId: string;

  @IsOptional() // ✅ 포인트 전액 결제 시 불필요
  @IsEnum(ProviderType)
  provider?: ProviderType; // Optional: 포인트 전액이면 null/undefined 가능

  @IsOptional()
  @IsNumber()
  @Min(0)
  usePoints?: number;

  @IsOptional()
  @IsString()
  profileId?: string;

  @IsOptional()
  @IsString()
  instrumentRef?: string;

  @IsString()
  idempotencyKey: string;
}

class CaptureDto {
  @IsString()
  intentId: string;

  @IsString()
  attemptId: string;
}

class RefundDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
```

## 5. 모듈 구성

```typescript
@Module({
  imports: [DbModule, PointModule, ProvidersModule],
  providers: [
    PaymentOrchestratorService,
    PaymentExecutorService,
    RefundService,
    BnplBillingScheduler, // 기존 정산 스케줄러
  ],
  controllers: [PaymentController],
  exports: [PaymentOrchestratorService, RefundService],
})
export class PaymentModule {}
```

**⚠️ 중요: 트랜잭션 전파 규칙 (WMS 패턴)**

포인트 차감/복원이 결제 트랜잭션과 함께 롤백되어야 하므로, 모든 포인트 메서드는 트랜잭션 전파를 지원해야 합니다:

```typescript
// PointService 시그니처
class PointService {
  async getBalance(partnerId: number): Promise<number>;
  async redeem(
    params: RedeemParams,
    tx?: DbTx,
  ): Promise<{ eventId: number; used: number }>;
  async earn(
    params: EarnParams,
    tx?: DbTx,
  ): Promise<{ eventId: number; detailId: number }>;
  async earnCancel(
    params: EarnCancelParams,
    tx?: DbTx,
  ): Promise<{ eventId: number; cancel: number }>;
}

// PointRepository 시그니처
class PointRepository {
  async redeem(
    p: RedeemParams,
    tx?: DbTx,
  ): Promise<{ eventId: number; used: number }>;
  async earn(
    p: EarnParams,
    tx?: DbTx,
  ): Promise<{ eventId: number; detailId: number }>;
  async earnCancel(
    p: EarnCancelParams,
    tx?: DbTx,
  ): Promise<{ eventId: number; cancel: number }>;
}
```

**트랜잭션 전파 규칙:**

- DB 접근 메서드는 마지막 파라미터로 `tx?: DbTx` 사용
- 상위에서 전달받은 `tx`를 하위 호출까지 전파
- `tx`가 있으면 재사용, 없으면 새 트랜잭션 시작
- 내부 헬퍼: `private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx)`

**실패 시 롤백 시나리오:**

1. 포인트 차감 완료
2. 외부 결제 API 호출 실패
3. **트랜잭션 롤백으로 포인트 차감도 자동 취소** ✅

## 6. 테스트 명세

```typescript
describe('PaymentOrchestrator', () => {
  describe('authorize', () => {
    it('✅ 포인트 전액 (provider=null) → CAPTURED, attempt 없음');
    it('포인트+카드 (provider=TOSS) → CAPTURED');
    it('포인트+BNPL (provider=HMS_BNPL) → AUTHORIZED');
    it('포인트 부족 → 에러');
    it('✅ finalAmount > 0 && provider=null → PROVIDER_REQUIRED 에러');
  });

  describe('capture', () => {
    it('AUTHORIZED → CAPTURED');
    it('이미 CAPTURED → 에러');
  });

  describe('refund', () => {
    it('전액 환불 → REFUNDED');
    it('부분 환불 → PARTIALLY_REFUNDED');
    it('비율 계산 정확성');
  });
});
```

## 7. 구현 일정

| Day | 작업 내용                                 |
| --- | ----------------------------------------- |
| 1   | 스키마 생성, 타입 정의                    |
| 2   | PaymentOrchestratorService 구현           |
| 3   | RefundService, BnplSettlementService 구현 |
| 4   | API 레이어, 통합 테스트                   |
| 5   | 배포 및 모니터링                          |

---

**이 스펙대로 정확히 구현하면 authorize/capture가 명확히 구분된 깔끔한 시스템이 됩니다.**
