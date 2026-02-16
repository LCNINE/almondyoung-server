# 💰 Wallet 서비스 Kafka 이벤트 명세서

이 문서는 Wallet 서비스에서 **실제로 구현된 Kafka 이벤트**와 **향후 구현이 필요한 Kafka 이벤트**를 정리합니다.

---

## 📋 현재 상태

### ❌ **Kafka 이벤트 송수신: 완전 미구현**

**확인 결과:**

- Kafka Producer/Consumer 코드 없음
- EventEmitter, @EventPattern 등 이벤트 관련 데코레이터 없음
- KafkaModule 임포트 없음
- ClientProxy 등 마이크로서비스 통신 코드 없음

**현재 구현된 것:**

- ✅ **DB Event Sourcing만**: 모든 상태 변경을 DB 테이블에 로그로 저장
- ✅ **동기적 처리만**: HTTP API 호출 → 비즈니스 로직 실행 → DB 저장 → 응답

---

## 🔄 구현이 필요한 Kafka 이벤트들

### 1. 결제 관련 이벤트 (High Priority)

#### 🔥 `wallet.payment.completed`

**발행 시점**: 결제 성공 시  
**소비자**: Channel Adapter, Order Service  
**비즈니스 필요성**: 주문 상태 업데이트, 재고 차감 트리거

```typescript
interface PaymentCompletedEvent {
  eventId: string;
  eventType: 'wallet.payment.completed';
  payload: {
    intentId: string;
    customerId: string;
    amount: number;
    currency: 'KRW';
    paymentMethod: 'CARD' | 'BNPL' | 'POINT';
    externalOrderId?: string;
    completedAt: string;
  };
  occurredAt: string;
  source: 'wallet-service';
}
```

#### 🔥 `wallet.payment.failed`

**발행 시점**: 결제 실패 시  
**소비자**: Channel Adapter, Order Service, Notification Service  
**비즈니스 필요성**: 주문 취소, 사용자 알림

```typescript
interface PaymentFailedEvent {
  eventId: string;
  eventType: 'wallet.payment.failed';
  payload: {
    intentId: string;
    customerId: string;
    amount: number;
    errorCode: string;
    errorMessage: string;
    externalOrderId?: string;
    failedAt: string;
  };
  occurredAt: string;
  source: 'wallet-service';
}
```

---

### 2. BNPL 관련 이벤트 (High Priority)

#### 🔥 `wallet.bnpl.credit.used`

**발행 시점**: BNPL 신용 사용 시  
**소비자**: Order Service, Analytics Service  
**비즈니스 필요성**: BNPL 주문 추적, 신용 한도 모니터링

```typescript
interface BnplCreditUsedEvent {
  eventId: string;
  eventType: 'wallet.bnpl.credit.used';
  payload: {
    bnplEventId: string;
    accountId: string;
    userId: string;
    amount: number;
    availableLimit: number; // 사용 후 잔여 한도
    externalOrderId: string;
    paymentIntentId: string;
    usedAt: string;
  };
  occurredAt: string;
  source: 'wallet-service';
}
```

---

### 3. 포인트 관련 이벤트 (Medium Priority)

#### 🟡 `wallet.point.earned`

**발행 시점**: 포인트 적립 시  
**소비자**: User Service, Notification Service  
**비즈니스 필요성**: 사용자 알림, 포인트 이력 동기화

```typescript
interface PointEarnedEvent {
  eventId: string;
  eventType: 'wallet.point.earned';
  payload: {
    pointEventId: number;
    partnerId: number; // 사용자 ID
    amount: number;
    reason?: string;
    orderId?: string;
    expiresAt?: string;
    earnedAt: string;
  };
  occurredAt: string;
  source: 'wallet-service';
}
```

#### 🟡 `wallet.point.redeemed`

**발행 시점**: 포인트 사용 시  
**소비자**: User Service, Order Service  
**비즈니스 필요성**: 포인트 차감 확인, 주문 할인 적용

```typescript
interface PointRedeemedEvent {
  eventId: string;
  eventType: 'wallet.point.redeemed';
  payload: {
    pointEventId: number;
    partnerId: number;
    amount: number;
    orderId?: string;
    redeemedAt: string;
  };
  occurredAt: string;
  source: 'wallet-service';
}
```

---

### 4. 환불 관련 이벤트 (Medium Priority)

#### 🟡 `wallet.refund.completed`

