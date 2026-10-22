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
import { eq, inArray, desc, sql, count, and } from 'drizzle-orm';
import { FULFILLMENT_EVENTS } from '../events';
import { LineCompositionReader } from '../../product-matching/line-composition/line-composition.reader';
import { selectLineCompositionViews } from '../../product-matching/line-composition/line-composition-views';
import { LineCompositionManager } from '../../product-matching/line-composition/line-composition.manager';
import {
  blocksFulfillment,
  CompositionItem,
  MatchingFailureReason,
} from '../../product-matching/line-composition/line-composition';
import { ReservationLifecycleService } from '../../inventory/shared/services/reservation-lifecycle.service';
import { acquireStockAvailabilityLocks } from '../../inventory/shared/locks/stock-availability-lock';
import { assertWarehouseSellable } from '../../inventory/shared/availability/sellable-warehouses';
import { CreateFulfillmentOrderDto } from '../dto/create-fulfillment-order.dto';
import { FULFILLMENT_STREAM, FulfillmentShippedPayload } from '@packages/event-contracts/streams';
import { InjectPublisher, PublisherFor } from '@app/events';
import { outbox_events } from '@app/events';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentReservationService } from './shipment-reservation.service';
import { FulfillmentProgressService } from './fulfillment-progress.service';
import { selectEntrancePassword } from './entrance-password.selection';
import { compatibleShippingProfileId } from './shipping-profile';
import { openShipment } from '../shipment/shipment-lifecycle';

type FulfillmentStatus = (typeof wmsTables.fulfillmentOrders.status.enumValues)[number];

// 외부 쿼리 문자열을 fulfillment status enum 으로 좁히는 타입 가드.
// enumValues 를 readonly string[] 로 넓혀 includes 비교 (단순 멤버십 체크용 안전한 위닝)
const isFulfillmentStatus = (value: string): value is FulfillmentStatus =>
  (wmsTables.fulfillmentOrders.status.enumValues as readonly string[]).includes(value);

type FulfillmentOrderItemInsert = {
  fulfillmentOrderId: string;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  variantId: string | null;
  skuId: string;
  qty: number;
  reservedQty: number;
  pickedQty: number;
  shippedQty: number;
  status: string;
};

// 상품매칭을 따르던 라인과 그 라인을 굳힐 구성
type LineFreeze = { salesOrderLineId: string; items: CompositionItem[] };

type UnmatchedSalesOrderLine = {
  salesOrderLineId: string;
  variantId: string;
  reason: MatchingFailureReason;
};

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

@Injectable()
export class FulfillmentsService {
  private readonly logger = new Logger(FulfillmentsService.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly reservationLifecycle: ReservationLifecycleService,
    private readonly lineCompositions: LineCompositionReader,
    @InjectPublisher(FULFILLMENT_STREAM)
    private readonly fulfillmentsV1: PublisherFor<typeof FULFILLMENT_STREAM>,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly lineCompositionManager: LineCompositionManager,
    @Optional() private readonly shipmentReservation?: ShipmentReservationService,
    @Optional() private readonly fulfillmentProgress?: FulfillmentProgressService,
  ) {}

  async requiresPhysicalFulfillmentOrder(salesOrderId: string, tx?: DbTx): Promise<boolean> {
    return this.db.run(async (trx) => {
      const { items } = await this.buildItemsFromSalesOrder(salesOrderId, trx);
      return items.length > 0;
    }, tx);
  }

  async create(dto: CreateFulfillmentOrderDto, tx?: DbTx) {
    // maintenance 는 게이트가 503 으로 막는다. V1 create 분기는 V1 출고 경로와 함께 Task 25 에서 제거됐다.
    this.workflowGate.assertV2MutationAllowed('fulfillment.create_v2');
    return this.createV2(dto, tx);
  }

