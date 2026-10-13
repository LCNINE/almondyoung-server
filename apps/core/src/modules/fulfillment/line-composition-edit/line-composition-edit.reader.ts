import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { DbTx, SalesOrderLine, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  compositionFromMatching,
  CompositionItem,
  CompositionSource,
} from '../../product-matching/line-composition/line-composition';
import { selectFrozenCompositions } from '../../product-matching/line-composition/frozen-compositions';
import { ProductSkuMappingService } from '../../product-matching/services/product-sku-mapping.service';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';
import { ACTIVE_WORK_ITEM_STATUSES } from '../services/work-item-status';
import { BoxLineView } from '../draft-box/box-target';
import {
  BoxOfLine,
  classifyExistingLine,
  CLOSED_FULFILLMENT_ORDER_STATUSES,
  CLOSED_SALES_ORDER_STATUSES,
  ExistingLinesImpact,
  isBlockingBox,
} from './line-composition-edit.types';

// 이미 끝난 박스 — 라인을 «담고» 있어도 수정 판정에서 뺀다(묘비·대체)
const DEAD_SHIPMENT_STATUSES = ['canceled', 'superseded'] as const;

/** 라인 구성 수정 경로의 조회(#1063 스펙 §7). 쓰기는 LineCompositionEditManager 가 한다. */
@Injectable()
export class LineCompositionEditReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly productSkuMapping: ProductSkuMappingService,
  ) {}

  /** 판매주문을 잠근다 — FO 생성(createV2)과 같은 «판매주문 먼저» 잠금 순서(스펙 §5.4). */
  async lockOrder(trx: DbTx, salesOrderId: string): Promise<{ id: string; status: string } | null> {
    const [order] = await trx
      .select({ id: wmsTables.salesOrders.id, status: wmsTables.salesOrders.status })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, salesOrderId))
      .for('update');
    return order ?? null;
  }

  async loadLine(trx: DbTx, salesOrderId: string, salesOrderLineId: string): Promise<SalesOrderLine | null> {
    const [line] = await trx
      .select()
      .from(wmsTables.salesOrderLines)
      .where(
        and(
          eq(wmsTables.salesOrderLines.id, salesOrderLineId),
          eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId),
        ),
      );
    return line ?? null;
  }

  async fulfillmentOrderOf(
    trx: DbTx,
    salesOrderId: string,
  ): Promise<{ id: string; status: string; fulfillmentMode: string | null; ownerId: string | null } | null> {
    const [fo] = await trx
      .select({
        id: wmsTables.fulfillmentOrders.id,
        status: wmsTables.fulfillmentOrders.status,
        fulfillmentMode: wmsTables.fulfillmentOrders.fulfillmentMode,
        ownerId: wmsTables.fulfillmentOrders.ownerId,
      })
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId))
      .limit(1);
    return fo ?? null;
  }

  async lineHasFulfillmentItems(trx: DbTx, salesOrderLineId: string): Promise<boolean> {
    const [row] = await trx
      .select({ id: wmsTables.fulfillmentOrderItems.id })
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.salesOrderLineId, salesOrderLineId))
      .limit(1);
    return Boolean(row);
  }

  async skus(trx: DbTx, skuIds: readonly string[]) {
    if (skuIds.length === 0) return [];
    return trx
      .select({ id: wmsTables.skus.id, stockType: wmsTables.skus.stockType, holderId: wmsTables.skus.holderId })
      .from(wmsTables.skus)
      .where(inArray(wmsTables.skus.id, [...skuIds]));
  }

  /** 라인마다 그 라인이 담긴 살아 있는 박스(묘비·대체 제외). */
  async boxesOfLines(trx: DbTx, salesOrderLineIds: readonly string[]): Promise<Map<string, BoxOfLine[]>> {
    const result = new Map<string, BoxOfLine[]>();
    if (salesOrderLineIds.length === 0) return result;
    const rows = await trx
      .selectDistinct({
        salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
        shipmentId: wmsTables.shipments.id,
        status: wmsTables.shipments.status,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
      .where(
        and(
          inArray(wmsTables.fulfillmentOrderItems.salesOrderLineId, [...salesOrderLineIds]),
          notInArray(wmsTables.shipments.status, [...DEAD_SHIPMENT_STATUSES]),
        ),
      )
      .orderBy(asc(wmsTables.shipments.id));
    const shipmentIds = [...new Set(rows.map((row) => row.shipmentId))];
    if (shipmentIds.length === 0) return result;
    const work = await trx
      .select({
        shipmentId: wmsTables.outboundBatchWorkItems.shipmentId,
        batchId: wmsTables.outboundBatchWorkItems.batchId,
      })
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          inArray(wmsTables.outboundBatchWorkItems.shipmentId, shipmentIds),
          inArray(wmsTables.outboundBatchWorkItems.status, [...ACTIVE_WORK_ITEM_STATUSES]),
        ),
      );
    const waybills = await trx
      .select({ shipmentId: wmsTables.waybills.shipmentId })
      .from(wmsTables.waybills)
      .where(
        and(
          inArray(wmsTables.waybills.shipmentId, shipmentIds),
          notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
        ),
      );
    const batchByShipment = new Map(work.map((row) => [row.shipmentId, row.batchId]));
    const withWaybill = new Set(waybills.map((row) => row.shipmentId));
    for (const row of rows) {
      if (row.salesOrderLineId === null) continue;
      const boxes = result.get(row.salesOrderLineId) ?? [];
      boxes.push({
        shipmentId: row.shipmentId,
        status: row.status,
        batchId: batchByShipment.get(row.shipmentId) ?? null,
        hasActiveWaybill: withWaybill.has(row.shipmentId),
      });
      result.set(row.salesOrderLineId, boxes);
    }
    return result;
  }

  /** 박스마다 그 라인의 줄(§6.2 담긴 개수 계산의 입력). */
  async lineQtyByBox(
    trx: DbTx,
    salesOrderLineId: string,
    shipmentIds: readonly string[],
  ): Promise<Map<string, BoxLineView[]>> {
    const result = new Map<string, BoxLineView[]>();
    if (shipmentIds.length === 0) return result;
    const rows = await trx
      .select({
        shipmentId: wmsTables.shipmentLines.shipmentId,
        shipmentLineId: wmsTables.shipmentLines.id,
        salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
        skuId: wmsTables.shipmentLines.skuId,
        qty: wmsTables.shipmentLines.qty,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(
        and(
          inArray(wmsTables.shipmentLines.shipmentId, [...shipmentIds]),
          eq(wmsTables.fulfillmentOrderItems.salesOrderLineId, salesOrderLineId),
        ),
      );
    for (const row of rows) {
      const lines = result.get(row.shipmentId) ?? [];
      lines.push({
        shipmentLineId: row.shipmentLineId,
        salesOrderLineId: row.salesOrderLineId,
        skuId: row.skuId,
        qty: row.qty,
      });
      result.set(row.shipmentId, lines);
    }
    return result;
  }

  /** 상품매칭이 지금 정하는 실물 구성. void·미해결이면 null — 일괄 적용 대상이 없다(스펙 D4). */
  async matchingComposition(trx: DbTx, variantId: string): Promise<CompositionItem[] | null> {
    const resolved = compositionFromMatching(await this.productSkuMapping.getByVariant(variantId, trx));
    return resolved.kind === 'follow' ? resolved.items : null;
  }

  /**
   * 일괄 적용 후보: 그 variant 의 굳힌 라인 중 아직 안 나간 수량이 있고 FO·판매주문이 닫히지 않은 것(스펙 §7.2 «FO 미완료»).
   * 직배송 FO 는 박스가 없어 맞출 것이 없으므로 뺀다. FO 전 운영자 지정 라인은 FO 항목이 없어 여기 안 들어온다 — FO 가 생길 때
   * 그 구성으로 만들어진다.
   */
  async existingLineCandidates(
    trx: DbTx,
    variantId: string,
  ): Promise<Array<{ salesOrderLineId: string; salesOrderId: string }>> {
    const lines = wmsTables.salesOrderLines;
    const items = wmsTables.fulfillmentOrderItems;
    const orders = wmsTables.fulfillmentOrders;
    const salesOrders = wmsTables.salesOrders;
    return (
      trx
        .selectDistinct({ salesOrderLineId: lines.id, salesOrderId: lines.salesOrderId })
        .from(lines)
        // fulfillment_order_items.sales_order_line_id 는 varchar 다 — uuid 를 text 로 맞춰 조인한다
        .innerJoin(items, eq(items.salesOrderLineId, sql`${lines.id}::text`))
        .innerJoin(orders, eq(orders.id, items.fulfillmentOrderId))
        .innerJoin(salesOrders, eq(salesOrders.id, lines.salesOrderId))
        .where(
          and(
            eq(lines.variantId, variantId),
            isNotNull(lines.compositionSource),
            sql`${items.qty} - ${items.shippedQty} - ${items.canceledQty} > 0`,
            or(isNull(orders.fulfillmentMode), ne(orders.fulfillmentMode, 'drop_ship')),
            notInArray(orders.status, [...CLOSED_FULFILLMENT_ORDER_STATUSES]),
            notInArray(salesOrders.status, [...CLOSED_SALES_ORDER_STATUSES, 'cancelled']),
          ),
        )
        .orderBy(asc(lines.salesOrderId), asc(lines.id))
    );
  }

  async linesForApply(
    trx: DbTx,
    lineIds: readonly string[],
  ): Promise<Array<{ id: string; compositionSource: CompositionSource | null }>> {
    if (lineIds.length === 0) return [];
    return trx
      .select({ id: wmsTables.salesOrderLines.id, compositionSource: wmsTables.salesOrderLines.compositionSource })
      .from(wmsTables.salesOrderLines)
      .where(inArray(wmsTables.salesOrderLines.id, [...lineIds]))
      .orderBy(asc(wmsTables.salesOrderLines.id));
  }

  /** «기존 출고에도 적용» 미리보기(스펙 §7.2). 읽기만 한다 — 적용은 잠금 아래에서 다시 판정한다. */
  async previewExistingLines(variantId: string, tx?: DbTx): Promise<ExistingLinesImpact> {
    return this.dbService.run(async (trx) => {
      const next = await this.matchingComposition(trx, variantId);
      if (!next) {
        return {
          variantId,
          applicable: false,
          newComposition: null,
          changeable: 0,
          skippedOperator: 0,
          skippedInProgress: 0,
          alreadySame: 0,
        };
      }
      const lineIds = (await this.existingLineCandidates(trx, variantId)).map((row) => row.salesOrderLineId);
      const lines = await this.linesForApply(trx, lineIds);
      const frozen = await selectFrozenCompositions(trx, lineIds);
      const boxes = await this.boxesOfLines(trx, lineIds);
      const counts = { changeable: 0, operator: 0, in_progress: 0, same: 0 };
      for (const line of lines) {
        if (line.compositionSource === null) continue;
        counts[
          classifyExistingLine({
            source: line.compositionSource,
            frozen: frozen.get(line.id) ?? [],
            next,
            blocked: (boxes.get(line.id) ?? []).some(isBlockingBox),
          })
        ] += 1;
      }
      return {
        variantId,
        applicable: true,
        newComposition: next,
        changeable: counts.changeable,
        skippedOperator: counts.operator,
        skippedInProgress: counts.in_progress,
        alreadySame: counts.same,
      };
    }, tx);
  }
}
