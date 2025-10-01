# @app/events - Stream-based Event Module

도메인 스트림 기반 Kafka 이벤트 시스템

## 🎯 핵심 개념

### Stream-based Topics
하나의 토픽에 여러 이벤트 타입을 포함하는 구조:
- ❌ **기존**: `user.created`, `user.updated`, `user.deleted` (토픽 3개)
- ✅ **개선**: `users.events.v1` (토픽 1개, 이벤트 타입 3개)

### Message Envelope
모든 메시지는 표준 Envelope로 감싸짐:
```typescript
{
  messageId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  messageType: "OrderCreated",
  messageKind: "event",
  payload: { ... },
  source: {
    service: "wms-order",
    aggregateType: "Order",
    aggregateId: "ORD-123"
  }
}
```

## 📦 설치

```bash
npm install @nestjs/microservices kafkajs ulid zod
```

## 📚 문서

- **[빠른 시작 가이드](./docs/quick-start-guide.md)** ⭐ 처음 사용자 필독!
- **[문제 해결 가이드](./docs/troubleshooting.md)** 🆘 문제가 있을 때
- [Schema Validation Guide](./docs/schema-validation-guide.md) - Zod 스키마 검증
- [Graceful Shutdown Guide](./docs/graceful-shutdown-guide.md) - 안전한 종료
- [First Look](./docs/first-look.md) - 아키텍처 평가

## 💡 주요 업데이트

### v1.1.0 (2025-10-01)
- ✅ **EventTypeGuard** 추가 - 이벤트 타입 필터링 (필수!)
- ✅ **환경변수 네이밍 통일** - `KAFKA_API_KEY`/`KAFKA_API_SECRET`
- ✅ **JSON 파싱 개선** - NestJS 자동 파싱 지원
- ✅ **에러 처리 개선** - `of(undefined)` 사용으로 깔끔한 필터링
- ✅ **완전한 예제** - `apps/events-test` 앱 제공

## 🚀 빠른 시작

> 💡 **처음 사용하시나요?** [빠른 시작 가이드](./docs/quick-start-guide.md)를 먼저 읽어보세요!

### 1. Stream 정의 (libs/shared/src/streams/)

```typescript
// libs/shared/src/streams/orders.stream.ts
import { StreamConfig, EventType } from '@app/events';

// 이벤트 페이로드 타입 정의
export interface OrderCreatedPayload {
  orderId: string;
  customerId: string;
  items: Array<{ skuId: string; quantity: number }>;
  totalAmount: number;
}

export interface OrderCancelledPayload {
  orderId: string;
  reason: string;
  cancelledBy: string;
}

// 이벤트 타입 맵
export type OrderEvents = {
  OrderCreated: EventType<OrderCreatedPayload>;
  OrderCancelled: EventType<OrderCancelledPayload>;
};

// Stream 설정
export const ORDER_STREAM: StreamConfig<OrderEvents> = {
  topic: {
    topic: 'orders.events.v1',
    partitions: 12,
  },
  aggregateType: 'Order',
  events: {
    OrderCreated: {
      messageType: 'OrderCreated',
      payloadType: {} as OrderCreatedPayload,
    },
    OrderCancelled: {
      messageType: 'OrderCancelled',
      payloadType: {} as OrderCancelledPayload,
    },
  },
};
```

### 2. Publisher 설정 (이벤트 발행 서비스)

```typescript
// apps/wms/src/order/order.module.ts
import { Module } from '@nestjs/common';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { ORDER_STREAM } from '@app/shared/streams/orders.stream';

@Module({
  imports: [
    EventsModule.forRoot({
      kafka: createKafkaConfigFromEnv({
        KAFKA_CLIENT_ID: 'wms-order-publisher',
        KAFKA_BROKERS: process.env.KAFKA_BROKERS!,
      }),
      streams: [ORDER_STREAM],
      serviceName: 'wms-order',
    }),
  ],
})
export class OrderModule {}
```

