# 테스트 시나리오 문서

## 📋 개요

Wallet MSA의 세션 기반 결제 시스템에 대한 포괄적인 테스트 시나리오를 정의합니다. 환불 플로우까지 포함한 전체 테스트 케이스를 다룹니다.

## 🧪 테스트 구조

### 테스트 파일 구조

```
apps/wallet/test/
├── payment.service.spec.ts          # 결제 서비스 단위 테스트
├── payment-session.service.spec.ts  # 세션 서비스 단위 테스트
├── refund.service.spec.ts           # 환불 서비스 단위 테스트
├── recurring-payment.scheduler.spec.ts # 정기결제 스케줄러 테스트
└── e2e/
    ├── payment-flow.e2e-spec.ts     # 결제 플로우 E2E 테스트
    └── refund-flow.e2e-spec.ts      # 환불 플로우 E2E 테스트
```

## 🔧 PaymentService 테스트

### 1. 세션 기반 결제 테스트

```typescript
describe('PaymentService - 세션 기반 결제', () => {
  describe('processPayment', () => {
    it('세션 ID가 제공된 경우 해당 세션 사용', async () => {
      // Given
      const existingSessionId = 'session_123';
      const paymentRequest = {
        userId: 'user_123',
        paymentMethodId: 'pm_123',
        amount: 50000,
        sessionId: existingSessionId,
        actor: 'USER' as const,
      };

      // When
      const result = await paymentService.processPayment(paymentRequest);

      // Then
      expect(result.sessionId).toBe(existingSessionId);
      expect(result.paymentEventId).toBeDefined();
      expect(result.status).toBe('CAPTURED');
    });

    it('세션 ID가 없는 경우 자동으로 세션 생성', async () => {
      // Given
      const paymentRequest = {
        userId: 'user_123',
        paymentMethodId: 'pm_123',
        amount: 50000,
        // sessionId 없음
        actor: 'USER' as const,
      };

      // When
      const result = await paymentService.processPayment(paymentRequest);

      // Then
      expect(result.sessionId).toBeDefined();
      expect(result.sessionId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID 형식
      expect(result.paymentEventId).toBeDefined();
      expect(result.status).toBe('CAPTURED');
    });

    it('결제 성공 시 세션 상태가 CAPTURED로 업데이트', async () => {
      // Given
      const paymentRequest = {
        userId: 'user_123',
        paymentMethodId: 'pm_123',
        amount: 50000,
        actor: 'USER' as const,
      };

      // When
      const result = await paymentService.processPayment(paymentRequest);

      // Then
      const session = await db
        .select()
        .from(schema.paymentSessions)
        .where(eq(schema.paymentSessions.id, result.sessionId))
        .limit(1);

      expect(session[0].status).toBe('CAPTURED');
      expect(session[0].capturedAt).toBeDefined();
    });

    it('결제 실패 시 세션 상태가 FAILED로 업데이트', async () => {
      // Given
      const paymentRequest = {
        userId: 'user_123',
        paymentMethodId: 'pm_invalid', // 실패하는 결제수단
        amount: 50000,
        actor: 'USER' as const,
      };

      // When & Then
      await expect(
        paymentService.processPayment(paymentRequest),
      ).rejects.toThrow('결제 실패');
    });

    it('PaymentSessionEvents에 상태 변경 로그 저장', async () => {
      // Given
      const paymentRequest = {
        userId: 'user_123',
        paymentMethodId: 'pm_123',
        amount: 50000,
        actor: 'USER' as const,
      };

      // When
      const result = await paymentService.processPayment(paymentRequest);

      // Then
      const sessionEvents = await db
        .select()
        .from(schema.paymentSessionEvents)
        .where(
          eq(schema.paymentSessionEvents.paymentSessionId, result.sessionId),
        )
        .orderBy(schema.paymentSessionEvents.occurredAt);

      expect(sessionEvents).toHaveLength(2);
      expect(sessionEvents[0].eventType).toBe('SESSION_CREATED');
      expect(sessionEvents[1].eventType).toBe('PAYMENT_CAPTURED');
    });
  });

  describe('결제수단별 테스트', () => {
    it('카드 결제 성공', async () => {
      // Given: 카드 결제수단
      // When: 결제 실행
      // Then: CAPTURED 상태 반환
    });

    it('BNPL 결제 성공 (AUTHORIZED 상태)', async () => {
      // Given: BNPL 결제수단
      // When: 결제 실행
      // Then: AUTHORIZED 상태 반환 (즉시 capture되지 않음)
    });

    it('포인트 결제 성공', async () => {
      // Given: 포인트 결제수단
      // When: 결제 실행
      // Then: CAPTURED 상태 반환
    });
  });

  describe('에러 처리', () => {
    it('존재하지 않는 결제수단으로 결제 시 에러', async () => {
      // Given
      const paymentRequest = {
        userId: 'user_123',
        paymentMethodId: 'pm_nonexistent',
        amount: 50000,
        actor: 'USER' as const,
      };

      // When & Then
      await expect(
        paymentService.processPayment(paymentRequest),
      ).rejects.toThrow('결제수단을 찾을 수 없습니다');
    });

    it('비활성화된 결제수단으로 결제 시 에러', async () => {
      // Given: INACTIVE 상태의 결제수단
      // When & Then: 에러 발생
    });

    it('다른 사용자의 결제수단으로 결제 시 에러', async () => {
      // Given: 다른 사용자 소유의 결제수단
      // When & Then: 에러 발생
    });
  });
});
```

