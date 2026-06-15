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
import { eq, inArray, asc, desc, sql, count, and } from 'drizzle-orm';
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
import { FulfillmentShippedPayload, FulfillmentDeliveredPayload, FulfillmentCancelledPayload, Carrier } from '@packages/event-contracts/streams';
import { SalesOrderAmendmentsService } from '../../sales-order/services/sales-order-amendments.service';
import { SalesOrderAmendmentDeltaDto } from '../../sales-order/dto/create-sales-order-amendment.dto';

type FulfillmentStatus = (typeof wmsTables.fulfillmentOrders.status.enumValues)[number];

// 외부 쿼리 문자열을 fulfillment status enum 으로 좁히는 타입 가드.
// enumValues 를 readonly string[] 로 넓혀 includes 비교 (단순 멤버십 체크용 안전한 위닝)
const isFulfillmentStatus = (value: string): value is FulfillmentStatus =>
  (wmsTables.fulfillmentOrders.status.enumValues as readonly string[]).includes(value);

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

    // FulfillmentCreated 는 구독하는 서비스가 없어 발행하지 않는다.
    // (스토어프론트/어드민 모두 Core API 로 live FO 상태를 직접 조회하고,
    //  Medusa 동기화는 Shipped/Delivered 만 사용한다.)
    // 설계 원칙: 아무도 구독하지 않는 이벤트는 발행하지 않는다.

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
      // FulfillmentReady 는 구독하는 서비스가 없어 발행하지 않는다 (설계 원칙: 미구독 이벤트 미발행).
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
      // 잠금 순서 컨벤션 (ready 상태 재고 조정 액션 공통): FO(id asc) → FOI(id asc) → reservation
      // origin FO를 잠가 reserve/unreserve/transferReservation과의 동시 실행을 직렬화한다
      const [origin] = await trx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, id))
        .limit(1)
        .for('update');
      if (!origin) return null;

      const TERMINAL_STATUSES = ['shipped', 'completed', 'canceled'];
      if (TERMINAL_STATUSES.includes(origin.status)) {
        throw new ConflictException(`Cannot split FO ${id} in status '${origin.status}'`);
      }

      const [newFo] = await trx
        .insert(wmsTables.fulfillmentOrders)
        .values({
          salesOrderId: origin.salesOrderId,
          warehouseId: origin.warehouseId,
          ownerId: origin.ownerId,
          fulfillmentMode: origin.fulfillmentMode,
          priority: origin.priority,
          status: 'created',
          shippingAddress: origin.shippingAddress,
          labelNo: null,
        })
        .returning();

      const itemMoves = dto?.items ?? [];
      const legacyMoves = dto?.lines ?? [];
      let splitItemCount = 0;
      let splitTotalQty = 0;

      type SplitReservationMove = {
        originalFulfillmentOrderItemId: string;
        newFulfillmentOrderItemId: string;
        skuId: string;
        splitQuantity: number;
        originalQuantityBeforeSplit: number;
      };

      if (itemMoves.length > 0) {
        const splitItems: SplitReservationMove[] = [];

        // 같은 FOI 중복 요청은 잠근 snapshot 값을 반복 사용해 qty/reservedQty 카운터를 깨뜨리므로 거부
        const requestedItemIds = itemMoves.map((mv) => mv.fulfillmentOrderItemId);
        if (new Set(requestedItemIds).size !== requestedItemIds.length) {
          throw new BadRequestException('Duplicate fulfillmentOrderItemId in split request');
        }
        // DTO @Min(1)과 별개로 서비스 불변식으로도 차단 — 내부 호출/validation pipe 누락 시
        // quantity<=0은 qty 0 신규 FOI 또는 origin qty 증가(음수 이동)를 만들 수 있다
        if (itemMoves.some((mv) => mv.quantity <= 0)) {
          throw new BadRequestException('Split quantity must be greater than 0');
        }

        // 대상 FOI를 id 순서로 한 번에 잠금 — stale reservedQty/qty 덮어쓰기 방지
        const lockedItems = await trx
          .select()
          .from(wmsTables.fulfillmentOrderItems)
          .where(
            and(
              inArray(wmsTables.fulfillmentOrderItems.id, requestedItemIds),
              eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, id),
            ),
          )
          .orderBy(asc(wmsTables.fulfillmentOrderItems.id))
          .for('update');
        const lockedItemById = new Map(lockedItems.map((item) => [item.id, item]));

        for (const mv of itemMoves) {
          const item = lockedItemById.get(mv.fulfillmentOrderItemId);
          if (!item || item.fulfillmentOrderId !== id) {
            throw new BadRequestException(`FOI ${mv.fulfillmentOrderItemId} not found in FO ${id}`);
          }

          const splittableQty = item.qty - item.shippedQty;
          if (splittableQty <= 0) continue;

          if (mv.quantity > splittableQty) {
            throw new BadRequestException(
              `Cannot split ${mv.quantity} of FOI ${item.id}: only ${splittableQty} units are splittable (shippedQty=${item.shippedQty})`,
            );
          }

          const moveQty = mv.quantity;

          if (item.qty - moveQty < 1 && item.shippedQty === 0) {
            throw new BadRequestException(
              `Cannot split all qty from FOI ${item.id}: at least 1 unit must remain on the origin`,
            );
          }

          const originalQtyBeforeSplit = item.qty;

          // reservedQty는 여기서 만지지 않는다 — 예약 row 이동과 카운터 갱신은
          // reservationLifecycle.handleFulfillmentOrderSplit이 실제 이동량 기준으로 일괄 수행
          await trx
            .update(wmsTables.fulfillmentOrderItems)
            .set({
              qty: item.qty - moveQty,
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
            originalFulfillmentOrderItemId: item.id,
            newFulfillmentOrderItemId: newItem.id,
            skuId: item.skuId,
            splitQuantity: moveQty,
            originalQuantityBeforeSplit: originalQtyBeforeSplit,
          });
          splitItemCount += 1;
          splitTotalQty += moveQty;
        }

        if (splitItems.length > 0) {
          await this.reservationLifecycle.handleFulfillmentOrderSplit(id, newFo.id, splitItems, trx);
        }
      } else if (legacyMoves.length > 0) {
        this.logger.warn(`[split] Using deprecated 'lines' field. Please use 'items' instead.`);

        const splitItems: SplitReservationMove[] = [];

        // legacy 경로도 items 경로와 동일한 불변식 적용: 중복 거부 + 수량 양수 + FO 멤버십 강제
        const requestedLineIds = legacyMoves.map((mv) => mv.fulfillmentOrderLineId);
        if (new Set(requestedLineIds).size !== requestedLineIds.length) {
          throw new BadRequestException('Duplicate fulfillmentOrderLineId in split request');
        }
        if (legacyMoves.some((mv) => mv.quantity <= 0)) {
          throw new BadRequestException('Split quantity must be greater than 0');
        }

        const lockedLegacyItems = await trx
          .select()
          .from(wmsTables.fulfillmentOrderItems)
          .where(
            and(
              inArray(wmsTables.fulfillmentOrderItems.id, requestedLineIds),
              eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, id),
            ),
          )
          .orderBy(asc(wmsTables.fulfillmentOrderItems.id))
          .for('update');
        const lockedLegacyItemById = new Map(lockedLegacyItems.map((item) => [item.id, item]));

        for (const mv of legacyMoves) {
          const item = lockedLegacyItemById.get(mv.fulfillmentOrderLineId);
          if (!item || item.fulfillmentOrderId !== id) {
            throw new BadRequestException(`FOI ${mv.fulfillmentOrderLineId} not found in FO ${id}`);
          }
          const moveQty = Math.min(mv.quantity, item.qty - item.shippedQty);
          if (moveQty <= 0) continue;

          if (item.qty - moveQty < 1 && item.shippedQty === 0) {
            throw new BadRequestException(
              `Cannot split all qty from FOI ${item.id}: at least 1 unit must remain on the origin`,
            );
          }

          const originalQtyBeforeSplit = item.qty;

          // reservedQty는 reservationLifecycle이 실제 이동량 기준으로 갱신
          await trx
            .update(wmsTables.fulfillmentOrderItems)
            .set({
              qty: item.qty - moveQty,
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
            originalFulfillmentOrderItemId: item.id,
            newFulfillmentOrderItemId: newItem.id,
            skuId: item.skuId,
            splitQuantity: moveQty,
            originalQuantityBeforeSplit: originalQtyBeforeSplit,
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

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ totalQty: origin.totalQty - splitTotalQty, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, id));

      return {
        ...newFo,
        totalItems: splitItemCount,
        totalQty: splitTotalQty,
      };
    }, tx);
  }

  async assignShipment(id: string, dto: AssignShipmentDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
      // ship()과 동일한 row lock: SELECT → INSERT 사이 동시 요청 2개가 중복 shipment를 만드는 race 차단
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

      const ASSIGN_SHIPMENT_TERMINAL = new Set(['shipped', 'completed', 'canceled']);
      if (ASSIGN_SHIPMENT_TERMINAL.has(fo.status)) {
        throw new ConflictException(`Cannot assign shipment to FO ${id} in terminal status '${fo.status}'`);
      }

      const [existingShipment] = await trx
        .select({ id: wmsTables.shipments.id })
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.fulfillmentOrderId, id))
        .limit(1);
      if (existingShipment) {
        throw new ConflictException(`Shipment already exists for FO ${id}`);
      }

      await trx.insert(wmsTables.shipments).values({
        trackingNo: dto.trackingNo,
        carrier: (dto.carrier ?? 'CJ') as Carrier,
        status: 'created',
        eta: dto.eta ? new Date(dto.eta) : null,
        splitStatus: false,
        fulfillmentOrderId: id,
      });

      // picking/inspection/invoiced 진행 중에는 labeled로 역전이하지 않음
      const NO_REGRESS_STATUSES = new Set(['picked', 'inspecting', 'inspected', 'invoiced']);
      if (!NO_REGRESS_STATUSES.has(fo.status)) {
        await trx
          .update(wmsTables.fulfillmentOrders)
          .set({ status: 'labeled' })
          .where(eq(wmsTables.fulfillmentOrders.id, id));
        // FulfillmentLabeled 는 구독하는 서비스가 없어 발행하지 않는다 (설계 원칙: 미구독 이벤트 미발행).
      }

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

      // 이미 shipped: idempotent return (invoice/direct-ship 경유 중복 호출 방어)
      if (fo.status === 'shipped') {
        return this.getOne(id, trx);
      }

      if (fo.status === 'completed' || fo.status === 'canceled') {
        throw new ConflictException(`Cannot ship FO ${id} in terminal status '${fo.status}'`);
      }

      if (fo.fulfillmentMode === 'drop_ship') {
        if (fo.directShipStatus !== 'forwarded') {
          throw new ConflictException(
            `Cannot ship drop_ship FO ${id}: directShipStatus must be 'forwarded', got '${fo.directShipStatus ?? 'null'}'`,
          );
        }
      } else {
        const SHIP_ALLOWED = new Set(['invoiced', 'labeled', 'picked', 'inspecting', 'inspected']);
        if (!SHIP_ALLOWED.has(fo.status)) {
          throw new ConflictException(
            `Cannot ship FO ${id} in status '${fo.status}'. Allowed: invoiced, labeled, picked, inspecting, inspected`,
          );
        }
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
      const now = new Date();
      for (const item of items) {
        await trx
          .update(wmsTables.fulfillmentOrderItems)
          .set({ shippedQty: item.qty, status: 'shipped', updatedAt: now })
          .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
      }

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'shipped', shippedAt: now, updatedAt: now })
        .where(eq(wmsTables.fulfillmentOrders.id, id));

      await this.reservationLifecycle.handleFulfillmentOrderStatusChange(id, fo.status, 'shipped', trx);

      const [salesOrderRow] = fo.salesOrderId
        ? await trx
            .select({ channelOrderId: wmsTables.salesOrders.channelOrderId })
            .from(wmsTables.salesOrders)
            .where(eq(wmsTables.salesOrders.id, fo.salesOrderId))
            .limit(1)
        : [];

      const shippedPayload: FulfillmentShippedPayload = {
        fulfillmentId: id,
        orderId: fo.salesOrderId ?? '',
        channelOrderId: salesOrderRow?.channelOrderId ?? undefined,
        trackingInfo: {
          carrier: (shipment?.carrier as Carrier) ?? 'CJ',
          trackingNumber: shipment?.trackingNo ?? '',
          invoiceUrl: shipment?.invoiceUrl ?? undefined,
        },
        shippedAt: now.toISOString(),
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

  async markDelivered(id: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const [fo] = await trx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, id))
        .limit(1);
      if (!fo) {
        throw new NotFoundException(`Fulfillment order ${id} not found`);
      }
      if (fo.status !== 'shipped') {
        throw new ConflictException(`Cannot mark delivered: FO is in status '${fo.status}', expected 'shipped'`);
      }

      const now = new Date();

      // 'completed' = delivered at FO level (FO_DELIVERED_STATUSES in store-sales-orders.service.ts)
      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'completed', updatedAt: now })
        .where(eq(wmsTables.fulfillmentOrders.id, id));

      // 배송 완료 시각을 shipment_tracking에 기록 → buildTrackingView()가 deliveredAt으로 노출
      const [shipmentRow] = await trx
        .select({ id: wmsTables.shipments.id })
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.fulfillmentOrderId, id))
        .limit(1);

      if (shipmentRow) {
        await trx.insert(wmsTables.shipmentTracking).values({
          shipmentId: shipmentRow.id,
          status: 'delivered',
          timestamp: now,
        });
        await trx
          .update(wmsTables.shipments)
          .set({ status: 'delivered', lastUpdated: now })
          .where(eq(wmsTables.shipments.id, shipmentRow.id));
      }

      const [salesOrderRow] = fo.salesOrderId
        ? await trx
            .select({ channelOrderId: wmsTables.salesOrders.channelOrderId })
            .from(wmsTables.salesOrders)
            .where(eq(wmsTables.salesOrders.id, fo.salesOrderId))
            .limit(1)
        : [];

      const deliveredPayload: FulfillmentDeliveredPayload = {
        fulfillmentId: id,
        orderId: fo.salesOrderId ?? '',
        channelOrderId: salesOrderRow?.channelOrderId ?? undefined,
        deliveredAt: now.toISOString(),
      };

      await this.outbox.enqueue(
        {
          eventType: FULFILLMENT_EVENTS.DELIVERED,
          aggregateType: 'fulfillment',
          aggregateId: id,
          partitionKey: fo.salesOrderId ?? id,
          payload: deliveredPayload,
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

  private computeAdminAvailableActions(
    fo: { status: string; fulfillmentMode: string | null; directShipStatus: string | null | undefined },
    items: Array<{ shippedQty: number }>,
  ): string[] {
    const TERMINAL_STATUSES = ['shipped', 'completed', 'canceled'];
    // 서버 불변식(FulfillmentReservationsFacade.RESERVATION_TRANSFER_ALLOWED_STATUSES)과 동일한 화이트리스트.
    // 블랙리스트로 두면 pending/forwarded 등 enum의 나머지 상태에서 버튼은 노출되는데 서버는 409를 던진다.
    const TRANSFER_ALLOWED_STATUSES = new Set(['created', 'reserving', 'ready', 'unfulfillable']);
    const isTerminal = TERMINAL_STATUSES.includes(fo.status);
    const hasShippedItems = items.some((i) => i.shippedQty > 0);
    const actions: string[] = [];

    if (!isTerminal) {
      if (!hasShippedItems) actions.push('split');
      actions.push('reserve');
      if (!hasShippedItems) {
        actions.push('unreserve');
        if (TRANSFER_ALLOWED_STATUSES.has(fo.status)) {
          actions.push('transferReservation');
        }
      }
      actions.push('assignShipment', 'cancel');
    }
    if (['invoiced', 'labeled', 'picked', 'inspecting', 'inspected'].includes(fo.status)) {
      actions.push('ship');
    }
    if (fo.status === 'shipped') {
      actions.push('deliver');
    }
    if (fo.fulfillmentMode === 'drop_ship' && !isTerminal) {
      const dsStatus = fo.directShipStatus;
      if (!dsStatus || dsStatus === 'pending') actions.push('forwardDropShip');
      if (dsStatus === 'forwarded') actions.push('completeDropShip');
    }
    return actions;
  }

  private computeBlockedReasons(
    fo: { status: string },
    items: Array<{ shippedQty: number }>,
  ): string[] {
    const reasons: string[] = [];
    if (['shipped', 'completed', 'canceled'].includes(fo.status)) {
      reasons.push('TERMINAL_STATUS');
    }
    if (items.some((i) => i.shippedQty > 0)) {
      reasons.push('SHIPPED_EVIDENCE');
    }
    return reasons;
  }

  async getOutboxEvents(id: string, tx?: DbTx) {
    const db = tx ?? this.db.db;
    return db
      .select({
        id: wmsTables.outboxEvents.id,
        eventType: wmsTables.outboxEvents.eventType,
        status: wmsTables.outboxEvents.status,
        attempts: wmsTables.outboxEvents.attempts,
        nextAttemptAt: wmsTables.outboxEvents.nextAttemptAt,
        publishedAt: wmsTables.outboxEvents.publishedAt,
        createdAt: wmsTables.outboxEvents.createdAt,
        updatedAt: wmsTables.outboxEvents.updatedAt,
      })
      .from(wmsTables.outboxEvents)
      .where(and(
        eq(wmsTables.outboxEvents.aggregateType, 'fulfillment'),
        eq(wmsTables.outboxEvents.aggregateId, id),
      ))
      .orderBy(desc(wmsTables.outboxEvents.createdAt));
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

    const [items, invoiceRows, shipmentRows] = await Promise.all([
      db
        .select({
          id: wmsTables.fulfillmentOrderItems.id,
          fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
          salesOrderId: wmsTables.fulfillmentOrderItems.salesOrderId,
          salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
          variantId: wmsTables.fulfillmentOrderItems.variantId,
          skuId: wmsTables.fulfillmentOrderItems.skuId,
          skuCode: wmsTables.skus.code,
          skuName: wmsTables.skus.name,
          qty: wmsTables.fulfillmentOrderItems.qty,
          reservedQty: wmsTables.fulfillmentOrderItems.reservedQty,
          pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
          shippedQty: wmsTables.fulfillmentOrderItems.shippedQty,
          status: wmsTables.fulfillmentOrderItems.status,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, id))
        .orderBy(wmsTables.fulfillmentOrderItems.createdAt),
      db
        .select({
          id: wmsTables.invoices.id,
          invoiceNumber: wmsTables.invoices.invoiceNumber,
          status: wmsTables.invoices.status,
          carrierCode: wmsTables.invoices.carrierCode,
          issueMethod: wmsTables.invoices.issueMethod,
        })
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.fulfillmentOrderId, id))
        .limit(1),
      db
        .select({
          id: wmsTables.shipments.id,
          trackingNo: wmsTables.shipments.trackingNo,
          carrier: wmsTables.shipments.carrier,
          status: wmsTables.shipments.status,
          eta: wmsTables.shipments.eta,
          invoiceUrl: wmsTables.shipments.invoiceUrl,
        })
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.fulfillmentOrderId, id))
        .limit(1),
    ]);

    const itemIds = items.map((i) => i.id);
    const reservations =
      itemIds.length > 0
        ? await db
            .select({
              id: wmsTables.stockReservations.id,
              fulfillmentOrderItemId: wmsTables.stockReservations.fulfillmentOrderItemId,
              skuId: wmsTables.stockReservations.skuId,
              warehouseId: wmsTables.stockReservations.warehouseId,
              quantity: wmsTables.stockReservations.quantity,
              status: wmsTables.stockReservations.status,
            })
            .from(wmsTables.stockReservations)
            .where(
              and(
                inArray(wmsTables.stockReservations.fulfillmentOrderItemId, itemIds),
                eq(wmsTables.stockReservations.status, 'confirmed'),
              ),
            )
        : [];

    const batchRow = fulfillmentOrder.batchId
      ? await db
          .select({ id: wmsTables.outboundBatches.id, batchNumber: wmsTables.outboundBatches.batchNumber })
          .from(wmsTables.outboundBatches)
          .where(eq(wmsTables.outboundBatches.id, fulfillmentOrder.batchId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null;

    const adminAvailableActions = this.computeAdminAvailableActions(fulfillmentOrder, items);
    const blockedReasons = this.computeBlockedReasons(fulfillmentOrder, items);

    // FOI 라인 + SKU 조인 (상세 화면 표시용)
    const itemsWithSku = await db
      .select({
        id: wmsTables.fulfillmentOrderItems.id,
        skuId: wmsTables.fulfillmentOrderItems.skuId,
        skuCode: wmsTables.skus.code,
        skuName: wmsTables.skus.name,
        qty: wmsTables.fulfillmentOrderItems.qty,
        reservedQty: wmsTables.fulfillmentOrderItems.reservedQty,
        pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
        shippedQty: wmsTables.fulfillmentOrderItems.shippedQty,
        status: wmsTables.fulfillmentOrderItems.status,
        salesOrderId: wmsTables.fulfillmentOrderItems.salesOrderId,
        salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
      })
      .from(wmsTables.fulfillmentOrderItems)
      .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, id))
      .orderBy(wmsTables.fulfillmentOrderItems.createdAt);

    return {
      ...fulfillmentOrder,
      invoice: invoiceRows[0] || null,
      shipment: shipmentRows[0] || null,
      batch: batchRow,
      items: itemsWithSku,
      reservations,
      adminAvailableActions,
      blockedReasons,
    };
  }

  async list(
    params: {
      limit: number;
      offset: number;
      status?: string;
      warehouseId?: string;
      fulfillmentMode?: string;
      salesOrderId?: string;
      priority?: string;
    },
    tx?: DbTx,
  ) {
    const db = tx ?? this.db.db;

    // status 쿼리 문자열을 enum 으로 안전 narrowing (잘못된 값은 무시)
    const statusFilter =
      params.status && isFulfillmentStatus(params.status) ? params.status : undefined;
    const conditions = [
      statusFilter ? eq(wmsTables.fulfillmentOrders.status, statusFilter) : undefined,
      params.warehouseId ? eq(wmsTables.fulfillmentOrders.warehouseId, params.warehouseId) : undefined,
      params.fulfillmentMode ? eq(wmsTables.fulfillmentOrders.fulfillmentMode, params.fulfillmentMode as any) : undefined,
      params.salesOrderId ? eq(wmsTables.fulfillmentOrders.salesOrderId, params.salesOrderId) : undefined,
      params.priority ? eq(wmsTables.fulfillmentOrders.priority, params.priority as any) : undefined,
    ].filter(Boolean);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await db
      .select({ value: count() })
      .from(wmsTables.fulfillmentOrders)
      .where(whereClause);
    const total = totalRow?.value ?? 0;

    const fulfillmentOrders = await db
      .select()
      .from(wmsTables.fulfillmentOrders)
      .where(whereClause)
      .limit(params.limit)
      .offset(params.offset)
      .orderBy(desc(wmsTables.fulfillmentOrders.createdAt));

    if (fulfillmentOrders.length === 0) {
      return { data: [], total };
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

    const data = fulfillmentOrders.map((fo) => ({
      ...fo,
      invoice: invoicesByFoId.get(fo.id) ?? null,
    }));

    return { data, total };
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
