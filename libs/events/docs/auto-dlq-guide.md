# 자동 DLQ 처리 가이드

## 개요

이벤트 핸들러에서 에러가 발생했을 때 자동으로 재시도하고, 재시도 실패 시 DLQ로 전송하는 기능입니다.

## 주요 기능

- ✅ **자동 재시도**: 핸들러 에러 발생 시 자동으로 재시도 (기본 3회)
- ✅ **백오프 전략**: Fixed, Linear, Exponential 백오프 지원
- ✅ **자동 DLQ 전송**: 재시도 실패 시 자동으로 DLQ로 전송
- ✅ **핸들러별 정책**: 데코레이터로 핸들러별 재시도 정책 커스터마이즈
- ✅ **에러 타입 필터링**: 특정 에러만 재시도하거나 제외 가능
- ✅ **Try-Catch 불필요**: 핸들러 코드가 깔끔해짐

## 사용 방법

### 1. Consumer Module 등록 (자동 DLQ 활성화)

```typescript
// apps/your-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { ORDER_STREAM } from '@app/shared/streams/orders.stream';

@Module({
  imports: [
    EventsModule.forConsumerModule({
      streams: [ORDER_STREAM],
      groupId: 'your-service-consumers',
      enableAutoDLQ: true,  // 자동 DLQ 처리 활성화 (기본값: true)
    }),
  ],
})
export class AppModule {}
```

### 2. main.ts에서 Consumer 연결

```typescript
// apps/your-service/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { EventsModule } from '@app/events';
import { ORDER_STREAM } from '@app/shared/streams/orders.stream';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Kafka Consumer 연결
  const consumerOptions = EventsModule.forConsumer({
    streams: [ORDER_STREAM],
    groupId: 'your-service-consumers',
  });

  app.connectMicroservice(consumerOptions);
  await app.startAllMicroservices();

  await app.listen(3000);
}
bootstrap();
```

### 3. 기본 핸들러 (자동 DLQ 적용)

```typescript
import { Controller, Logger } from '@nestjs/common';
import { OnEvent, EventPayload } from '@app/events';
import { OrderCreatedPayload } from '@app/shared/streams/orders.stream';

@Controller()
export class OrderEventsConsumer {
  private readonly logger = new Logger(OrderEventsConsumer.name);

  @OnEvent('orders.events.v1', 'OrderCreated')
  async handleOrderCreated(@EventPayload() payload: OrderCreatedPayload) {
    // 에러가 발생하면:
    // 1. 자동으로 3번 재시도 (exponential backoff)
    // 2. 재시도 실패 시 DLQ로 자동 전송
    // 3. 핸들러에서 try-catch 불필요!
    
    if (!payload.customerId) {
      throw new Error('Customer ID is required'); // 자동으로 재시도됨
    }

    await this.processOrder(payload);
  }

  private async processOrder(payload: OrderCreatedPayload) {
    // 비즈니스 로직
  }
}
```

### 4. 재시도 정책 커스터마이즈

```typescript
import { Controller } from '@nestjs/common';
import { OnEvent, EventPayload, RetryPolicy } from '@app/events';

@Controller()
export class OrderEventsConsumer {
  @OnEvent('orders.events.v1', 'OrderCreated')
  @RetryPolicy({
    maxRetries: 5,              // 5번 재시도
    backoff: 'exponential',     // 지수 백오프 (1s, 2s, 4s, 8s, 16s)
    initialDelayMs: 2000,       // 초기 지연 2초
    maxDelayMs: 60000,          // 최대 지연 60초
  })
  async handleOrderCreated(@EventPayload() payload: OrderCreatedPayload) {
    await this.processOrder(payload);
  }

  @OnEvent('orders.events.v1', 'OrderCancelled')
  @RetryPolicy({
    maxRetries: 3,
    backoff: 'linear',          // 선형 백오프 (1s, 2s, 3s)
  })
  async handleOrderCancelled(@EventPayload() payload: OrderCancelledPayload) {
    await this.cancelOrder(payload);
  }
}
```

### 5. 백오프 전략

#### Exponential (기본값)
```typescript
@RetryPolicy({ backoff: 'exponential', initialDelayMs: 1000 })
// 재시도 간격: 1s, 2s, 4s, 8s, 16s, ...
```

#### Linear
```typescript
@RetryPolicy({ backoff: 'linear', initialDelayMs: 1000 })
// 재시도 간격: 1s, 2s, 3s, 4s, 5s, ...
```

#### Fixed
```typescript
@RetryPolicy({ backoff: 'fixed', initialDelayMs: 5000 })
// 재시도 간격: 5s, 5s, 5s, 5s, ...
```

### 6. 에러 타입 필터링

```typescript
class ValidationError extends Error {}
class NetworkError extends Error {}
class FatalError extends Error {}

@Controller()
export class OrderEventsConsumer {
  // 특정 에러만 재시도
  @OnEvent('orders.events.v1', 'OrderCreated')
  @RetryPolicy({
    maxRetries: 5,
    retryableErrors: [NetworkError, TimeoutError],  // 이 에러들만 재시도
  })
  async handleWithRetryableErrors(@EventPayload() payload: any) {
    // NetworkError → 재시도
    // FatalError → 즉시 DLQ로
  }

  // 특정 에러는 재시도 안 함
  @OnEvent('orders.events.v1', 'OrderUpdated')
  @RetryPolicy({
    maxRetries: 3,
    nonRetryableErrors: [ValidationError, FatalError],  // 이 에러들은 재시도 안함
  })
  async handleWithNonRetryableErrors(@EventPayload() payload: any) {
    // ValidationError → 즉시 DLQ로
    // NetworkError → 재시도
  }
}
```

