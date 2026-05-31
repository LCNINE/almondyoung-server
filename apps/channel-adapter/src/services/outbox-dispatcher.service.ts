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
  ORDER_STREAM,
  OrderEvents,
  OrderCreatedPayload,
  OrderCancelledPayload,
  OrderModifiedPayload,
  OrderRefundCreatedPayload,
} from '@packages/event-contracts/streams';
import { channelAdapterSchema, inboxEvents } from '../schema';
import { ORDER_STREAM_EVENT_TYPES } from '../order-event-routing';
import { eq, and, lte, sql, inArray, ne } from 'drizzle-orm';

type ChannelAdapterPayload =
  | OrderSyncCompletedPayload
  | InventorySyncCompletedPayload
  | CommandExecutedPayload
  | SyncFailurePayload
  | ChannelStatusChangedPayload
  | QueryExecutedPayload;

type OrderPayload = OrderCreatedPayload | OrderCancelledPayload | OrderModifiedPayload | OrderRefundCreatedPayload;

/**
 * OutboxDispatcherService
 *
 * 책임: Outbox 테이블의 이벤트를 Kafka로 발행
 * - Cron으로 주기적 폴링 (10초마다)
 * - FOR UPDATE SKIP LOCKED로 동시성 제어
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
    @InjectStreamPublisher(ORDER_STREAM.topic.topic)
    private readonly ordersPublisher: StreamPublisher<OrderEvents>,
  ) {}

  onModuleInit() {
    this.logger.log('OutboxDispatcher 초기화 완료');
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
          aggregate_type: string;
          aggregate_id: string;
          partition_key: string;
          payload: Record<string, unknown>;
          attempts: number;
        }>(sql`
          SELECT
            id,
            event_type,
            aggregate_type,
            aggregate_id,
            partition_key,
            payload,
            attempts
          FROM ${inboxEvents}
          WHERE status = 'pending'
            AND next_attempt_at <= NOW()
            AND aggregate_type = 'ChannelAdapter'
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
          .update(inboxEvents)
          .set({
            attempts: sql`${inboxEvents.attempts} + 1`,
          })
          .where(inArray(inboxEvents.id, eventIds));

        return pendingEvents;
      });

      if (events.length === 0) {
        return;
      }

      this.logger.log(`Outbox 이벤트 발행 시작: ${events.length}개`);

      for (const event of events) {
        try {
          await this.publishEvent(event);
          processedCount++;
        } catch (error) {
          this.logger.error(`이벤트 발행 실패: ${event.id} (${event.event_type})`, error);
        }
      }

      this.logger.log(`Outbox 이벤트 발행 완료: ${processedCount}/${events.length}개`);
    } catch (error) {
      this.logger.error('Outbox dispatch 실행 중 오류:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 개별 이벤트 처리
   *
   * eventType에 따라 적절한 publisher를 선택하여 발행
   * - OrderCreated, OrderCancelled, OrderModified → orders.events.v1
   * - 그 외 → channel-adapter.events.v1
   *
   * Note: aggregateType은 모두 'ChannelAdapter'로 통일 (채널 어댑터 서비스에서 발행)
   */
  private async publishEvent(event: {
    id: string;
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    partition_key: string;
    payload: Record<string, unknown>;
    attempts: number;
  }) {
    try {
      // eventType에 따라 적절한 publisher 선택. 제외 목록은 InboxWorkerService 와 공유.
      if ((ORDER_STREAM_EVENT_TYPES as readonly string[]).includes(event.event_type)) {
        // Order 이벤트 → orders.events.v1로 발행 (WMS가 구독)
        await this.ordersPublisher.publishEvent({
          eventType: event.event_type as keyof OrderEvents,
          aggregateId: event.aggregate_id,
          payload: event.payload as unknown as OrderPayload,
          metadata: { partitionKey: event.partition_key },
        });
      } else {
        // Channel Adapter 이벤트 → channel-adapter.events.v1로 발행
        await this.channelAdapterPublisher.publishEvent({
          eventType: event.event_type as keyof ChannelAdapterEvents,
          aggregateId: event.aggregate_id,
          payload: event.payload as any, // ChannelAdapterPayload 타입 호환성 문제로 any 사용
          metadata: { partitionKey: event.partition_key },
        });
      }

      // 성공 → published 상태로 변경
      await this.db.db
        .update(inboxEvents)
        .set({
          status: 'published',
          publishedAt: new Date(),
        })
        .where(eq(inboxEvents.id, event.id));

      this.logger.debug(`Event ${event.id}: ${event.event_type} (${event.aggregate_type})`);
    } catch (error) {
      const newAttempts = event.attempts + 1;
      const isFinalFailure = newAttempts >= 5;

      await this.db.db
        .update(inboxEvents)
        .set({
          status: isFinalFailure ? 'failed' : 'pending',
          attempts: newAttempts,
          nextAttemptAt: isFinalFailure ? undefined : this.calculateNextAttempt(newAttempts),
        })
        .where(eq(inboxEvents.id, event.id));

      this.logger.error(
        `Event ${event.id} 실패 (${newAttempts}/5): ${event.event_type}`,
        error instanceof Error ? error.message : String(error),
      );

      if (isFinalFailure) {
        this.logger.error(`최종 실패: ${event.id} (${event.event_type}) - 수동 처리 필요`);
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
      .update(inboxEvents)
      .set({
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
      })
      .where(
        eventIds
          ? and(eq(inboxEvents.status, 'failed'), inArray(inboxEvents.id, eventIds))
          : eq(inboxEvents.status, 'failed'),
      )
      .returning({ id: inboxEvents.id });

    this.logger.log(`수동 재시도: ${result.length}개 이벤트 재활성화`);
    return result.length;
  }
}
