import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { DomainEvent } from '@packages/event-contracts/types';
import { OrderCreatedPayload } from '@packages/event-contracts/streams/orders.stream';
import { analyticsSchema, factOrderEvents, factOrderItems } from '../../../schema';
import { DbTx } from '../../../db.types';
import { OrderAggregateSeed } from './order-types';

export type OrderCreatedFactResult = {
  claimed: boolean;
  seeds: OrderAggregateSeed[];
};

@Injectable()
export class OrderFactsService {
  private readonly logger = new Logger(OrderFactsService.name);

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async recordOrderCreated(
    envelope: DomainEvent<OrderCreatedPayload>,
    payload: OrderCreatedPayload,
    tx?: DbTx,
  ): Promise<OrderCreatedFactResult> {
    const orderKey = payload.externalOrderId ?? payload.orderId;
    const occurredAt = payload.createdAt ? new Date(payload.createdAt) : undefined;
    const occurredDate = this.toDateOnly(occurredAt ?? new Date());

    const result = await this.inTx(async (executor) => {
      const claimedEvents = await executor
        .insert(factOrderEvents)
        .values({
          messageId: envelope.messageId,
          messageType: envelope.messageType,
          messageVersion: envelope.messageVersion,
          messageKind: envelope.messageKind,
          correlationId: envelope.correlationId,
          causationId: envelope.causationId,
          aggregateType: envelope.source.aggregateType,
          aggregateId: envelope.source.aggregateId,
          sourceService: envelope.source.service,
          salesChannel: payload.salesChannel,
          orderId: payload.orderId,
          externalOrderId: payload.externalOrderId,
          occurredAt,
          payload: envelope.payload,
          metadata: envelope.metadata ?? null,
        })
        .onConflictDoNothing({
          target: factOrderEvents.messageId,
        })
        .returning({
          messageId: factOrderEvents.messageId,
        });

      if (claimedEvents.length === 0) {
        return { claimed: false, seeds: [] };
      }

      if (payload.items.length === 0) {
        return { claimed: true, seeds: [] };
      }

      const insertedItems = await executor
        .insert(factOrderItems)
        .values(
          payload.items.map((item) => ({
            messageId: envelope.messageId,
            orderKey,
            orderId: payload.orderId,
            externalOrderId: payload.externalOrderId,
            salesChannel: payload.salesChannel,
            customerId: payload.customerId,
            orderItemId: item.orderItemId ?? null,
            masterId: item.masterId,
            versionId: item.versionId,
            variantId: item.variantId,
            skuId: item.skuId,
            productName: item.productName,
            channelProductId: item.channelProductId ?? null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            currency: payload.currency,
            occurredAt,
          })),
        )
        .onConflictDoNothing({
          target: [factOrderItems.orderKey, factOrderItems.salesChannel, factOrderItems.orderItemId],
        })
        .returning({
          masterId: factOrderItems.masterId,
          quantity: factOrderItems.quantity,
        });
      if (insertedItems.length === 0) {
        return { claimed: true, seeds: [] };
      }

      const aggregated = new Map<string, number>();
      for (const item of insertedItems) {
        aggregated.set(item.masterId, (aggregated.get(item.masterId) ?? 0) + (item.quantity ?? 0));
      }

      return {
        claimed: true,
        seeds: [...aggregated.entries()].map(([masterId, quantitySold]) => ({
          masterId,
          salesChannel: payload.salesChannel,
          occurredDate,
          orderCount: 1,
          quantitySold,
        })),
      };
    }, tx);

    if (result.claimed) {
      this.logger.debug(`OrderCreated persisted: ${payload.orderId} (${payload.salesChannel})`);
    } else {
      this.logger.debug(`Duplicate OrderCreated skipped: ${envelope.messageId}`);
    }

    return result;
  }

  private toDateOnly(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
}
