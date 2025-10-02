# Transactional Outbox Pattern

## 개요

마이크로서비스 아키텍처에서 **DB 트랜잭션**과 **이벤트 발행**의 원자성을 보장하기 위한 패턴입니다.

### 해결하려는 문제: Dual Write Problem

```typescript
// ❌ 문제 상황
async createOrder(dto: CreateOrderDto) {
  // 1. DB에 저장 (성공)
  await this.db.transaction(async (tx) => {
    await tx.insert(orders).values(orderData);
  });

  // 2. 이벤트 발행 (네트워크 장애로 실패!)
  await this.publisher.publishEvent({...});

  // 결과: DB에는 저장됨, 이벤트는 발행 안됨 → 데이터 불일치!
}
```

### Outbox 패턴의 해결책

```
┌─────────────────────────────────────┐
│  비즈니스 트랜잭션                   │
│  ┌──────────────────────────────┐   │
│  │ 1. orders 테이블에 INSERT    │   │
│  │ 2. outbox_events에 INSERT    │   │  ← 같은 트랜잭션!
│  └──────────────────────────────┘   │
│           COMMIT (원자적)            │
└─────────────────────────────────────┘
              ↓
         (트랜잭션 밖)
              ↓
┌─────────────────────────────────────┐
│  OutboxDispatcher (@Cron)           │
│  - outbox_events 폴링               │
│  - Kafka로 발행                     │
│  - 성공 시 PUBLISHED 상태 변경      │
└─────────────────────────────────────┘
```

---

## 아키텍처

### 1. Outbox 테이블 스키마

```typescript
// apps/wms/database/schemas/outbox.schema.ts
import { pgTable, serial, varchar, jsonb, timestamp, integer, text } from 'drizzle-orm/pg-core';

export const outbox_events = pgTable('outbox_events', {
  id: serial('id').primaryKey(),

  // 이벤트 식별
  aggregateType: varchar('aggregate_type', { length: 50 }).notNull(),  // 'Order', 'Stock'
  aggregateId: varchar('aggregate_id', { length: 100 }).notNull(),     // 'ORD-123'
  eventType: varchar('event_type', { length: 100 }).notNull(),         // 'OrderCreated'

  // 페이로드
  payload: jsonb('payload').notNull(),
  metadata: jsonb('metadata'),

  // 추적 정보
  correlationId: varchar('correlation_id', { length: 100 }),
  causationId: varchar('causation_id', { length: 100 }),

  // 상태 관리
  status: varchar('status', { length: 20 }).notNull().default('PENDING'),
  // 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED'

  // 타임스탬프
  createdAt: timestamp('created_at').notNull().defaultNow(),
  publishedAt: timestamp('published_at'),
  failedAt: timestamp('failed_at'),

  // 재시도 관리
  retryCount: integer('retry_count').notNull().default(0),
  errorMessage: text('error_message'),
});

// 인덱스
export const outboxStatusIdx = index('outbox_status_idx').on(
  outbox_events.status,
  outbox_events.createdAt
);
```

### 2. 비즈니스 로직에서 Outbox 사용

```typescript
// apps/wms/src/order/services/order.service.ts
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbTx } from '../../database/schemas/wms-schema';
import { orders } from '../../database/schemas/wms-schema';
import { outbox_events } from '../../database/schemas/outbox.schema';

@Injectable()
export class OrderService {
  constructor(private readonly db: Database) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  /**
   * 주문 생성 + Outbox에 이벤트 저장
   */
  async createOrder(dto: CreateOrderDto, tx?: DbTx) {
    return this.inTx(async (tx) => {
      // 1. 비즈니스 로직 - 주문 저장 (SoT)
      const [order] = await tx
        .insert(orders)
        .values({
          customerId: dto.customerId,
          totalAmount: dto.totalAmount,
          items: dto.items,
        })
        .returning();

      // 2. Outbox에 이벤트 저장 (발행 대기열)
      await tx.insert(outbox_events).values({
        aggregateType: 'Order',
        aggregateId: order.id,
        eventType: 'OrderCreated',
        payload: {
          orderId: order.id,
          customerId: order.customerId,
          totalAmount: order.totalAmount,
          items: order.items,
          status: order.status,
        },
        metadata: {
          source: 'order-service',
          userId: dto.userId,
        },
        status: 'PENDING',
      });

      // 3. 트랜잭션 커밋 → 원자적으로 저장!
      return order;
    }, tx);
  }

  /**
   * 주문 취소 + Outbox에 이벤트 저장
   */
  async cancelOrder(orderId: string, reason: string, tx?: DbTx) {
    return this.inTx(async (tx) => {
      // 1. 주문 상태 변경
      const [order] = await tx
        .update(orders)
        .set({
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: reason,
        })
        .where(eq(orders.id, orderId))
        .returning();

      // 2. Outbox에 취소 이벤트 저장
      await tx.insert(outbox_events).values({
        aggregateType: 'Order',
        aggregateId: order.id,
        eventType: 'OrderCancelled',
        payload: {
          orderId: order.id,
          status: order.status,
          reason: reason,
          cancelledAt: order.cancelledAt.toISOString(),
        },
        status: 'PENDING',
      });

      return order;
    }, tx);
  }
}
```

