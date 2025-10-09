import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import { TestEvents } from '../test-stream.config';
import { sql, eq, inArray } from 'drizzle-orm';
import { Database } from '../../../database/schemas/demo-schema';
import { outbox_events, OutboxEvent } from '../../../database/schemas/outbox.schema';

interface OutboxEventRow {
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
    @Inject('DATABASE') private readonly db: Database,
    @InjectStreamPublisher('test.events.v1')
    private readonly testPublisher: StreamPublisher<TestEvents>,
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
  private async acquireEventBatch(): Promise<OutboxEventRow[]> {
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

      const selected = result;

      if (selected.length === 0) {
        return [];
      }

      // 2. 즉시 PROCESSING 상태로 변경 (다른 인스턴스가 못 가져가게)
      const ids = selected.map(e => e.id);

      await tx
        .update(outbox_events)
        .set({ status: 'PROCESSING' })
        .where(inArray(outbox_events.id, ids));

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
  private async processEvent(event: OutboxEventRow) {
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
  private async publishToKafka(event: OutboxEventRow) {
    // aggregateType에 따라 적절한 publisher로 발행
    switch (event.aggregateType) {
      case 'TestRecord':
        await this.testPublisher.publishEvent({
          eventType: event.eventType as keyof TestEvents,
          aggregateId: event.aggregateId,
          payload: event.payload,
          metadata: event.metadata,
          correlationId: event.correlationId,
          causationId: event.causationId,
        });
        break;
      default:
        throw new Error(`Unknown aggregate type: ${event.aggregateType}`);
    }
  }

  /**
   * 최종 실패 알림
   */
  private async sendFailureAlert(event: OutboxEventRow, error: Error) {
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

    const deletedCount = result.length;
    this.logger.log(`🧹 Cleaned up ${deletedCount} old events`);
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

    const failedCount = result[0]?.count || 0;

    if (failedCount > 0) {
      this.logger.warn(`⚠️  ${failedCount} events in FAILED status`);
    }
  }
}
