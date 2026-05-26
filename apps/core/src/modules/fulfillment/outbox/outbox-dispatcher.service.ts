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

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    @InjectStreamPublisher(FULFILLMENT_STREAM.topic.topic)
    private readonly fulfillmentPublisher: StreamPublisher<FulfillmentEvents>,
    @InjectStreamPublisher(INVENTORY_STREAM.topic.topic)
    private readonly inventoryPublisher: StreamPublisher<InventoryEvents>,
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
        await tx
          .update(wmsTables.outboxEvents)
          .set({
            attempts: sql`${wmsTables.outboxEvents.attempts} + 1`,
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