### 3. 이벤트 발행

```typescript
// apps/wms/src/order/services/order.service.ts
import { Injectable } from '@nestjs/common';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import { ORDER_STREAM, OrderEvents } from '@app/shared/streams/orders.stream';

@Injectable()
export class OrderService {
  constructor(
    @InjectStreamPublisher('orders.events.v1')
    private readonly orderPublisher: StreamPublisher<OrderEvents>,
  ) {}

  async createOrder(dto: CreateOrderDto) {
    const order = await this.saveOrder(dto);

    // 이벤트 발행
    await this.orderPublisher.publishEvent({
      eventType: 'OrderCreated',
      aggregateId: order.id,
      payload: {
        orderId: order.id,
        customerId: order.customerId,
        items: order.items,
        totalAmount: order.totalAmount,
      },
    });

    return order;
  }

  async cancelOrder(orderId: string, reason: string) {
    await this.updateOrderStatus(orderId, 'cancelled');

    await this.orderPublisher.publishEvent({
      eventType: 'OrderCancelled',
      aggregateId: orderId,
      payload: {
        orderId,
        reason,
        cancelledBy: 'admin',
      },
    });
  }
}
```

### 4. Consumer 설정 (이벤트 구독 서비스)

```typescript
// apps/channel-adapter/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AdapterModule } from './adapter.module';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { ORDER_STREAM } from '@app/shared/streams/orders.stream';

async function bootstrap() {
  const app = await NestFactory.create(AdapterModule);

  // Kafka Consumer 연결
  const consumerOptions = EventsModule.forConsumer({
    kafka: createKafkaConfigFromEnv({
      KAFKA_CLIENT_ID: 'channel-adapter-consumer',
      KAFKA_BROKERS: process.env.KAFKA_BROKERS!,
    }),
    streams: [ORDER_STREAM],
    groupId: 'channel-adapter-consumers',
  });

  app.connectMicroservice(consumerOptions);

  await app.startAllMicroservices();
  await app.listen(3003);
}
bootstrap();
```

### 5. 이벤트 핸들러 구현

**⚠️ 중요:** Consumer는 반드시 `controllers` 배열에 등록하고, `@UseInterceptors(EventTypeGuard)`를 추가해야 합니다!

```typescript
// apps/channel-adapter/src/consumers/order-events.consumer.ts
import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { 
  OnEvent, 
  EventPayload, 
  EventMetadata,
  EventTypeGuard,  // ← 이벤트 타입 필터링 (필수!)
  RetryPolicy,     // ← 재시도 정책 (권장)
} from '@app/events';
import { OrderCreatedPayload, OrderCancelledPayload } from '@app/shared/streams/orders.stream';

@Controller()
@UseInterceptors(EventTypeGuard)  // ← 반드시 추가! (이벤트 타입 필터링)
export class OrderEventsConsumer {
  private readonly logger = new Logger(OrderEventsConsumer.name);

  @OnEvent('orders.events.v1', 'OrderCreated')
  @RetryPolicy({ maxAttempts: 3, backoff: 'exponential' })  // ← 재시도 정책
  async handleOrderCreated(
    @EventPayload() payload: OrderCreatedPayload,
    @EventMetadata() metadata: any,
  ) {
    this.logger.log(`Order created: ${payload.orderId}`, {
      correlationId: metadata.correlationId,
    });

    // 채널로 주문 동기화
    await this.syncOrderToChannels(payload);
  }

  @OnEvent('orders.events.v1', 'OrderCancelled')
  async handleOrderCancelled(
    @EventPayload() payload: OrderCancelledPayload,
  ) {
    this.logger.log(`Order cancelled: ${payload.orderId}`);

    // 채널에 취소 상태 전송
    await this.notifyOrderCancellation(payload);
  }

  private async syncOrderToChannels(order: OrderCreatedPayload) {
    // 구현...
  }

  private async notifyOrderCancellation(order: OrderCancelledPayload) {
    // 구현...
  }
}
```

