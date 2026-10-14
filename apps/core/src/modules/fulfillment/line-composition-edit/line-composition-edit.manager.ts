import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
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
import {
  ApplySkipReason,
  ApplyToExistingLinesResult,
  BoxOfLine,
  classifyExistingLine,
  CLOSED_FULFILLMENT_ORDER_STATUSES,
  CLOSED_SALES_ORDER_STATUSES,
  isBlockingBox,
  LineCompositionChangeResult,
} from './line-composition-edit.types';

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

const closedSalesOrderStatuses = new Set<string>(CLOSED_SALES_ORDER_STATUSES);
const closedFulfillmentOrderStatuses = new Set<string>(CLOSED_FULFILLMENT_ORDER_STATUSES);

function assertSalesOrderOpen(order: { id: string; status: string }): void {
  if (closedSalesOrderStatuses.has(order.status)) {
    throw conflict('SALES_ORDER_CLOSED', `Sales order ${order.id} is ${order.status}`);
  }
}

function assertFulfillmentOrderOpen(fo: { id: string; status: string }): void {
  if (closedFulfillmentOrderStatuses.has(fo.status)) {
    throw conflict('FULFILLMENT_ORDER_CLOSED', `Fulfillment order ${fo.id} is ${fo.status}`);
  }
}

type ApplyOutcome = 'changed' | ApplySkipReason;

// 주문 하나의 적용이 이 코드로 실패하면 그 주문의 후보 라인을 이 사유로 센다. 나머지 오류는 그대로 던진다 —
// 앞 주문들은 이미 커밋됐고, 다시 보내면 «이미 같음»이 되어 멱등이다.
// 박스 구성이 잠금을 얻는 사이 바뀐 경합도 작업 중으로 센다: 전체를 중단하지 않고, 다시 보내면 된다.
const SKIP_REASON_BY_CODE: Record<string, ApplySkipReason> = {
  LINE_BOX_NOT_DRAFT: 'in_progress',
  BOX_NOT_DRAFT: 'in_progress',
  SHIPMENT_ACTIVE_WORK_ITEM: 'in_progress',
  SHIPMENT_CUSTODY_EXISTS: 'in_progress',
  SHIPMENT_ACTIVE_INVOICE: 'in_progress',
  SHIPMENT_COMPONENT_CHANGED_RETRY: 'in_progress',
  FULFILLMENT_INVARIANT_COMPONENT_CHANGED_RETRY: 'in_progress',
  COMPOSITION_UNITS_AMBIGUOUS: 'units_ambiguous',
  // 새 구성이 이 주문의 FO 경로(직배송·3PL 화주)에 못 들어간다 — 주문 하나의 문제라 전체를 중단하지 않는다
  DROP_SHIP_NOT_SUPPORTED: 'not_applicable',
  SKU_HOLDER_MISMATCH_FOR_3PL: 'not_applicable',
  // 후보를 고른 뒤 잠금 전에 주문·FO 가 닫혔거나 라인의 박스가 모두 사라졌다 — 맞출 박스가 없다
  SALES_ORDER_CLOSED: 'not_applicable',
  FULFILLMENT_ORDER_CLOSED: 'not_applicable',
  LINE_NOT_IN_FULFILLMENT: 'not_applicable',
};
const SKIP_REASON_ORDER: ApplySkipReason[] = ['operator', 'in_progress', 'same', 'units_ambiguous', 'not_applicable'];

