import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { desc, eq } from 'drizzle-orm';
import { WarehouseService } from '../../inventory/warehouse/services/warehouse.service';
import { DbTx, FulfillmentOrderCreationBacklog, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  FulfillmentCreationMissingLine,
  FulfillmentOrderCreationBacklogService,
} from '../backlog/fulfillment-order-creation-backlog.service';
import { FulfillmentsService } from './fulfillments.service';

@Injectable()
export class FulfillmentOrderCreationBacklogWorker {
  private readonly logger = new Logger(FulfillmentOrderCreationBacklogWorker.name);
  private isProcessing = false;

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly backlog: FulfillmentOrderCreationBacklogService,
    private readonly fulfillments: FulfillmentsService,
    private readonly warehouses: WarehouseService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async processPending() {
    if (this.isProcessing) {
      this.logger.debug('Previous fulfillment creation backlog run is still active, skipping');
      return;
    }

    this.isProcessing = true;
    try {
      const rows = await this.backlog.claimPending(20);
      for (const row of rows) {
        try {
          await this.processOne(row.id);
        } catch (error) {
          this.logger.error(`Failed to process fulfillment creation backlog ${row.id}`, error);
          try {
            await this.backlog.markFailed(row.id, row.attempts, error);
          } catch (markError) {
            this.logger.error(`Failed to mark fulfillment creation backlog ${row.id} as failed`, markError);
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to process fulfillment creation backlog batch', error);
    } finally {
      this.isProcessing = false;
    }
  }

  async processOne(backlogId: string) {
    await this.db.transaction(async (tx) => {
      const backlog = await this.backlog.findById(backlogId, tx);
      if (!backlog || backlog.status !== 'processing') {
        return;
      }

      await this.processClaimed(backlog, tx);
    });
  }

  private async processClaimed(backlog: FulfillmentOrderCreationBacklog, tx: DbTx) {
    const [salesOrder] = await tx
      .select()
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, backlog.salesOrderId))
      .limit(1);

    if (!salesOrder) {
      await this.backlog.markFailed(backlog.id, backlog.attempts, new Error('Sales order not found'), tx);
      return;
    }

    if (salesOrder.status === 'cancelled') {
      await this.backlog.markNotRequired(backlog.id, tx);
      return;
    }

    const existingFulfillmentOrder = await this.findExistingFulfillmentOrder(backlog.salesOrderId, tx);
    if (existingFulfillmentOrder) {
      await this.backlog.markCompleted(backlog.id, existingFulfillmentOrder.id, tx);
      return;
    }

    try {
      const requiresPhysicalFulfillmentOrder = await this.fulfillments.requiresPhysicalFulfillmentOrder(
        backlog.salesOrderId,
        tx,
      );
      if (!requiresPhysicalFulfillmentOrder) {
        await this.backlog.markNotRequired(backlog.id, tx);
        return;
      }

      const fulfillmentOrder = await this.fulfillments.create(
        {
          salesOrderId: backlog.salesOrderId,
          warehouseId: this.warehouses.getDefaultId(),
          shippingAddress: salesOrder.shippingAddress as any,
        },
        tx,
      );

      if (fulfillmentOrder?.id) {
        await this.backlog.markCompleted(backlog.id, fulfillmentOrder.id, tx);
      } else {
        await this.backlog.markNotRequired(backlog.id, tx);
      }
    } catch (error) {
      if (this.isCancelledSalesOrderError(error)) {
        await this.backlog.markNotRequired(backlog.id, tx);
        return;
      }

      const missingLines = this.extractMissingLines(error);
      if (missingLines.length > 0) {
        await this.backlog.markAwaitingMatching(backlog.id, missingLines, tx);
        return;
      }

      await this.backlog.markFailed(backlog.id, backlog.attempts, error, tx);
    }
  }

  private isCancelledSalesOrderError(error: unknown): boolean {
    if (!(error instanceof BadRequestException)) {
      return false;
    }

    const response = error.getResponse();
    if (typeof response === 'string') {
      return response.includes('Cannot create fulfillment for cancelled sales order');
    }

    if (!response || typeof response !== 'object') {
      return false;
    }

    const message = (response as { message?: unknown }).message;
    return typeof message === 'string' && message.includes('Cannot create fulfillment for cancelled sales order');
  }

  private async findExistingFulfillmentOrder(salesOrderId: string, tx: DbTx) {
    const [row] = await tx
      .select()
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId))
      .orderBy(desc(wmsTables.fulfillmentOrders.createdAt))
      .limit(1);

    return row;
  }

  private extractMissingLines(error: unknown): FulfillmentCreationMissingLine[] {
    if (!(error instanceof BadRequestException)) {
      return [];
    }

    const response = error.getResponse();
    if (!response || typeof response !== 'object') {
      return [];
    }

    const code = (response as { code?: unknown }).code;
    const missingLines = (response as { missingLines?: unknown }).missingLines;
    if (code !== 'PRODUCT_SKU_MATCHING_REQUIRED' || !Array.isArray(missingLines)) {
      return [];
    }

    return missingLines.filter(this.isMissingLine);
  }

  private isMissingLine(value: unknown): value is FulfillmentCreationMissingLine {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const line = value as Partial<FulfillmentCreationMissingLine>;
    return (
      typeof line.salesOrderLineId === 'string' && typeof line.variantId === 'string' && typeof line.reason === 'string'
    );
  }
}