## 📚 고급 기능

### 배치 이벤트 발행

```typescript
await this.orderPublisher.publishEvents([
  { eventType: 'OrderCreated', aggregateId: 'ORD-1', payload: {...} },
  { eventType: 'OrderCreated', aggregateId: 'ORD-2', payload: {...} },
  { eventType: 'OrderCreated', aggregateId: 'ORD-3', payload: {...} },
]);
```

### Correlation ID 전파

```typescript
await this.orderPublisher.publishEvent({
  eventType: 'OrderCreated',
  aggregateId: orderId,
  payload: {...},
  correlationId: request.correlationId,  // 요청에서 전달받은 ID
  causationId: previousEventId,          // 이전 이벤트 ID
});
```

### Aggregate Version (Event Sourcing)

```typescript
await this.orderPublisher.publishEvent({
  eventType: 'OrderCreated',
  aggregateId: orderId,
  aggregateVersion: 1,                   // Event Sourcing용
  payload: {...},
});
```

### 커맨드 발행

```typescript
await this.orderPublisher.publishCommand({
  commandType: 'ProcessOrder',
  aggregateId: orderId,
  payload: { orderId },
  expiresIn: 60000,                      // 1분 후 만료
});
```

### 자동 DLQ 처리 (권장) ⭐

```typescript
// 1. Consumer Module에서 자동 DLQ 활성화
@Module({
  imports: [
    EventsModule.forConsumerModule({
      streams: [ORDER_STREAM],
      groupId: 'order-consumer',
      enableAutoDLQ: true,  // 자동 DLQ 처리 (기본값: true)
    }),
  ],
})
export class AppModule {}

// 2. 핸들러에서 try-catch 불필요!
@Controller()
export class OrderEventsConsumer {
  @OnEvent('orders.events.v1', 'OrderCreated')
  async handleOrderCreated(@EventPayload() payload: OrderCreatedPayload) {
    // 에러 발생 시:
    // 1. 자동으로 3번 재시도 (exponential backoff)
    // 2. 재시도 실패 시 DLQ로 자동 전송
    await this.processOrder(payload);
  }

  @OnEvent('orders.events.v1', 'OrderUpdated')
  @RetryPolicy({ maxRetries: 5, backoff: 'exponential' })
  async handleOrderUpdated(@EventPayload() payload: OrderUpdatedPayload) {
    // 핸들러별 재시도 정책 커스터마이즈
    await this.updateOrder(payload);
  }
}
```

상세 가이드: [자동 DLQ 처리 가이드](./docs/auto-dlq-guide.md)

### 스키마 검증 (Schema Validation) ⭐

```typescript
// 1. Zod 스키마 정의 (libs/shared/src/streams/orders.stream.ts)
import { z } from 'zod';

const OrderCreatedSchema = z.object({
  orderId: z.string().uuid(),
  customerId: z.string().uuid(),
  totalAmount: z.number().positive(),
});

type OrderCreatedPayload = z.infer<typeof OrderCreatedSchema>;

export const ORDER_STREAM: StreamConfig<OrderEvents> = {
  events: {
    OrderCreated: {
      messageType: 'OrderCreated',
      payloadType: {} as OrderCreatedPayload,
      schema: OrderCreatedSchema,  // ✅ 스키마 추가!
    },
  },
};

// 2. Publisher (발행 시 자동 검증)
EventsModule.forRoot({
  streams: [ORDER_STREAM],
  validation: { validateOnPublish: true },  // 기본값: true
});

await publisher.publishEvent({
  eventType: 'OrderCreated',
  aggregateId: 'order-123',
  payload: { orderId: 'invalid-uuid', ... },  // ❌ 검증 실패 → SchemaValidationError
});

// 3. Consumer (수신 시 자동 검증)
EventsModule.forConsumerModule({
  streams: [ORDER_STREAM],
  validation: { validateOnConsume: true },  // 기본값: true
});

@OnEvent('orders.events.v1', 'OrderCreated')
async handleOrderCreated(@EventPayload() payload: OrderCreatedPayload) {
  // ✅ 이 시점에 payload는 이미 스키마 검증 완료!
  // ✅ 타입 안전성 + 런타임 검증 보장
}
```

