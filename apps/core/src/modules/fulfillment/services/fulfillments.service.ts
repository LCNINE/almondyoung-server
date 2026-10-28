import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { eq, inArray, desc, sql, count, and } from 'drizzle-orm';
import { LineCompositionReader } from '../../product-matching/line-composition/line-composition.reader';
import { selectLineCompositionViews } from '../../product-matching/line-composition/line-composition-views';
import { LineCompositionManager } from '../../product-matching/line-composition/line-composition.manager';
import {
  blocksFulfillment,
  CompositionItem,
  MatchingFailureReason,
} from '../../product-matching/line-composition/line-composition';
import { acquireStockAvailabilityLocks } from '../../inventory/shared/locks/stock-availability-lock';
import { assertWarehouseSellable } from '../../inventory/shared/availability/sellable-warehouses';
import { CreateFulfillmentOrderDto } from '../dto/create-fulfillment-order.dto';
import { FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import { outbox_events } from '@app/events';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentReservationService } from './shipment-reservation.service';
import { FulfillmentProgressService } from './fulfillment-progress.service';
import { selectEntrancePassword } from './entrance-password.selection';
import { compatibleShippingProfileId } from './shipping-profile';
import { openShipment } from '../shipment/shipment-lifecycle';
import { reprojectFulfillmentOrders } from '../fulfillment-order/fulfillment-order-projection';
import { directSuppliersOfSkus } from '../supplier-shipment/direct-suppliers-of-skus';

type FulfillmentStatus = (typeof wmsTables.fulfillmentOrders.status.enumValues)[number];
type FulfillmentMode = (typeof wmsTables.fulfillmentOrders.fulfillmentMode.enumValues)[number];

// 외부 쿼리 문자열을 fulfillment status enum 으로 좁히는 타입 가드.
// enumValues 를 readonly string[] 로 넓혀 includes 비교 (단순 멤버십 체크용 안전한 위닝)
const isFulfillmentStatus = (value: string): value is FulfillmentStatus =>
  (wmsTables.fulfillmentOrders.status.enumValues as readonly string[]).includes(value);

// fulfillmentMode 쿼리 문자열도 같은 방식으로 좁힌다 — enum 밖 값(옛 'drop_ship' 포함)이 쿼리에 닿으면 22P02 → 500 이다.
const isFulfillmentMode = (value: string): value is FulfillmentMode =>
  (wmsTables.fulfillmentOrders.fulfillmentMode.enumValues as readonly string[]).includes(value);

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

type FoLabels = { displayOrderNo: string | null; salesChannel: string | null; warehouseName: string | null };

/** 화면이 내부 id 대신 고객이 아는 주문번호와 창고 이름을 보이게 한다 */
async function withFoLabels<T extends { salesOrderId: string | null; warehouseId: string | null }>(
  db: DbTx | DbService<typeof wmsSchema>['db'],
  rows: T[],
): Promise<(T & FoLabels)[]> {
  const salesOrderIds = uniqueStrings(rows.flatMap((row) => (row.salesOrderId ? [row.salesOrderId] : [])));
  const warehouseIds = uniqueStrings(rows.flatMap((row) => (row.warehouseId ? [row.warehouseId] : [])));
  const orders = salesOrderIds.length
    ? await db
        .select({
          id: wmsTables.salesOrders.id,
          displayOrderNo: wmsTables.salesOrders.displayOrderNo,
          salesChannel: wmsTables.salesOrders.salesChannel,
        })
        .from(wmsTables.salesOrders)
        .where(inArray(wmsTables.salesOrders.id, salesOrderIds))
    : [];
  const warehouses = warehouseIds.length
    ? await db
        .select({ id: wmsTables.warehouses.id, name: wmsTables.warehouses.name })
        .from(wmsTables.warehouses)
        .where(inArray(wmsTables.warehouses.id, warehouseIds))
    : [];
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const warehouseNameById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name]));
  return rows.map((row) => {
    const order = row.salesOrderId ? orderById.get(row.salesOrderId) : undefined;
    return {
      ...row,
      displayOrderNo: order?.displayOrderNo ?? null,
      salesChannel: order?.salesChannel ?? null,
      warehouseName: row.warehouseId ? (warehouseNameById.get(row.warehouseId) ?? null) : null,
    };
  });
}

