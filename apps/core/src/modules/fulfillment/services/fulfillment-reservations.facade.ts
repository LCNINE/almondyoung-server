import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { eq, and } from 'drizzle-orm';
import { UnifiedReservationService } from '../../inventory/shared/services/unified-reservation.service';
import { ProductSellableQuantityService } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';

@Injectable()
export class FulfillmentReservationsFacade {
  private readonly logger = new Logger(FulfillmentReservationsFacade.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly unified: UnifiedReservationService,
    private readonly productSellableQuantity: ProductSellableQuantityService,
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  async reserve(dto: { fulfillmentOrderItemId: string; quantity: number }, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const foi = await trx.query.fulfillmentOrderItems.findFirst({
        where: eq(wmsTables.fulfillmentOrderItems.id, dto.fulfillmentOrderItemId),
      });
      if (!foi) {
        throw new BadRequestException(`FOI ${dto.fulfillmentOrderItemId} not found`);
      }

      const fo = await trx.query.fulfillmentOrders.findFirst({
        where: eq(wmsTables.fulfillmentOrders.id, foi.fulfillmentOrderId),
      });
      if (!fo) {
        throw new BadRequestException(`FO ${foi.fulfillmentOrderId} not found`);
      }
      if (!fo.warehouseId) {
        throw new BadRequestException(`FO ${fo.id} has no warehouseId`);
      }

      const reservation = await this.unified.reserveStock(
        {
          targetType: 'FULFILLMENT_ORDER',
          targetId: fo.id,
          skuId: foi.skuId,
          warehouseId: fo.warehouseId,
          quantity: dto.quantity,
          reason: 'Fulfillment order item reservation',
        },
        trx,
      );

      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ reservedQty: (foi.reservedQty || 0) + dto.quantity, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrderItems.id, foi.id));

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ totalReservedQty: (fo.totalReservedQty || 0) + dto.quantity, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, fo.id));

      this.logger.log(`Reserved ${dto.quantity} of SKU ${foi.skuId} for FO ${fo.id} (FOI ${foi.id})`);
      return reservation;
    }, tx);
  }

  async unreserve(dto: { fulfillmentOrderItemId: string; quantity: number }, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const foi = await trx.query.fulfillmentOrderItems.findFirst({
        where: eq(wmsTables.fulfillmentOrderItems.id, dto.fulfillmentOrderItemId),
      });
      if (!foi) {
        throw new BadRequestException(`FOI ${dto.fulfillmentOrderItemId} not found`);
      }
      const fo = await trx.query.fulfillmentOrders.findFirst({
        where: eq(wmsTables.fulfillmentOrders.id, foi.fulfillmentOrderId),
      });
      if (!fo) {
        throw new BadRequestException(`FO ${foi.fulfillmentOrderId} not found`);
      }

      const reservations = await this.unified.getReservationsByTarget('FULFILLMENT_ORDER', fo.id, trx);
      let remaining = dto.quantity;
      for (const r of reservations) {
        if (remaining <= 0) break;
        if (r.skuId !== foi.skuId) continue;
        if (r.quantity <= remaining) {
          await this.unified.releaseReservation(r.id, trx);
          remaining -= r.quantity;
        } else {
          await trx
            .update(wmsTables.stockReservations)
            .set({ quantity: r.quantity - remaining, updatedAt: new Date() })
            .where(and(eq(wmsTables.stockReservations.id, r.id), eq(wmsTables.stockReservations.status, 'confirmed')));
          remaining = 0;
        }
      }

      const released = dto.quantity - Math.max(0, remaining);
      if (released > 0) {
        await this.productSellableQuantity.recalculateAndPublishForSku(foi.skuId, trx);
      }

      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ reservedQty: Math.max(0, (foi.reservedQty || 0) - released), updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrderItems.id, foi.id));

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ totalReservedQty: Math.max(0, (fo.totalReservedQty || 0) - released), updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, fo.id));

      this.logger.log(`Unreserved ${released}/${dto.quantity} of SKU ${foi.skuId} for FO ${fo.id} (FOI ${foi.id})`);
    }, tx);
  }

  async transferReservation(
    dto: { fromFulfillmentOrderItemId: string; toFulfillmentOrderItemId: string; quantity: number },
    tx?: DbTx,
  ) {
    return this.inTx(async (trx) => {
      const from = await trx.query.fulfillmentOrderItems.findFirst({
        where: eq(wmsTables.fulfillmentOrderItems.id, dto.fromFulfillmentOrderItemId),
      });
      const to = await trx.query.fulfillmentOrderItems.findFirst({
        where: eq(wmsTables.fulfillmentOrderItems.id, dto.toFulfillmentOrderItemId),
      });
      if (!from || !to) {
        throw new BadRequestException('Invalid FOI id(s)');
      }
      const fromFo = await trx.query.fulfillmentOrders.findFirst({
        where: eq(wmsTables.fulfillmentOrders.id, from.fulfillmentOrderId),
      });
      const toFo = await trx.query.fulfillmentOrders.findFirst({
        where: eq(wmsTables.fulfillmentOrders.id, to.fulfillmentOrderId),
      });
      if (!fromFo || !toFo || !toFo.warehouseId) {
        throw new BadRequestException('Invalid FO(s) or target FO has no warehouse');
      }
      if (from.skuId !== to.skuId) {
        throw new BadRequestException('SKU mismatch between from/to FOI');
      }

      await this.unified.reserveStock(
        {
          targetType: 'FULFILLMENT_ORDER',
          targetId: toFo.id,
          skuId: to.skuId,
          warehouseId: toFo.warehouseId,
          quantity: dto.quantity,
          reason: `Transfer from FOI ${from.id} to ${to.id}`,
        },
        trx,
      );

      await this.unreserve({ fulfillmentOrderItemId: from.id, quantity: dto.quantity }, trx);

      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ reservedQty: (to.reservedQty || 0) + dto.quantity, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrderItems.id, to.id));

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ totalReservedQty: (toFo.totalReservedQty || 0) + dto.quantity, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, toFo.id));

      this.logger.log(`Transferred ${dto.quantity} from FOI ${from.id} to FOI ${to.id}`);
    }, tx);
  }
}