**발행 시점**: 환불 완료 시  
**소비자**: Channel Adapter, Order Service  
**비즈니스 필요성**: 환불 상태 동기화, 재고 복구

```typescript
interface RefundCompletedEvent {
  eventId: string;
  eventType: 'wallet.refund.completed';
  payload: {
    refundId: string;
    originalPaymentIntentId: string;
    customerId: string;
    refundAmount: number;
    externalOrderId?: string;
    completedAt: string;
  };
  occurredAt: string;
  source: 'wallet-service';
}
```

---

## ❌ 이벤트 발행이 불필요한 것들

### 현금영수증 이벤트

**이유**:

- 동기적 처리가 적절 (법적 의무사항, 즉시 발행 필요)
- 외부 시스템 의존성 낮음 (국세청 API → DB 저장으로 완료)
- 단순한 워크플로우 (발행 → 성공/실패 → 완료)

### 세금계산서 이벤트

**이유**:

- 회계 시스템과의 연동이 필요하다면 고려 가능하지만, 현재는 단순 저장만 하므로 불필요
- 대부분 월말 배치로 처리되는 업무

---

## 🛠️ 구현 로드맵

### Phase 1: 핵심 결제 이벤트 (즉시 구현)

1. `wallet.payment.completed` - Channel Adapter가 주문 완료 처리 가능
2. `wallet.payment.failed` - 결제 실패 시 주문 취소 처리
3. `wallet.bnpl.credit.used` - BNPL 주문 추적

### Phase 2: 포인트 이벤트 (단계적 구현)

4. `wallet.point.earned` - 사용자 포인트 적립 알림
5. `wallet.point.redeemed` - 포인트 사용 확인

### Phase 3: 환불 이벤트 (장기 계획)

6. `wallet.refund.completed` - 환불 완료 처리

---

## 🔧 구현 예시

### EventPublisher 서비스

```typescript
@Injectable()
export class EventPublisher {
  constructor(
    @Inject('KAFKA_CLIENT') private readonly kafkaClient: ClientKafka,
  ) {}

  async publishPaymentCompleted(payment: PaymentIntent): Promise<void> {
    const event: PaymentCompletedEvent = {
      eventId: generateUUIDv7(),
      eventType: 'wallet.payment.completed',
      payload: {
        intentId: payment.id,
        customerId: payment.customerId,
        amount: payment.amount,
        currency: 'KRW',
        paymentMethod: payment.paymentType,
        externalOrderId: payment.externalOrderId,
        completedAt: new Date().toISOString(),
      },
      occurredAt: new Date().toISOString(),
      source: 'wallet-service',
    };

    await this.kafkaClient.emit('wallet.payment.completed', event);
  }
}
```

### PaymentService에서 이벤트 발행

```typescript
@Injectable()
export class PaymentService {
  constructor(private readonly eventPublisher: EventPublisher) {}

  async completePayment(intentId: string): Promise<void> {
    // 1. 기존 DB 업데이트 로직
    const payment = await this.updatePaymentStatus(intentId, 'COMPLETED');

    // 2. Kafka 이벤트 발행 (신규 추가)
    await this.eventPublisher.publishPaymentCompleted(payment);
  }
}
```

### app.module.ts에 Kafka 설정 추가

```typescript
@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'KAFKA_CLIENT',
        transport: Transport.KAFKA,
        options: {
          client: {
            clientId: 'wallet-service',
            brokers: ['localhost:9092'],
          },
        },
      },
    ]),
  ],
})
export class AppModule {}
```

---

## 📊 이벤트 우선순위 매트릭스

| 이벤트                     | 비즈니스 중요도 | 구현 복잡도 | 우선순위  |
| -------------------------- | --------------- | ----------- | --------- |
| `wallet.payment.completed` | 🔥 High         | 🟢 Low      | **1순위** |
| `wallet.payment.failed`    | 🔥 High         | 🟢 Low      | **1순위** |
| `wallet.bnpl.credit.used`  | 🔥 High         | 🟡 Medium   | **2순위** |
| `wallet.point.earned`      | 🟡 Medium       | 🟢 Low      | **3순위** |
| `wallet.point.redeemed`    | 🟡 Medium       | 🟢 Low      | **3순위** |
| `wallet.refund.completed`  | 🟡 Medium       | 🟡 Medium   | **4순위** |

---

**최종 업데이트**: 2025-09-25  
**버전**: 3.0.0 (Kafka 이벤트 중심으로 재작성)  
**작성자**: Wallet Service Team
