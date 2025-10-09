# 스키마 검증 (Schema Validation) 가이드

## 개요

Zod를 사용한 런타임 스키마 검증으로 **타입 안전성 + 런타임 검증**을 동시에 달성합니다.

## 주요 기능

- ✅ **발행 시 검증**: Publisher에서 이벤트 발행 전 payload 검증
- ✅ **수신 시 검증**: Consumer에서 메시지 수신 후 payload 검증
- ✅ **타입 추론**: Zod 스키마에서 TypeScript 타입 자동 추출
- ✅ **선택적 검증**: 이벤트 타입별로 선택적으로 스키마 적용 가능
- ✅ **자동 DLQ**: 스키마 검증 실패 시 재시도 없이 즉시 DLQ로 전송

## 사용 방법

### 1. Zod 스키마 정의 (libs/shared/src/streams/)

```typescript
// libs/shared/src/streams/orders.stream.ts
import { z } from 'zod';
import { event, stream } from '@app/events';

// 1. Zod 스키마 정의 (런타임 검증)
export const OrderCreatedSchema = z.object({
  orderId: z.string().uuid(),
  customerId: z.string().uuid(),
  items: z.array(
    z.object({
      skuId: z.string().uuid(),
      quantity: z.number().int().positive(),
      price: z.number().positive(),
    }),
  ),
  totalAmount: z.number().positive(),
  orderStatus: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED']),
  createdAt: z.string().datetime(), // ISO 8601
});

export const OrderCancelledSchema = z.object({
  orderId: z.string().uuid(),
  customerId: z.string().uuid(),
  reason: z.string().min(1).max(500),
  cancelledAt: z.string().datetime(),
});

// 2. TypeScript 타입 추출 (컴파일 타임 검증)
export type OrderCreatedPayload = z.infer<typeof OrderCreatedSchema>;
export type OrderCancelledPayload = z.infer<typeof OrderCancelledSchema>;

// 3. Stream 정의 (타입 안전 버전 - 스키마 포함)
export const ORDER_STREAM = stream({
  topic: 'orders.events.v1',
  partitions: 12,
  aggregateType: 'Order',
  events: {
    OrderCreated: event<'OrderCreated', OrderCreatedPayload>('OrderCreated', OrderCreatedSchema),
    OrderCancelled: event<'OrderCancelled', OrderCancelledPayload>('OrderCancelled', OrderCancelledSchema),
  },
});

// 4. 타입 추론
export type OrderEvents = typeof ORDER_STREAM.events;
```

### 2. Publisher 설정 (자동 검증)

```typescript
// apps/wms/src/order/order.module.ts
import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { ORDER_STREAM } from '@app/shared/streams/orders.stream';

@Module({
  imports: [
    EventsModule.forRoot({
      streams: [ORDER_STREAM],
      serviceName: 'wms-order',
      validation: {
        validateOnPublish: true,     // 발행 시 검증 (기본값: true)
        throwOnValidationError: true, // 검증 실패 시 에러 발생 (기본값: true)
      },
    }),
  ],
})
export class OrderModule {}
```

### 3. 이벤트 발행 (자동 검증됨)

```typescript
// apps/wms/src/order/services/order.service.ts
import { Injectable } from '@nestjs/common';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import { ORDER_STREAM, OrderEvents, OrderCreatedPayload } from '@app/shared/streams/orders.stream';

@Injectable()
export class OrderService {
  constructor(
    @InjectStreamPublisher('orders.events.v1')
    private readonly orderPublisher: StreamPublisher<OrderEvents>,
  ) {}

  async createOrder(dto: CreateOrderDto) {
    const order = await this.saveOrder(dto);

    // ✅ 발행 시 자동으로 스키마 검증됨
    await this.orderPublisher.publishEvent({
      eventType: 'OrderCreated',
      aggregateId: order.id,
      payload: {
        orderId: order.id,
        customerId: order.customerId,
        items: order.items,
        totalAmount: order.totalAmount,
        orderStatus: 'PENDING',
        createdAt: new Date().toISOString(),
      },
    });
    // ✅ 검증 통과: 메시지 발행됨
    // ❌ 검증 실패: SchemaValidationError 발생 (발행 안됨)

    return order;
  }

  async publishInvalidEvent() {
    // ❌ 스키마 검증 실패 예시
    await this.orderPublisher.publishEvent({
      eventType: 'OrderCreated',
      aggregateId: 'order-123',
      payload: {
        orderId: 'invalid-uuid',  // ❌ UUID 형식이 아님
        customerId: '',           // ❌ 빈 문자열
        items: [],                // ❌ 최소 1개 이상 필요하다면
        totalAmount: -100,        // ❌ 음수 불가
        orderStatus: 'INVALID',   // ❌ enum에 없는 값
        createdAt: 'not-a-date',  // ❌ ISO 8601 형식 아님
      },
    });
    // 👆 SchemaValidationError 발생!
  }
}
```

### 4. Consumer 설정 (자동 검증)