## 🔄 RecurringPaymentScheduler 테스트

```typescript
describe('RecurringPaymentScheduler - 정기결제', () => {
  describe('processRecurringPayment', () => {
    it('정기결제 시 세션 자동 생성 후 결제 실행', async () => {
      // Given
      const recurringTarget = {
        paymentMethod: { id: 'pm_123', userId: 'user_123' },
        cardMethod: { hmsMemberId: 'hms_123' },
      };

      // When
      const result = await scheduler.processRecurringPayment(recurringTarget);

      // Then
      expect(result.sessionId).toBeDefined();
      expect(result.paymentEventId).toBeDefined();
      expect(result.status).toBe('CAPTURED');

      // 세션 이벤트 검증
      const sessionEvents = await db
        .select()
        .from(schema.paymentSessionEvents)
        .where(
          eq(schema.paymentSessionEvents.paymentSessionId, result.sessionId),
        );

      expect(sessionEvents).toContainEqual(
        expect.objectContaining({ eventType: 'SESSION_CREATED' }),
      );
      expect(sessionEvents).toContainEqual(
        expect.objectContaining({ eventType: 'PAYMENT_CAPTURED' }),
      );
    });

    it('정기결제 메타데이터 올바르게 설정', async () => {
      // Given & When
      const result = await scheduler.processRecurringPayment(recurringTarget);

      // Then
      const paymentEvent = await db
        .select()
        .from(schema.paymentEvents)
        .where(eq(schema.paymentEvents.id, result.paymentEventId))
        .limit(1);

      const eventContext = JSON.parse(paymentEvent[0].eventContext);
      expect(eventContext.business.isSubscriptionPayment).toBe(true);
      expect(eventContext.business.source).toBe('scheduler');
      expect(eventContext.business.billingCycle).toBe('MONTHLY');
    });

    it('정기결제 실패 시 적절한 에러 처리', async () => {
      // Given: 실패하는 결제수단
      // When & Then: 에러 발생 및 로깅
    });
  });

  describe('멱등성 테스트', () => {
    it('동일한 날짜에 같은 결제수단으로 중복 실행 방지', async () => {
      // Given: 멱등성 키 기반 중복 실행
      // When & Then: 첫 번째는 성공, 두 번째는 캐시된 결과 반환
    });
  });
});
```

## 💰 RefundService 테스트

