# Channel Adapter Outbox Pattern 명세서

## 개요

Channel Adapter 서비스에 **Transactional Outbox Pattern**을 도입하여 이벤트 발행의 원자성과 중복 방지를 보장합니다.

### 목표

1. **원자성 보장**: DB 트랜잭션과 이벤트 발행의 논리적 원자성
2. **중복 방지**: 동일 이벤트의 중복 발행 방지
3. **장애 복구**: 네트워크 장애 시 자동 재시도
4. **확장성**: 여러 인스턴스 동시 실행 가능 (FOR UPDATE SKIP LOCKED)

---

## 아키텍처

```
┌─────────────────────────────────────────┐
│  Channel Sync/Command Manager            │
│  ┌────────────────────────────────────┐  │
│  │ 1. 비즈니스 로직 처리              │  │
│  │ 2. OutboxService.enqueue() 호출    │  │  ← 같은 트랜잭션!
│  └────────────────────────────────────┘  │
│           COMMIT (원자적)                │
└─────────────────────────────────────────┘
              ↓
         (트랜잭션 밖)
              ↓
┌─────────────────────────────────────────┐
│  OutboxDispatcherService (@Cron)         │
│  ┌────────────────────────────────────┐  │
│  │ 1. PENDING 이벤트 폴링            │  │
│  │ 2. 중복 판단 (messageId 체크)     │  │
│  │ 3. StreamPublisher로 발행         │  │
│  │ 4. PUBLISHED 상태 변경            │  │
│  └────────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

---

## 1. Outbox 스키마 정의

### 1.1 스키마 파일 위치

```
apps/channel-adapter/src/schema.ts
```

### 1.2 테이블 정의

```typescript
import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  integer,
  text,
  index,
  sql,
} from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/**
 * Outbox Events 테이블
 * 
 * Channel Adapter의 모든 이벤트를 Outbox를 거쳐 발행
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    // 이벤트 식별
    eventType: varchar('event_type', { length: 100 }).notNull(), // 'OrderSyncCompleted', 'CommandExecuted' 등
    aggregateType: varchar('aggregate_type', { length: 50 }).notNull().default('ChannelAdapter'),
    aggregateId: varchar('aggregate_id', { length: 255 }).notNull(), // 채널별 주문/상품 ID
    partitionKey: varchar('partition_key', { length: 255 }).notNull(), // Kafka 파티션 키

    // 페이로드
    payload: jsonb('payload').notNull(),
    metadata: jsonb('metadata'), // correlationId, causationId 등

    // 중복 방지용 메시지 ID (StreamPublisher가 생성)
    messageId: varchar('message_id', { length: 100 }).unique(), // 발행 전에는 null

    // 상태 관리
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    // 'pending' | 'processing' | 'published' | 'failed'

    // 재시도 관리
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at').defaultNow(),
    errorMessage: text('error_message'),

    // 타임스탬프
    createdAt: timestamp('created_at').notNull().defaultNow(),
    publishedAt: timestamp('published_at'),
    failedAt: timestamp('failed_at'),
  },
  (table) => [
    // 상태별 조회 최적화
    index('idx_outbox_status_created').on(table.status, table.createdAt),
    index('idx_outbox_pending_next_attempt').on(table.status, table.nextAttemptAt),
    
    // 중복 방지용 인덱스 (messageId는 unique)
    index('idx_outbox_message_id').on(table.messageId),
    
    // 파티션 키 인덱스 (선택적)
    index('idx_outbox_partition_key').on(table.partitionKey),
  ],
);
```

### 1.3 스키마 Export 업데이트

```typescript
// apps/channel-adapter/src/schema.ts
export const channelAdapterSchema = {
  eventLogs,
  syncHistories,
  processedEvents,
  syncStatuses,
  wmsOrderMappings,
  pendingOrders,
  outboxEvents, // ← 추가
} as const;
```

---

## 2. OutboxService 구현

### 2.1 서비스 파일 위치

```
apps/channel-adapter/src/services/outbox.service.ts
```

### 2.2 구현 내용

```typescript
import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { channelAdapterSchema, outboxEvents } from '../schema';
import { ChannelAdapterSchema } from '../types';

// DbTx 타입 정의 (WMS 패턴 참고)
type DbTx = Parameters<
  Parameters<DbService<typeof channelAdapterSchema>['db']['transaction']>[0]
>[0];

/**
 * OutboxService
 * 
 * 책임:
 * - 이벤트를 Outbox 테이블에 enqueue
 * - 트랜잭션 내에서 호출되어 원자성 보장
 */
