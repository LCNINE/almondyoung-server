import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import {
  CompositionItem,
  compositionItemsProblem,
  CompositionSource,
  isDigitalFulfillmentLine,
  sameComposition,
  sortComposition,
} from '../../product-matching/line-composition/line-composition';
import { selectFrozenCompositions } from '../../product-matching/line-composition/frozen-compositions';
import { LineCompositionManager } from '../../product-matching/line-composition/line-composition.manager';
import { SalesOrderAmendmentsService } from '../../sales-order/services/sales-order-amendments.service';
import { FulfillmentOrderCreationBacklogService } from '../backlog/fulfillment-order-creation-backlog.service';
import { boxTarget, unitsOfLineInBox } from '../draft-box/box-target';
import { DraftBoxAmender } from '../draft-box/draft-box-amender';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { lockShipmentAggregate } from '../services/shipment-aggregate';
import { LineCompositionEditReader } from './line-composition-edit.reader';
import { BoxOfLine, isBlockingBox, LineCompositionChangeResult } from './line-composition-edit.types';

export const LINE_COMPOSITION_OPERATOR_REASON = 'LINE_COMPOSITION_OPERATOR';
export const LINE_COMPOSITION_MATCHING_REASON = 'LINE_COMPOSITION_MATCHING_APPLIED';

function conflict(code: string, message: string, extra: Record<string, unknown> = {}): ConflictException {
  return new ConflictException({ code, message, ...extra });
}

function boxMembershipKey(boxes: readonly BoxOfLine[]): string {
  return boxes
    .map((box) => `${box.shipmentId}:${isBlockingBox(box) ? 'blocked' : 'open'}`)
    .sort()
    .join(',');
}

function badRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}

/**
 * 판매주문 라인 구성 수정(#1063 스펙 §7). 판매주문 잠금 → 구성 쓰기 → 박스 맞추기 → amendment 를 한 트랜잭션으로 한다 —
 * 구성만 바뀌고 박스가 안 바뀌면 다음 FO 판정·취소 비율이 박스와 다른 구성을 읽는다.
 */
