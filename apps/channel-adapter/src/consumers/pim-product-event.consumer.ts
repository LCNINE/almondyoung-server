// PIM에서 publish/unpublish/rollback 이벤트가 발생하면 Inbox에 저장

import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload, EventEnvelope } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { DomainEvent } from '@packages/event-contracts/types';
import {
  ProductMasterActiveVersionChangedPayload,
  ProductMasterDeletedPayload,
} from '@packages/event-contracts/streams/product.stream';
import { DbService } from '@app/db';
import { processedEvents, inboxEvents } from '../schema';
import { eq } from 'drizzle-orm';
import type { ChannelAdapterSchema } from '../types';
import { createHash } from 'crypto';

const PRODUCT_TOPIC = 'products.events.v1';
const ACTIVE_VERSION_CHANGED = 'ProductMasterActiveVersionChanged';
const MASTER_DELETED = 'ProductMasterDeleted';

/**
 * PIM Product Event Consumer
 *
 * PIM 서비스가 발행한 Product 이벤트를 수신하여 Inbox에 저장합니다.
 * InboxWorker가 비동기로 Medusa에 동기화 처리합니다.
 *
 * - ProductMasterActiveVersionChanged: 상품 버전 활성화 변경 (발행/취소/롤백)
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class PimProductEventConsumer {
  private readonly logger = new Logger(PimProductEventConsumer.name);

  constructor(private readonly dbService: DbService<ChannelAdapterSchema>) {
    this.logger.log('PIM Product Event Consumer 초기화 완료');
  }

  private buildEventInstanceIdempotency(
    eventType: typeof ACTIVE_VERSION_CHANGED | typeof MASTER_DELETED,
    envelope: Pick<DomainEvent<unknown>, 'messageId'>,
    fallbackParts: string[],
  ): { idempotencyKey: string; eventVersion: string } {
    if (envelope.messageId) {
      return {
        idempotencyKey: `${PRODUCT_TOPIC}:${eventType}:${envelope.messageId}`,
        eventVersion: envelope.messageId,
      };
    }

    const fallbackKey = fallbackParts.join(':');
    const digest = createHash('sha256').update(fallbackKey).digest('hex').slice(0, 40);
    return {
      idempotencyKey: `${PRODUCT_TOPIC}:${eventType}:${fallbackKey}`,
      eventVersion: `fallback:${digest}`,
    };
  }

  private async saveToInboxOnce(params: {
    eventType: typeof ACTIVE_VERSION_CHANGED | typeof MASTER_DELETED;
    masterId: string;
    payload: ProductMasterActiveVersionChangedPayload | ProductMasterDeletedPayload;
    envelope: DomainEvent<ProductMasterActiveVersionChangedPayload> | DomainEvent<ProductMasterDeletedPayload>;
    idempotencyKey: string;
    eventVersion: string;
  }): Promise<boolean> {
    const db = this.dbService.db;

    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(processedEvents)
        .where(eq(processedEvents.idempotencyKey, params.idempotencyKey))
        .limit(1);

      if (existing) {
        this.logger.debug(`[PIM] 이미 처리된 이벤트 스킵: ${params.idempotencyKey}`);
        return false;
      }

      const now = new Date();

      await tx.insert(processedEvents).values({
        idempotencyKey: params.idempotencyKey,
        source: PRODUCT_TOPIC,
        eventType: params.eventType,
        resourceId: params.masterId,
        eventVersion: params.eventVersion,
        status: 'PROCESSED',
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(inboxEvents).values({
        eventType: params.eventType,
        aggregateType: 'Product',
        aggregateId: params.masterId,
        partitionKey: params.masterId,
        payload: params.payload,
        metadata: {
          correlationId: params.envelope.correlationId,
          messageId: params.envelope.messageId,
          chainId: params.envelope.chainId,
        },
        status: 'pending',
        createdAt: now,
      });

      return true;
    });
  }

  /**
   * PIM ProductMasterActiveVersionChanged 이벤트 처리
   *
   * 이벤트를 Inbox에 저장하여 InboxWorker가 비동기로 처리하도록 함
   *
   * @param envelope 이벤트 메타데이터 (correlationId, timestamp 등)
   * @param payload 이벤트 페이로드
   */
  @OnEvent('products.events.v1', 'ProductMasterActiveVersionChanged')
  async onProductMasterActiveVersionChanged(
    @EventEnvelope() envelope: DomainEvent<ProductMasterActiveVersionChangedPayload>,
    @EventPayload() payload: ProductMasterActiveVersionChangedPayload,
  ): Promise<void> {
    const startTime = Date.now();
    const { masterId, versionId, changeReason } = payload;

    this.logger.log(
      `[PIM] Product Event 수신: ${masterId} → ${changeReason} (correlationId: ${envelope.correlationId})`,
      {
        versionId,
      },
    );

    try {
      const { idempotencyKey, eventVersion } = this.buildEventInstanceIdempotency(ACTIVE_VERSION_CHANGED, envelope, [
        masterId,
        versionId ?? 'none',
        changeReason,
        payload.changedAt,
      ]);

      const saved = await this.saveToInboxOnce({
        eventType: ACTIVE_VERSION_CHANGED,
        masterId,
        payload,
        envelope,
        idempotencyKey,
        eventVersion,
      });

      if (!saved) return;

      const duration = Date.now() - startTime;
      this.logger.log(`[PIM] Inbox 저장 완료: ${masterId} (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`[PIM] Inbox 저장 실패: ${masterId} (${duration}ms)`, {
        error: error.message,
        stack: error.stack,
      });
      throw error; // Re-throw to send to DLQ
    }
  }

  @OnEvent(PRODUCT_TOPIC, MASTER_DELETED)
  async onProductMasterDeleted(
    @EventEnvelope() envelope: DomainEvent<ProductMasterDeletedPayload>,
    @EventPayload() payload: ProductMasterDeletedPayload,
  ): Promise<void> {
    const startTime = Date.now();
    const { masterId } = payload;

    this.logger.log(`[PIM] Product deleted event 수신: ${masterId} (correlationId: ${envelope.correlationId})`);

    try {
      const { idempotencyKey, eventVersion } = this.buildEventInstanceIdempotency(MASTER_DELETED, envelope, [
        masterId,
        'deleted',
        payload.deletedAt,
      ]);

      const saved = await this.saveToInboxOnce({
        eventType: MASTER_DELETED,
        masterId,
        payload,
        envelope,
        idempotencyKey,
        eventVersion,
      });

      if (!saved) return;

      const duration = Date.now() - startTime;
      this.logger.log(`[PIM] Deleted inbox 저장 완료: ${masterId} (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`[PIM] Deleted inbox 저장 실패: ${masterId} (${duration}ms)`, {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Consumer 상태 확인 (헬스체크용)
   */
  getHealthStatus() {
    return {
      consumer: 'PimProductEventConsumer',
      topic: 'products.events.v1',
      status: 'active',
      lastProcessedAt: new Date().toISOString(),
    };
  }
}