function errorCode(error: unknown): string | null {
  if (!(error instanceof HttpException)) return null;
  const body = error.getResponse();
  if (typeof body !== 'object' || body === null || !('code' in body)) return null;
  return typeof body.code === 'string' ? body.code : null;
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
      assertSalesOrderOpen(order);
      const line = await this.reader.loadLine(trx, salesOrderId, salesOrderLineId);
      if (!line) throw new NotFoundException(`Line ${salesOrderLineId} is not in sales order ${salesOrderId}`);
      if (isDigitalFulfillmentLine(line)) throw badRequest('LINE_NOT_PHYSICAL', `Line ${line.id} is not physical`);

      const fo = await this.reader.fulfillmentOrderOf(trx, salesOrderId);
      if (fo) assertFulfillmentOrderOpen(fo);
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
        fulfillmentOrderId: fo.id,
        before,
        after,
        source: 'operator',
        actorId: actor.id,
        note,
        reasonCode: LINE_COMPOSITION_OPERATOR_REASON,
      });
    }, tx);
  }

  /**
   * 상품매칭 저장 뒤 «기존 출고에도 적용»(스펙 §7.2). 주문마다 별도 트랜잭션 — 한 트랜잭션에 몰면 잠금이 여러 판매주문·재고 키에
   * 걸쳐 출고 작업과 교착·대기가 커진다. tx 를 받으면(테스트) 그 안에서 주문마다 savepoint 로 같은 경계를 흉내 낸다.
   */
  async applyToExistingLines(variantId: string, actor: { id: string }, tx?: DbTx): Promise<ApplyToExistingLinesResult> {
    // 상품매칭이 실물 구성으로 해결되지 않으면 적용할 것이 없다(미리보기 applicable=false 와 같다). 주문별 재확인은 경합용이다
    const candidates = await this.dbService.run(async (trx) => {
      if (!(await this.reader.matchingComposition(trx, variantId))) return [];
      return this.reader.existingLineCandidates(trx, variantId);
    }, tx);
    const byOrder = new Map<string, string[]>();
    for (const row of candidates) {
      byOrder.set(row.salesOrderId, [...(byOrder.get(row.salesOrderId) ?? []), row.salesOrderLineId]);
    }
    const counts = new Map<ApplyOutcome, number>();
    const bump = (outcome: ApplyOutcome, by = 1) => counts.set(outcome, (counts.get(outcome) ?? 0) + by);
    for (const [salesOrderId, lineIds] of [...byOrder].sort(([a], [b]) => a.localeCompare(b))) {
      try {
        const outcomes = await this.dbService.run(
          (trx) =>
            trx.transaction((savepoint) => this.applyToOrder(savepoint, salesOrderId, variantId, lineIds, actor)),
          tx,
        );
        for (const outcome of outcomes) bump(outcome);
      } catch (error) {
        const code = errorCode(error);
        const reason = code ? SKIP_REASON_BY_CODE[code] : undefined;
        if (!reason) throw error;
        bump(reason, lineIds.length);
      }
    }
    return {
      changed: counts.get('changed') ?? 0,
      skipped: SKIP_REASON_ORDER.flatMap((reason) => {
        const count = counts.get(reason) ?? 0;
        return count > 0 ? [{ reason, count }] : [];
      }),
    };
  }

  private async applyToOrder(
    trx: DbTx,
    salesOrderId: string,
    variantId: string,
    lineIds: readonly string[],
    actor: { id: string },
  ): Promise<ApplyOutcome[]> {
    const order = await this.reader.lockOrder(trx, salesOrderId);
    if (!order || order.status === 'cancelled') return lineIds.map(() => 'in_progress');
    assertSalesOrderOpen(order);
    // 미리보기 뒤 상품매칭·라인이 바뀌었을 수 있다 — 잠금 아래에서 다시 읽는다
    const next = await this.reader.matchingComposition(trx, variantId);
    if (!next) return lineIds.map(() => 'not_applicable');
    // 상품매칭이 직배송·타 화주 SKU 로 바뀌었어도 창고·3PL 박스에 넣지 않는다 — 개별 지정 경로와 같은 검사. 주문당 한 번
    const fo = await this.reader.fulfillmentOrderOf(trx, salesOrderId);
    if (fo) assertFulfillmentOrderOpen(fo);
    await this.assertSkus(trx, next, fo?.ownerId ?? null);
    const lines = await this.reader.linesForApply(trx, lineIds);
    const frozen = await selectFrozenCompositions(trx, lineIds);
    const boxes = await this.reader.boxesOfLines(trx, lineIds);
    const outcomes: ApplyOutcome[] = [];
    for (const line of lines) {
      if (line.compositionSource === null) continue;
      const before = frozen.get(line.id) ?? [];
      const decision = classifyExistingLine({
        source: line.compositionSource,
        frozen: before,
        next,
        blocked: (boxes.get(line.id) ?? []).some(isBlockingBox),
      });
      if (decision !== 'changeable') {
        outcomes.push(decision);
        continue;
      }
      await this.changeFrozenLine(trx, {
        salesOrderId,
        salesOrderLineId: line.id,
        fulfillmentOrderId: fo?.id ?? null,
        before,
        after: next,
        source: 'matching',
        actorId: actor.id,
        note: null,
        reasonCode: LINE_COMPOSITION_MATCHING_REASON,
      });
      outcomes.push('changed');
    }
    return outcomes;
  }

  /** FO 가 있고 굳힌 라인의 구성을 바꾸고 박스를 맞춘다. 호출자가 판매주문을 잠갔다. */
  private async changeFrozenLine(
    trx: DbTx,
    input: {
      salesOrderId: string;
      salesOrderLineId: string;
      /** 박스 링크용. 일괄 적용 경로에서 FO 를 못 찾았으면 null — 그때는 박스가 없어 이 오류까지 오지 않는다 */
      fulfillmentOrderId: string | null;
      before: readonly CompositionItem[];
      after: CompositionItem[];
      source: CompositionSource;
      actorId: string;
      note: string | null;
      reasonCode: string;
    },
  ): Promise<LineCompositionChangeResult> {
    const boxes = (await this.reader.boxesOfLines(trx, [input.salesOrderLineId])).get(input.salesOrderLineId) ?? [];
    // 맞출 박스가 없는데 구성만 바꾸면 남은 FO 항목·취소 비율이 새 구성과 갈린다
    if (boxes.length === 0) {
      throw conflict('LINE_NOT_IN_FULFILLMENT', `Line ${input.salesOrderLineId} has no live boxes`);
    }
    const blocking = boxes.filter(isBlockingBox);
    if (blocking.length > 0) {
      throw conflict('LINE_BOX_NOT_DRAFT', `Line ${input.salesOrderLineId} is in boxes that are not editable`, {
        // 응답 필터는 허용목록 details 만 통과시킨다(GlobalExceptionFilter) — 최상위 칸은 화면에 도착하지 않는다
        details: {
          fulfillmentOrderId: input.fulfillmentOrderId,
          boxes: blocking.map((box) => ({
            shipmentId: box.shipmentId,
            status: box.status,
            batchId: box.batchId,
            hasActiveWaybill: box.hasActiveWaybill,
          })),
        },
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
      if (!sku) throw badRequest('SKU_NOT_FOUND', `SKU ${id} not found`);
      if (sku.stockType === 'drop_shipped') throw badRequest('DROP_SHIP_NOT_SUPPORTED', `SKU ${id} is drop-shipped`);
      if (ownerId && sku.holderId !== ownerId) {
        throw badRequest('SKU_HOLDER_MISMATCH_FOR_3PL', `SKU ${id} belongs to another holder`);
      }
    }
  }
}