@Injectable()
export class FulfillmentsService {
  private readonly logger = new Logger(FulfillmentsService.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly lineCompositions: LineCompositionReader,
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
    const salesOrderId = dto.salesOrderId;
    // 출고주문은 판매주문에서만 만든다(K6 PR4). 판매주문 없는 FO 는 취소(판매주문 취소로만)·직배 완료(FulfillmentShipped
    // 의 orderId)·수량 사실 어디에도 닿지 않아 만들어지면 빠져나갈 길이 없다. 수동 출고는 판매주문 입력으로 만든다.
    if (!salesOrderId) {
      throw new BadRequestException({
        code: 'FULFILLMENT_REQUIRES_SALES_ORDER',
        message: 'A fulfillment order can only be created from a sales order.',
      });
    }
    if ((dto.items?.length ?? 0) > 0 || (dto.lines?.length ?? 0) > 0) {
      throw new BadRequestException({
        code: 'SALES_ORDER_ITEMS_DERIVED_FROM_MATCHING',
        message: 'Fulfillment items for a sales order must be derived from product-SKU matching.',
      });
    }

    // Fail before opening the creation transaction when the request is known to
    // contain warehouse demand. Digital-only and drop-shipped-only SOs need no warehouse.
    if (!dto.warehouseId && (await this.hasWarehouseControlledDemandPreflight(salesOrderId, tx))) {
      throw new BadRequestException({
        code: 'V2_PHYSICAL_FULFILLMENT_REQUIRES_WAREHOUSE',
        message: 'A warehouse is required for V2 physical fulfillment',
      });
    }

    return this.db.run(async (trx) => {
      await trx.execute(sql`
        SELECT id FROM ${wmsTables.salesOrders}
        WHERE ${wmsTables.salesOrders.id} = ${salesOrderId}
        FOR UPDATE
      `);
      const [salesOrder] = await trx
        .select()
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, salesOrderId))
        .limit(1);
      if (!salesOrder) throw new BadRequestException(`Sales order ${salesOrderId} not found`);
      if (salesOrder.status === 'cancelled') {
        throw new BadRequestException(`Cannot create fulfillment for cancelled sales order ${salesOrderId}`);
      }

      const [existing] = await trx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId))
        .limit(1);
      if (existing) return this.getOne(existing.id, trx);
      // 셀메이트 과도기: 판매주문 status 의 shipped·delivered 는 셀메이트 스크립트가 쓴다(ADR-0017 — core 경로는 쓰지 않음).
      // 이미 나간 주문에 FO 를 만들면 확정 예약·draft 상자가 재고를 묶는다(10-08 실측 3,883개). 판매주문 잠금 아래에서
      // 검사해야 판정 직후 스크립트가 돈 틈까지 막힌다. FO 없이 돌아오면 워커가 backlog 를 not_required 로 닫는다.
      if (salesOrder.status === 'shipped' || salesOrder.status === 'delivered') {
        this.logger.log(
          `Skip FO creation for sales order ${salesOrderId}: already ${salesOrder.status} outside core (sellmate)`,
        );
        return null;
      }

      const { items: itemsToInsert, freeze } = await this.buildItemsFromSalesOrder(salesOrderId, trx);

      // Digital-only/void-matched sales orders do not create a placeholder FO.
      if (itemsToInsert.length === 0) return null;
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
      // 항목을 SKU 재고 유형으로 가른다(K3 스펙 §4.3-1) — 직배분은 입점사마다 draft 상자 하나(예약 없음), 창고분은 창고 draft 상자.
      const dropShippedSkuIds = new Set(skuRows.filter((row) => row.stockType === 'drop_shipped').map((row) => row.id));
      const warehouseSkuRows = skuRows.filter((row) => !dropShippedSkuIds.has(row.id));
      // 입점사를 못 정하면 fail-closed(N3) — 위에서 굳힌 라인 구성도 호출자의 트랜잭션(백로그 워커의 savepoint)과 함께 되돌아간다
      const supplierOfSku = await directSuppliersOfSkus(trx, [...dropShippedSkuIds]);
      // 창고 몫이 없으면 창고도 없다(N2) — FO warehouse_id NULL. 창고 필수·판매 창고 검증은 창고 몫이 있을 때만.
      const warehouseId =
        warehouseSkuRows.length > 0 ? await this.requireSellableWarehouse(dto.warehouseId, trx) : null;

      const [fo] = await trx
        .insert(wmsTables.fulfillmentOrders)
        .values({
          salesOrderId: dto.salesOrderId ?? null,
          warehouseId,
          ownerId: dto.ownerId ?? null,
          fulfillmentMode: dto.fulfillmentMode ?? 'in_house',
          priority: dto.priority ?? 'normal',
          status: 'created',
          totalItems: itemsToInsert.length,
          totalQty: itemsToInsert.reduce((total, item) => total + item.qty, 0),
          totalReservedQty: 0,
          shippingAddress: dto.shippingAddress ?? salesOrder.shippingAddress ?? null,
        })
        .returning();
      const insertedItems = await trx
        .insert(wmsTables.fulfillmentOrderItems)
        .values(itemsToInsert.map((item) => ({ ...item, fulfillmentOrderId: fo.id })))
        .returning();

      // 창고 상자와 입점사 상자는 수령인·공동현관 비번이 같다 — 같은 주문이다
      const recipientSnapshot = dto.shippingAddress ?? salesOrder.shippingAddress ?? null;
      const entrancePassword = selectEntrancePassword([
        { orderDate: salesOrder.orderDate, entrancePassword: salesOrder.entrancePassword },
      ]);
      const boxLine = (item: (typeof insertedItems)[number]) => ({
        fulfillmentOrderItemId: item.id,
        skuId: item.skuId,
        qty: item.qty,
      });

      // 배송 프로필은 창고분 SKU 만으로 정한다 — 직배 SKU 는 프로필이 없어서, 섞어 정하면 하나만 섞여도 NULL 이 된다
      const warehouseBox =
        warehouseId === null
          ? null
          : {
              warehouseId,
              ...(await openShipment(
                trx,
                {
                  owner: { kind: 'warehouse', warehouseId },
                  status: 'draft',
                  shippingProfileId: compatibleShippingProfileId(warehouseSkuRows.map((row) => row.deliveryProfileId)),
                  recipientSnapshot,
                  entrancePassword,
                },
                insertedItems.filter((item) => !dropShippedSkuIds.has(item.skuId)).map(boxLine),
              )),
            };

      // 입점사 상자는 예약보다 먼저 연다 — 예약이 부르는 투영이 입점사 라인을 «예약된 것과 같다»로 세야 한다(N4)
      const itemsBySupplier = new Map<string, Array<(typeof insertedItems)[number]>>();
      for (const item of insertedItems) {
        const supplierId = supplierOfSku.get(item.skuId);
        if (supplierId !== undefined)
          itemsBySupplier.set(supplierId, [...(itemsBySupplier.get(supplierId) ?? []), item]);
      }
      for (const supplierId of [...itemsBySupplier.keys()].sort()) {
        const { shipment } = await openShipment(
          trx,
          {
            owner: { kind: 'supplier', supplierId },
            status: 'draft',
            shippingProfileId: null,
            recipientSnapshot,
            entrancePassword,
          },
          (itemsBySupplier.get(supplierId) ?? []).map(boxLine),
        );
        this.logger.log(
          `Created supplier Draft shipment ${shipment.id} (supplier ${supplierId}) for fulfillment order ${fo.id}`,
        );
      }

      if (warehouseBox === null) {
        // 예약할 창고 라인이 없어 예약이 투영을 부르지 않는다 — 직접 투영한다(FO·FOI status 는 투영만 쓴다)
        await reprojectFulfillmentOrders(trx, [fo.id]);
        return this.getOne(fo.id, trx);
      }

      // Acquire every stock key first so multi-SKU orders cannot deadlock each
      // other by sales-order line order. reservePartial safely re-enters the locks.
      await acquireStockAvailabilityLocks(
        trx,
        warehouseBox.lines.map((line) => ({ skuId: line.skuId, warehouseId: warehouseBox.warehouseId })),
      );
      let mutated = false;
      for (const line of warehouseBox.lines.sort((a, b) => a.id.localeCompare(b.id))) {
        const result = await shipmentReservation.reservePartial(line.id, line.qty, trx);
        mutated ||= result.mutated;
      }
      if (!mutated) await shipmentReservation.recompute(warehouseBox.shipment.id, trx);

      this.logger.log(`Created V2 Draft shipment ${warehouseBox.shipment.id} for fulfillment order ${fo.id}`);
      return this.getOne(fo.id, trx);
    }, tx);
  }

  private async hasWarehouseControlledDemandPreflight(salesOrderId: string, tx?: DbTx): Promise<boolean> {
    const executor = (tx ?? this.db.db) as unknown as DbTx;
    const { items } = await this.buildItemsFromSalesOrder(salesOrderId, executor);
    const skuIds = items.map((item) => item.skuId);
    if (skuIds.length === 0) return false;

    const skuRows = await executor
      .select({ stockType: wmsTables.skus.stockType })
      .from(wmsTables.skus)
      .where(inArray(wmsTables.skus.id, [...new Set(skuIds)]));
    // Unknown SKU IDs are validated by the locked command path. Treat them as
    // warehouse-controlled here so a missing warehouse still fails closed.
    return skuRows.length !== new Set(skuIds).size || skuRows.some((row) => row.stockType !== 'drop_shipped');
  }

  /**
   * 창고 몫이 있는 FO 의 창고. 비판매 창고(해외 등)로는 출고를 지시할 수 없다 — 예약은 호출자가 창고를 지정하는
   * 구조라, 이 지점을 막으면 비판매 창고에 예약이 걸릴 경로가 없다. 없는 창고에도 던지므로 존재 검증을 겸한다.
   */
  private async requireSellableWarehouse(warehouseId: string | undefined, trx: DbTx): Promise<string> {
    if (!warehouseId) {
      throw new BadRequestException({
        code: 'V2_PHYSICAL_FULFILLMENT_REQUIRES_WAREHOUSE',
        message: 'A warehouse is required for V2 physical fulfillment',
      });
    }
    await assertWarehouseSellable(trx, warehouseId);
    return warehouseId;
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
              supplierId: wmsTables.shipments.supplierId,
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
          supplierLineQty: itemLines
            .filter((line) => line.supplierId !== null)
            .reduce((total, line) => total + line.qty, 0),
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
    const [labeled] = await withFoLabels(db, [fulfillmentOrder]);
    return {
      ...labeled,
      progress,
      shipments: shipmentList,
      items: itemsWithSku,
      lines: lineViews,
      reservations: v2Reservations,
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
    const modeFilter =
      params.fulfillmentMode && isFulfillmentMode(params.fulfillmentMode) ? params.fulfillmentMode : undefined;
    const conditions = [
      statusFilter ? eq(wmsTables.fulfillmentOrders.status, statusFilter) : undefined,
      params.warehouseId ? eq(wmsTables.fulfillmentOrders.warehouseId, params.warehouseId) : undefined,
      modeFilter ? eq(wmsTables.fulfillmentOrders.fulfillmentMode, modeFilter) : undefined,
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
    return { data: await withFoLabels(db, fulfillmentOrders), total };
  }
}