```typescript
describe('RefundService - 환불 처리', () => {
  describe('processRefund', () => {
    it('전액 환불 성공', async () => {
      // Given
      const paymentEvent = await createTestPaymentEvent({
        amount: 50000,
        status: 'CAPTURED',
      });

      const refundRequest = {
        paymentEventId: paymentEvent.id,
        // amount 없음 (전액 환불)
        reason: '고객 요청',
        actor: 'USER' as const,
      };

      // When
      const result = await refundService.processRefund(refundRequest);

      // Then
      expect(result.refundEventId).toBeDefined();
      expect(result.sessionId).toBe(paymentEvent.sessionId);
      expect(result.amount).toBe(50000);
      expect(result.status).toBe('COMPLETED');

      // 세션 상태 검증
      const session = await db
        .select()
        .from(schema.paymentSessions)
        .where(eq(schema.paymentSessions.id, paymentEvent.sessionId))
        .limit(1);

      expect(session[0].status).toBe('REFUNDED');
      expect(session[0].refundedAmount).toBe(50000);
    });

    it('부분 환불 성공', async () => {
      // Given
      const paymentEvent = await createTestPaymentEvent({
        amount: 50000,
        status: 'CAPTURED',
      });

      const refundRequest = {
        paymentEventId: paymentEvent.id,
        amount: 25000, // 부분 환불
        reason: '부분 취소',
        actor: 'USER' as const,
      };

      // When
      const result = await refundService.processRefund(refundRequest);

      // Then
      expect(result.amount).toBe(25000);
      expect(result.status).toBe('COMPLETED');

      // 세션 상태 검증 (부분 환불이므로 REFUNDED가 아닐 수 있음)
      const session = await db
        .select()
        .from(schema.paymentSessions)
        .where(eq(schema.paymentSessions.id, paymentEvent.sessionId))
        .limit(1);

      expect(session[0].refundedAmount).toBe(25000);
    });

    it('환불 완료 시 PaymentSessionEvents에 로그 저장', async () => {
      // Given & When
      const result = await refundService.processRefund(refundRequest);

      // Then
      const sessionEvents = await db
        .select()
        .from(schema.paymentSessionEvents)
        .where(
          eq(schema.paymentSessionEvents.paymentSessionId, result.sessionId),
        )
        .orderBy(schema.paymentSessionEvents.occurredAt);

      const refundEvent = sessionEvents.find(
        (e) => e.eventType === 'REFUND_COMPLETED',
      );
      expect(refundEvent).toBeDefined();

      const eventData = JSON.parse(refundEvent.eventData);
      expect(eventData.refundEventId).toBe(result.refundEventId);
      expect(eventData.refundAmount).toBe(result.amount);
    });

    it('RefundEvents 테이블에 환불 기록 저장', async () => {
      // Given & When
      const result = await refundService.processRefund(refundRequest);

      // Then
      const refundEvent = await db
        .select()
        .from(schema.refundEvents)
        .where(eq(schema.refundEvents.id, result.refundEventId))
        .limit(1);

      expect(refundEvent[0]).toMatchObject({
        paymentEventId: refundRequest.paymentEventId,
        amount: result.amount,
        status: 'COMPLETED',
        reason: refundRequest.reason,
        completedBy: refundRequest.actor,
      });
    });
  });

  describe('환불 검증 테스트', () => {
    it('존재하지 않는 결제 이벤트 환불 시 에러', async () => {
      // Given
      const refundRequest = {
        paymentEventId: 'nonexistent_payment',
        actor: 'USER' as const,
      };

      // When & Then
      await expect(refundService.processRefund(refundRequest)).rejects.toThrow(
        '결제 이벤트를 찾을 수 없습니다',
      );
    });

    it('CAPTURED 상태가 아닌 결제 환불 시 에러', async () => {
      // Given: FAILED 상태의 결제 이벤트
      const paymentEvent = await createTestPaymentEvent({
        status: 'FAILED',
      });

      const refundRequest = {
        paymentEventId: paymentEvent.id,
        actor: 'USER' as const,
      };

      // When & Then
      await expect(refundService.processRefund(refundRequest)).rejects.toThrow(
        '환불 가능한 상태가 아닙니다',
      );
    });

    it('세션 ID가 없는 결제 환불 시 에러', async () => {
      // Given: sessionId가 null인 결제 이벤트 (마이그레이션 전 데이터)
      // When & Then: 에러 발생
    });

    it('환불 금액이 원본 금액을 초과하는 경우 에러', async () => {
      // Given: 50,000원 결제
      // When: 100,000원 환불 요청
      // Then: 에러 발생
    });
  });

  describe('결제수단별 환불 테스트', () => {
    it('카드 환불 성공', async () => {
      // Given: 카드 결제 이벤트
      // When: 환불 실행
      // Then: HMS 카드 어댑터 호출 확인
    });

    it('BNPL 환불 성공', async () => {
      // Given: BNPL 결제 이벤트
      // When: 환불 실행
      // Then: HMS BNPL 어댑터 호출 확인
    });

    it('포인트 환불 성공', async () => {
      // Given: 포인트 결제 이벤트
      // When: 환불 실행
      // Then: 포인트 복원 확인
    });
  });
});
```

## 🔗 E2E 테스트

### 전체 결제 플로우 E2E

```typescript
describe('Payment Flow E2E', () => {
  it('결제 → 환불 전체 플로우', async () => {
    // 1. 결제수단 등록
    const paymentMethod = await registerPaymentMethod({
      userId: 'user_123',
      methodType: 'CARD',
      methodName: '테스트 카드',
    });

    // 2. 결제 실행
    const paymentResult = await request(app.getHttpServer())
      .post('/payments/process')
      .send({
        userId: 'user_123',
        paymentMethodId: paymentMethod.id,
        amount: 50000,
        currency: 'KRW',
      })
      .expect(200);

    expect(paymentResult.body.sessionId).toBeDefined();
    expect(paymentResult.body.paymentEventId).toBeDefined();
    expect(paymentResult.body.status).toBe('CAPTURED');

    // 3. 환불 실행
    const refundResult = await request(app.getHttpServer())
      .post('/payments/refund')
      .send({
        paymentEventId: paymentResult.body.paymentEventId,
        reason: 'E2E 테스트 환불',
      })
      .expect(200);

    expect(refundResult.body.sessionId).toBe(paymentResult.body.sessionId);
    expect(refundResult.body.refundedAmount).toBe(50000);
    expect(refundResult.body.status).toBe('COMPLETED');

    // 4. 세션 상태 최종 검증
    const finalSession = await db
      .select()
      .from(schema.paymentSessions)
      .where(eq(schema.paymentSessions.id, paymentResult.body.sessionId))
      .limit(1);

    expect(finalSession[0].status).toBe('REFUNDED');
  });

  it('정기결제 → 환불 플로우', async () => {
    // 1. 구독용 결제수단 등록
    // 2. 정기결제 스케줄러 실행
    // 3. 정기결제 결과 확인
    // 4. 정기결제 환불
    // 5. 최종 상태 검증
  });
});
```