### 7. DLQ 비활성화 (중요하지 않은 이벤트)

```typescript
import { OnEvent, EventPayload, DisableDLQ } from '@app/events';

@Controller()
export class AnalyticsEventsConsumer {
  @OnEvent('analytics.events.v1', 'PageView')
  @DisableDLQ()  // 실패해도 DLQ에 보내지 않음 (버림)
  async handlePageView(@EventPayload() payload: PageViewPayload) {
    // 중요하지 않은 이벤트는 실패해도 괜찮음
    await this.trackPageView(payload);
  }
}
```

### 8. 수동 DLQ 처리 (필요한 경우)

```typescript
import { Controller, Logger } from '@nestjs/common';
import { OnEvent, EventEnvelope, DisableDLQ, DLQHandler } from '@app/events';

@Controller()
export class CustomDLQConsumer {
  constructor(private readonly dlqHandler: DLQHandler) {}

  @OnEvent('orders.events.v1', 'OrderCreated')
  @DisableDLQ()  // 자동 DLQ 비활성화
  async handleOrderCreated(@EventEnvelope() envelope: DomainEvent) {
    try {
      await this.processOrder(envelope.payload);
    } catch (error) {
      // 커스텀 로직으로 DLQ 전송
      if (this.shouldSendToDLQ(error)) {
        await this.dlqHandler.sendToDLQ({
          originalTopic: 'orders.events.v1',
          originalMessage: envelope,
          error,
          context: {
            partition: 0,
            offset: '12345',
            consumer: 'CustomDLQConsumer',
            retryCount: 0,
          },
        });
      }

      throw error;
    }
  }

  private shouldSendToDLQ(error: Error): boolean {
    // 커스텀 로직
    return error.name !== 'ValidationError';
  }
}
```

## 작동 원리

1. **에러 발생**: 핸들러에서 에러가 throw됨
2. **Exception Filter 캐치**: `EventsExceptionFilter`가 에러를 자동으로 캐치
3. **재시도 정책 조회**: 핸들러의 `@RetryPolicy` 메타데이터 조회
4. **재시도 실행**: 백오프 전략에 따라 재시도
5. **재시도 성공**: 정상 처리됨, Kafka offset commit
6. **재시도 실패**: DLQ로 자동 전송, Kafka offset commit
7. **로그 기록**: 모든 과정이 상세히 로깅됨

## 기본 설정

```typescript
// 기본 재시도 정책
{
  maxRetries: 3,
  backoff: 'exponential',
  initialDelayMs: 1000,
  maxDelayMs: 30000,
}
```

## 로그 예시

```
[EventsExceptionFilter] Event handler failed: handleOrderCreated
  error: "Customer ID is required"
  topic: "orders.events.v1"
  partition: 0
  offset: "12345"

[EventsExceptionFilter] Retrying in 1000ms... (attempt 1/3)
[EventsExceptionFilter] Retrying in 2000ms... (attempt 2/3)
[EventsExceptionFilter] ✅ Retry succeeded on attempt 2

--- 또는 ---

[EventsExceptionFilter] Retrying in 1000ms... (attempt 1/3)
[EventsExceptionFilter] Retrying in 2000ms... (attempt 2/3)
[EventsExceptionFilter] Retrying in 4000ms... (attempt 3/3)
[DLQHandler] 📤 Message sent to DLQ after 3 failed attempts
[EventsExceptionFilter] ❌ Handler failed after 3 retries: handleOrderCreated
```

## 주의사항

1. **멱등성**: 재시도되므로 핸들러 로직은 멱등해야 함
2. **타임아웃**: Kafka `max.poll.interval.ms` 내에 재시도가 완료되어야 함
3. **DLQ 토픽**: DLQ 토픽(`{topic}.dlq`)이 사전에 생성되어 있어야 함
4. **로그 모니터링**: DLQ로 전송된 메시지는 별도 모니터링 필요

## 마이그레이션 가이드

### Before (수동 DLQ 처리)
```typescript
@OnEvent('orders.events.v1', 'OrderCreated')
async handleOrderCreated(@EventEnvelope() envelope: DomainEvent) {
  try {
    await this.processOrder(envelope.payload);
  } catch (error) {
    await this.dlqHandler.sendToDLQ({
      originalTopic: 'orders.events.v1',
      originalMessage: envelope,
      error,
      context: { /* ... */ },
    });
    throw error;
  }
}
```

### After (자동 DLQ 처리)
```typescript
@OnEvent('orders.events.v1', 'OrderCreated')
async handleOrderCreated(@EventPayload() payload: OrderCreatedPayload) {
  // try-catch 불필요!
  await this.processOrder(payload);
}
```

## FAQ

**Q: 재시도 중에도 다른 메시지를 처리하나요?**  
A: 아니요. 재시도는 동기적으로 실행되며, 해당 파티션의 메시지 처리가 블록됩니다.

**Q: DLQ 전송 실패 시 어떻게 되나요?**  
A: DLQ 전송 실패는 치명적이므로 에러를 다시 던져서 Kafka가 메시지를 재전달하도록 합니다.

**Q: 모든 핸들러에 자동 DLQ가 적용되나요?**  
A: 네, `enableAutoDLQ: true`로 설정하면 모든 핸들러에 자동 적용됩니다. 개별 핸들러에서 `@DisableDLQ()`로 비활성화할 수 있습니다.

**Q: 재시도 정책을 글로벌로 설정할 수 있나요?**  
A: 현재는 핸들러별로만 설정 가능합니다. 글로벌 설정은 추후 추가 예정입니다.