### 3. OutboxDispatcher 구현

```typescript
// apps/wms/src/order/services/outbox-dispatcher.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import { ORDER_STREAM, OrderEvents } from '@app/shared/streams';
import { sql, eq } from 'drizzle-orm';
import { outbox_events } from '../../database/schemas/outbox.schema';

interface OutboxEvent {
  id: number;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: any;
  metadata?: any;
  status: 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED';
  retryCount: number;
  createdAt: Date;
  correlationId?: string;
  causationId?: string;
}

@Injectable()
export class OutboxDispatcher {
  private readonly logger = new Logger(OutboxDispatcher.name);

  constructor(
    private readonly db: Database,
    @InjectStreamPublisher('orders.events.v1')
    private readonly orderPublisher: StreamPublisher<OrderEvents>,
    // 필요한 다른 publisher들도 주입
  ) {}

  /**
   * 매 5초마다 실행 - Pending 이벤트 처리
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  async dispatchPendingEvents() {
    try {
      // 1. 배치 단위로 이벤트 획득 (FOR UPDATE SKIP LOCKED)
      const events = await this.acquireEventBatch();

      if (events.length === 0) {
        return;
      }

      this.logger.log(`📦 Processing ${events.length} events`);

      // 2. Kafka로 발행 (트랜잭션 밖)
      for (const event of events) {
        await this.processEvent(event);
      }
    } catch (error) {
      this.logger.error('Dispatcher error:', error);
    }
  }

  /**
   * 배치 단위로 이벤트 획득
   *
   * FOR UPDATE SKIP LOCKED:
   * - 여러 인스턴스가 동시 실행해도 중복 처리 방지
   * - 다른 인스턴스가 락 건 행은 건너뛰고 다음 행 처리
   */
  private async acquireEventBatch(): Promise<OutboxEvent[]> {
    return await this.db.transaction(async (tx) => {
      // 1. SELECT FOR UPDATE SKIP LOCKED (Raw SQL)
      const result = await tx.execute<{
        id: number;
        aggregate_type: string;
        aggregate_id: string;
        event_type: string;
        payload: any;
        metadata: any;
        status: string;
        retry_count: number;
        created_at: Date;
        correlation_id?: string;
        causation_id?: string;
      }>(sql`
        SELECT
          id,
          aggregate_type,
          aggregate_id,
          event_type,
          payload,
          metadata,
          status,
          retry_count,
          created_at,
          correlation_id,
          causation_id
        FROM outbox_events
        WHERE status = 'PENDING'
          AND retry_count < 5
        ORDER BY created_at
        LIMIT 100
        FOR UPDATE SKIP LOCKED
      `);

      const selected = result.rows;

      if (selected.length === 0) {
        return [];
      }

      // 2. 즉시 PROCESSING 상태로 변경 (다른 인스턴스가 못 가져가게)
      const ids = selected.map(e => e.id);

      await tx.execute(sql`
        UPDATE outbox_events
        SET status = 'PROCESSING'
        WHERE id = ANY(${ids})
      `);

      // 3. camelCase로 변환하여 반환
      return selected.map(row => ({
        id: row.id,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        eventType: row.event_type,
        payload: row.payload,
        metadata: row.metadata,
        status: 'PROCESSING' as const,
        retryCount: row.retry_count,
        createdAt: row.created_at,
        correlationId: row.correlation_id,
        causationId: row.causation_id,
      }));
    });
  }

  /**
   * 개별 이벤트 처리
   */
  private async processEvent(event: OutboxEvent) {
    try {
      // Kafka로 발행
      await this.publishToKafka(event);

      // 성공 → PUBLISHED 상태로 변경
      await this.db
        .update(outbox_events)
        .set({
          status: 'PUBLISHED',
          publishedAt: new Date(),
        })
        .where(eq(outbox_events.id, event.id));

      this.logger.log(`✅ Event ${event.id}: ${event.eventType}`);
    } catch (error) {
      // 실패 처리
      const newRetryCount = event.retryCount + 1;
      const isFinalFailure = newRetryCount >= 5;

      await this.db
        .update(outbox_events)
        .set({
          status: isFinalFailure ? 'FAILED' : 'PENDING',  // ← PENDING으로 되돌림
          retryCount: newRetryCount,
          errorMessage: error.message,
          failedAt: isFinalFailure ? new Date() : undefined,
        })
        .where(eq(outbox_events.id, event.id));

      this.logger.error(
        `❌ Event ${event.id} failed (${newRetryCount}/5):`,
        error.message,
      );

      // 최종 실패 시 알림
      if (isFinalFailure) {
        await this.sendFailureAlert(event, error);
      }
    }
  }

  /**
   * Kafka로 이벤트 발행
   */
  private async publishToKafka(event: OutboxEvent) {
    const publisher = this.getPublisher(event.aggregateType);

    await publisher.publishEvent({
      eventType: event.eventType as any,
      aggregateId: event.aggregateId,
      payload: event.payload,
      metadata: event.metadata,
      correlationId: event.correlationId,
      causationId: event.causationId,
    });
  }

  /**
   * aggregateType에 따라 적절한 publisher 선택
   */
  private getPublisher(aggregateType: string): StreamPublisher<any> {
    switch (aggregateType) {
      case 'Order':
        return this.orderPublisher;
      // case 'Stock':
      //   return this.inventoryPublisher;
      default:
        throw new Error(`Unknown aggregate type: ${aggregateType}`);
    }
  }

  /**
   * 최종 실패 알림
   */
  private async sendFailureAlert(event: OutboxEvent, error: Error) {
    // TODO: Slack, Email, PagerDuty 등으로 알림
    this.logger.error(
      `🚨 ALERT: Event ${event.id} failed permanently after 5 attempts`,
      {
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        error: error.message,
      },
    );
  }

  /**
   * 매일 새벽 2시 - 오래된 PUBLISHED 이벤트 삭제
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanupOldEvents() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const result = await this.db.execute(sql`
      DELETE FROM outbox_events
      WHERE status = 'PUBLISHED'
        AND published_at < ${sevenDaysAgo}
    `);

    this.logger.log(`🧹 Cleaned up ${result.rowCount} old events`);
  }

  /**
   * 매 시간마다 - FAILED 이벤트 현황 보고
   */
  @Cron(CronExpression.EVERY_HOUR)
  async reportFailedEvents() {
    const result = await this.db.execute<{ count: number }>(sql`
      SELECT COUNT(*) as count
      FROM outbox_events
      WHERE status = 'FAILED'
    `);

    const failedCount = result.rows[0]?.count || 0;

    if (failedCount > 0) {
      this.logger.warn(`⚠️  ${failedCount} events in FAILED status`);
    }
  }
}
```