## 📊 성능 테스트

```typescript
describe('Performance Tests', () => {
  it('동시 결제 처리 성능', async () => {
    const concurrentPayments = 100;
    const promises = Array.from({ length: concurrentPayments }, (_, i) =>
      paymentService.processPayment({
        userId: `user_${i}`,
        paymentMethodId: `pm_${i}`,
        amount: 10000,
        actor: 'USER',
      }),
    );

    const startTime = Date.now();
    const results = await Promise.allSettled(promises);
    const endTime = Date.now();

    const successCount = results.filter((r) => r.status === 'fulfilled').length;
    const avgTime = (endTime - startTime) / concurrentPayments;

    expect(successCount).toBeGreaterThan(concurrentPayments * 0.95); // 95% 성공률
    expect(avgTime).toBeLessThan(1000); // 평균 1초 이내
  });

  it('대용량 환불 처리 성능', async () => {
    // 1000건의 환불 요청 동시 처리
    // 성능 및 정확성 검증
  });
});
```

## 🔧 테스트 유틸리티

### 테스트 데이터 생성 헬퍼

```typescript
// test/helpers/test-data.helper.ts
export class TestDataHelper {
  static async createTestPaymentEvent(
    options: {
      amount?: number;
      status?: string;
      userId?: string;
    } = {},
  ) {
    const session = await this.createTestSession({
      userId: options.userId || 'test_user',
      amount: options.amount || 50000,
    });

    const paymentMethod = await this.createTestPaymentMethod({
      userId: options.userId || 'test_user',
    });

    const paymentEvent = await db
      .insert(schema.paymentEvents)
      .values({
        sessionId: session.id,
        methodId: paymentMethod.id,
        amount: options.amount || 50000,
        status: options.status || 'CAPTURED',
        actor: 'USER',
        eventContext: JSON.stringify({
          pg: { transactionId: 'test_tx_123' },
          business: { paymentPurpose: 'PURCHASE' },
          pricing: { finalAmount: options.amount || 50000 },
        }),
      })
      .returning();

    return paymentEvent[0];
  }

  static async createTestSession(options: {
    userId: string;
    amount: number;
    status?: string;
  }) {
    const session = await db
      .insert(schema.paymentSessions)
      .values({
        userId: options.userId,
        amount: options.amount,
        currency: 'KRW',
        status: options.status || 'PENDING',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      })
      .returning();

    return session[0];
  }

  static async createTestPaymentMethod(options: {
    userId: string;
    methodType?: string;
  }) {
    const paymentMethod = await db
      .insert(schema.paymentMethod)
      .values({
        userId: options.userId,
        methodType: options.methodType || 'CARD',
        methodName: '테스트 결제수단',
        status: 'ACTIVE',
        paymentPurpose: 'BOTH',
      })
      .returning();

    return paymentMethod[0];
  }
}
```

### Mock 설정

```typescript
// test/mocks/payment-adapters.mock.ts
export const mockHmsCardAdapter = {
  processPayment: jest.fn().mockResolvedValue({
    status: 'CAPTURED',
    transactionId: 'mock_tx_123',
    approvalNumber: 'APPR123456',
  }),

  refund: jest.fn().mockResolvedValue({
    success: true,
    pgTransactionId: 'refund_tx_123',
  }),
};
```

## 📈 테스트 커버리지 목표

### 단위 테스트

- **PaymentService**: 95% 이상
- **RefundService**: 95% 이상
- **PaymentSessionService**: 90% 이상
- **RecurringPaymentScheduler**: 85% 이상

### 통합 테스트

- 결제 → 환불 플로우: 100%
- 정기결제 플로우: 100%
- 에러 시나리오: 90% 이상

### E2E 테스트

- 주요 사용자 시나리오: 100%
- API 엔드포인트: 90% 이상

---

이 문서는 Wallet MSA의 포괄적인 테스트 전략을 정의합니다. 모든 기능 개발 시 해당 테스트 케이스를 구현해야 합니다.
