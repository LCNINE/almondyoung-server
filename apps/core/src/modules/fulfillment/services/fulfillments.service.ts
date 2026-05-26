import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { and, eq, inArray, desc } from 'drizzle-orm';
import { PoliciesService } from './policies.service';
import { AvailabilityService } from './availability.service';
import { FULFILLMENT_EVENTS } from '../events';
import { OutboxService } from '../outbox/outbox.service';
import { ProductSkuMappingService } from '../../product-matching/services/product-sku-mapping.service';
import { ReservationLifecycleService } from '../../inventory/shared/services/reservation-lifecycle.service';
import { CreateFulfillmentOrderDto } from '../dto/create-fulfillment-order.dto';
import { SplitFulfillmentOrderDto } from '../dto/split-fulfillment-order.dto';
import { AssignShipmentDto } from '../dto/assign-shipment.dto';
import { FulfillmentShippedPayload, FulfillmentCancelledPayload, Carrier } from '@packages/event-contracts/streams';

@Injectable()
export class FulfillmentsService {
  private readonly logger = new Logger(FulfillmentsService.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly policies: PoliciesService,
    private readonly availability: AvailabilityService,
    private readonly reservationLifecycle: ReservationLifecycleService,
    private readonly productSkuMapping: ProductSkuMappingService,
    private readonly outbox: OutboxService,
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  async create(dto: CreateFulfillmentOrderDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
      try {
        if (dto.salesOrderId) {
          const [salesOrder] = await trx
            .select()
            .from(wmsTables.salesOrders)
            .where(eq(wmsTables.salesOrders.id, dto.salesOrderId))
            .limit(1);
          if (!salesOrder) {
            throw new BadRequestException(`Sales order ${dto.salesOrderId} not found`);
          }
          if (salesOrder.status === 'cancelled') {
            throw new BadRequestException(`Cannot create fulfillment for cancelled sales order ${dto.salesOrderId}`);
          }
        }

        if (dto.warehouseId) {
          const [warehouse] = await trx
            .select()
            .from(wmsTables.warehouses)
            .where(eq(wmsTables.warehouses.id, dto.warehouseId))
            .limit(1);
          if (!warehouse) {
            throw new BadRequestException(`Warehouse ${dto.warehouseId} not found`);
          }
        }

        this.logger.log(`Creating fulfillment order for SO: ${dto.salesOrderId || 'standalone'}`);

        const [fo] = await trx
          .insert(wmsTables.fulfillmentOrders)
          .values({
            salesOrderId: dto.salesOrderId ?? null,
            warehouseId: dto.warehouseId ?? null,
            ownerId: dto.ownerId ?? null,
            status: 'created',
            shippingAddress: dto.shippingAddress ?? null,
            labelNo: null,
          })
          .returning();

        if (!fo) {
          throw new Error('Failed to create fulfillment order');
        }

        await this.outbox.enqueue(
          {
            eventType: FULFILLMENT_EVENTS.CREATED,
            aggregateType: 'fulfillment',
            aggregateId: fo.id,
            partitionKey: fo.id,
            payload: { fulfillmentOrderId: fo.id },
          },
          trx,
        );

        const items = Array.isArray(dto.items) ? dto.items : [];
        const legacyLines = Array.isArray(dto.lines) ? dto.lines : [];

        if (items.length > 0) {
          for (const item of items) {
            if (!item.skuId || !item.quantity || item.quantity <= 0) {
              throw new BadRequestException(`Invalid item data: skuId and positive quantity are required`);
            }
            const [sku] = await trx.select().from(wmsTables.skus).where(eq(wmsTables.skus.id, item.skuId)).limit(1);
            if (!sku) {
              throw new BadRequestException(`SKU ${item.skuId} not found`);
            }
          }

          await trx.insert(wmsTables.fulfillmentOrderItems).values(
            items.map((item) => ({
              fulfillmentOrderId: fo.id,
              salesOrderId: dto.salesOrderId ?? null,
              salesOrderLineId: item.salesOrderLineId ?? null,
              mappingSnapshotId: item.mappingSnapshotId ?? null,
              variantId: item.variantId ?? null,
              skuId: item.skuId,
              qty: item.quantity,
              reservedQty: 0,
              pickedQty: 0,
              shippedQty: 0,
              status: 'pending',
            })),
          );
        } else if (legacyLines.length > 0) {
          this.logger.warn(`[create] Using deprecated 'lines' field for FO creation. Please use 'items' instead.`);

          for (const line of legacyLines) {
            if (!line.skuId || !line.quantity || line.quantity <= 0) {
              throw new BadRequestException(`Invalid line data: skuId and positive quantity are required`);
            }
            const [sku] = await trx.select().from(wmsTables.skus).where(eq(wmsTables.skus.id, line.skuId)).limit(1);
            if (!sku) {
              throw new BadRequestException(`SKU ${line.skuId} not found`);
            }
          }

          await trx.insert(wmsTables.fulfillmentOrderItems).values(
            legacyLines.map((l) => ({
              fulfillmentOrderId: fo.id,
              salesOrderId: dto.salesOrderId ?? null,
              salesOrderLineId: null,
              mappingSnapshotId: null,
              variantId: null,
              skuId: l.skuId,
              qty: l.quantity,
              reservedQty: 0,
              pickedQty: 0,
              shippedQty: 0,
              status: 'pending',
            })),
          );
        } else if (dto.salesOrderId) {
          const soLines = await trx
            .select()
            .from(wmsTables.salesOrderLines)
            .where(eq(wmsTables.salesOrderLines.salesOrderId, dto.salesOrderId));

          const itemsToInsert: Array<{
            fulfillmentOrderId: string;
            salesOrderId: string;
            salesOrderLineId: string;
            mappingSnapshotId: string | null;
            variantId: string;
            skuId: string;
            qty: number;
            reservedQty: number;
            pickedQty: number;
            shippedQty: number;
            status: string;
          }> = [];

          for (const sl of soLines) {
            if (sl.mappingSnapshotId) {
              const snapshot = await this.productSkuMapping.getMappingSnapshot(sl.mappingSnapshotId, trx);
              if (snapshot && snapshot.mappings.length > 0) {
                for (const mapping of snapshot.mappings) {
                  const qty = sl.quantity * Math.max(1, mapping.quantity);
                  itemsToInsert.push({
                    fulfillmentOrderId: fo.id,
                    salesOrderId: dto.salesOrderId,
                    salesOrderLineId: sl.id,
                    mappingSnapshotId: sl.mappingSnapshotId,
                    variantId: sl.variantId,
                    skuId: mapping.skuId,
                    qty,
                    reservedQty: 0,
                    pickedQty: 0,
                    shippedQty: 0,
                    status: 'pending',
                  });
                }
                continue;
              }
            }

            // Fallback: realtime matching
            const matching = await this.productSkuMapping.getByVariant(sl.variantId, trx);
            if (matching && Array.isArray((matching as { links?: unknown[] }).links)) {
              const links = (matching as { links: Array<{ skuId: string; quantity: number }> }).links;
              for (const link of links) {
                const qty = sl.quantity * Math.max(1, link.quantity || 1);
                itemsToInsert.push({
                  fulfillmentOrderId: fo.id,
                  salesOrderId: dto.salesOrderId,
                  salesOrderLineId: sl.id,
                  mappingSnapshotId: null,
                  variantId: sl.variantId,
                  skuId: link.skuId,
                  qty,
                  reservedQty: 0,
                  pickedQty: 0,
                  shippedQty: 0,
                  status: 'pending',
                });
              }
            }
          }

          if (itemsToInsert.length > 0) {
            await trx.insert(wmsTables.fulfillmentOrderItems).values(itemsToInsert);
            this.logger.log(`Created ${itemsToInsert.length} fulfillment order items`);
          }
        }

        if (fo.ownerId) {
          const fois = await trx
            .select()
            .from(wmsTables.fulfillmentOrderItems)
            .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id));
          const skuIds = fois.map((item) => item.skuId);
          if (skuIds.length > 0) {
            const skuRows = await trx.select().from(wmsTables.skus).where(inArray(wmsTables.skus.id, skuIds));
            const mismatched = skuRows.find((s) => s.holderId !== fo.ownerId);
            if (mismatched) {
              throw new BadRequestException('SKU_HOLDER_MISMATCH_FOR_3PL');
            }
          }
        }

        const allFulfillable = await this.evaluateFulfillability(trx, fo.id, dto.warehouseId ?? null);

        if (allFulfillable) {
          await trx
            .update(wmsTables.fulfillmentOrders)
            .set({ status: 'ready' })
            .where(eq(wmsTables.fulfillmentOrders.id, fo.id));
          await this.outbox.enqueue(
            {
              eventType: FULFILLMENT_EVENTS.READY,
              aggregateType: 'fulfillment',
              aggregateId: fo.id,
              partitionKey: fo.id,
              payload: { fulfillmentOrderId: fo.id },
            },
            trx,
          );
        }

        this.logger.log(
          `Fulfillment order ${fo.id} created successfully with status: ${allFulfillable ? 'ready' : 'created'}`,
        );
        return this.getOne(fo.id, trx);
      } catch (error) {
        this.logger.error(`Failed to create fulfillment order for SO ${dto.salesOrderId}:`, error);
        throw error;
      }
    }, tx);
  }

  private async evaluateFulfillability(trx: DbTx, foId: string, warehouseId: string | null): Promise<boolean> {
    const [fo] = await trx
      .select()
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.id, foId))
      .limit(1);
    if (!fo) return false;

    if (fo.fulfillmentMode === 'drop_ship') return true;

    if (!warehouseId) return false;

    const items = await trx
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foId));

    if (items.length === 0) return true;

    for (const item of items) {
      const onHand = await this.availability.getAvailableQuantity(item.skuId, warehouseId, trx);
      const policy = item.variantId ? await this.policies.getVariantPolicy(item.variantId, trx) : null;
      const canFulfill = this.policies.evaluateFulfillability(
        {
          inventoryManagement: policy?.inventoryManagement ?? true,
          preStockSellable: policy?.preStockSellable ?? false,
          alwaysSellableZeroStock: policy?.alwaysSellableZeroStock ?? false,
        },
        onHand,
        item.qty,
      );
      if (!canFulfill) return false;
    }

    return true;
  }

  async split(id: string, dto: SplitFulfillmentOrderDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const [origin] = await trx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, id))
        .limit(1);
      if (!origin) return null;

      const [newFo] = await trx
        .insert(wmsTables.fulfillmentOrders)
        .values({
          salesOrderId: origin.salesOrderId,
          warehouseId: origin.warehouseId,
          ownerId: origin.ownerId,
          status: 'created',
          shippingAddress: origin.shippingAddress,
          labelNo: null,
        })
        .returning();

      const itemMoves = dto?.items ?? [];
      const legacyMoves = dto?.lines ?? [];

      if (itemMoves.length > 0) {
        const splitItems: Array<{
          fulfillmentOrderItemId: string;
          skuId: string;
          splitQuantity: number;
          originalQuantity: number;
        }> = [];

        for (const mv of itemMoves) {
          const [item] = await trx
            .select()
            .from(wmsTables.fulfillmentOrderItems)
            .where(eq(wmsTables.fulfillmentOrderItems.id, mv.fulfillmentOrderItemId))
            .limit(1);
          if (!item) continue;
          const moveQty = Math.min(mv.quantity, item.qty - item.shippedQty);
          if (moveQty <= 0) continue;

          await trx
            .update(wmsTables.fulfillmentOrderItems)
            .set({
              qty: item.qty - moveQty,
              reservedQty: Math.max(0, item.reservedQty - moveQty),
              updatedAt: new Date(),
            })
            .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));

          const [newItem] = await trx
            .insert(wmsTables.fulfillmentOrderItems)
            .values({
              fulfillmentOrderId: newFo.id,
              salesOrderId: item.salesOrderId,
              salesOrderLineId: item.salesOrderLineId,
              mappingSnapshotId: item.mappingSnapshotId,
              variantId: item.variantId,
              skuId: item.skuId,
              qty: moveQty,
              reservedQty: 0,
              pickedQty: 0,
              shippedQty: 0,
              status: 'pending',
            })
            .returning();

          splitItems.push({
            fulfillmentOrderItemId: newItem.id,
            skuId: item.skuId,
            splitQuantity: moveQty,
            originalQuantity: item.qty,
          });
        }

        if (splitItems.length > 0) {
          await this.reservationLifecycle.handleFulfillmentOrderSplit(id, newFo.id, splitItems, trx);
        }
      } else if (legacyMoves.length > 0) {
        this.logger.warn(`[split] Using deprecated 'lines' field. Please use 'items' instead.`);

        const splitItems: Array<{
          fulfillmentOrderItemId: string;
          skuId: string;
          splitQuantity: number;
          originalQuantity: number;
        }> = [];

        for (const mv of legacyMoves) {
          const [item] = await trx
            .select()
            .from(wmsTables.fulfillmentOrderItems)
            .where(eq(wmsTables.fulfillmentOrderItems.id, mv.fulfillmentOrderLineId))
            .limit(1);
          if (!item) continue;
          const moveQty = Math.min(mv.quantity, item.qty - item.shippedQty);
          if (moveQty <= 0) continue;

          await trx
            .update(wmsTables.fulfillmentOrderItems)
            .set({
              qty: item.qty - moveQty,
              reservedQty: Math.max(0, item.reservedQty - moveQty),
              updatedAt: new Date(),
            })
            .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));

          const [newItem] = await trx
            .insert(wmsTables.fulfillmentOrderItems)
            .values({
              fulfillmentOrderId: newFo.id,
              salesOrderId: item.salesOrderId,
              salesOrderLineId: item.salesOrderLineId,
              mappingSnapshotId: item.mappingSnapshotId,
              variantId: item.variantId,
              skuId: item.skuId,
              qty: moveQty,
              reservedQty: 0,
              pickedQty: 0,
              shippedQty: 0,
              status: 'pending',
            })
            .returning();

          splitItems.push({
            fulfillmentOrderItemId: newItem.id,
            skuId: item.skuId,
            splitQuantity: moveQty,
            originalQuantity: item.qty,
          });
        }

        if (splitItems.length > 0) {
          await this.reservationLifecycle.handleFulfillmentOrderSplit(id, newFo.id, splitItems, trx);
        }
      }

      return newFo;
    }, tx);
  }

  async assignShipment(id: string, dto: AssignShipmentDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
      await trx.insert(wmsTables.shipments).values({
        trackingNo: dto.trackingNo,
        status: 'created',
        eta: dto.eta ? new Date(dto.eta) : null,
        splitStatus: false,
        fulfillmentOrderId: id,
      });

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'labeled' })
        .where(eq(wmsTables.fulfillmentOrders.id, id));
      await this.outbox.enqueue(
        {
          eventType: FULFILLMENT_EVENTS.LABELLED,
          aggregateType: 'fulfillment',
          aggregateId: id,
          partitionKey: id,
          payload: { fulfillmentOrderId: id },
        },
        trx,
      );

      return this.getOne(id, trx);
    }, tx);
  }

  async ship(id: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const [fo] = await trx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, id))
        .limit(1);
      if (!fo) {
        throw new NotFoundException(`Fulfillment order ${id} not found`);
      }

      const [shipment] = await trx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.fulfillmentOrderId, id))
        .limit(1);

      const items = await trx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, id));
      for (const item of items) {
        await trx
          .update(wmsTables.fulfillmentOrderItems)
          .set({ shippedQty: item.qty, status: 'shipped', updatedAt: new Date() })
          .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
      }

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'shipped' })
        .where(eq(wmsTables.fulfillmentOrders.id, id));

      const shippedPayload: FulfillmentShippedPayload = {
        fulfillmentId: id,
        orderId: fo.salesOrderId ?? '',
        trackingInfo: {
          carrier: (shipment?.carrier as Carrier) ?? 'CJ',
          trackingNumber: shipment?.trackingNo ?? '',
          invoiceUrl: shipment?.invoiceUrl ?? undefined,
        },
        shippedAt: new Date().toISOString(),
        estimatedDeliveryDate: shipment?.eta?.toISOString(),
        shippedItems: items.map((item) => ({
          fulfillmentItemId: item.id,
          skuId: item.skuId,
          shippedQty: item.qty,
        })),
      };

      await this.outbox.enqueue(
        {
          eventType: FULFILLMENT_EVENTS.SHIPPED,
          aggregateType: 'fulfillment',
          aggregateId: id,
          partitionKey: fo.salesOrderId ?? id,
          payload: shippedPayload,
        },
        trx,
      );

      return this.getOne(id, trx);
    }, tx);
  }

  async cancel(
    id: string,
    options?: {
      reason?: 'ORDER_CANCELLED' | 'OUT_OF_STOCK' | 'ADMIN_CANCEL';
      reasonDetail?: string;
      cancelledBy?: string;
    },
    tx?: DbTx,
  ) {
    return this.inTx(async (trx) => {
      const [fo] = await trx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, id))
        .limit(1);
      if (!fo) {
        throw new NotFoundException(`Fulfillment order ${id} not found`);
      }

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'canceled' })
        .where(eq(wmsTables.fulfillmentOrders.id, id));

      const cancelledPayload: FulfillmentCancelledPayload = {
        fulfillmentId: id,
        orderId: fo.salesOrderId ?? '',
        reason: options?.reason ?? 'ADMIN_CANCEL',
        reasonDetail: options?.reasonDetail,
        cancelledBy: options?.cancelledBy ?? 'system',
        cancelledAt: new Date().toISOString(),
      };

      await this.outbox.enqueue(
        {
          eventType: FULFILLMENT_EVENTS.CANCELLED,
          aggregateType: 'fulfillment',
          aggregateId: id,
          partitionKey: fo.salesOrderId ?? id,
          payload: cancelledPayload,
        },
        trx,
      );

      return this.getOne(id, trx);
    }, tx);
  }

  async getOne(id: string, tx?: DbTx) {
    const db = tx ?? this.db.db;

    const [fulfillmentOrder] = await db
      .select()
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.id, id))
      .limit(1);

    if (!fulfillmentOrder) {
      return null;
    }

    const invoiceRows = await db
      .select({
        id: wmsTables.invoices.id,
        invoiceNumber: wmsTables.invoices.invoiceNumber,
        status: wmsTables.invoices.status,
        carrierCode: wmsTables.invoices.carrierCode,
        issueMethod: wmsTables.invoices.issueMethod,
      })
      .from(wmsTables.invoices)
      .where(eq(wmsTables.invoices.fulfillmentOrderId, id))
      .limit(1);

    return {
      ...fulfillmentOrder,
      invoice: invoiceRows[0] || null,
    };
  }

  async list(params: { limit: number; offset: number }, tx?: DbTx) {
    const db = tx ?? this.db.db;

    const fulfillmentOrders = await db
      .select()
      .from(wmsTables.fulfillmentOrders)
      .limit(params.limit)
      .offset(params.offset)
      .orderBy(desc(wmsTables.fulfillmentOrders.createdAt));

    if (fulfillmentOrders.length === 0) {
      return [];
    }

    const fulfillmentOrderIds = fulfillmentOrders.map((fo) => fo.id);

    const invoices = await db
      .select({
        id: wmsTables.invoices.id,
        fulfillmentOrderId: wmsTables.invoices.fulfillmentOrderId,
        invoiceNumber: wmsTables.invoices.invoiceNumber,
        status: wmsTables.invoices.status,
        carrierCode: wmsTables.invoices.carrierCode,
        issueMethod: wmsTables.invoices.issueMethod,
      })
      .from(wmsTables.invoices)
      .where(inArray(wmsTables.invoices.fulfillmentOrderId, fulfillmentOrderIds));

    const invoicesByFoId = new Map<string, (typeof invoices)[0]>();
    for (const invoice of invoices) {
      invoicesByFoId.set(invoice.fulfillmentOrderId, invoice);
    }

    return fulfillmentOrders.map((fo) => ({
      ...fo,
      invoice: invoicesByFoId.get(fo.id) || null,
    }));
  }

  async checkAvailability(fulfillmentOrderId: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const fo = await this.getOne(fulfillmentOrderId, trx);
      if (!fo?.warehouseId) return { ready: false };

      const items = await trx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));

      if (items.length === 0) return { ready: true };

      for (const item of items) {
        const onHand = await this.availability.getAvailableQuantity(item.skuId, fo.warehouseId, trx);
        const policy = item.variantId ? await this.policies.getVariantPolicy(item.variantId, trx) : null;
        const canFulfill = this.policies.evaluateFulfillability(
          {
            inventoryManagement: policy?.inventoryManagement ?? true,
            preStockSellable: policy?.preStockSellable ?? false,
            alwaysSellableZeroStock: policy?.alwaysSellableZeroStock ?? false,
          },
          onHand,
          item.qty,
        );
        if (!canFulfill) return { ready: false };
      }

      return { ready: true };
    }, tx);
  }
}
