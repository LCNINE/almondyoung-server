import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import {
  FULFILLMENT_STREAM,
  FulfillmentEvents,
  FulfillmentCreatedPayload,
  FulfillmentReadyPayload,
  FulfillmentLabeledPayload,
  FulfillmentShippedPayload,
  FulfillmentDeliveredPayload,
  FulfillmentCancelledPayload,
  FulfillmentReturnedPayload,
  INVENTORY_STREAM,
  InventoryEvents,
  CORE_ORDER_STREAM,
  CoreOrderEvents,
  SalesOrderCancelledPayload,
} from '@packages/event-contracts/streams';
import { wmsTables, wmsSchema } from '../../inventory/schema/inventory.schema';
import { eq, and, lte, sql, inArray } from 'drizzle-orm';

type FulfillmentPayload =
  | FulfillmentCreatedPayload
  | FulfillmentReadyPayload
  | FulfillmentLabeledPayload
  | FulfillmentShippedPayload
  | FulfillmentDeliveredPayload
  | FulfillmentCancelledPayload
  | FulfillmentReturnedPayload;

@Injectable()
export class OutboxDispatcherService implements OnModuleInit {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private isProcessing = false;

  /**
   * 배치 acquire 시 row 를 잠그는 lease 시간(ms).
   * acquire 가 next_attempt_at 을 NOW + LEASE_MS 로 밀어 두면, 발행이 진행 중이거나
   * 프로세스가 여러 개(롤링 배포 등)여도 같은 pending row 가 재선택되지 않는다.
   * 발행이 정상/실패로 끝나면 publishEvent 가 status/next_attempt_at 을 다시 확정한다.
   * 프로세스가 발행 도중 죽으면 lease 만료 후 attempts 증가 없이 재시도된다.
   */
  private static readonly LEASE_MS = 60_000;

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    @InjectStreamPublisher(FULFILLMENT_STREAM.topic.topic)
    private readonly fulfillmentPublisher: StreamPublisher<FulfillmentEvents>,
    @InjectStreamPublisher(INVENTORY_STREAM.topic.topic)
    private readonly inventoryPublisher: StreamPublisher<InventoryEvents>,
    @InjectStreamPublisher(CORE_ORDER_STREAM.topic.topic)
    private readonly coreOrderPublisher: StreamPublisher<CoreOrderEvents>,
  ) {}

  onModuleInit() {
    this.logger.log('📤 OutboxDispatcher 초기화 완료 ✅ (Fulfillment + Inventory)');
  }

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
          FROM ${wmsTables.outboxEvents}
          WHERE status = 'pending'
            AND next_attempt_at <= NOW()
          ORDER BY created_at ASC
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        `);

        if (pendingEvents.length === 0) {
          return [];
        }

        const eventIds = pendingEvents.map((e) => e.id);
        // attempts 는 여기서 올리지 않는다 — 발행 실패 시 publishEvent 가 단일 지점에서 증가시킨다.
        // 대신 next_attempt_at 을 lease 만큼 밀어 발행 중인 row 의 재선택(이중 증가/중복 발행)을 막는다.
        await tx
          .update(wmsTables.outboxEvents)
          .set({
            nextAttemptAt: new Date(Date.now() + OutboxDispatcherService.LEASE_MS),
          })
          .where(inArray(wmsTables.outboxEvents.id, eventIds));

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
          this.logger.error(`이벤트 발행 실패: ${event.id} (${event.event_type})`, error);
        }
      }

      this.logger.log(`✅ Outbox 이벤트 발행 완료: ${processedCount}/${events.length}개`);
    } catch (error) {
      this.logger.error('Outbox dispatch 실행 중 오류:', error);
    } finally {
      this.isProcessing = false;
    }
  }

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
      if (event.aggregate_type === 'Stock' || event.aggregate_type === 'ProductSellableQuantity') {
        await this.inventoryPublisher.publishEvent({
          eventType: event.event_type as keyof InventoryEvents,
          aggregateId: event.aggregate_id,
          payload: event.payload as any,
          metadata: { partitionKey: event.partition_key },
        });
      } else if (event.event_type === 'SalesOrderCancelled') {
        // Core 아웃바운드: core.orders.events.v1 / SalesOrderCancelled
        // (Channel Adapter → Medusa 취소 동기화에 사용)
        await this.coreOrderPublisher.publishEvent({
          eventType: 'SalesOrderCancelled',
          aggregateId: event.aggregate_id,
          payload: event.payload as unknown as SalesOrderCancelledPayload,
          metadata: { partitionKey: event.partition_key },
        });
      } else if (
        event.event_type === 'OrderCancelled' ||
        event.event_type === 'ORDER_CANCELLED'
      ) {
        // 레거시 outbox 소진: 구형 payload는 OrderCancelledSchema 필수 필드(reason, cancelledBy 등)가
        // 없어 Kafka 발행 시 검증 오류가 발생한다. Channel Adapter는 이미 core.orders.events.v1/
        // SalesOrderCancelled 를 구독하므로 이 이벤트는 Kafka 미발행, published 처리한다.
        this.logger.warn(
          `레거시 취소 이벤트 건너뜀: ${event.id} (${event.event_type}) — Kafka 미발행, published 처리`,
        );
      } else {
        await this.fulfillmentPublisher.publishEvent({
          eventType: event.event_type as keyof FulfillmentEvents,
          aggregateId: event.aggregate_id,
          payload: event.payload as unknown as FulfillmentPayload,
          metadata: { partitionKey: event.partition_key },
        });
      }

      await this.db.db
        .update(wmsTables.outboxEvents)
        .set({
          status: 'published',
          publishedAt: new Date(),
        })
        .where(eq(wmsTables.outboxEvents.id, event.id));

      this.logger.debug(`✅ Event ${event.id}: ${event.event_type} (${event.aggregate_type})`);
    } catch (error) {
      const newAttempts = event.attempts + 1;
      const isFinalFailure = newAttempts >= 5;

      await this.db.db
        .update(wmsTables.outboxEvents)
        .set({
          status: isFinalFailure ? 'failed' : 'pending',
          attempts: newAttempts,
          nextAttemptAt: isFinalFailure ? undefined : this.calculateNextAttempt(newAttempts),
        })
        .where(eq(wmsTables.outboxEvents.id, event.id));

      this.logger.error(
        `❌ Event ${event.id} 실패 (${newAttempts}/5): ${event.event_type} (${event.aggregate_type})`,
        error instanceof Error ? error.message : String(error),
      );

      if (isFinalFailure) {
        this.logger.error(`🚨 최종 실패: ${event.id} (${event.event_type}) - 수동 처리 필요`);
      }

      throw error;
    }
  }

  private calculateNextAttempt(attempts: number): Date {
    const delays = [10, 30, 60, 300];
    const delay = delays[Math.min(attempts - 1, delays.length - 1)];
    return new Date(Date.now() + delay * 1000);
  }

  async retryFailedEvents(eventIds?: string[]): Promise<number> {
    const result = await this.db.db
      .update(wmsTables.outboxEvents)
      .set({
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
      })
      .where(
        eventIds
          ? and(eq(wmsTables.outboxEvents.status, 'failed'), inArray(wmsTables.outboxEvents.id, eventIds))
          : eq(wmsTables.outboxEvents.status, 'failed'),
      )
      .returning({ id: wmsTables.outboxEvents.id });

    this.logger.log(`수동 재시도: ${result.length}개 이벤트 재활성화`);
    return result.length;
  }
}