```typescript
// apps/channel-adapter/src/app.module.ts
import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { ORDER_STREAM } from '@app/shared/streams/orders.stream';

@Module({
  imports: [
    EventsModule.forConsumerModule({
      streams: [ORDER_STREAM],
      groupId: 'channel-adapter-consumers',
      enableAutoDLQ: true,  // 자동 DLQ 처리
      validation: {
        validateOnConsume: true,      // 수신 시 검증 (기본값: true)
        throwOnValidationError: true, // 검증 실패 시 에러 (기본값: true)
      },
    }),
  ],
})
export class AppModule {}
```

### 5. 이벤트 핸들러 (자동 검증됨)

```typescript
// apps/channel-adapter/src/consumers/order-events.consumer.ts
import { Controller, Logger } from '@nestjs/common';
import { OnEvent, EventPayload } from '@app/events';
import { OrderCreatedPayload } from '@app/shared/streams/orders.stream';

@Controller()
export class OrderEventsConsumer {
  private readonly logger = new Logger(OrderEventsConsumer.name);

  @OnEvent('orders.events.v1', 'OrderCreated')
  async handleOrderCreated(@EventPayload() payload: OrderCreatedPayload) {
    // ✅ 이 시점에 payload는 이미 스키마 검증 완료!
    // ✅ 타입 안전성 보장됨
    
    console.log(payload.orderId);      // string (UUID)
    console.log(payload.totalAmount);  // number (positive)
    console.log(payload.orderStatus);  // 'PENDING' | 'CONFIRMED' | 'CANCELLED'
    
    // 검증된 데이터로 안전하게 작업 가능
    await this.syncOrderToChannels(payload);
  }
}
```

## 스키마 검증 실패 처리

### 자동 DLQ 전송

스키마 검증 실패 시:
1. **재시도 안함** (SchemaValidationError는 nonRetryableErrors)
2. **즉시 DLQ로 전송** (자동)
3. **Offset Commit** (메시지 처리 완료)

```typescript
// 검증 실패 로그 예시
[SchemaValidationInterceptor] ❌ Consumer schema validation failed: OrderCreated
  topic: orders.events.v1
  messageId: 01ARZ3NDEKTSV4RRFFQ69G5FAV
  errors:
    - orderId: Invalid uuid
    - totalAmount: Number must be greater than 0
    - orderStatus: Invalid enum value. Expected 'PENDING' | 'CONFIRMED' | 'CANCELLED', received 'INVALID'

[DLQHandler] 📤 Message sent to DLQ after 0 failed attempts
```

### 검증 옵션 커스터마이즈

```typescript
EventsModule.forConsumerModule({
  streams: [ORDER_STREAM],
  groupId: 'my-consumer',
  validation: {
    validateOnConsume: true,      // 수신 시 검증 활성화
    throwOnValidationError: false, // 검증 실패해도 에러 안던짐 (경고만)
  },
})
```

`throwOnValidationError: false`인 경우:
- 검증 실패해도 에러를 던지지 않음
- 경고 로그만 출력하고 핸들러 계속 실행
- DLQ로 전송 안됨

## Zod 스키마 작성 팁

### 1. 기본 타입 검증

```typescript
z.string()              // 문자열
z.number()              // 숫자
z.boolean()             // 불리언
z.date()                // Date 객체
z.string().uuid()       // UUID 형식
z.string().email()      // 이메일 형식
z.string().url()        // URL 형식
z.string().datetime()   // ISO 8601 datetime
```

### 2. 숫자 제약

```typescript
z.number().int()        // 정수
z.number().positive()   // 양수
z.number().nonnegative()// 0 이상
z.number().min(0)       // 최소값
z.number().max(100)     // 최대값
```

### 3. 문자열 제약

```typescript
z.string().min(1)       // 최소 길이
z.string().max(500)     // 최대 길이
z.string().length(10)   // 정확한 길이
z.string().regex(/^[A-Z]/) // 정규식
```

### 4. 배열

```typescript
z.array(z.string())     // 문자열 배열
z.array(z.object({      // 객체 배열
  id: z.string(),
  qty: z.number(),
}))
.min(1)                 // 최소 1개
.max(100)               // 최대 100개
```

### 5. 객체 (Nested)

```typescript
z.object({
  user: z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
  }),
  items: z.array(
    z.object({
      productId: z.string(),
      quantity: z.number().int().positive(),
    }),
  ),
})
```

### 6. Enum

```typescript
z.enum(['PENDING', 'ACTIVE', 'CANCELLED'])
```

### 7. Optional / Nullable

```typescript
z.string().optional()   // string | undefined
z.string().nullable()   // string | null
z.string().nullish()    // string | null | undefined
```

### 8. Default 값

```typescript
z.string().default('default-value')
z.number().default(0)
```

### 9. Union (여러 타입 중 하나)

```typescript
z.union([z.string(), z.number()])  // string | number
```

### 10. Refinement (커스텀 검증)

