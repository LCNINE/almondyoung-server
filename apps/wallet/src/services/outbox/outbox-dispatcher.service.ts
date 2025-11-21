import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import {
  PAYMENT_STREAM,
  PaymentEvents,
} from '@packages/event-contracts/streams';
import { walletSchema } from '../../shared/database/schema';
import * as schema from '../../shared/database/schema';
import { eq, and, lte, sql } from 'drizzle-orm';

/**
 * OutboxDispatcher
 *
 * 책임: Outbox 테이블의 이벤트를 Kafka로 발행
 * - Cron으로 주기적 폴링 (10초마다)
 * - FOR UPDATE SKIP LOCKED로 동시성 제어
 * - 발행 실패 시 재시도 (최대 5회)
 */
@Injectable()
export class OutboxDispatcher implements OnModuleInit {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private isProcessing = false;

  constructor(
    private readonly db: DbService<typeof walletSchema>,
    @InjectStreamPublisher(PAYMENT_STREAM.topic.topic)
    private readonly paymentPublisher: StreamPublisher<PaymentEvents>,
  ) {}

  onModuleInit() {
    this.logger.log('OutboxDispatcher 초기화 완료 ✅');
  }

  /**
   * Cron: 10초마다 실행
   *
   * PENDING 상태의 이벤트를 조회하여 Kafka로 발행
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async dispatch() {
    // 중복 실행 방지
    if (this.isProcessing) {
      this.logger.debug('이전 dispatch 작업 진행 중, 건너뜀');
      return;
    }

    this.isProcessing = true;

    try {
      const batchSize = 100;
      let processedCount = 0;

      // 1. PENDING 이벤트 조회 (FOR UPDATE SKIP LOCKED)
      const events = await this.db.db.transaction(async (tx) => {
        const pendingEvents = await tx.execute<{
          id: string;
          event_type: string;
          aggregate_type: string;
          aggregate_id: string;
          partition_key: string;
          payload: any;
          metadata: any;
          attempts: number;
        }>(sql`
          SELECT 
            id, 
            event_type, 
            aggregate_type, 
            aggregate_id, 
            partition_key, 
            payload, 
            metadata, 
            attempts
          FROM ${schema.outboxEvents}
          WHERE status = 'PENDING'
            AND next_attempt_at <= NOW()
          ORDER BY created_at ASC
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        `);

        if (pendingEvents.length === 0) {
          return [];
        }

        // 2. 상태를 PROCESSING으로 변경 (트랜잭션 내)
        const eventIds = pendingEvents.map((e) => e.id);
        await tx
          .update(schema.outboxEvents)
          .set({
            status: 'PENDING', // 아직 PROCESSING 상태 없으므로 PENDING 유지
            attempts: sql`${schema.outboxEvents.attempts} + 1`,
            updatedAt: new Date(),
          })
          .where(sql`${schema.outboxEvents.id} = ANY(${eventIds})`);

        return pendingEvents;
      });

      if (events.length === 0) {
        return;
      }

      this.logger.log(`📤 Outbox 이벤트 발행 시작: ${events.length}개`);

      // 3. 각 이벤트를 Kafka로 발행 (트랜잭션 밖)
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
   */
  private async publishEvent(event: {
    id: string;
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    partition_key: string;
    payload: any;
    metadata: any;
    attempts: number;
  }) {
    try {
      // Kafka로 발행
      await this.paymentPublisher.publishEvent({
        eventType: event.event_type as any,
        aggregateId: event.aggregate_id,
        payload: event.payload,
        metadata: event.metadata,
      });

      // 성공 → PUBLISHED 상태로 변경
      await this.db.db
        .update(schema.outboxEvents)
        .set({
          status: 'PUBLISHED',
          publishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.outboxEvents.id, event.id));

      this.logger.debug(`✅ Event ${event.id}: ${event.event_type}`);
    } catch (error) {
      // 실패 처리
      const newAttempts = event.attempts + 1;
      const isFinalFailure = newAttempts >= 5;

      await this.db.db
        .update(schema.outboxEvents)
        .set({
          status: isFinalFailure ? 'FAILED' : 'PENDING',
          attempts: newAttempts,
          errorMessage: error instanceof Error ? error.message : String(error),
          nextAttemptAt: isFinalFailure
            ? undefined
            : this.calculateNextAttempt(newAttempts),
          updatedAt: new Date(),
        })
        .where(eq(schema.outboxEvents.id, event.id));

      this.logger.error(
        `❌ Event ${event.id} 실패 (${newAttempts}/5): ${event.event_type}`,
        error instanceof Error ? error.message : String(error),
      );

      // 최종 실패 시 알림 (TODO: 슬랙, 이메일 등)
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
      .update(schema.outboxEvents)
      .set({
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(
        eventIds
          ? and(
              eq(schema.outboxEvents.status, 'FAILED'),
              sql`${schema.outboxEvents.id} = ANY(${eventIds})`,
            )
          : eq(schema.outboxEvents.status, 'FAILED'),
      )
      .returning({ id: schema.outboxEvents.id }); // [Changed]: 업데이트된 row의 id 반환

    this.logger.log(`수동 재시도: ${result.length}개 이벤트 재활성화`);
    return result.length;
  }
}