@Injectable()
export class OutboxService {
  constructor(
    private readonly db: DbService<typeof channelAdapterSchema>,
  ) {}

  /**
   * 이벤트를 Outbox에 enqueue
   * 
   * @param params - 이벤트 정보
   * @param tx - 트랜잭션 컨텍스트 (선택적)
   * 
   * @example
   * await this.outboxService.enqueue({
   *   eventType: 'OrderSyncCompleted',
   *   aggregateId: 'naver-ORD-123',
   *   partitionKey: 'naver_smartstore',
   *   payload: { ... },
   *   metadata: { correlationId: '...' },
   * }, tx);
   */
  async enqueue(
    params: {
      eventType: string;
      aggregateId: string;
      partitionKey: string;
      payload: unknown;
      metadata?: Record<string, unknown>;
    },
    tx?: DbTx,
  ): Promise<void> {
    const exec = async (trx: DbTx) => {
      await trx.insert(outboxEvents).values({
        eventType: params.eventType,
        aggregateType: 'ChannelAdapter',
        aggregateId: params.aggregateId,
        partitionKey: params.partitionKey,
        payload: params.payload as any,
        metadata: params.metadata as any,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
        messageId: null, // 발행 시점에 생성됨
      });
    };

    if (tx) {
      return exec(tx);
    }
    return this.db.db.transaction(exec);
  }
}
```

---

## 3. OutboxDispatcherService 구현

### 3.1 서비스 파일 위치

```
apps/channel-adapter/src/services/outbox-dispatcher.service.ts
```

### 3.2 구현 내용

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import {
  CHANNEL_ADAPTER_STREAM,
  ChannelAdapterEvents,
  OrderSyncCompletedPayload,
  InventorySyncCompletedPayload,
  CommandExecutedPayload,
  SyncFailurePayload,
  ChannelStatusChangedPayload,
  QueryExecutedPayload,
} from '@packages/event-contracts/streams';
import { channelAdapterSchema, outboxEvents } from '../schema';
import { eq, and, lte, sql } from 'drizzle-orm';
import { generateMessageId } from '@app/events/utils/message-id.util';

type ChannelAdapterPayload =
  | OrderSyncCompletedPayload
  | InventorySyncCompletedPayload
  | CommandExecutedPayload
  | SyncFailurePayload
  | ChannelStatusChangedPayload
  | QueryExecutedPayload;

/**
 * OutboxDispatcherService
 * 
 * 책임:
 * - Outbox 테이블의 이벤트를 Kafka로 발행
 * - Cron으로 주기적 폴링 (10초마다)
 * - FOR UPDATE SKIP LOCKED로 동시성 제어
 * - 중복 판단 (messageId 기반)
 * - 발행 실패 시 재시도 (최대 5회)
 */
@Injectable()
export class OutboxDispatcherService implements OnModuleInit {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private isProcessing = false;

  constructor(
    private readonly db: DbService<typeof channelAdapterSchema>,
    @InjectStreamPublisher(CHANNEL_ADAPTER_STREAM.topic.topic)
    private readonly channelAdapterPublisher: StreamPublisher<ChannelAdapterEvents>,
  ) {}

  onModuleInit() {
    this.logger.log('📤 OutboxDispatcher 초기화 완료 ✅');
  }

  /**
   * Cron: 10초마다 실행
   * 
   * PENDING 상태의 이벤트를 조회하여 Kafka로 발행
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async dispatch() {
    if (this.isProcessing) {
      this.logger.debug('이전 dispatch 작업 진행 중, 건너뜀');
      return;
    }

    this.isProcessing = true;

    try {
      const batchSize = 100;
      let processedCount = 0;

      // FOR UPDATE SKIP LOCKED로 동시성 제어
      const events = await this.db.db.transaction(async (tx) => {
        const pendingEvents = await tx.execute<{
          id: string;
          event_type: string;
          aggregate_id: string;
          partition_key: string;
          payload: Record<string, unknown>;
          metadata: Record<string, unknown> | null;
          attempts: number;
          message_id: string | null;
        }>(sql`
          SELECT 
            id, 
            event_type, 
            aggregate_id, 
            partition_key, 
            payload,
            metadata,
            attempts,
            message_id
          FROM ${outboxEvents}
          WHERE status = 'pending'
            AND next_attempt_at <= NOW()
          ORDER BY created_at ASC
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        `);

        if (pendingEvents.length === 0) {
          return [];
        }

        // 조회된 이벤트의 attempts 증가 (트랜잭션 내)
        const eventIds = pendingEvents.map((e) => e.id);
        await tx
          .update(outboxEvents)
          .set({
            attempts: sql`${outboxEvents.attempts} + 1`,
            status: 'processing',
          })
          .where(sql`${outboxEvents.id} = ANY(${eventIds})`);

        return pendingEvents;
      });

      if (events.length === 0) {
        return;
      }

      this.logger.log(`📤 Outbox 이벤트 발행 시작: ${events.length}개`);

      for (const event of events) {
        try {
          await this.publishEvent(event);
          processedCount++;
        } catch (error) {
          this.logger.error(
            `이벤트 발행 실패: ${event.id} (${event.event_type})`,
            error,
          );
        }
      }

      this.logger.log(
        `✅ Outbox 이벤트 발행 완료: ${processedCount}/${events.length}개`,
      );
    } catch (error) {
      this.logger.error('Outbox dispatch 실행 중 오류:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 개별 이벤트 처리
   * 
   * 중복 판단 로직 포함:
   * - messageId가 이미 존재하면 중복으로 판단
   * - messageId가 없으면 새로 생성하여 발행
   */
  private async publishEvent(event: {
    id: string;
    event_type: string;
    aggregate_id: string;
    partition_key: string;
    payload: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
    attempts: number;
    message_id: string | null;
  }) {
    try {
      // 1. 중복 판단: messageId가 이미 존재하는지 확인
      let messageId = event.message_id;
      
      if (!messageId) {
        // messageId가 없으면 새로 생성
        messageId = generateMessageId();
        
        // 동일 messageId가 이미 발행되었는지 확인
        const existing = await this.db.db
          .select({ id: outboxEvents.id })
          .from(outboxEvents)
          .where(
            and(
              eq(outboxEvents.messageId, messageId),
              eq(outboxEvents.status, 'published'),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          // 이미 발행된 이벤트 → 중복으로 판단하여 건너뜀
          this.logger.warn(
            `⚠️ 중복 이벤트 감지: ${event.id} (messageId: ${messageId}), 건너뜀`,
          );
          
          // 상태를 published로 변경 (중복이지만 처리 완료로 간주)
          await this.db.db
            .update(outboxEvents)
            .set({
              status: 'published',
              publishedAt: new Date(),
              messageId: messageId,
            })
            .where(eq(outboxEvents.id, event.id));
          
          return;
        }

        // messageId 저장
        await this.db.db
          .update(outboxEvents)
          .set({ messageId: messageId })
          .where(eq(outboxEvents.id, event.id));
      } else {
        // messageId가 이미 있는 경우 → 중복 확인
        const existing = await this.db.db
          .select({ id: outboxEvents.id })
          .from(outboxEvents)
          .where(
            and(
              eq(outboxEvents.messageId, messageId),
              eq(outboxEvents.status, 'published'),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          // 이미 발행된 이벤트 → 중복으로 판단하여 건너뜀
          this.logger.warn(
            `⚠️ 중복 이벤트 감지: ${event.id} (messageId: ${messageId}), 건너뜀`,
          );
          
          await this.db.db
            .update(outboxEvents)
            .set({
              status: 'published',
              publishedAt: new Date(),
            })
            .where(eq(outboxEvents.id, event.id));
          
          return;
        }
      }

      // 2. StreamPublisher를 통해 이벤트 발행
      await this.channelAdapterPublisher.publishEvent({
        eventType: event.event_type as keyof ChannelAdapterEvents,
        aggregateId: event.aggregate_id,
        payload: event.payload as unknown as ChannelAdapterPayload,
        metadata: {
          ...(event.metadata || {}),
          partitionKey: event.partition_key,
        },
      });

      // 3. 성공 → published 상태로 변경
      await this.db.db
        .update(outboxEvents)
        .set({
          status: 'published',
          publishedAt: new Date(),
          messageId: messageId,
        })
        .where(eq(outboxEvents.id, event.id));

      this.logger.debug(`✅ Event ${event.id}: ${event.event_type}`);
    } catch (error) {
      const newAttempts = event.attempts + 1;
      const isFinalFailure = newAttempts >= 5;

      await this.db.db
        .update(outboxEvents)
        .set({
          status: isFinalFailure ? 'failed' : 'pending',
          attempts: newAttempts,
          nextAttemptAt: isFinalFailure
            ? undefined
            : this.calculateNextAttempt(newAttempts),
          errorMessage: error instanceof Error ? error.message : String(error),
          failedAt: isFinalFailure ? new Date() : undefined,
        })
        .where(eq(outboxEvents.id, event.id));

      this.logger.error(
        `❌ Event ${event.id} 실패 (${newAttempts}/5): ${event.event_type}`,
        error instanceof Error ? error.message : String(error),
      );

      if (isFinalFailure) {
        this.logger.error(
          `🚨 최종 실패: ${event.id} (${event.event_type}) - 수동 처리 필요`,
        );
      }

      throw error;
    }
  }

  /**
   * 재시도 간격 계산 (Exponential Backoff)
   * 
   * 1차: 10초 후
   * 2차: 30초 후
   * 3차: 1분 후
   * 4차: 5분 후
   */
  private calculateNextAttempt(attempts: number): Date {
    const delays = [10, 30, 60, 300]; // 초 단위
    const delay = delays[Math.min(attempts - 1, delays.length - 1)];
    return new Date(Date.now() + delay * 1000);
  }

  /**
   * 수동 재시도 (관리자용)
   * 
   * FAILED 상태의 이벤트를 다시 PENDING으로 변경
   */
  async retryFailedEvents(eventIds?: string[]): Promise<number> {
    const result = await this.db.db
      .update(outboxEvents)
      .set({
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
        errorMessage: null,
      })
      .where(
        eventIds
          ? and(
              eq(outboxEvents.status, 'failed'),
              sql`${outboxEvents.id} = ANY(${eventIds})`,
            )
          : eq(outboxEvents.status, 'failed'),
      )
      .returning({ id: outboxEvents.id });

    this.logger.log(`수동 재시도: ${result.length}개 이벤트 재활성화`);
    return result.length;
  }
}
```