```typescript
z.string().refine(
  (val) => val.startsWith('SKU-'),
  { message: 'SKU code must start with SKU-' }
)

z.number().refine(
  (val) => val % 10 === 0,
  { message: 'Must be multiple of 10' }
)
```

## 선택적 스키마 적용

모든 이벤트에 스키마를 적용할 필요는 없습니다:

```typescript
export const ORDER_STREAM: StreamConfig<OrderEvents> = {
  topic: { topic: 'orders.events.v1' },
  aggregateType: 'Order',
  events: {
    // ✅ 스키마 검증 O
    OrderCreated: {
      messageType: 'OrderCreated',
      payloadType: {} as OrderCreatedPayload,
      schema: OrderCreatedSchema,  // 스키마 있음
    },
    
    // ⚠️  스키마 검증 X (기존 방식)
    OrderUpdated: {
      messageType: 'OrderUpdated',
      payloadType: {} as OrderUpdatedPayload,
      // schema 없음 → 검증 생략
    },
  },
};
```

## Best Practices

1. **중요한 이벤트부터 스키마 추가**: 주문, 결제, 재고 등 핵심 이벤트
2. **점진적 적용**: 모든 이벤트에 한번에 추가하지 말고 점진적으로
3. **스키마 버전 관리**: 스키마 변경 시 메시지 버전 업그레이드
4. **Refinement 활용**: 비즈니스 규칙을 스키마에 포함
5. **DLQ 모니터링**: 스키마 검증 실패 메시지는 별도 알림 설정

## 트러블슈팅

### Q: 스키마 검증이 작동하지 않아요

A: 다음을 확인하세요:
1. Stream config에 `schema` 필드가 있는지
2. `validation.validateOnPublish/validateOnConsume`이 `true`인지
3. `throwOnValidationError`가 `true`인지 (false면 경고만 출력)

### Q: 기존 이벤트에 스키마를 추가하면 어떻게 되나요?

A: 
- Publisher: 발행 시점부터 스키마 검증됨
- Consumer: 수신 시점부터 스키마 검증됨
- 기존에 Kafka에 저장된 메시지는 Consumer 수신 시 검증됨
- 검증 실패 시 DLQ로 전송되므로 주의!

### Q: 스키마 변경 시 하위 호환성은?

A: Zod 스키마를 변경하면:
1. 새 필드 추가: `.optional()` 사용하면 하위 호환
2. 필드 제거: 기존 메시지 검증 실패 → DLQ
3. 타입 변경: 기존 메시지 검증 실패 → DLQ

**권장**: 메시지 버전 업그레이드 (`v2`) 후 점진적 마이그레이션

### Q: 성능 영향은?

A: 
- Zod 검증은 매우 빠름 (1ms 미만)
- 대부분의 경우 네트워크 I/O가 병목
- 스키마 검증 비용 << 잘못된 데이터 처리 비용

## 예시: 복잡한 스키마

```typescript
import { z } from 'zod';

export const ComplexOrderSchema = z.object({
  orderId: z.string().uuid(),
  customerId: z.string().uuid(),
  
  items: z.array(
    z.object({
      skuId: z.string().uuid(),
      skuCode: z.string().regex(/^SKU-[A-Z0-9]+$/),
      quantity: z.number().int().positive().max(9999),
      price: z.number().positive().multipleOf(0.01), // 소수점 2자리
      discount: z.number().nonnegative().max(100).optional(),
    }),
  ).min(1).max(100),
  
  shippingAddress: z.object({
    recipientName: z.string().min(1).max(100),
    recipientPhone: z.string().regex(/^\d{10,11}$/),
    address: z.string().min(5).max(500),
    zipCode: z.string().length(5),
  }),
  
  paymentMethod: z.enum(['CARD', 'BANK_TRANSFER', 'VIRTUAL_ACCOUNT']),
  
  totalAmount: z.number().positive(),
  shippingFee: z.number().nonnegative(),
  discountAmount: z.number().nonnegative(),
  
  orderStatus: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED']),
  createdAt: z.string().datetime(),
  
  // 커스텀 검증: 총액 = 상품 금액 - 할인 + 배송비
}).refine(
  (data) => {
    const itemsTotal = data.items.reduce((sum, item) => {
      const itemPrice = item.price * item.quantity;
      const itemDiscount = item.discount ? (itemPrice * item.discount / 100) : 0;
      return sum + (itemPrice - itemDiscount);
    }, 0);
    
    const expectedTotal = itemsTotal - data.discountAmount + data.shippingFee;
    return Math.abs(data.totalAmount - expectedTotal) < 0.01; // 부동소수점 오차 허용
  },
  { message: 'Total amount does not match calculation' }
);
```

## 다음 단계

- [자동 DLQ 처리 가이드](./auto-dlq-guide.md)
- [재시도 정책 커스터마이즈](./auto-dlq-guide.md#재시도-정책-커스터마이즈)
- [메인 README](../README.md)

