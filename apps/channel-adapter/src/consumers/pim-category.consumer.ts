// PIM에서 카테고리 변경 이벤트가 발생하면 Inbox에 저장

import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload, EventEnvelope } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { DomainEvent } from '@packages/event-contracts/types';
import { CategoryChangedPayload } from '@packages/event-contracts/streams/product.stream';
import { DbService } from '@app/db';
import { processedEvents, inboxEvents } from '../schema';
import { eq } from 'drizzle-orm';
import type { ChannelAdapterSchema } from '../types';

/**
 * PIM Category Event Consumer
 *
 * PIM 서비스가 발행한 Category 이벤트를 수신하여 Inbox에 저장합니다.
 * InboxWorker가 비동기로 Medusa에 동기화 처리합니다.
 *
 * - CategoryChanged: 카테고리 생성/수정/삭제/이동
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class PimCategoryConsumer {
  private readonly logger = new Logger(PimCategoryConsumer.name);

  constructor(private readonly dbService: DbService<ChannelAdapterSchema>) {
    this.logger.log('PIM Category Event Consumer 초기화 완료');
  }

  /**
   * PIM CategoryChanged 이벤트 처리
   *
   * 이벤트를 Inbox에 저장하여 InboxWorker가 비동기로 처리하도록 함
   *
   * @param envelope 이벤트 메타데이터 (correlationId, timestamp 등)
   * @param payload 이벤트 페이로드
   */
  @OnEvent('products.events.v1', 'CategoryChanged')
  async onCategoryChanged(
    @EventEnvelope() envelope: DomainEvent<CategoryChangedPayload>,
    @EventPayload() payload: CategoryChangedPayload,
  ): Promise<void> {
    const startTime = Date.now();
    const { categoryId, changeType } = payload;

    this.logger.log(
      `[PIM] Category Event 수신: ${categoryId} → ${changeType} (correlationId: ${envelope.correlationId})`,
    );

    try {
      const db = this.dbService.db;

      // 1. 멱등성 체크: 동일 이벤트 처리 방지
      const idempotencyKey = `${categoryId}:${changeType}:CategoryChanged:${envelope.messageId || new Date().toISOString()}`;
      const [existing] = await db
        .select()
        .from(processedEvents)
        .where(eq(processedEvents.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existing) {
        this.logger.debug(`[PIM] 이미 처리된 이벤트 스킵: ${idempotencyKey}`);
        return;
      }

      // 2. processedEvents에 기록
      await db.insert(processedEvents).values({
        idempotencyKey,
        source: 'products.events.v1',
        eventType: 'CategoryChanged',
        resourceId: categoryId,
        eventVersion: envelope.messageId || new Date().toISOString(),
        status: 'PROCESSED',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 3. Inbox에 저장 (InboxWorker가 처리할 것)
      await db.insert(inboxEvents).values({
        eventType: 'CategoryChanged',
        aggregateType: 'Category',
        aggregateId: categoryId,
        partitionKey: categoryId, // Category 도메인은 categoryId로 파티셔닝
        payload: payload,
        metadata: {
          correlationId: envelope.correlationId,
          messageId: envelope.messageId,
          chainId: envelope.chainId,
        },
        status: 'pending',
        createdAt: new Date(),
      });

      const duration = Date.now() - startTime;
      this.logger.log(`[PIM] Inbox 저장 완료: ${categoryId} (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`[PIM] Inbox 저장 실패: ${categoryId} (${duration}ms)`, {
        error: error.message,
        stack: error.stack,
      });
      throw error; // Re-throw to send to DLQ
    }
  }

  /**
   * Consumer 상태 확인 (헬스체크용)
   */
  getHealthStatus() {
    return {
      consumer: 'PimCategoryConsumer',
      topic: 'products.events.v1',
      eventType: 'CategoryChanged',
      status: 'active',
      lastProcessedAt: new Date().toISOString(),
    };
  }
}