**검증 실패 시**: 재시도 없이 즉시 DLQ로 전송

상세 가이드: [스키마 검증 가이드](./docs/schema-validation-guide.md)

### Graceful Shutdown ⭐

```typescript
// 1. main.ts에서 shutdown hooks 활성화 (필수!)
const app = await NestFactory.create(AppModule);
app.enableShutdownHooks();  // ✅ 필수!
await app.listen(3000);

// 2. EventsModule 사용 시 자동으로 활성화됨!
EventsModule.forRoot({
  streams: [ORDER_STREAM],
});

// 애플리케이션 종료 시:
// 1. In-flight 메시지 처리 완료 대기
// 2. Kafka producer/consumer graceful disconnect
// 3. 최대 30초 타임아웃
```

**종료 로그 예시**:
```
[GracefulShutdownService] 🛑 Graceful shutdown initiated (signal: SIGTERM)
[GracefulShutdownService] Disconnecting Kafka client...
[GracefulShutdownService] ✅ Kafka client disconnected
[GracefulShutdownService] ✅ Graceful shutdown completed
```

상세 가이드: [Graceful Shutdown 가이드](./docs/graceful-shutdown-guide.md)

### 수동 DLQ 처리

```typescript
import { DLQHandler, DisableDLQ } from '@app/events';

@Injectable()
export class MyConsumer {
  constructor(private readonly dlqHandler: DLQHandler) {}

  @OnEvent('orders.events.v1', 'OrderCreated')
  @DisableDLQ()  // 자동 DLQ 비활성화
  async handleOrderCreated(@EventEnvelope() envelope: DomainEvent) {
    try {
      await this.processOrder(envelope.payload);
    } catch (error) {
      // 수동으로 DLQ 전송 (커스텀 로직 가능)
      await this.dlqHandler.sendToDLQ({
        originalTopic: 'orders.events.v1',
        originalMessage: envelope,
        error,
        context: {
          partition: 0,
          offset: '12345',
          consumer: 'OrderEventsConsumer',
          retryCount: 3,
        },
      });

      throw error;
    }
  }
}
```

## 🏗️ 프로젝트 구조

```
libs/events/src/
├── envelope.types.ts              # MessageEnvelope, DomainEvent, DomainCommand
├── stream-config.types.ts         # StreamConfig, KafkaConfig (Zod schema 지원)
├── events.module.ts               # EventsModule (forRoot, forConsumer, forConsumerModule)
├── publishers/
│   └── stream-publisher.service.ts# 스키마 검증 포함
├── consumers/
│   └── decorators.ts              # @OnEvent, @EventPayload, etc.
├── dlq/
│   ├── dlq.types.ts
│   └── dlq-handler.service.ts
├── retry/
│   ├── retry-policy.types.ts      # 재시도 정책 타입
│   ├── retry-policy.decorator.ts  # @RetryPolicy, @DisableDLQ
│   └── retry.util.ts              # 재시도 로직
├── filters/
│   └── events-exception.filter.ts # 자동 DLQ 처리 필터
├── validation/
│   ├── schema-validation.types.ts # Zod 스키마 타입
│   └── schema-validation.util.ts  # 스키마 검증 유틸리티
├── interceptors/
│   └── schema-validation.interceptor.ts # Consumer 스키마 검증
├── shutdown/
│   └── graceful-shutdown.service.ts # Graceful shutdown 처리
├── utils/
│   └── message-id.util.ts         # ULID 생성
└── docs/
    ├── auto-dlq-guide.md          # 자동 DLQ 가이드
    ├── schema-validation-guide.md # 스키마 검증 가이드
    └── graceful-shutdown-guide.md # Graceful shutdown 가이드

libs/shared/src/streams/           # 공통 Stream 정의
├── orders.stream.ts
├── inventory.stream.ts
├── inventory-with-schema.example.ts # Zod 스키마 예시
├── payments.stream.ts
└── users.stream.ts
```

