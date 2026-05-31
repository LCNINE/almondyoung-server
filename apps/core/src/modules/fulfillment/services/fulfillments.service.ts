import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { eq, inArray, desc, sql } from 'drizzle-orm';
import { PoliciesService } from './policies.service';
import { AvailabilityService } from './availability.service';
import { FULFILLMENT_EVENTS } from '../events';
import { OutboxService } from '../outbox/outbox.service';
import { ProductSkuMappingService } from '../../product-matching/services/product-sku-mapping.service';
import { ReservationLifecycleService } from '../../inventory/shared/services/reservation-lifecycle.service';
import { UnifiedReservationService } from '../../inventory/shared/services/unified-reservation.service';
import { CreateFulfillmentOrderDto } from '../dto/create-fulfillment-order.dto';
import { CreateCompensationShipmentDto, CompensationShipmentItemDto } from '../dto/create-compensation-shipment.dto';
import { SplitFulfillmentOrderDto } from '../dto/split-fulfillment-order.dto';
import { AssignShipmentDto } from '../dto/assign-shipment.dto';
import { FulfillmentShippedPayload, FulfillmentCancelledPayload, Carrier } from '@packages/event-contracts/streams';
import { SalesOrderAmendmentsService } from '../../sales-order/services/sales-order-amendments.service';
import { SalesOrderAmendmentDeltaDto } from '../../sales-order/dto/create-sales-order-amendment.dto';

type FulfillmentOrderItemInsert = {
  fulfillmentOrderId: string;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  mappingSnapshotId: string | null;
  variantId: string | null;
  skuId: string;
  qty: number;
  reservedQty: number;
  pickedQty: number;
  shippedQty: number;
  status: string;
};

type FulfillmentOrderRow = typeof wmsTables.fulfillmentOrders.$inferSelect;

type UnmatchedSalesOrderLine = {
  salesOrderLineId: string;
  variantId: string;
  reason: string;
};

type VariantSkuMatching = Awaited<ReturnType<ProductSkuMappingService['getByVariant']>>;

type ReservationFailureDetail = {
  fulfillmentOrderItemId: string;
  salesOrderLineId: string | null;
  variantId: string | null;
  skuId: string;
  requiredQty: number;
  availableQty: number;
  reason: string;
};
type PartialCancelledLineQuantity = {
  salesOrderLineId: string;
  quantity: number;
};

const SALES_ORDER_REF_TYPE = 'sales_order';
const AMENDMENT_REF_TYPE = 'sales_order_amendment';
const FULFILLMENT_ORDER_REF_TYPE = 'fulfillment_order';
const COMPENSATION_ALLOWED_SALES_ORDER_STATUSES = new Set(['confirmed', 'processing', 'shipped', 'delivered']);

