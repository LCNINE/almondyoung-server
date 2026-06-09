import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { eq, and } from 'drizzle-orm';
import { UnifiedReservationService } from '../../inventory/shared/services/unified-reservation.service';
import { ProductSellableQuantityService } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { FULFILLMENT_EVENTS } from '../events';
import { OutboxService } from '../outbox/outbox.service';
import { PoliciesService } from './policies.service';

@Injectable()
export class FulfillmentReservationsFacade {
  private readonly logger = new Logger(FulfillmentReservationsFacade.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly unified: UnifiedReservationService,
    private readonly productSellableQuantity: ProductSellableQuantityService,
    private readonly policies: PoliciesService,
    private readonly outbox: OutboxService,
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  private readonly TERMINAL_STATUSES = ['shipped', 'completed', 'canceled'] as const;

  async reserve(
    urlFulfillmentOrderId: string,
    dto: { fulfillmentOrderItemId: string; quantity: number },
    tx?: DbTx,
  ) {
    return this.inTx(async (trx) => {
      const foi = await trx.query.fulfillmentOrderItems.findFirst({
        where: eq(wmsTables.fulfillmentOrderItems.id, dto.fulfillmentOrderItemId),
      });
      if (!foi) {
        throw new BadRequestException(`FOI ${dto.fulfillmentOrderItemId} not found`);
      }
      if (foi.fulfillmentOrderId !== urlFulfillmentOrderId) {
        throw new BadRequestException(
          `FOI ${foi.id} belongs to FO ${foi.fulfillmentOrderId}, not ${urlFulfillmentOrderId}`,
        );
      }

      const fo = await trx.query.fulfillmentOrders.findFirst({
        where: eq(wmsTables.fulfillmentOrders.id, foi.fulfillmentOrderId),
      });
      if (!fo) {
        throw new BadRequestException(`FO ${foi.fulfillmentOrderId} not found`);
      }
      if (this.TERMINAL_STATUSES.includes(fo.status as any)) {
        throw new ConflictException(`Cannot reserve for FO ${fo.id} in status '${fo.status}'`);
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
          fulfillmentOrderItemId: foi.id,
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

      await this.refreshReservationStatus(fo.id, trx);

      this.logger.log(`Reserved ${dto.quantity} of SKU ${foi.skuId} for FO ${fo.id} (FOI ${foi.id})`);
      return reservation;
    }, tx);
  }

  async unreserve(
    urlFulfillmentOrderId: string,
    dto: { fulfillmentOrderItemId: string; quantity: number },
    tx?: DbTx,
  ) {
    return this.inTx(async (trx) => {
      const foi = await trx.query.fulfillmentOrderItems.findFirst({
        where: eq(wmsTables.fulfillmentOrderItems.id, dto.fulfillmentOrderItemId),
      });
      if (!foi) {
        throw new BadRequestException(`FOI ${dto.fulfillmentOrderItemId} not found`);
      }
      if (foi.fulfillmentOrderId !== urlFulfillmentOrderId) {
        throw new BadRequestException(
          `FOI ${foi.id} belongs to FO ${foi.fulfillmentOrderId}, not ${urlFulfillmentOrderId}`,
        );
      }

      const fo = await trx.query.fulfillmentOrders.findFirst({
        where: eq(wmsTables.fulfillmentOrders.id, foi.fulfillmentOrderId),
      });
      if (!fo) {
        throw new BadRequestException(`FO ${foi.fulfillmentOrderId} not found`);
      }
      if (this.TERMINAL_STATUSES.includes(fo.status as any)) {
        throw new ConflictException(`Cannot unreserve for FO ${fo.id} in status '${fo.status}'`);
      }
      if (foi.shippedQty > 0) {
        throw new ConflictException(
          `Cannot unreserve FOI ${foi.id}: shipped evidence exists (shippedQty=${foi.shippedQty})`,
        );
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

      await this.refreshReservationStatus(fo.id, trx);

      this.logger.log(`Unreserved ${released}/${dto.quantity} of SKU ${foi.skuId} for FO ${fo.id} (FOI ${foi.id})`);
    }, tx);
  }

  async transferReservation(
    urlFulfillmentOrderId: string,
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
      if (from.fulfillmentOrderId !== urlFulfillmentOrderId) {
        throw new BadRequestException(
          `Source FOI ${from.id} belongs to FO ${from.fulfillmentOrderId}, not ${urlFulfillmentOrderId}`,
        );
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
      if (this.TERMINAL_STATUSES.includes(fromFo.status as any)) {
        throw new ConflictException(`Cannot transfer reservation from FO ${fromFo.id} in status '${fromFo.status}'`);
      }
      if (this.TERMINAL_STATUSES.includes(toFo.status as any)) {
        throw new ConflictException(`Cannot transfer reservation to FO ${toFo.id} in status '${toFo.status}'`);
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
          fulfillmentOrderItemId: to.id,
          reason: `Transfer from FOI ${from.id} to ${to.id}`,
        },
        trx,
      );

      await this.unreserve(urlFulfillmentOrderId, { fulfillmentOrderItemId: from.id, quantity: dto.quantity }, trx);

      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ reservedQty: (to.reservedQty || 0) + dto.quantity, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrderItems.id, to.id));

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ totalReservedQty: (toFo.totalReservedQty || 0) + dto.quantity, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, toFo.id));

      await this.refreshReservationStatus(toFo.id, trx);

      this.logger.log(`Transferred ${dto.quantity} from FOI ${from.id} to FOI ${to.id}`);
    }, tx);
  }

  private async refreshReservationStatus(fulfillmentOrderId: string, trx: DbTx): Promise<void> {
    const fo = await trx.query.fulfillmentOrders.findFirst({
      where: eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId),
    });
    if (!fo) return;

    if (
      [
        'labeled',
        'allocated',
        'picking',
        'picked',
        'inspecting',
        'invoiced',
        'completed',
        'forwarded',
        'shipped',
        'canceled',
      ].includes(fo.status)
    ) {
      return;
    }

    const items = await trx.query.fulfillmentOrderItems.findMany({
      where: eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId),
    });
    if (items.length === 0) return;

    const totalReservedQty = items.reduce((sum, item) => sum + (item.reservedQty || 0), 0);
    const reservationRequirements = await Promise.all(
      items.map((item) => this.requiresStockReservation(item.variantId, trx)),
    );
    const allReserved = items.every(
      (item, index) => !reservationRequirements[index] || (item.reservedQty || 0) >= item.qty,
    );

    await trx
      .update(wmsTables.fulfillmentOrders)
      .set({
        status: allReserved ? 'ready' : ['ready', 'pending'].includes(fo.status) ? 'created' : fo.status,
        totalReservedQty,
        reservationFailureReason: allReserved ? null : fo.reservationFailureReason,
        reservationFailureDetails: allReserved ? null : fo.reservationFailureDetails,
        updatedAt: new Date(),
      })
      .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

    if (allReserved && fo.status !== 'ready') {
      await this.outbox.enqueue(
        {
          eventType: FULFILLMENT_EVENTS.READY,
          aggregateType: 'fulfillment',
          aggregateId: fulfillmentOrderId,
          partitionKey: fulfillmentOrderId,
          payload: { fulfillmentOrderId },
        },
        trx,
      );
    }
  }

  private async requiresStockReservation(variantId: string | null | undefined, trx: DbTx): Promise<boolean> {
    if (!variantId) return true;

    const policy = await this.policies.getVariantPolicy(variantId, trx);
    return policy.inventoryManagement;
  }
}