---

## 4. 기존 서비스 통합

### 4.1 ChannelSyncManager 수정

```typescript
// apps/channel-adapter/src/services/channel-sync.manager.ts

import { OutboxService } from './outbox.service';

@Injectable()
export class ChannelSyncManager {
  constructor(
    private readonly repo: ChannelAdapterRepository,
    private readonly outboxService: OutboxService, // ← 추가
    // eventPublisher는 제거 (Outbox를 통해 발행)
    private readonly adapterFactory: ChannelAdapterFactory,
  ) {}

  /**
   * Inbound 동기화 처리
   */
  async syncInbound(
    events: InternalOrderEvent[],
    channel: ChannelType,
    dataType: DataType,
  ): Promise<SyncResult> {
    // ... 기존 검증 로직 ...

    // DB 저장 (트랜잭션)
    await this.repo.db.db.transaction(async (tx) => {
      // 1. 비즈니스 로직 처리
      await this.repo.saveSyncHistory({ ... }, tx);
      // ... 기타 DB 작업 ...

      // 2. Outbox에 이벤트 enqueue (같은 트랜잭션!)
      await this.outboxService.enqueue(
        {
          eventType: 'OrderSyncCompleted',
          aggregateId: `${channel}-${events[0]?.externalOrderId || 'batch'}`,
          partitionKey: channel,
          payload: {
            channelType: channel,
            syncType: 'inbound',
            orderCount: events.length,
            orders: events,
            syncDurationMs: Date.now() - startTime,
            errors: errors.length > 0 ? errors : undefined,
          },
          metadata: {
            correlationId: generateMessageId(),
            dataType,
          },
        },
        tx, // ← 트랜잭션 전달!
      );
    });

    // ... 기존 로직 ...
  }
}
```