@Injectable()
export class FulfillmentsService {
  private readonly logger = new Logger(FulfillmentsService.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly policies: PoliciesService,
    private readonly availability: AvailabilityService,
    private readonly reservationLifecycle: ReservationLifecycleService,
    private readonly unifiedReservation: UnifiedReservationService,
    private readonly productSkuMapping: ProductSkuMappingService,
    private readonly outbox: OutboxService,
    @Optional() private readonly salesOrderAmendments?: SalesOrderAmendmentsService,
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  async requiresPhysicalFulfillmentOrder(salesOrderId: string, tx?: DbTx): Promise<boolean> {
    return this.inTx(async (trx) => {
      const items = await this.buildItemsFromSalesOrder(salesOrderId, trx);
      return items.length > 0;
    }, tx);
  }

  async create(dto: CreateFulfillmentOrderDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
      try {
        if (dto.salesOrderId) {
          await trx.execute(sql`
            SELECT id
            FROM ${wmsTables.salesOrders}
            WHERE ${wmsTables.salesOrders.id} = ${dto.salesOrderId}
            FOR UPDATE
          `);

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

          const [existingFulfillmentOrder] = await trx
            .select()
            .from(wmsTables.fulfillmentOrders)
            .where(eq(wmsTables.fulfillmentOrders.salesOrderId, dto.salesOrderId))
            .limit(1);

          if (existingFulfillmentOrder) {
            this.logger.log(
              `Fulfillment order ${existingFulfillmentOrder.id} already exists for SO ${dto.salesOrderId}, returning existing order`,
            );
            return this.getOne(existingFulfillmentOrder.id, trx);
          }
        }

        await this.validateWarehouseExists(dto.warehouseId, trx);

        this.logger.log(`Creating fulfillment order for SO: ${dto.salesOrderId || 'standalone'}`);

        const requestedItems = Array.isArray(dto.items) ? dto.items : [];
        const legacyLines = Array.isArray(dto.lines) ? dto.lines : [];

        if (dto.salesOrderId && (requestedItems.length > 0 || legacyLines.length > 0)) {
          throw new BadRequestException({
            code: 'SALES_ORDER_ITEMS_DERIVED_FROM_MATCHING',
            message:
              'Fulfillment items for a sales order must be derived from product-SKU matching. Omit items and lines when salesOrderId is provided.',
          });
        }

        let itemsToInsert: Omit<FulfillmentOrderItemInsert, 'fulfillmentOrderId'>[];
        if (requestedItems.length > 0) {
          const itemWithSalesOrderReference = requestedItems.find((item) => item.salesOrderId || item.salesOrderLineId);
          if (itemWithSalesOrderReference) {
            throw new BadRequestException({
              code: 'FULFILLMENT_ITEM_SO_REFERENCE_NOT_ALLOWED',
              message:
                'Explicit fulfillment items are for standalone orders only. Omit item-level sales order references.',
            });
          }

          itemsToInsert = requestedItems.map((item) => {
            if (!item.skuId || !item.quantity || item.quantity <= 0) {
              throw new BadRequestException(`Invalid item data: skuId and positive quantity are required`);
            }
            return {
              salesOrderId: null,
              salesOrderLineId: null,
              mappingSnapshotId: item.mappingSnapshotId ?? null,
              variantId: item.variantId ?? null,
              skuId: item.skuId,
              qty: item.quantity,
              reservedQty: 0,
              pickedQty: 0,
              shippedQty: 0,
              status: 'pending',
            };
          });
        } else if (legacyLines.length > 0) {
          this.logger.warn(`[create] Using deprecated 'lines' field for FO creation. Please use 'items' instead.`);
          itemsToInsert = legacyLines.map((line) => {
            if (!line.skuId || !line.quantity || line.quantity <= 0) {
              throw new BadRequestException(`Invalid line data: skuId and positive quantity are required`);
            }
            return {
              salesOrderId: dto.salesOrderId ?? null,
              salesOrderLineId: null,
              mappingSnapshotId: null,
              variantId: null,
              skuId: line.skuId,
              qty: line.quantity,
              reservedQty: 0,
              pickedQty: 0,
              shippedQty: 0,
              status: 'pending',
            };
          });
        } else if (dto.salesOrderId) {
          itemsToInsert = await this.buildItemsFromSalesOrder(dto.salesOrderId, trx);
        } else {
          throw new BadRequestException('Fulfillment order requires items or salesOrderId');
        }

        if (itemsToInsert.length === 0 && !dto.salesOrderId) {
          throw new BadRequestException('Fulfillment order items cannot be empty');
        }

        return this.createFulfillmentOrderFromItems(dto, itemsToInsert, trx);
      } catch (error) {
        this.logger.error(`Failed to create fulfillment order for SO ${dto.salesOrderId}:`, error);
        throw error;
      }
    }, tx);
  }

  async createCompensationShipment(dto: CreateCompensationShipmentDto, operatorId?: string, tx?: DbTx) {
    if (!this.salesOrderAmendments) {
      throw new Error('SalesOrderAmendmentsService is required to create compensation shipments');
    }
    const salesOrderAmendments = this.salesOrderAmendments;

    return this.inTx(async (trx) => {
      if (dto.fulfillmentOrderId && dto.items?.length) {
        throw new BadRequestException(
          'Use fulfillmentOrderId to link an existing effect or items to create one, not both',
        );
      }
      if (!dto.fulfillmentOrderId && !dto.items?.length) {
        throw new BadRequestException('Compensation shipment requires fulfillmentOrderId or items');
      }

      const [salesOrder] = await trx
        .select()
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, dto.salesOrderId))
        .limit(1);
      if (!salesOrder) {
        throw new NotFoundException(`Sales order ${dto.salesOrderId} not found`);
      }
      if (!COMPENSATION_ALLOWED_SALES_ORDER_STATUSES.has(salesOrder.status)) {
        throw new BadRequestException(
          `Cannot create compensation shipment for SalesOrder ${dto.salesOrderId} in status ${salesOrder.status}`,
        );
      }

      let fulfillmentOrder: FulfillmentOrderRow | null;
      if (dto.fulfillmentOrderId) {
        fulfillmentOrder = await this.getOne(dto.fulfillmentOrderId, trx);
        if (!fulfillmentOrder) {
          throw new NotFoundException(`Fulfillment order ${dto.fulfillmentOrderId} not found`);
        }
        if (fulfillmentOrder.salesOrderId) {
          throw new BadRequestException('Compensation shipment can only link standalone fulfillment orders');
        }
      } else {
        await this.validateWarehouseExists(dto.warehouseId, trx);
        const itemsToInsert = await this.buildItemsFromCompensationItems(dto.salesOrderId, dto.items ?? [], trx);
        fulfillmentOrder = await this.createFulfillmentOrderFromItems(
          {
            warehouseId: dto.warehouseId,
            ownerId: dto.ownerId,
            fulfillmentMode: dto.fulfillmentMode,
            priority: dto.priority,
            shippingAddress: dto.shippingAddress ?? (salesOrder.shippingAddress as any),
          },
          itemsToInsert,
          trx,
        );
      }
      if (!fulfillmentOrder) {
        throw new Error('Failed to create or link fulfillment order');
      }

      const amendment = await salesOrderAmendments.create(
        {
          salesOrderId: dto.salesOrderId,
          amendmentKind: 'fulfillment_only',
          decision: 'approved',
          reasonCode: dto.reasonCode,
          note: dto.note,
          occurredAt: dto.occurredAt,
          metadata: {
            ...(dto.metadata ?? {}),
            compensationShipment: {
              fulfillmentOrderId: fulfillmentOrder.id,
              linkedExistingFulfillmentOrder: Boolean(dto.fulfillmentOrderId),
              items: dto.items ?? [],
            },
          },
          deltas: this.buildCompensationDeltas(dto),
        },
        operatorId,
        trx,
      );

      await this.linkCompensationFulfillment({
        salesOrderId: dto.salesOrderId,
        amendmentId: amendment.id,
        fulfillmentOrderId: fulfillmentOrder.id,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
        metadata: {
          reasonCode: dto.reasonCode ?? null,
          linkedExistingFulfillmentOrder: Boolean(dto.fulfillmentOrderId),
        },
        trx,
      });

      return { amendment, fulfillmentOrder };
    }, tx);
  }

  private async validateWarehouseExists(warehouseId: string | undefined, trx: DbTx) {
    if (!warehouseId) {
      return;
    }

    const [warehouse] = await trx
      .select()
      .from(wmsTables.warehouses)
      .where(eq(wmsTables.warehouses.id, warehouseId))
      .limit(1);
    if (!warehouse) {
      throw new BadRequestException(`Warehouse ${warehouseId} not found`);
    }
  }

  private buildCompensationDeltas(dto: CreateCompensationShipmentDto): SalesOrderAmendmentDeltaDto[] {
    const baseInstruction =
      dto.fulfillmentInstruction ??
      (dto.fulfillmentOrderId
        ? `Link compensation fulfillment order ${dto.fulfillmentOrderId}`
        : 'Create compensation shipment');

    if (!dto.items?.length) {
      return [
        {
          type: 'fulfillment_only_correction',
          fulfillmentInstruction: baseInstruction,
          reason: dto.reasonCode,
        },
      ];
    }

    return dto.items.map((item) => ({
      type: 'fulfillment_only_correction',
      salesOrderLineId: item.salesOrderLineId,
      fulfillmentInstruction: baseInstruction,
      reason: dto.reasonCode,
      metadata: {
        variantId: item.variantId,
        quantity: item.quantity,
      },
    }));
  }

  private async createFulfillmentOrderFromItems(
    dto: Pick<
      CreateFulfillmentOrderDto,
      'salesOrderId' | 'warehouseId' | 'ownerId' | 'fulfillmentMode' | 'priority' | 'shippingAddress'
    >,
    itemsToInsert: Omit<FulfillmentOrderItemInsert, 'fulfillmentOrderId'>[],
    trx: DbTx,
  ) {
    if (itemsToInsert.length > 0) {
      await this.validateSkuRows(itemsToInsert, dto.ownerId ?? null, trx);
    }

    const initialStatus = dto.salesOrderId && itemsToInsert.length === 0 ? 'completed' : 'created';

    const [fo] = await trx
      .insert(wmsTables.fulfillmentOrders)
      .values({
        salesOrderId: dto.salesOrderId ?? null,
        warehouseId: dto.warehouseId ?? null,
        ownerId: dto.ownerId ?? null,
        fulfillmentMode: dto.fulfillmentMode ?? null,
        priority: dto.priority ?? 'normal',
        status: initialStatus,
        totalItems: itemsToInsert.length,
        totalQty: itemsToInsert.reduce((sum, item) => sum + item.qty, 0),
        totalReservedQty: 0,
        reservationFailureReason: null,
        reservationFailureDetails: null,
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

    const insertedItems =
      itemsToInsert.length > 0
        ? await trx
            .insert(wmsTables.fulfillmentOrderItems)
            .values(itemsToInsert.map((item) => ({ ...item, fulfillmentOrderId: fo.id })))
            .returning()
        : [];
    this.logger.log(`Created ${insertedItems.length} fulfillment order items`);

    if (insertedItems.length === 0) {
      this.logger.log(`Fulfillment order ${fo.id} completed without physical items`);
      return this.getOne(fo.id, trx);
    }

    const reservationResult =
      dto.fulfillmentMode === 'drop_ship'
        ? { status: 'ready' as const, totalReservedQty: 0, failures: [] }
        : await this.tryReserveItems(fo.id, dto.warehouseId ?? null, insertedItems, trx);

    if (reservationResult.status === 'ready') {
      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({
          status: 'ready',
          totalReservedQty: reservationResult.totalReservedQty,
          reservationFailureReason: null,
          reservationFailureDetails: null,
          updatedAt: new Date(),
        })
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
    } else if (reservationResult.status === 'unfulfillable') {
      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({
          status: 'unfulfillable',
          totalReservedQty: reservationResult.totalReservedQty,
          reservationFailureReason: 'RESERVATION_FAILED',
          reservationFailureDetails: {
            attemptedAt: new Date().toISOString(),
            failedItems: reservationResult.failures,
          },
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.fulfillmentOrders.id, fo.id));
    } else if (reservationResult.totalReservedQty > 0) {
      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({
          totalReservedQty: reservationResult.totalReservedQty,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.fulfillmentOrders.id, fo.id));
    }

    this.logger.log(`Fulfillment order ${fo.id} created successfully with status: ${reservationResult.status}`);
    return this.getOne(fo.id, trx);
  }

  private async buildItemsFromSalesOrder(
    salesOrderId: string,
    trx: DbTx,
  ): Promise<Omit<FulfillmentOrderItemInsert, 'fulfillmentOrderId'>[]> {
    const soLines = await trx
      .select()
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId));

    if (soLines.length === 0) {
      throw new BadRequestException(`Sales order ${salesOrderId} has no lines`);
    }

    const itemsToInsert: Omit<FulfillmentOrderItemInsert, 'fulfillmentOrderId'>[] = [];
    const missingLines: UnmatchedSalesOrderLine[] = [];
    const cancelledByLine = await this.loadPartialCancelledLineQuantities(salesOrderId, trx);

    for (const sl of soLines) {
      const fulfillableQuantity = sl.quantity - (cancelledByLine.get(sl.id) ?? 0);
      if (fulfillableQuantity <= 0) {
        continue;
      }

      const snapshotMappings = sl.mappingSnapshotId
        ? (await this.productSkuMapping.getMappingSnapshot(sl.mappingSnapshotId, trx)).mappings
        : [];

      if (snapshotMappings.length > 0) {
        for (const mapping of snapshotMappings) {
          itemsToInsert.push({
            salesOrderId,
            salesOrderLineId: sl.id,
            mappingSnapshotId: sl.mappingSnapshotId,
            variantId: sl.variantId,
            skuId: mapping.skuId,
            qty: fulfillableQuantity * Math.max(1, mapping.quantity || 1),
            reservedQty: 0,
            pickedQty: 0,
            shippedQty: 0,
            status: 'pending',
          });
        }
        continue;
      }

      const matching = await this.productSkuMapping.getByVariant(sl.variantId, trx);
      if (this.isVoidMatching(matching)) {
        continue;
      }

      const links = this.getPhysicalSkuLinks(matching);

      if (links.length === 0) {
        missingLines.push({
          salesOrderLineId: sl.id,
          variantId: sl.variantId,
          reason: this.getMatchingFailureReason(matching),
        });
        continue;
      }

      for (const link of links) {
        itemsToInsert.push({
          salesOrderId,
          salesOrderLineId: sl.id,
          mappingSnapshotId: null,
          variantId: sl.variantId,
          skuId: link.skuId,
          qty: fulfillableQuantity * Math.max(1, link.quantity || 1),
          reservedQty: 0,
          pickedQty: 0,
          shippedQty: 0,
          status: 'pending',
        });
      }
    }

    if (missingLines.length > 0) {
      throw new BadRequestException({
        code: 'PRODUCT_SKU_MATCHING_REQUIRED',
        message: 'Cannot create fulfillment order because some sales order lines have no SKU matching',
        missingLines,
      });
    }

    return itemsToInsert;
  }

  private async loadPartialCancelledLineQuantities(salesOrderId: string, trx: DbTx): Promise<Map<string, number>> {
    const cancellations = await trx
      .select({ metadata: wmsTables.salesOrderCancellations.metadata })
      .from(wmsTables.salesOrderCancellations)
      .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId));

    const cancelledByLine = new Map<string, number>();
    for (const cancellation of cancellations) {
      const metadata = (cancellation.metadata ?? {}) as Record<string, unknown>;
      const cancelledLines = Array.isArray(metadata.cancelledLines)
        ? (metadata.cancelledLines as PartialCancelledLineQuantity[])
        : [];
      for (const line of cancelledLines) {
        if (!line || typeof line.salesOrderLineId !== 'string' || typeof line.quantity !== 'number') {
          continue;
        }
        cancelledByLine.set(line.salesOrderLineId, (cancelledByLine.get(line.salesOrderLineId) ?? 0) + line.quantity);
      }
    }

    return cancelledByLine;
  }

  private async buildItemsFromCompensationItems(
    salesOrderId: string,
    items: CompensationShipmentItemDto[],
    trx: DbTx,
  ): Promise<Omit<FulfillmentOrderItemInsert, 'fulfillmentOrderId'>[]> {
    const originalLines = await trx
      .select()
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId));
    const originalLineIds = new Set(originalLines.map((line) => line.id));
    const originalLineById = new Map(originalLines.map((line) => [line.id, line]));
    const referencedLineIds = items
      .map((item) => item.salesOrderLineId)
      .filter((lineId): lineId is string => Boolean(lineId));
    const missingSourceLineId = referencedLineIds.find((lineId) => !originalLineIds.has(lineId));
    if (missingSourceLineId) {
      throw new BadRequestException(`SalesOrder line ${missingSourceLineId} does not belong to the target SalesOrder`);
    }

    const itemsToInsert: Omit<FulfillmentOrderItemInsert, 'fulfillmentOrderId'>[] = [];
    const missingItems: Array<{ variantId: string; reason: string }> = [];

    for (const item of items) {
      const sourceLine = item.salesOrderLineId ? originalLineById.get(item.salesOrderLineId) : undefined;
      if (sourceLine && sourceLine.variantId !== item.variantId) {
        throw new BadRequestException(
          `Compensation item variant ${item.variantId} does not match SalesOrder line ${sourceLine.id} variant ${sourceLine.variantId}`,
        );
      }

      const snapshotMappings = sourceLine?.mappingSnapshotId
        ? (await this.productSkuMapping.getMappingSnapshot(sourceLine.mappingSnapshotId, trx)).mappings
        : [];

      if (sourceLine && snapshotMappings.length > 0) {
        for (const mapping of snapshotMappings) {
          itemsToInsert.push({
            salesOrderId,
            salesOrderLineId: sourceLine.id,
            mappingSnapshotId: sourceLine.mappingSnapshotId,
            variantId: sourceLine.variantId,
            skuId: mapping.skuId,
            qty: item.quantity * Math.max(1, mapping.quantity || 1),
            reservedQty: 0,
            pickedQty: 0,
            shippedQty: 0,
            status: 'pending',
          });
        }
        continue;
      }

      const matching = await this.productSkuMapping.getByVariant(item.variantId, trx);
      if (this.isVoidMatching(matching)) {
        continue;
      }

      const links = this.getPhysicalSkuLinks(matching);
      if (links.length === 0) {
        missingItems.push({ variantId: item.variantId, reason: this.getMatchingFailureReason(matching) });
        continue;
      }

      for (const link of links) {
        itemsToInsert.push({
          salesOrderId,
          salesOrderLineId: item.salesOrderLineId ?? null,
          mappingSnapshotId: null,
          variantId: item.variantId,
          skuId: link.skuId,
          qty: item.quantity * Math.max(1, link.quantity || 1),
          reservedQty: 0,
          pickedQty: 0,
          shippedQty: 0,
          status: 'pending',
        });
      }
    }

    if (missingItems.length > 0) {
      throw new BadRequestException({
        code: 'PRODUCT_SKU_MATCHING_REQUIRED',
        message: 'Cannot create compensation fulfillment order because some variants have no SKU matching',
        missingItems,
      });
    }

    if (itemsToInsert.length === 0) {
      throw new BadRequestException({
        code: 'COMPENSATION_SHIPMENT_REQUIRES_PHYSICAL_ITEMS',
        message: 'Compensation shipment requires at least one physically fulfilled item',
      });
    }

    return itemsToInsert;
  }

  private async linkCompensationFulfillment(input: {
    salesOrderId: string;
    amendmentId: string;
    fulfillmentOrderId: string;
    occurredAt: Date;
    metadata: Record<string, unknown>;
    trx: DbTx;
  }) {
    await input.trx.insert(wmsTables.businessLinks).values([
      {
        sourceType: AMENDMENT_REF_TYPE,
        sourceId: input.amendmentId,
        sourceExternalRef: null,
        targetType: FULFILLMENT_ORDER_REF_TYPE,
        targetId: input.fulfillmentOrderId,
        targetExternalRef: null,
        relationName: 'caused_compensation_fulfillment',
        metadata: input.metadata,
        occurredAt: input.occurredAt,
      },
      {
        sourceType: SALES_ORDER_REF_TYPE,
        sourceId: input.salesOrderId,
        sourceExternalRef: null,
        targetType: FULFILLMENT_ORDER_REF_TYPE,
        targetId: input.fulfillmentOrderId,
        targetExternalRef: null,
        relationName: 'caused_compensation_fulfillment',
        metadata: {
          ...input.metadata,
          amendmentId: input.amendmentId,
        },
        occurredAt: input.occurredAt,
      },
    ]);
  }

  private isVoidMatching(matching: VariantSkuMatching): boolean {
    return matching?.status === 'matched' && matching.strategy === 'void';
  }

  private getPhysicalSkuLinks(matching: VariantSkuMatching): Array<{ skuId: string; quantity: number }> {
    if (matching?.status !== 'matched' || matching.strategy !== 'variant') {
      return [];
    }

    return Array.isArray((matching as { links?: unknown[] }).links)
      ? (matching as { links: Array<{ skuId: string; quantity: number }> }).links
      : [];
  }

  private getMatchingFailureReason(matching: VariantSkuMatching): string {
    if (!matching) {
      return 'NO_PRODUCT_SKU_MATCHING';
    }

    if (matching.status === 'ignored') {
      return 'LEGACY_PRODUCT_MATCHING_IGNORED';
    }

    if (matching.status !== 'matched') {
      return 'PRODUCT_MATCHING_UNRESOLVED';
    }

    if (matching.strategy !== 'variant') {
      return 'PRODUCT_MATCHING_STRATEGY_UNRESOLVED';
    }

    return 'NO_PRODUCT_SKU_MATCHING';
  }

  private async validateSkuRows(
    items: Array<Pick<FulfillmentOrderItemInsert, 'skuId'>>,
    ownerId: string | null,
    trx: DbTx,
  ): Promise<void> {
    const skuIds = [...new Set(items.map((item) => item.skuId))];
    const skuRows = await trx.select().from(wmsTables.skus).where(inArray(wmsTables.skus.id, skuIds));

    const foundSkuIds = new Set(skuRows.map((sku) => sku.id));
    const missingSkuId = skuIds.find((skuId) => !foundSkuIds.has(skuId));
    if (missingSkuId) {
      throw new BadRequestException(`SKU ${missingSkuId} not found`);
    }

    if (ownerId) {
      const mismatched = skuRows.find((sku) => sku.holderId !== ownerId);
      if (mismatched) {
        throw new BadRequestException('SKU_HOLDER_MISMATCH_FOR_3PL');
      }
    }
  }

  private async tryReserveItems(
    fulfillmentOrderId: string,
    warehouseId: string | null,
    items: Array<{
      id: string;
      salesOrderLineId: string | null;
      variantId: string | null;
      skuId: string;
      qty: number;
    }>,
    trx: DbTx,
  ): Promise<{
    status: 'created' | 'ready' | 'unfulfillable';
    totalReservedQty: number;
    failures: ReservationFailureDetail[];
  }> {
    if (!warehouseId) {
      return { status: 'created', totalReservedQty: 0, failures: [] };
    }

    let totalReservedQty = 0;
    const failures: ReservationFailureDetail[] = [];

    for (const item of items) {
      const requiresStockReservation = await this.requiresStockReservation(item.variantId, trx);
      if (!requiresStockReservation) {
        continue;
      }

      const availableQty = await this.availability.getAvailableQuantity(item.skuId, warehouseId, trx);

      try {
        await this.unifiedReservation.reserveStock(
          {
            targetType: 'FULFILLMENT_ORDER',
            targetId: fulfillmentOrderId,
            fulfillmentOrderItemId: item.id,
            skuId: item.skuId,
            warehouseId,
            quantity: item.qty,
            reason: 'Fulfillment order item reservation',
          },
          trx,
        );

        await trx
          .update(wmsTables.fulfillmentOrderItems)
          .set({ reservedQty: item.qty, updatedAt: new Date() })
          .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));

        totalReservedQty += item.qty;
      } catch (error) {
        if (!(error instanceof ConflictException)) {
          throw error;
        }

        failures.push({
          fulfillmentOrderItemId: item.id,
          salesOrderLineId: item.salesOrderLineId,
          variantId: item.variantId,
          skuId: item.skuId,
          requiredQty: item.qty,
          availableQty,
          reason: error.message,
        });
      }
    }

    return {
      status: failures.length > 0 ? 'unfulfillable' : 'ready',
      totalReservedQty,
      failures,
    };
  }

  private async requiresStockReservation(variantId: string | null, trx: DbTx): Promise<boolean> {
    if (!variantId) return true;

    const policy = await this.policies.getVariantPolicy(variantId, trx);
    return policy.inventoryManagement;
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
      let splitItemCount = 0;
      let splitTotalQty = 0;

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
          splitItemCount += 1;
          splitTotalQty += moveQty;
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
          splitItemCount += 1;
          splitTotalQty += moveQty;
        }

        if (splitItems.length > 0) {
          await this.reservationLifecycle.handleFulfillmentOrderSplit(id, newFo.id, splitItems, trx);
        }
      }

      if (splitItemCount === 0) {
        throw new BadRequestException('Fulfillment order split requires at least one movable item');
      }

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ totalItems: splitItemCount, totalQty: splitTotalQty, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, newFo.id));

      return {
        ...newFo,
        totalItems: splitItemCount,
        totalQty: splitTotalQty,
      };
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
      await trx.execute(sql`
        SELECT id
        FROM ${wmsTables.fulfillmentOrders}
        WHERE ${wmsTables.fulfillmentOrders.id} = ${id}
        FOR UPDATE
      `);

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

      await trx.execute(sql`
        SELECT id
        FROM ${wmsTables.fulfillmentOrderItems}
        WHERE ${wmsTables.fulfillmentOrderItems.fulfillmentOrderId} = ${id}
        FOR UPDATE
      `);

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
        .set({ status: 'shipped', updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, id));

      await this.reservationLifecycle.handleFulfillmentOrderStatusChange(id, fo.status, 'shipped', trx);

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
        .set({ status: 'canceled', updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, id));

      await this.reservationLifecycle.handleFulfillmentOrderStatusChange(id, fo.status, 'canceled', trx);

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

      if (items.length === 0) return { ready: false };

      const availableQtyBySku = new Map<string, number>();
      for (const item of items) {
        const policy = item.variantId ? await this.policies.getVariantPolicy(item.variantId, trx) : null;
        const stockPolicy = {
          inventoryManagement: policy?.inventoryManagement ?? true,
          preStockSellable: policy?.preStockSellable ?? false,
          alwaysSellableZeroStock: policy?.alwaysSellableZeroStock ?? false,
        };
        const remainingRequiredQty = Math.max(0, item.qty - (item.reservedQty || 0));
        if (!stockPolicy.inventoryManagement || remainingRequiredQty === 0) {
          continue;
        }

        let availableQty = availableQtyBySku.get(item.skuId);
        if (availableQty === undefined) {
          availableQty = await this.availability.getAvailableQuantity(item.skuId, fo.warehouseId, trx);
        }

        const canFulfill = this.policies.evaluateFulfillability(stockPolicy, availableQty, remainingRequiredQty);
        if (!canFulfill) return { ready: false };
        availableQtyBySku.set(item.skuId, availableQty - remainingRequiredQty);
      }

      return { ready: true };
    }, tx);
  }
}
