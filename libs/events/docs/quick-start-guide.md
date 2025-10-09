# 🚀 Events Module - 빠른 시작 가이드

Stream 기반 Kafka 이벤트 시스템을 5분 안에 시작하세요!

## 📋 목차

1. [사전 준비](#사전-준비)
2. [Stream 정의](#1-stream-정의)
3. [Publisher 설정](#2-publisher-설정-이벤트-발행)
4. [Consumer 설정](#3-consumer-설정-이벤트-수신)
5. [이벤트 타입 필터링](#4-이벤트-타입-필터링)
6. [환경 변수 설정](#5-환경-변수-설정)
7. [전체 예제](#6-전체-예제)

---

## 사전 준비

### Kafka 클러스터 (필수)

**옵션 A: Confluent Cloud (권장)**
1. https://confluent.cloud/ 계정 생성
2. 클러스터 생성
3. API Key/Secret 발급
4. 토픽 생성

**옵션 B: 로컬 Kafka**
```bash
docker run -d -p 9092:9092 apache/kafka:latest
```

### 의존성 설치

```bash
npm install @nestjs/microservices kafkajs
```

---

## 1. Stream 정의

`libs/shared/src/streams/` 디렉토리에 스트림을 정의합니다.

```typescript
// libs/shared/src/streams/orders.stream.ts
import { event, stream } from '@app/events';
import { z } from 'zod';

// 1️⃣ Payload 타입 정의
export interface OrderCreatedPayload {
  orderId: string;
  customerId: string;
  totalAmount: number;
  items: Array<{ skuId: string; quantity: number }>;
}

export interface OrderCancelledPayload {
  orderId: string;
  reason: string;
  cancelledBy: string;
}

// 2️⃣ Zod 스키마 정의 (선택사항이지만 권장)
const OrderCreatedSchema = z.object({
  orderId: z.string(),
  customerId: z.string(),
  totalAmount: z.number().positive(),
  items: z.array(z.object({
    skuId: z.string(),
    quantity: z.number().int().positive(),
  })),
});

const OrderCancelledSchema = z.object({
  orderId: z.string(),
  reason: z.string(),
  cancelledBy: z.string(),
});

// 3️⃣ Stream Config (타입 안전 버전)
export const ORDER_STREAM = stream({
  topic: 'orders.events.v1',
  partitions: 6,  // Confluent Cloud의 실제 파티션 수와 일치
  aggregateType: 'Order',
  events: {
    OrderCreated: event<'OrderCreated', OrderCreatedPayload>('OrderCreated', OrderCreatedSchema),
    OrderCancelled: event<'OrderCancelled', OrderCancelledPayload>('OrderCancelled', OrderCancelledSchema),
  },
});

// 4️⃣ 타입 추론
export type OrderEvents = typeof ORDER_STREAM.events;
```

---

## 2. Publisher 설정 (이벤트 발행)

### Module 설정

```typescript
// apps/my-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { ORDER_STREAM } from '@app/shared/streams';

@Module({
  imports: [
    EventsModule.forRoot({
      streams: [ORDER_STREAM],
      serviceName: process.env.SERVICE_NAME || 'my-service',
      // kafka 옵션은 생략 가능 (환경변수에서 자동 생성)
      validation: {
        validateOnPublish: true,  // 발행 시 스키마 검증
        throwOnValidationError: true,
      },
    }),
  ],
  // ...
})
export class AppModule {}
```

### Service에서 이벤트 발행

```typescript
// apps/my-service/src/orders/order.service.ts
import { Injectable } from '@nestjs/common';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import { ORDER_STREAM, OrderEvents } from '@app/shared/streams';

@Injectable()
export class OrderService {
  constructor(
    @InjectStreamPublisher('orders.events.v1')
    private readonly orderPublisher: StreamPublisher<OrderEvents>,
  ) {}

  async createOrder(dto: CreateOrderDto) {
    // 비즈니스 로직
    const order = await this.saveOrder(dto);

    // ✅ 이벤트 발행
    await this.orderPublisher.publishEvent({
      eventType: 'OrderCreated',
      aggregateId: order.id,
      payload: {
        orderId: order.id,
        customerId: order.customerId,
        totalAmount: order.totalAmount,
        items: order.items,
      },
      metadata: {
        source: 'order-service',
        action: 'create',
      },
    });

    return order;
  }
}
```

---

## 3. Consumer 설정 (이벤트 수신)

### 방법 A: forConsumerModule() - 자동 DLQ 처리 (권장)

**Module 설정:**

```typescript
// apps/my-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { ORDER_STREAM } from '@app/shared/streams';

@Module({
  imports: [
    EventsModule.forConsumerModule({
      streams: [ORDER_STREAM],
      groupId: 'my-service-orders-consumer',
      enableAutoDLQ: true,  // 자동 DLQ 처리
      validation: {
        validateOnConsume: true,  // 수신 시 스키마 검증
      },
    }),
  ],
  // ...
})
export class AppModule {}
```

### 방법 B: forConsumer() - main.ts에서 수동 연결

**main.ts:**

```typescript
// apps/my-service/src/main.ts
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { EventsModule } from '@app/events';
import { ORDER_STREAM } from '@app/shared/streams';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Kafka Microservice 연결
  const kafkaConfig = EventsModule.forConsumer({
    streams: [ORDER_STREAM],
    groupId: 'my-service-orders-consumer',
  });

  app.connectMicroservice<MicroserviceOptions>(kafkaConfig);
  await app.startAllMicroservices();

  await app.listen(3000);
}

bootstrap();
```

### Consumer 구현

```typescript
// apps/my-service/src/orders/order.consumer.ts
import { Controller, UseInterceptors } from '@nestjs/common';
import {
  OnEvent,
  EventPayload,
  EventEnvelope,
  EventMetadata,
  MessageEnvelope,
  EventTypeGuard,  // 이벤트 타입 필터링
  RetryPolicy,     // 재시도 정책
} from '@app/events';
import { OrderCreatedPayload } from '@app/shared/streams';

@Controller()
@UseInterceptors(EventTypeGuard)  // ← 이벤트 타입 필터링 활성화
export class OrderConsumer {
  constructor(private readonly inventoryService: InventoryService) {}

  /**
   * OrderCreated 이벤트 처리
   */
  @OnEvent('orders.events.v1', 'OrderCreated')
  @RetryPolicy({ maxAttempts: 3, backoff: 'exponential' })  // 재시도 정책
  async handleOrderCreated(
    @EventPayload() payload: OrderCreatedPayload,
    @EventEnvelope() envelope: MessageEnvelope<OrderCreatedPayload>,
    @EventMetadata() metadata: Record<string, unknown>,
  ) {
    console.log('📥 Order Created:', payload.orderId);

    // 비즈니스 로직
    await this.inventoryService.reserveStock(payload.items);

    console.log('✅ Stock reserved for order:', payload.orderId);
  }

  /**
   * OrderCancelled 이벤트 처리
   */
  @OnEvent('orders.events.v1', 'OrderCancelled')
  @RetryPolicy({ maxAttempts: 3 })
  async handleOrderCancelled(
    @EventPayload() payload: OrderCancelledPayload,
  ) {
    console.log('📥 Order Cancelled:', payload.orderId);

    await this.inventoryService.releaseStock(payload.orderId);

    console.log('✅ Stock released for order:', payload.orderId);
  }
}
```

---

## 4. 이벤트 타입 필터링

`@UseInterceptors(EventTypeGuard)`를 사용하면:
- `@OnEvent`에 지정한 이벤트 타입만 처리
- 다른 이벤트는 조용히 무시 (에러 없이)
- Offset commit 정상 처리

**없으면 어떻게 되나요?**
- 모든 핸들러가 모든 메시지에 대해 호출됨
- payload가 맞지 않으면 undefined 발생

**꼭 사용하세요!** ✅

---

## 5. 환경 변수 설정

### 환경 변수 로딩 (중요!)

**main.ts 파일의 최상단에서 로딩:**

```typescript
// ⚠️ 중요: dotenv는 다른 import보다 먼저!
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

---

## 6. 전체 예제

완전한 예제는 `apps/events-test` 앱을 참고하세요:

```bash
# 앱 구조
apps/events-test/
├── .env                    # 환경 변수
├── .env.local.example      # 로컬 개발용 예시
├── .env.confluent.example  # Confluent Cloud용 예시
├── src/
│   ├── main.ts            # 앱 진입점 (환경변수 로딩)
│   ├── test.module.ts     # Module 설정
│   ├── test.service.ts    # Publisher
│   ├── test.consumer.ts   # Consumer
│   └── test.controller.ts # HTTP API
└── README.md              # 상세 가이드
```

**실행:**

```bash
# 1. 환경 변수 설정
cd apps/events-test
cp .env.confluent.example .env
# .env 파일 수정 (실제 값 입력)

# 2. Confluent Cloud에서 토픽 생성
# - test.events.v1 (partitions: 6)
# - test.events.v1.dlq (partitions: 1)

# 3. 앱 실행
npm run start:events-test:dev

# 4. 이벤트 발행 테스트
curl -X POST http://localhost:3100/test/create \
  -H "Content-Type: application/json" \
  -d '{"testId":"test-001","message":"Hello Events!"}'

# 5. 로그 확인
# 🚨🚨🚨 CONSUMER CALLED!
# 📥 Consumed: TestEventCreated
```

---

## 🎯 체크리스트

구현 전 확인하세요:

- [ ] Kafka 클러스터 준비 (Confluent Cloud 또는 로컬)
- [ ] 토픽 생성 (main + dlq)
- [ ] Stream 정의 (payload 타입 + 스키마)
- [ ] 환경 변수 설정 (.env 파일)
- [ ] Publisher 설정 (EventsModule.forRoot)
- [ ] Consumer 설정 (forConsumerModule 또는 forConsumer)
- [ ] Consumer에 `@UseInterceptors(EventTypeGuard)` 추가
- [ ] 이벤트 핸들러에 `@OnEvent` 데코레이터
- [ ] 재시도 정책 설정 (`@RetryPolicy`)

---

## 📚 더 알아보기

- [전체 README](../README.md) - 모든 기능 상세 설명
- [Schema Validation Guide](./schema-validation-guide.md) - Zod 스키마 검증
- [Graceful Shutdown Guide](./graceful-shutdown-guide.md) - 안전한 종료
- [First Look](./first-look.md) - 아키텍처 평가

---

## 🆘 문제 해결

### Consumer가 메시지를 받지 못해요

1. **Consumer가 controllers 배열에 등록되었나요?**
   ```typescript
   @Module({
     controllers: [MyController, MyConsumer],  // ← MyConsumer 추가!
     providers: [MyService],
   })
   ```

2. **EventTypeGuard를 사용하고 있나요?**
   ```typescript
   @Controller()
   @UseInterceptors(EventTypeGuard)  // ← 필수!
   export class MyConsumer {}
   ```

3. **환경변수가 로딩되었나요?**
   - main.ts 최상단에서 `dotenv.config()` 호출 확인

4. **Confluent Cloud ACL 권한이 있나요?**
   - API Key에 토픽 READ 권한 확인

### 같은 메시지를 계속 처리해요

- **원인:** 핸들러에서 에러 발생 → Offset commit 실패
- **해결:** 
  - `@RetryPolicy` 추가
  - `enableAutoDLQ: true` 설정
  - 에러 로그 확인

### Confluent Cloud 토픽은 어떻게 만드나요?

1. https://confluent.cloud/ 로그인
2. 클러스터 선택
3. Topics → Create topic
4. Topic name: `your-stream.events.v1`
5. Partitions: 6 (권장)
6. Create 클릭
7. DLQ 토픽도 동일하게: `your-stream.events.v1.dlq`

---

**이제 시작하세요!** 🚀