  private async createV2(dto: CreateFulfillmentOrderDto, tx?: DbTx) {
    if (!this.shipmentReservation) {
      throw new Error('ShipmentReservationService is required for V2 fulfillment creation');
    }
    const shipmentReservation = this.shipmentReservation;

    // Fail before opening the creation transaction when the request is known to
    // contain physical demand. Digital-only SOs remain a no-FO route.
    if (
      dto.fulfillmentMode !== 'drop_ship' &&
      !dto.warehouseId &&
      (await this.hasWarehouseControlledDemandPreflight(dto, tx))
    ) {
      throw new BadRequestException({
        code: 'V2_PHYSICAL_FULFILLMENT_REQUIRES_WAREHOUSE',
        message: 'A warehouse is required for V2 physical fulfillment',
      });
    }

    return this.db.run(async (trx) => {
      let salesOrder: typeof wmsTables.salesOrders.$inferSelect | undefined;
      if (dto.salesOrderId) {
        await trx.execute(sql`
          SELECT id FROM ${wmsTables.salesOrders}
          WHERE ${wmsTables.salesOrders.id} = ${dto.salesOrderId}
          FOR UPDATE
        `);
        [salesOrder] = await trx
          .select()
          .from(wmsTables.salesOrders)
          .where(eq(wmsTables.salesOrders.id, dto.salesOrderId))
          .limit(1);
        if (!salesOrder) throw new BadRequestException(`Sales order ${dto.salesOrderId} not found`);
        if (salesOrder.status === 'cancelled') {
          throw new BadRequestException(`Cannot create fulfillment for cancelled sales order ${dto.salesOrderId}`);
        }

        const [existing] = await trx
          .select()
          .from(wmsTables.fulfillmentOrders)
          .where(eq(wmsTables.fulfillmentOrders.salesOrderId, dto.salesOrderId))
          .limit(1);
        if (existing) return this.getOne(existing.id, trx);
        // 셀메이트 과도기: 판매주문 status 의 shipped·delivered 는 셀메이트 스크립트가 쓴다(ADR-0017 — core 경로는 쓰지 않음).
        // 이미 나간 주문에 FO 를 만들면 확정 예약·draft 상자가 재고를 묶는다(10-08 실측 3,883개). 판매주문 잠금 아래에서
        // 검사해야 판정 직후 스크립트가 돈 틈까지 막힌다. FO 없이 돌아오면 워커가 backlog 를 not_required 로 닫는다.
        if (salesOrder.status === 'shipped' || salesOrder.status === 'delivered') {
          this.logger.log(
            `Skip FO creation for sales order ${dto.salesOrderId}: already ${salesOrder.status} outside core (sellmate)`,
          );
          return null;
        }
      }

      const requestedItems = Array.isArray(dto.items) ? dto.items : [];
      const legacyLines = Array.isArray(dto.lines) ? dto.lines : [];
      if (dto.salesOrderId && (requestedItems.length > 0 || legacyLines.length > 0)) {
        throw new BadRequestException({
          code: 'SALES_ORDER_ITEMS_DERIVED_FROM_MATCHING',
          message: 'Fulfillment items for a sales order must be derived from product-SKU matching.',
        });
      }

      let itemsToInsert: Omit<FulfillmentOrderItemInsert, 'fulfillmentOrderId'>[];
      let freeze: LineFreeze[] = [];
      if (requestedItems.length > 0) {
        const referenced = requestedItems.find((item) => item.salesOrderId || item.salesOrderLineId);
        if (referenced) {
          throw new BadRequestException({
            code: 'FULFILLMENT_ITEM_SO_REFERENCE_NOT_ALLOWED',
            message: 'Explicit V2 fulfillment items cannot carry sales-order references.',
          });
        }
        itemsToInsert = requestedItems.map((item) => {
          if (!item.skuId || !item.quantity || item.quantity <= 0) {
            throw new BadRequestException('Invalid item data: skuId and positive quantity are required');
          }
          return {
            salesOrderId: null,
            salesOrderLineId: null,
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
        itemsToInsert = legacyLines.map((line) => {
          if (!line.skuId || !line.quantity || line.quantity <= 0) {
            throw new BadRequestException('Invalid line data: skuId and positive quantity are required');
          }
          return {
            salesOrderId: null,
            salesOrderLineId: null,
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
        const built = await this.buildItemsFromSalesOrder(dto.salesOrderId, trx);
        itemsToInsert = built.items;
        freeze = built.freeze;
      } else {
        throw new BadRequestException('Fulfillment order requires items or salesOrderId');
      }

      // Digital-only/void-matched sales orders do not create a placeholder FO.
      if (itemsToInsert.length === 0 && dto.salesOrderId) return null;
      if (itemsToInsert.length === 0) throw new BadRequestException('Fulfillment order items cannot be empty');
      // 판매주문 잠금 아래에서 굳힌다(#1063 스펙 §5.4). 뒤 검증이 실패하면 호출자의 트랜잭션, 또는 백로그 워커가 감싼 savepoint 가 롤백되면서 함께 되돌아간다.
      if (freeze.length > 0) await this.lineCompositionManager.freezeFromMatching(freeze, trx);
      await this.validateSkuRows(itemsToInsert, dto.ownerId ?? null, trx);
      const uniqueSkuIds = [...new Set(itemsToInsert.map((item) => item.skuId))];
      const skuRows = await trx
        .select({
          id: wmsTables.skus.id,
          stockType: wmsTables.skus.stockType,
          deliveryProfileId: wmsTables.skus.deliveryProfileId,
        })
        .from(wmsTables.skus)
        .where(inArray(wmsTables.skus.id, uniqueSkuIds));
      const dropShippedSkuCount = skuRows.filter((row) => row.stockType === 'drop_shipped').length;
      if (dto.fulfillmentMode === 'drop_ship' || dropShippedSkuCount === skuRows.length) {
        // Explicit direct mode and all-drop_shipped demand never enter the V2
        // warehouse shipment/reservation model.
        return this.createFulfillmentOrderFromItems(
          {
            ...dto,
            fulfillmentMode: 'drop_ship',
            shippingAddress:
              dto.shippingAddress ??
              (salesOrder?.shippingAddress as CreateFulfillmentOrderDto['shippingAddress'] | undefined),
          },
          itemsToInsert,
          trx,
        );
      }
      if (dropShippedSkuCount > 0) {
        throw new BadRequestException({
          code: 'V2_MIXED_DIRECT_AND_WAREHOUSE_FULFILLMENT',
          message: 'drop_shipped and warehouse-controlled SKUs require separate fulfillment routes',
        });
      }
      if (!dto.warehouseId) {
        throw new BadRequestException({
          code: 'V2_PHYSICAL_FULFILLMENT_REQUIRES_WAREHOUSE',
          message: 'A warehouse is required for V2 physical fulfillment',
        });
      }
      await this.validateWarehouseExists(dto.warehouseId, trx);

      const [fo] = await trx
        .insert(wmsTables.fulfillmentOrders)
        .values({
          salesOrderId: dto.salesOrderId ?? null,
          warehouseId: dto.warehouseId,
          ownerId: dto.ownerId ?? null,
          fulfillmentMode: dto.fulfillmentMode ?? 'in_house',
          priority: dto.priority ?? 'normal',
          status: 'created',
          totalItems: itemsToInsert.length,
          totalQty: itemsToInsert.reduce((total, item) => total + item.qty, 0),
          totalReservedQty: 0,
          shippingAddress: dto.shippingAddress ?? salesOrder?.shippingAddress ?? null,
        })
        .returning();
      const insertedItems = await trx
        .insert(wmsTables.fulfillmentOrderItems)
        .values(itemsToInsert.map((item) => ({ ...item, fulfillmentOrderId: fo.id })))
        .returning();

      const compatibleProfileId = compatibleShippingProfileId(skuRows.map((row) => row.deliveryProfileId));
      const { shipment, lines: shipmentLines } = await openShipment(
        trx,
        {
          warehouseId: dto.warehouseId,
          status: 'draft',
          shippingProfileId: compatibleProfileId ?? null,
          recipientSnapshot: dto.shippingAddress ?? salesOrder?.shippingAddress ?? null,
          entrancePassword: selectEntrancePassword(
            salesOrder ? [{ orderDate: salesOrder.orderDate, entrancePassword: salesOrder.entrancePassword }] : [],
          ),
        },
        insertedItems.map((item) => ({ fulfillmentOrderItemId: item.id, skuId: item.skuId, qty: item.qty })),
      );

      // Acquire every stock key first so multi-SKU orders cannot deadlock each
      // other by sales-order line order. reservePartial safely re-enters the locks.
      await acquireStockAvailabilityLocks(
        trx,
        shipmentLines.map((line) => ({ skuId: line.skuId, warehouseId: dto.warehouseId as string })),
      );
      let mutated = false;
      for (const line of shipmentLines.sort((a, b) => a.id.localeCompare(b.id))) {
        const result = await shipmentReservation.reservePartial(line.id, line.qty, trx);
        mutated ||= result.mutated;
      }
      if (!mutated) await shipmentReservation.recompute(shipment.id, trx);

      this.logger.log(`Created V2 Draft shipment ${shipment.id} for fulfillment order ${fo.id}`);
      return this.getOne(fo.id, trx);
    }, tx);
  }

  private async hasWarehouseControlledDemandPreflight(dto: CreateFulfillmentOrderDto, tx?: DbTx): Promise<boolean> {
    const executor = (tx ?? this.db.db) as unknown as DbTx;
    let skuIds: string[];
    if ((dto.items?.length ?? 0) > 0) {
      skuIds = dto.items?.map((item) => item.skuId) ?? [];
    } else if ((dto.lines?.length ?? 0) > 0) {
      skuIds = dto.lines?.map((line) => line.skuId) ?? [];
    } else if (dto.salesOrderId) {
      const { items } = await this.buildItemsFromSalesOrder(dto.salesOrderId, executor);
      skuIds = items.map((item) => item.skuId);
    } else {
      return true;
    }
    if (skuIds.length === 0) return false;

    const skuRows = await executor
      .select({ stockType: wmsTables.skus.stockType })
      .from(wmsTables.skus)
      .where(inArray(wmsTables.skus.id, [...new Set(skuIds)]));
    // Unknown SKU IDs are validated by the locked command path. Treat them as
    // warehouse-controlled here so a missing warehouse still fails closed.
    return skuRows.length !== new Set(skuIds).size || skuRows.some((row) => row.stockType !== 'drop_shipped');
  }

  private async validateWarehouseExists(warehouseId: string | undefined, trx: DbTx): Promise<void> {
    if (!warehouseId) {
      return;
    }

    // 비판매 창고(해외 등)로는 출고를 지시할 수 없다. 예약은 호출자가 창고를 지정하는
    // 구조라, 이 지점을 막으면 비판매 창고에 예약이 걸릴 경로가 없다. 없는 창고에도
    // 던지므로 기존 존재 검증을 겸한다.
    await assertWarehouseSellable(trx, warehouseId);
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

    // 이 메서드의 유일한 호출자는 createV2 의 drop_ship 분기다 — 타사 재고라 자사 예약을 만들지 않고
    // 항상 ready 로 전환한다. (V1 창고 예약 경로 tryReserveItems 는 Task 25 에서 제거됐다.)
    await trx
      .update(wmsTables.fulfillmentOrders)
      .set({
        status: 'ready',
        totalReservedQty: 0,
        reservationFailureReason: null,
        reservationFailureDetails: null,
        updatedAt: new Date(),
      })
      .where(eq(wmsTables.fulfillmentOrders.id, fo.id));
    // FulfillmentReady 는 구독하는 서비스가 없어 발행하지 않는다 (설계 원칙: 미구독 이벤트 미발행).

    this.logger.log(`Fulfillment order ${fo.id} created successfully with status: ready`);
    return this.getOne(fo.id, trx);
  }

  /**
   * 판매주문 → FO 항목. 판정은 LineCompositionReader 하나가 한다(#1063 스펙 §5.3-1). 이 메서드는 읽기만 한다 —
   * 미리 판정(requiresPhysicalFulfillmentOrder·preflight)에서도 불리므로, 굳히기는 잠금을 쥔 createV2 가 `freeze` 를 받아서 한다.
   */
  private async buildItemsFromSalesOrder(
    salesOrderId: string,
    trx: DbTx,
  ): Promise<{
    items: Omit<FulfillmentOrderItemInsert, 'fulfillmentOrderId'>[];
    freeze: LineFreeze[];
  }> {
    const resolved = await this.lineCompositions.resolveForOrder(salesOrderId, trx);
    if (resolved.length === 0) {
      throw new BadRequestException(`Sales order ${salesOrderId} has no lines`);
    }

    const items: Omit<FulfillmentOrderItemInsert, 'fulfillmentOrderId'>[] = [];
    const missingLines: UnmatchedSalesOrderLine[] = [];
    const freeze: LineFreeze[] = [];

    for (const entry of resolved) {
      const { line, fulfillableQuantity, resolution } = entry;
      if (blocksFulfillment(entry) && resolution.kind === 'missing') {
        missingLines.push({ salesOrderLineId: line.id, variantId: line.variantId, reason: resolution.reason });
        continue;
      }
      if (fulfillableQuantity <= 0) continue;
      // 디지털 라인은 물리 출고 대상이 아니다 — digital-only 주문은 결과가 비어 backlog not_required 로 닫힌다
      if (
        resolution.kind === 'digital' ||
        resolution.kind === 'outsourced' ||
        resolution.kind === 'void' ||
        resolution.kind === 'missing'
      )
        continue;
      if (resolution.kind === 'follow') freeze.push({ salesOrderLineId: line.id, items: resolution.items });
      for (const item of resolution.items) {
        items.push({
          salesOrderId,
          salesOrderLineId: line.id,
          variantId: line.variantId,
          skuId: item.skuId,
          qty: fulfillableQuantity * item.qtyPerUnit,
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

    return { items, freeze };
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

  async ship(id: string, tx?: DbTx) {
    this.workflowGate.assertOperationalMutationAllowed('fulfillment.drop_ship');
    return this.db.run(async (trx) => {
      await trx.execute(
        sql`SELECT id FROM ${wmsTables.fulfillmentOrders} WHERE ${wmsTables.fulfillmentOrders.id} = ${id} FOR UPDATE`,
      );
      const [fo] = await trx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, id))
        .limit(1);
      if (!fo) throw new NotFoundException(`Fulfillment order ${id} not found`);
      if (fo.status === 'shipped') return this.getOne(id, trx);
      if (fo.status === 'completed' || fo.status === 'canceled')
        throw new ConflictException(`Cannot ship FO ${id} in terminal status '${fo.status}'`);
      if (fo.fulfillmentMode !== 'drop_ship')
        throw new ConflictException(
          `ship() 은 drop_ship 전용입니다. 자사 출고는 shipment dispatch attempt를 거칩니다.`,
        );
      if (fo.directShipStatus !== 'forwarded')
        throw new ConflictException(
          `Cannot ship drop_ship FO ${id}: directShipStatus must be 'forwarded', got '${fo.directShipStatus ?? 'null'}'`,
        );

      await trx.execute(
        sql`SELECT id FROM ${wmsTables.fulfillmentOrderItems} WHERE ${wmsTables.fulfillmentOrderItems.fulfillmentOrderId} = ${id} FOR UPDATE`,
      );
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

      // drop_ship 불변식("자사 재고 예약 없음") 방어 sweep — 잔존 confirmed 예약이 있으면
      // 좀비가 되므로 같은 tx 로 즉시 해제. 정상 drop_ship 은 항상 0건(no-op).
      const sweptOnShip = await this.reservationLifecycle.releaseLeftoverReservations(
        id,
        'reconcile: drop_ship invariant sweep',
        trx,
      );
      if (sweptOnShip > 0) {
        this.logger.warn(`drop_ship FO ${id} 에서 잔존 예약 ${sweptOnShip}건 sweep — 예약 없음 불변식 위반`);
      }

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
        trackingInfo: { carrier: 'CJ', trackingNumber: '', invoiceUrl: undefined },
        shippedAt: now.toISOString(),
        estimatedDeliveryDate: undefined,
        shippedItems: items.map((item) => ({ fulfillmentItemId: item.id, skuId: item.skuId, shippedQty: item.qty })),
      };
      await this.fulfillmentsV1.enqueue(
        {
          // FO 당 전량출고 완료 이벤트는 논리적으로 한 번 — dispatch 경로의 v1 완료 투영과 같은 키 규약.
          idempotencyKey: `${id}:fully-shipped`,
          eventType: FULFILLMENT_EVENTS.SHIPPED,
          aggregateId: id,
          partitionKey: fo.salesOrderId ?? id,
          payload: shippedPayload,
        },
        trx,
      );
      return this.getOne(id, trx);
    }, tx);
  }

  private computeAdminAvailableActions(fo: {
    status: string;
    fulfillmentMode: string | null;
    directShipStatus: string | null | undefined;
  }): string[] {
    const TERMINAL_STATUSES = ['shipped', 'completed', 'canceled'];
    const isTerminal = TERMINAL_STATUSES.includes(fo.status);
    const actions: string[] = [];

    // FO 단위 수동 reserve/unreserve/transfer 액션은 V1 예약 경로와 함께 Task 25 에서 라우트째 제거됐다.
    // V2 예약은 shipment line 단위로 자동(부분예약 + retry worker)이고, 재배치는 shipment-line transfer 로 한다.
    // drop_ship 은 타사 재고라 재고 관련 액션을 광고하지 않는다(아래 forward/complete 만).
    const isDropShip = fo.fulfillmentMode === 'drop_ship';
    if (isDropShip && !isTerminal) {
      const dsStatus = fo.directShipStatus;
      if (!dsStatus || dsStatus === 'pending') actions.push('forwardDropShip');
      if (dsStatus === 'forwarded') actions.push('completeDropShip');
    }
    return actions;
  }

  private computeBlockedReasons(fo: { status: string }, items: Array<{ shippedQty: number }>): string[] {
    const reasons: string[] = [];
    if (['shipped', 'completed', 'canceled'].includes(fo.status)) {
      reasons.push('TERMINAL_STATUS');
    }
    if (items.some((i) => i.shippedQty > 0)) {
      reasons.push('SHIPPED_EVIDENCE');
    }
    return reasons;
  }

  /**
   * FO 하나의 아웃박스 행 (admin-web 의 이력 탭이 읽는 진단 엔드포인트).
   *
   * **6-C-4 가 옛 갈래를 지웠다.** 이 배포 이전에 만들어진 FO 의 이력 탭은 비어 보인다 —
   * 진단용 표시일 뿐이고 도메인 판정에 쓰이지 않으므로 백필 대상이 아니었다(표지 백필은
   * `hasFullyShippedProjection` 이 읽는 `:fully-shipped` 행만 옮긴다).
   *
   * 응답 모양은 그대로 유지한다 — admin-web 이 소문자 `status`('failed'/'pending')와 `attempts`
   * 를 읽는다. 공용 테이블은 대문자 status 와 `retry_count` 를 쓰므로 여기서 옛 어휘로 되돌린다.
   * `updated_at` 컬럼은 공용 테이블에 없어 *마지막으로 알려진 변화 시각*으로 채운다.
   */
  async getOutboxEvents(id: string, tx?: DbTx) {
    const db = tx ?? this.db.db;

    const sharedRows = await db
      .select({
        id: outbox_events.id,
        eventType: outbox_events.eventType,
        status: outbox_events.status,
        attempts: outbox_events.retryCount,
        nextAttemptAt: outbox_events.nextAttemptAt,
        publishedAt: outbox_events.publishedAt,
        createdAt: outbox_events.createdAt,
        failedAt: outbox_events.failedAt,
      })
      .from(outbox_events)
      .where(and(eq(outbox_events.aggregateType, FULFILLMENT_STREAM.aggregateType), eq(outbox_events.aggregateId, id)));

    return sharedRows
      .map((row) => ({
        id: String(row.id),
        eventType: row.eventType,
        status: row.status.toLowerCase(),
        attempts: row.attempts,
        nextAttemptAt: row.nextAttemptAt,
        publishedAt: row.publishedAt,
        createdAt: row.createdAt,
        updatedAt: row.publishedAt ?? row.failedAt ?? row.createdAt,
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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

    const items = await db
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
        canceledQty: wmsTables.fulfillmentOrderItems.canceledQty,
        status: wmsTables.fulfillmentOrderItems.status,
      })
      .from(wmsTables.fulfillmentOrderItems)
      .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, id))
      .orderBy(wmsTables.fulfillmentOrderItems.createdAt);

    const itemIds = items.map((i) => i.id);

    const adminAvailableActions = this.computeAdminAvailableActions(fulfillmentOrder);
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
        canceledQty: wmsTables.fulfillmentOrderItems.canceledQty,
        status: wmsTables.fulfillmentOrderItems.status,
        salesOrderId: wmsTables.fulfillmentOrderItems.salesOrderId,
        salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
      })
      .from(wmsTables.fulfillmentOrderItems)
      .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, id))
      .orderBy(wmsTables.fulfillmentOrderItems.createdAt);

    // V2 읽기 형태만 남는다 — V1 형태(issuedForFO invoice·openedForFO shipment·batch 링크)는
    // V1 출고 경로와 함께 Task 25 에서 제거됐다. maintenance 모드에서도 읽기는 이 형태다.
    if (!this.fulfillmentProgress) throw new Error('FulfillmentProgressService is required for V2 reads');
    const allShipmentLines =
      itemIds.length === 0
        ? []
        : await db
            .select({
              id: wmsTables.shipmentLines.id,
              fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId,
              shipmentId: wmsTables.shipmentLines.shipmentId,
              shipmentStatus: wmsTables.shipments.status,
              qty: wmsTables.shipmentLines.qty,
              inspectedQty: wmsTables.shipmentLines.inspectedQty,
              reservedQty: wmsTables.shipmentLines.reservedQty,
              manifestVersion: wmsTables.shipments.manifestVersion,
              reservationVersion: wmsTables.shipments.reservationVersion,
              shippingProfileId: wmsTables.shipments.shippingProfileId,
            })
            .from(wmsTables.shipmentLines)
            .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
            .where(inArray(wmsTables.shipmentLines.fulfillmentOrderItemId, itemIds));
    const activeLines = allShipmentLines.filter((line) =>
      ['draft', 'planned', 'recovery_required'].includes(line.shipmentStatus),
    );
    const activeLineIds = activeLines.map((line) => line.id);
    const v2Reservations =
      activeLineIds.length === 0
        ? []
        : await db
            .select({
              id: wmsTables.stockReservations.id,
              shipmentLineId: wmsTables.stockReservations.shipmentLineId,
              skuId: wmsTables.stockReservations.skuId,
              warehouseId: wmsTables.stockReservations.warehouseId,
              quantity: wmsTables.stockReservations.quantity,
              status: wmsTables.stockReservations.status,
              requestedAt: wmsTables.stockReservations.requestedAt,
            })
            .from(wmsTables.stockReservations)
            .where(
              and(
                inArray(wmsTables.stockReservations.shipmentLineId, activeLineIds),
                eq(wmsTables.stockReservations.status, 'confirmed'),
              ),
            );
    const progress = this.fulfillmentProgress.projectOrder(
      items.map((item) => {
        const itemLines = activeLines.filter((line) => line.fulfillmentOrderItemId === item.id);
        const lineIds = new Set(itemLines.map((line) => line.id));
        return {
          id: item.id,
          qty: item.qty,
          shippedQty: item.shippedQty,
          canceledQty: item.canceledQty,
          confirmedReservedQty: v2Reservations
            .filter((reservation) => reservation.shipmentLineId && lineIds.has(reservation.shipmentLineId))
            .reduce((total, reservation) => total + reservation.quantity, 0),
          activeLineQty: itemLines.reduce((total, line) => total + line.qty, 0),
          processing: item.pickedQty > 0 || itemLines.some((line) => line.inspectedQty > 0),
          recoveryRequired: itemLines.some((line) => line.shipmentStatus === 'recovery_required'),
        };
      }),
    );
    const shipmentIds = uniqueStrings(allShipmentLines.map((line) => line.shipmentId));
    const shipmentList = shipmentIds.map((shipmentId) => {
      const lines = allShipmentLines.filter((line) => line.shipmentId === shipmentId);
      const first = lines[0];
      return {
        id: shipmentId,
        status: first.shipmentStatus,
        manifestVersion: first.manifestVersion,
        reservationVersion: first.reservationVersion,
        shippingProfileId: first.shippingProfileId,
        qty: lines.reduce((total, line) => total + line.qty, 0),
        reservedQty: lines.reduce((total, line) => total + line.reservedQty, 0),
      };
    });
    const salesOrderLineIds = uniqueStrings(
      itemsWithSku.map((item) => item.salesOrderLineId).filter((lineId): lineId is string => lineId !== null),
    );
    const lineViews = await selectLineCompositionViews(db, salesOrderLineIds);
    return {
      ...fulfillmentOrder,
      progress,
      shipments: shipmentList,
      items: itemsWithSku,
      lines: lineViews,
      reservations: v2Reservations,
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
    const statusFilter = params.status && isFulfillmentStatus(params.status) ? params.status : undefined;
    const conditions = [
      statusFilter ? eq(wmsTables.fulfillmentOrders.status, statusFilter) : undefined,
      params.warehouseId ? eq(wmsTables.fulfillmentOrders.warehouseId, params.warehouseId) : undefined,
      params.fulfillmentMode
        ? eq(wmsTables.fulfillmentOrders.fulfillmentMode, params.fulfillmentMode as any)
        : undefined,
      params.salesOrderId ? eq(wmsTables.fulfillmentOrders.salesOrderId, params.salesOrderId) : undefined,
      params.priority ? eq(wmsTables.fulfillmentOrders.priority, params.priority as any) : undefined,
    ].filter(Boolean);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await db.select({ value: count() }).from(wmsTables.fulfillmentOrders).where(whereClause);
    const total = totalRow?.value ?? 0;

    const fulfillmentOrders = await db
      .select()
      .from(wmsTables.fulfillmentOrders)
      .where(whereClause)
      .limit(params.limit)
      .offset(params.offset)
      .orderBy(desc(wmsTables.fulfillmentOrders.createdAt));

    // V1 의 FO-소유 invoice 조인(issuedForFO)은 Task 25 에서 제거됐다 — V2 invoice 는 shipment 소유다.
    return { data: fulfillmentOrders, total };
  }
}