@Injectable()
export class LineCompositionEditManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reader: LineCompositionEditReader,
    private readonly compositions: LineCompositionManager,
    private readonly amender: DraftBoxAmender,
    private readonly backlog: FulfillmentOrderCreationBacklogService,
    private readonly amendments: SalesOrderAmendmentsService,
    private readonly invariant: FulfillmentInvariantService,
  ) {}

  async assignToLine(
    salesOrderId: string,
    salesOrderLineId: string,
    items: readonly CompositionItem[],
    note: string | null,
    actor: { id: string },
    tx?: DbTx,
  ): Promise<LineCompositionChangeResult> {
    const problem = compositionItemsProblem(items);
    if (problem) throw badRequest('COMPOSITION_ITEMS_INVALID', problem);
    const after = sortComposition(items);
    return this.dbService.run(async (trx) => {
      const order = await this.reader.lockOrder(trx, salesOrderId);
      if (!order) throw new NotFoundException(`Sales order ${salesOrderId} not found`);
      if (order.status === 'cancelled')
        throw conflict('SALES_ORDER_CANCELLED', `Sales order ${salesOrderId} is cancelled`);
      const line = await this.reader.loadLine(trx, salesOrderId, salesOrderLineId);
      if (!line) throw new NotFoundException(`Line ${salesOrderLineId} is not in sales order ${salesOrderId}`);
      if (isDigitalFulfillmentLine(line)) throw badRequest('LINE_NOT_PHYSICAL', `Line ${line.id} is not physical`);

      const fo = await this.reader.fulfillmentOrderOf(trx, salesOrderId);
      await this.assertSkus(trx, after, fo?.ownerId ?? null);

      if (!fo) {
        // FO 전 1회 지정(스펙 D1): 구성을 굳히고 매칭 대기를 깨운다. FO 생성은 같은 판매주문 잠금 뒤에서 이 구성을 읽는다
        await this.compositions.assignByOperator(line.id, after, actor.id, trx);
        await this.backlog.requeueAwaitingMatching(salesOrderId, trx);
        return {
          salesOrderLineId: line.id,
          source: 'operator',
          items: after,
          changedShipmentIds: [],
          amendmentId: null,
        };
      }
      if (fo.fulfillmentMode === 'drop_ship') {
        throw badRequest('DROP_SHIP_NOT_SUPPORTED', `Fulfillment order ${fo.id} is drop-ship`);
      }
      if (!(await this.reader.lineHasFulfillmentItems(trx, line.id))) {
        throw conflict('LINE_NOT_IN_FULFILLMENT', `Line ${line.id} has no fulfillment items`);
      }
      const before = (await selectFrozenCompositions(trx, [line.id])).get(line.id) ?? [];
      if (line.compositionSource === null || before.length === 0) {
        throw conflict('COMPOSITION_NOT_FROZEN', `Line ${line.id} composition is not frozen`);
      }
      if (sameComposition(before, after)) {
        // 박스는 그대로. 출처만 operator 로 — 이후 일괄 적용이 이 라인을 건너뛰게(스펙 D3)
        if (line.compositionSource !== 'operator')
          await this.compositions.assignByOperator(line.id, after, actor.id, trx);
        return {
          salesOrderLineId: line.id,
          source: 'operator',
          items: after,
          changedShipmentIds: [],
          amendmentId: null,
        };
      }
      return this.changeFrozenLine(trx, {
        salesOrderId,
        salesOrderLineId: line.id,
        before,
        after,
        source: 'operator',
        actorId: actor.id,
        note,
        reasonCode: LINE_COMPOSITION_OPERATOR_REASON,
      });
    }, tx);
  }

  /** FO 가 있고 굳힌 라인의 구성을 바꾸고 박스를 맞춘다. 호출자가 판매주문을 잠갔다. */
  private async changeFrozenLine(
    trx: DbTx,
    input: {
      salesOrderId: string;
      salesOrderLineId: string;
      before: readonly CompositionItem[];
      after: CompositionItem[];
      source: CompositionSource;
      actorId: string;
      note: string | null;
      reasonCode: string;
    },
  ): Promise<LineCompositionChangeResult> {
    const boxes = (await this.reader.boxesOfLines(trx, [input.salesOrderLineId])).get(input.salesOrderLineId) ?? [];
    const blocking = boxes.filter(isBlockingBox);
    if (blocking.length > 0) {
      throw conflict('LINE_BOX_NOT_DRAFT', `Line ${input.salesOrderLineId} is in boxes that are not editable`, {
        boxes: blocking.map((box) => ({ shipmentId: box.shipmentId, status: box.status, batchId: box.batchId })),
      });
    }
    const shipmentIds = boxes.map((box) => box.shipmentId).sort();
    // 분할·합포장은 판매주문이 아니라 박스를 잠근다 — 박스를 잠그기 전에 센 담긴 개수는 그 사이 옮겨진 줄을 놓친다.
    // 잠금 순서는 FO 생성과 같다(판매주문, 박스 id 순, 재고)
    for (const shipmentId of shipmentIds) await this.lockBox(trx, shipmentId);
    const locked = (await this.reader.boxesOfLines(trx, [input.salesOrderLineId])).get(input.salesOrderLineId) ?? [];
    if (boxMembershipKey(locked) !== boxMembershipKey(boxes)) {
      throw conflict(
        'SHIPMENT_COMPONENT_CHANGED_RETRY',
        `Boxes of line ${input.salesOrderLineId} changed while acquiring locks`,
      );
    }
    const linesByBox = await this.reader.lineQtyByBox(trx, input.salesOrderLineId, shipmentIds);
    // 담긴 개수는 옛 구성으로 센다 — 구성을 바꾼 뒤엔 «이 줄 수량이 몇 개분인가»를 알 수 없다
    const unitsByBox = new Map(
      shipmentIds.map((id) => [id, unitsOfLineInBox(input.salesOrderLineId, linesByBox.get(id) ?? [], input.before)]),
    );

    if (input.source === 'operator') {
      await this.compositions.assignByOperator(input.salesOrderLineId, input.after, input.actorId, trx);
    } else {
      await this.compositions.replaceMatchingComposition(input.salesOrderLineId, input.after, trx);
    }

    const changedShipmentIds: string[] = [];
    for (const shipmentId of shipmentIds) {
      const units = unitsByBox.get(shipmentId) ?? 0;
      if (units === 0) continue;
      const target = boxTarget(
        new Map([[input.salesOrderLineId, units]]),
        new Map([[input.salesOrderLineId, input.after]]),
      );
      const result = await this.amender.amend(shipmentId, target, input.reasonCode, { id: input.actorId }, trx);
      if (result.changed) changedShipmentIds.push(shipmentId);
    }
    const amendmentId = await this.amendments.recordLineCompositionChange(
      {
        salesOrderId: input.salesOrderId,
        salesOrderLineId: input.salesOrderLineId,
        before: input.before,
        after: input.after,
        shipmentIds: changedShipmentIds,
        reasonCode: input.reasonCode,
        note: input.note,
        actorId: input.actorId,
      },
      trx,
    );
    return {
      salesOrderLineId: input.salesOrderLineId,
      source: input.source,
      items: input.after,
      changedShipmentIds,
      amendmentId,
    };
  }

  /** 잠그는 사이 줄이 모두 빠져나간 박스는 404 가 아니라 다시 시도할 경합이다. */
  private async lockBox(trx: DbTx, shipmentId: string): Promise<void> {
    try {
      await lockShipmentAggregate(trx, this.invariant, shipmentId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw conflict('SHIPMENT_COMPONENT_CHANGED_RETRY', `Shipment ${shipmentId} changed while acquiring locks`);
      }
      throw error;
    }
  }

  /** FO 생성과 같은 SKU 규칙 — 직배송 SKU 는 창고 SKU 와 섞지 않고, 3PL FO 는 화주가 같아야 한다. */
  private async assertSkus(trx: DbTx, items: readonly CompositionItem[], ownerId: string | null): Promise<void> {
    const ids = items.map((item) => item.skuId);
    const rows = await this.reader.skus(trx, ids);
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of ids) {
      const sku = byId.get(id);
      if (!sku) throw new BadRequestException(`SKU ${id} not found`);
      if (sku.stockType === 'drop_shipped') throw badRequest('DROP_SHIP_NOT_SUPPORTED', `SKU ${id} is drop-shipped`);
      if (ownerId && sku.holderId !== ownerId) {
        throw badRequest('SKU_HOLDER_MISMATCH_FOR_3PL', `SKU ${id} belongs to another holder`);
      }
    }
  }
}