### 4. 모듈 등록

```typescript
// apps/wms/src/order/order.module.ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EventsModule } from '@app/events';
import { ORDER_STREAM } from '@app/shared/streams';
import { OrderService } from './services/order.service';
import { OutboxDispatcher } from './services/outbox-dispatcher.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),  // ← Cron 활성화
    EventsModule.forRoot({
      streams: [ORDER_STREAM],
      serviceName: 'wms-order',
    }),
  ],
  providers: [
    OrderService,
    OutboxDispatcher,  // ← Dispatcher 등록
  ],
  exports: [OrderService],
})
export class OrderModule {}
```

---

## 핵심 개념

### 1. SoT (Source of Truth) vs Outbox

- **SoT**: `orders`, `stock_events` 등 비즈니스 데이터 테이블
- **Outbox**: Kafka로 전송하기 위한 **임시 전송 대기열**
- Outbox는 발행 성공 후 삭제해도 됨 (SoT에 이미 데이터 있음)

### 2. 이벤트 상태 전이

```
PENDING → PROCESSING → PUBLISHED (성공)
                    ↓
                  PENDING (재시도)
                    ↓
                  FAILED (최종 실패, 5회 초과)
```

### 3. FOR UPDATE SKIP LOCKED

```sql
-- Pod 1
SELECT * FROM outbox_events
WHERE status = 'PENDING'
LIMIT 100
FOR UPDATE SKIP LOCKED;
-- 결과: id=1,2,3 (락 획득)

-- Pod 2 (동시 실행)
SELECT * FROM outbox_events
WHERE status = 'PENDING'
LIMIT 100
FOR UPDATE SKIP LOCKED;
-- 결과: id=4,5,6 (락 걸린 1,2,3은 건너뜀!)
```

**효과:**
- 여러 인스턴스가 동시 실행해도 중복 처리 없음
- 대기 없이 바로 다음 행 처리 → 높은 처리량

### 4. 트랜잭션 범위

