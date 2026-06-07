import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { outbox_events } from './outbox.schema';
import { OutboxConfig } from './outbox.types';
import { eq, inArray, and, lt, lte, or, isNull } from 'drizzle-orm';

@Injectable()
export class OutboxDispatcher {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private readonly config: Required<OutboxConfig>;
  private readonly publisherMap: Map<string, StreamPublisher>;

  constructor(
    private readonly dbService: DbService,
    publisherMap: Map<string, StreamPublisher>,
    config?: OutboxConfig,
  ) {
    this.publisherMap = publisherMap;
    this.config = {
      dispatchIntervalMs: config?.dispatchIntervalMs ?? 5000,
      batchSize: config?.batchSize ?? 100,
      maxRetries: config?.maxRetries ?? 5,
      processingTimeoutMs: config?.processingTimeoutMs ?? 300_000,
      cleanupDays: config?.cleanupDays ?? 7,
    };
  }

  private get db() {
    return this.dbService.db;
  }

  @Cron('*/5 * * * * *')
  async dispatchPendingEvents() {
    try {
      await this.requeueStaleProcessingEvents();
      const events = await this.acquireEventBatch();

      if (events.length === 0) {
        return;
      }

      this.logger.log(`Processing ${events.length} outbox events`);

      for (const event of events) {
        await this.processEvent(event);
      }
    } catch (error) {
      this.logger.error('Dispatcher error:', error);
    }
  }

  private async acquireEventBatch() {
    return await this.db.transaction(async (tx) => {
      const processingStartedAt = new Date();
      const result = await tx
        .select({
          id: outbox_events.id,
          topic: outbox_events.topic,
          aggregateType: outbox_events.aggregateType,
          aggregateId: outbox_events.aggregateId,
          eventType: outbox_events.eventType,
          payload: outbox_events.payload,
          retryCount: outbox_events.retryCount,
          createdAt: outbox_events.createdAt,
        })
        .from(outbox_events)
        .where(and(eq(outbox_events.status, 'PENDING'), lt(outbox_events.retryCount, this.config.maxRetries)))
        .orderBy(outbox_events.createdAt)
        .limit(this.config.batchSize)
        .for('update', { skipLocked: true });

      if (result.length === 0) {
        return [];
      }

      const ids = result.map((e) => e.id);

      await tx
        .update(outbox_events)
        .set({ status: 'PROCESSING', processingStartedAt })
        .where(inArray(outbox_events.id, ids));

      return result;
    });
  }

  private async requeueStaleProcessingEvents() {
    const threshold = new Date(Date.now() - this.config.processingTimeoutMs);
    const timeoutSeconds = Math.floor(this.config.processingTimeoutMs / 1000);

    const result = await this.db
      .update(outbox_events)
      .set({
        status: 'PENDING',
        processingStartedAt: null,
        errorMessage: `Requeued after ${timeoutSeconds}s processing timeout`,
      })
      .where(
        and(
          eq(outbox_events.status, 'PROCESSING'),
          or(isNull(outbox_events.processingStartedAt), lte(outbox_events.processingStartedAt, threshold)),
        ),
      )
      .returning({ id: outbox_events.id });

    if (result.length > 0) {
      this.logger.warn(`Requeued ${result.length} stale outbox events`);
    }
  }

  private async processEvent(event: any) {
    try {
      const publisher = this.publisherMap.get(event.topic);

      if (!publisher) {
        throw new Error(`No publisher found for topic: ${event.topic}`);
      }

      await publisher.publishRawEnvelope(event.payload, event.aggregateId);

      await this.db
        .update(outbox_events)
        .set({
          status: 'PUBLISHED',
          processingStartedAt: null,
          publishedAt: new Date(),
        })
        .where(eq(outbox_events.id, event.id));

      this.logger.log(`Event ${event.id} published: ${event.eventType}`);
    } catch (error) {
      await this.handleFailure(event, error);
    }
  }

  private async handleFailure(event: any, error: any) {
    const newRetryCount = event.retryCount + 1;
    const isFinalFailure = newRetryCount >= this.config.maxRetries;

    await this.db
      .update(outbox_events)
      .set({
        status: isFinalFailure ? 'FAILED' : 'PENDING',
        processingStartedAt: null,
        retryCount: newRetryCount,
        errorMessage: error.message,
        failedAt: isFinalFailure ? new Date() : undefined,
      })
      .where(eq(outbox_events.id, event.id));

    this.logger.error(`Event ${event.id} failed (${newRetryCount}/${this.config.maxRetries}): ${error.message}`);
  }

  @Cron('0 2 * * *')
  async cleanupOldEvents() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.cleanupDays);

    const result = await this.db
      .delete(outbox_events)
      .where(and(eq(outbox_events.status, 'PUBLISHED'), lt(outbox_events.publishedAt, cutoffDate)))
      .returning({ id: outbox_events.id });

    this.logger.log(`Cleaned up ${result.length} old outbox events`);
  }
}