### 4.2 ChannelCommandManager 수정

```typescript
// apps/channel-adapter/src/services/channel-command.manager.ts

import { OutboxService } from './outbox.service';

@Injectable()
export class ChannelCommandManager {
  constructor(
    private readonly adapterFactory: ChannelAdapterFactory,
    private readonly outboxService: OutboxService, // ← 추가
    // eventPublisher는 제거
  ) {}

  async execute(
    channel: ChannelType,
    command: ChannelCommand,
  ): Promise<SyncResult> {
    // ... 기존 검증 로직 ...

    // 명령 실행
    const adapter = this.adapterFactory.getAdapter(channel);
    const result = await adapter.executeCommand(command);

    const duration = Date.now() - startTime;
    const targetId = this.extractTargetId(command);

    // Outbox에 이벤트 enqueue (트랜잭션 없음 - 로깅만)
    await this.outboxService.enqueue({
      eventType: 'CommandExecuted',
      aggregateId: `${channel}-${targetId}`,
      partitionKey: channel,
      payload: {
        channelType: channel,
        commandType: command.type,
        targetId,
        executionResult: result.success ? 'success' : 'failed',
        processedCount: result.processedCount || 0,
        failedCount: result.failedCount || 0,
        executionDurationMs: duration,
      },
      metadata: {
        correlationId: generateMessageId(),
      },
    });

    // ... 기존 로직 ...
  }
}
```

