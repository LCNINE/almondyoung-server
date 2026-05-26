import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventEnvelope, EventPayload } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import type { DomainEvent } from '@packages/event-contracts/types';
import type { ProductSellableQuantityChangedPayload } from '@packages/event-contracts/streams/inventory.stream';
import { DbService } from '@app/db';
import { inboxEvents, processedEvents } from '../schema';
import { eq } from 'drizzle-orm';
import type { ChannelAdapterSchema } from '../types';

@Controller()
@UseInterceptors(EventTypeGuard)
export class ProductSellableQuantityConsumer {
  private readonly logger = new Logger(ProductSellableQuantityConsumer.name);

  constructor(private readonly dbService: DbService<ChannelAdapterSchema>) {
    this.logger.log('Product Sellable Quantity Consumer 초기화 완료');
  }

  @OnEvent('inventory.events.v1', 'ProductSellableQuantityChanged')
  async onProductSellableQuantityChanged(
    @EventEnvelope() envelope: DomainEvent<ProductSellableQuantityChangedPayload>,
    @EventPayload() payload: ProductSellableQuantityChangedPayload,
  ): Promise<void> {
    const startTime = Date.now();
    const idempotencyKey = `${payload.variantId}:${payload.calculatedAt}:ProductSellableQuantityChanged`;

    this.logger.log(
      `[Inventory] ProductSellableQuantityChanged 수신: variant=${payload.variantId}, ` +
        `qty=${payload.sellableQuantity}, reason=${payload.reason ?? 'unknown'}`,
    );

    try {
      const db = this.dbService.db;
      const [existing] = await db
        .select()
        .from(processedEvents)
        .where(eq(processedEvents.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existing) {
        this.logger.debug(`[Inventory] 이미 처리된 이벤트 스킵: ${idempotencyKey}`);
        return;
      }

      await db.insert(processedEvents).values({
        idempotencyKey,
        source: 'inventory.events.v1',
        eventType: 'ProductSellableQuantityChanged',
        resourceId: payload.variantId,
        eventVersion: envelope.messageId || payload.calculatedAt,
        status: 'PROCESSED',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await db.insert(inboxEvents).values({
        eventType: 'ProductSellableQuantityChanged',
        aggregateType: 'ProductVariant',
        aggregateId: payload.variantId,
        partitionKey: payload.variantId,
        payload,
        metadata: {
          correlationId: envelope.correlationId,
          messageId: envelope.messageId,
          chainId: envelope.chainId,
        },
        status: 'pending',
        createdAt: new Date(),
      });

      this.logger.log(`[Inventory] Inbox 저장 완료: ${payload.variantId} (${Date.now() - startTime}ms)`);
    } catch (error) {
      this.logger.error(`[Inventory] Inbox 저장 실패: ${payload.variantId} (${Date.now() - startTime}ms)`, {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  getHealthStatus() {
    return {
      consumer: 'ProductSellableQuantityConsumer',
      topic: 'inventory.events.v1',
      eventType: 'ProductSellableQuantityChanged',
      status: 'active',
      lastProcessedAt: new Date().toISOString(),
    };
  }
}