## 🔧 환경 변수

### Confluent Cloud

```env
SERVICE_NAME=my-service
KAFKA_BROKERS=pkc-xxxxx.region.aws.confluent.cloud:9092
KAFKA_API_KEY=your-api-key          # 신규 표준 네이밍
KAFKA_API_SECRET=your-api-secret    # 신규 표준 네이밍
KAFKA_CLIENT_ID=my-service
KAFKA_GROUP_ID=my-consumer-group

# 또는 레거시 네이밍 (하위 호환)
# KAFKA_SASL_USERNAME=your-api-key
# KAFKA_SASL_PASSWORD=your-api-secret
```

### 로컬 Kafka

```env
SERVICE_NAME=my-service
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=my-service
KAFKA_GROUP_ID=my-consumer-group
# 로컬에서는 인증 불필요
```

### ⚠️ 환경변수 로딩 주의

**main.ts 최상단에서 로딩:**

```typescript
// ⚠️ 반드시 다른 import보다 먼저!
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ 
  path: path.resolve(process.cwd(), 'apps/my-service/.env'),
  override: true 
});

// 환경변수 로딩 후 다른 모듈 import
import { NestFactory } from '@nestjs/core';
// ...
```

## 📊 토픽 네이밍 컨벤션

```
{domain}.{type}.v{version}

orders.events.v1         # 주문 이벤트
orders.commands.v1       # 주문 커맨드
orders.events.v1.dlq     # 주문 이벤트 DLQ

inventory.events.v1
payments.events.v1
users.events.v1
```

## 🎯 Best Practices

1. **Shutdown Hooks 활성화**: `app.enableShutdownHooks()` 필수 호출 (main.ts)
2. **자동 DLQ 활성화**: `forConsumerModule()`로 자동 DLQ 처리 활성화 (권장)
3. **스키마 검증 적용**: 중요한 이벤트에 Zod 스키마 추가 (런타임 검증)
4. **Aggregate ID 기반 파티셔닝**: 같은 Order의 이벤트는 같은 파티션으로 → 순서 보장
5. **Idempotency**: `messageId`로 중복 처리 방지 (핸들러는 멱등해야 함)
6. **Correlation ID**: 전체 플로우 추적
7. **재시도 정책 커스터마이즈**: 핸들러별로 적절한 재시도 정책 설정
8. **타입 안전성**: TypeScript 타입 + Zod 스키마로 완벽한 타입 안전성
9. **DLQ 모니터링**: DLQ 메시지는 별도 알림 및 재처리 프로세스 구축
10. **선택적 스키마 적용**: 모든 이벤트에 스키마를 적용할 필요는 없음 (핵심 이벤트 우선)
11. **Graceful Shutdown 테스트**: 프로덕션 배포 전 종료 테스트 필수

## 🐛 트러블슈팅

### Consumer가 메시지를 받지 못할 때
```typescript
// main.ts에서 connectMicroservice() 확인
app.connectMicroservice(EventsModule.forConsumer({...}));
await app.startAllMicroservices();  // 이거 필수!
```

### 타입 에러
```typescript
// StreamConfig 타입을 명시적으로 지정
export const ORDER_STREAM: StreamConfig<OrderEvents> = { ... };
```

### DLQ 토픽이 없다는 에러
- Kafka에서 자동 토픽 생성이 비활성화되어 있는 경우
- 수동으로 DLQ 토픽 생성: `orders.events.v1.dlq`