---

## 5. 모듈 등록

### 5.1 AdapterModule 수정

```typescript
// apps/channel-adapter/src/adapter.module.ts

import { ScheduleModule } from '@nestjs/schedule';
import { OutboxService } from './services/outbox.service';
import { OutboxDispatcherService } from './services/outbox-dispatcher.service';

@Module({
  imports: [
    ScheduleModule.forRoot(), // ← Cron 활성화
    // ... 기존 imports ...
  ],
  providers: [
    // ... 기존 providers ...
    OutboxService, // ← 추가
    OutboxDispatcherService, // ← 추가
  ],
  // ...
})
export class AdapterModule {}
```

---

## 6. 중복 판단 로직 상세

### 6.1 중복 판단 기준

1. **messageId 기반**: StreamPublisher가 생성한 messageId가 이미 발행되었는지 확인
2. **상태 확인**: `status = 'published'`인 이벤트만 중복으로 간주
3. **발행 전 확인**: 발행 직전에 중복 여부를 확인하여 불필요한 발행 방지

### 6.2 중복 처리 흐름

```
1. OutboxDispatcher가 PENDING 이벤트 조회
2. messageId 생성 또는 기존 messageId 사용
3. DB에서 동일 messageId + published 상태 조회
4. 존재하면 → 중복으로 판단, published 상태로 변경 후 건너뜀
5. 존재하지 않으면 → StreamPublisher로 발행
6. 발행 성공 → published 상태로 변경
```

### 6.3 멱등성 보장

- **Producer 측**: Outbox 패턴으로 At-Least-Once 보장
- **Consumer 측**: `processed_events` 테이블로 중복 처리 방지 (기존 로직 유지)

---

## 7. 마이그레이션

### 7.1 마이그레이션 파일 생성