```typescript
// ✅ 올바른 방법
async dispatch() {
  // 1. 트랜잭션 안: SELECT + UPDATE (빠르게)
  const events = await this.db.transaction(async (tx) => {
    const rows = await tx.execute(sql`SELECT ... FOR UPDATE SKIP LOCKED`);
    await tx.execute(sql`UPDATE ... SET status = 'PROCESSING'`);
    return rows;
  });
  // 트랜잭션 종료

  // 2. 트랜잭션 밖: Kafka 발행 (느림 - 네트워크 I/O)
  for (const event of events) {
    await this.publishToKafka(event);
    await this.db.update(...);  // 상태 업데이트
  }
}
```

**이유:**
- Kafka 발행은 수백ms ~ 수초 소요
- 트랜잭션이 길어지면 DB 락 발생 → 동시성 저하
- **SELECT + UPDATE만 트랜잭션 안에**, **Kafka 발행은 밖에**

---

## 장점

1. ✅ **원자성 보장**: DB 저장 + 이벤트 발행이 논리적으로 원자적
2. ✅ **At-Least-Once 보장**: 네트워크 장애 시에도 재시도로 발행 보장
3. ✅ **수평 확장 가능**: 여러 인스턴스 실행 가능 (FOR UPDATE SKIP LOCKED)
4. ✅ **감사/디버깅 용이**: Outbox 테이블에 발행 이력 보관 가능
5. ✅ **장애 복구**: 앱 재시작 시 PENDING 이벤트 자동 재발행

---

## 주의사항

### 1. 멱등성 보장 필요 (Consumer 측)

Outbox 패턴은 **At-Least-Once** 보장 → 같은 이벤트가 여러 번 발행될 수 있음

```typescript
// Consumer에서 멱등성 처리
@OnEvent('orders.events.v1', 'OrderCreated')
async handleOrderCreated(
  @EventEnvelope() envelope: MessageEnvelope<OrderCreatedPayload>,
  @EventPayload() payload: OrderCreatedPayload,
) {
  // 중복 처리 방지
  const existing = await this.db
    .select()
    .from(processed_events)
    .where(eq(processed_events.messageId, envelope.messageId));

  if (existing.length > 0) {
    this.logger.warn(`Duplicate event ${envelope.messageId}, skipping`);
    return;  // 이미 처리됨
  }

  // 비즈니스 로직
  await this.processOrder(payload);

  // 처리 완료 기록
  await this.db.insert(processed_events).values({
    messageId: envelope.messageId,
    processedAt: new Date(),
  });
}
```

### 2. Dispatcher 성능 튜닝

```typescript
// 배치 크기 조정 (처리량 vs 지연시간)
LIMIT 100  // 기본값
LIMIT 1000 // 높은 처리량 필요 시

// 폴링 주기 조정
@Cron(CronExpression.EVERY_5_SECONDS)  // 기본값
@Cron(CronExpression.EVERY_SECOND)     // 낮은 지연시간 필요 시
@Cron(CronExpression.EVERY_30_SECONDS) // 처리량 낮을 때
```

### 3. 인덱스 최적화

```sql
-- 필수 인덱스
CREATE INDEX outbox_status_idx
ON outbox_events(status, created_at);

-- 복합 인덱스 (성능 개선)
CREATE INDEX outbox_pending_idx
ON outbox_events(status, retry_count, created_at)
WHERE status = 'PENDING';
```

### 4. 모니터링 메트릭

- **Pending 이벤트 수**: 급증 시 Kafka 장애 의심
- **Failed 이벤트 수**: 증가 시 알림 필요
- **평균 처리 시간**: PENDING → PUBLISHED 소요 시간
- **재시도 횟수**: 높으면 네트워크 불안정

---

## 대안 비교

| 패턴 | 장점 | 단점 | 적합성 |
|------|------|------|--------|
| **Transactional Outbox** | 원자성 보장, 구현 간단 | 폴링 오버헤드 | ✅ 권장 |
| Change Data Capture (Debezium) | 애플리케이션 코드 수정 없음 | 인프라 복잡도 증가 | 대규모 시스템 |
| Event Sourcing | 이벤트 = 데이터 | 학습 곡선 높음 | 장기 전략 |
| At-Least-Once + Retry | 간단함 | 100% 보장 불가 | 작은 프로젝트 |

---

## 다음 단계

1. Outbox 테이블 마이그레이션 생성
2. OutboxDispatcher 구현
3. 기존 서비스에 Outbox 패턴 적용
4. 모니터링 대시보드 구축
5. 알림 시스템 연동 (Slack, PagerDuty)

---

## 참고 자료

- [Microservices Pattern: Transactional Outbox](https://microservices.io/patterns/data/transactional-outbox.html)
- [PostgreSQL FOR UPDATE](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)
- [NestJS Scheduled Tasks](https://docs.nestjs.com/techniques/task-scheduling)
