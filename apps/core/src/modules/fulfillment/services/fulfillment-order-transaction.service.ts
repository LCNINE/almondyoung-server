import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { ReservationLifecycleService } from '../../inventory/shared/services/reservation-lifecycle.service';

@Injectable()
export class FulfillmentOrderTransactionService {
  private readonly logger = new Logger(FulfillmentOrderTransactionService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reservationLifecycle: ReservationLifecycleService,
  ) {}

  async cancelFulfillmentOrder(fulfillmentOrderId: string, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      const foRows = await trx
        .select({ id: wmsTables.fulfillmentOrders.id, status: wmsTables.fulfillmentOrders.status })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);
      const fulfillmentOrder = foRows[0];

      if (!fulfillmentOrder) {
        throw new BadRequestException(`Fulfillment order ${fulfillmentOrderId} not found`);
      }

      if (fulfillmentOrder.status === 'completed' || fulfillmentOrder.status === 'shipped') {
        throw new ConflictException(`Cannot cancel FO in status: ${fulfillmentOrder.status}`);
      }

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'canceled', canceledAt: new Date(), totalReservedQty: 0 })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

      await this.reservationLifecycle.handleFulfillmentOrderStatusChange(
        fulfillmentOrderId,
        fulfillmentOrder.status,
        'canceled',
        trx,
      );

      this.logger.log(`Canceled FO ${fulfillmentOrderId} and released reservations via lifecycle service`);
    }, tx);
  }

  async updateFulfillmentOrderPriority(
    fulfillmentOrderId: string,
    priority: 'normal' | 'high' | 'urgent',
    tx?: DbTx,
  ): Promise<void> {
    return this.dbService.run(async (trx) => {
      const [updated] = await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ priority, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .returning();

      if (!updated) {
        throw new BadRequestException(`Fulfillment order ${fulfillmentOrderId} not found`);
      }

      this.logger.log(`Updated FO ${fulfillmentOrderId} priority to ${priority}`);
    }, tx);
  }

  async allocateToOutboundBatch(fulfillmentOrderId: string, batchId: string, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      const foRows = await trx
        .select({
          id: wmsTables.fulfillmentOrders.id,
          status: wmsTables.fulfillmentOrders.status,
          totalItems: wmsTables.fulfillmentOrders.totalItems,
          totalQty: wmsTables.fulfillmentOrders.totalQty,
        })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);
      const fulfillmentOrder = foRows[0];

      if (!fulfillmentOrder) {
        throw new BadRequestException(`Fulfillment order ${fulfillmentOrderId} not found`);
      }

      if (!['ready', 'pending'].includes(fulfillmentOrder.status)) {
        throw new ConflictException(`FO must be ready for allocation. Current: ${fulfillmentOrder.status}`);
      }

      const batchRows = await trx
        .select({ id: wmsTables.outboundBatches.id, status: wmsTables.outboundBatches.status })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      const batch = batchRows[0];

      if (!batch) {
        throw new BadRequestException(`Outbound batch ${batchId} not found`);
      }

      if (batch.status !== 'created') {
        throw new ConflictException(`Batch must be in created status. Current: ${batch.status}`);
      }

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'allocated', batchId, allocatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

      const currentBatchItemsRows = await trx
        .select({ totalItems: wmsTables.outboundBatches.totalItems, totalQty: wmsTables.outboundBatches.totalQty })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      const currentBatchItems = currentBatchItemsRows[0];

      await trx
        .update(wmsTables.outboundBatches)
        .set({
          totalItems: (currentBatchItems?.totalItems || 0) + (fulfillmentOrder.totalItems ?? 0),
          totalQty: (currentBatchItems?.totalQty || 0) + (fulfillmentOrder.totalQty ?? 0),
        })
        .where(eq(wmsTables.outboundBatches.id, batchId));

      this.logger.log(`Allocated FO ${fulfillmentOrderId} to batch ${batchId}`);
    }, tx);
  }
}