```bash
cd apps/channel-adapter
npm run drizzle:generate
npm run drizzle:migrate
```

### 7.2 마이그레이션 SQL (참고)

```sql
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  aggregate_type VARCHAR(50) NOT NULL DEFAULT 'ChannelAdapter',
  aggregate_id VARCHAR(255) NOT NULL,
  partition_key VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL,
  metadata JSONB,
  message_id VARCHAR(100) UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP DEFAULT NOW(),
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  published_at TIMESTAMP,
  failed_at TIMESTAMP
);

CREATE INDEX idx_outbox_status_created ON outbox_events(status, created_at);
CREATE INDEX idx_outbox_pending_next_attempt ON outbox_events(status, next_attempt_at);
CREATE INDEX idx_outbox_message_id ON outbox_events(message_id);
CREATE INDEX idx_outbox_partition_key ON outbox_events(partition_key);
```

---

## 8. 모니터링 및 알림

### 8.1 주요 메트릭

- **Pending 이벤트 수**: 급증 시 Kafka 장애 의심
- **Failed 이벤트 수**: 증가 시 알림 필요
- **평균 처리 시간**: PENDING → PUBLISHED 소요 시간
- **재시도 횟수**: 높으면 네트워크 불안정

### 8.2 로그 예시

```
📤 OutboxDispatcher 초기화 완료 ✅
📤 Outbox 이벤트 발행 시작: 15개
✅ Event abc-123: OrderSyncCompleted
⚠️ 중복 이벤트 감지: def-456 (messageId: msg-789), 건너뜀
❌ Event ghi-789 실패 (3/5): CommandExecuted
✅ Outbox 이벤트 발행 완료: 14/15개
```

---

## 9. 테스트 전략

### 9.1 단위 테스트

- `OutboxService.enqueue()`: 트랜잭션 내 저장 확인
- `OutboxDispatcherService.publishEvent()`: 중복 판단 로직 검증

### 9.2 통합 테스트

- 트랜잭션 롤백 시 Outbox에도 저장되지 않는지 확인
- 중복 이벤트가 실제로 발행되지 않는지 확인
- 재시도 로직이 정상 동작하는지 확인

---

## 10. 마이그레이션 계획

### Phase 1: 인프라 구축
1. Outbox 스키마 생성
2. OutboxService 구현
3. OutboxDispatcherService 구현
4. 모듈 등록

### Phase 2: 점진적 적용
1. ChannelSyncManager에 Outbox 적용
2. ChannelCommandManager에 Outbox 적용
3. 기존 eventPublisher 제거

### Phase 3: 검증 및 최적화
1. 모니터링 대시보드 구축
2. 성능 튜닝 (배치 크기, 폴링 주기)
3. 알림 시스템 연동

---

## 11. 참고 자료

- [Transactional Outbox Pattern 문서](./transactional-outbox-pattern.md)
- [WMS Outbox 구현 참고](../apps/wms/src/order/shared/services/outbox.service.ts)
- [WMS OutboxDispatcher 구현 참고](../apps/wms/src/order/shared/services/outbox-dispatcher.service.ts)

---

## 12. FAQ

### Q1. 기존 eventPublisher를 완전히 제거해야 하나요?

**A**: 네, Outbox 패턴을 통해 모든 이벤트가 발행되므로 기존 eventPublisher는 제거합니다.

### Q2. 트랜잭션이 없는 경우에도 Outbox를 사용하나요?

**A**: 네, OutboxService가 내부적으로 트랜잭션을 생성하므로 안전하게 사용할 수 있습니다.

### Q3. 중복 판단이 100% 정확한가요?

**A**: messageId 기반으로 판단하므로 매우 높은 정확도를 보장합니다. 다만 Consumer 측에서도 멱등성 처리를 권장합니다.

### Q4. 폴링 주기를 조정할 수 있나요?

**A**: 네, `@Cron(CronExpression.EVERY_10_SECONDS)` 부분을 수정하여 조정할 수 있습니다.

---

**작성일**: 2024-12-XX  
**작성자**: AI Assistant  
**검토자**: (대기 중)

