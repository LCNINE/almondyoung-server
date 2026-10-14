import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { StoreSalesOrdersService } from '../../sales-order/services/store-sales-orders.service';
import { type PrintOrderRow } from '../schema/print-order.schema';
import { PrintCancelRemainingReader } from './print-cancel-remaining.reader';
import { toBoardItem, type PrintOrderBoardItem } from './print-order-board.rules';
import { CANCEL_CLAIM_STALE_MS } from './print-order-cancellation.manager';
import { PrintOrderAdminManager, type PrintCancelOutcome } from './print-order-admin.manager';
import { PrintOrderReader, type PrintOrderSummary, type PrintOrderListQuery } from './print-order.reader';

export interface PrintOrderActor {
  userId: string;
  roles?: string[];
}

type AdminCancelResult = Awaited<ReturnType<StoreSalesOrdersService['adminCancelRequest']>>;

export interface PrintCancelResolveResult {
  printOrder: PrintOrderRow;
  salesCancel: AdminCancelResult | null;
}

const staleCancellingBefore = () => new Date(Date.now() - CANCEL_CLAIM_STALE_MS);

@Injectable()
export class PrintOrdersService {
  constructor(
    private readonly reader: PrintOrderReader,
    private readonly manager: PrintOrderAdminManager,
    private readonly storeSalesOrders: StoreSalesOrdersService,
    private readonly remaining: PrintCancelRemainingReader,
  ) {}

  summary(): Promise<PrintOrderSummary> {
    return this.reader.summary(staleCancellingBefore());
  }

  async list(query: PrintOrderListQuery): Promise<{ items: PrintOrderBoardItem[]; total: number }> {
    const { items, total } = await this.reader.list(query, staleCancellingBefore());
    const now = Date.now();
    return { items: items.map((item) => toBoardItem(item, now)), total };
  }

  async byLine(salesOrderLineId: string): Promise<PrintOrderBoardItem> {
    const item = await this.reader.byLine(salesOrderLineId);
    if (!item) throw new NotFoundError(`Print order not found for line: ${salesOrderLineId}`);
    return toBoardItem(item, Date.now());
  }

  async byDesign(almondDesignId: string): Promise<PrintOrderBoardItem[]> {
    const now = Date.now();
    return (await this.reader.byDesign(almondDesignId)).map((item) => toBoardItem(item, now));
  }

  retry(id: string, actor: PrintOrderActor, confirmNoWowpressOrder: boolean): Promise<PrintOrderRow> {
    return this.manager.retry(id, actor.userId, confirmNoWowpressOrder);
  }

  confirmTest(id: string, actor: PrintOrderActor, note: string): Promise<PrintOrderRow> {
    return this.manager.confirmTest(id, actor.userId, note);
  }

  // 인쇄 행을 먼저 cancelled 로 바꿔야 판매주문 취소의 인쇄 gate 가 통과한다. 남은 수량만 요청하고, 같은 멱등키라 다시 눌러도 취소 요청은 하나다
  async resolveCancel(
    id: string,
    outcome: PrintCancelOutcome,
    actor: PrintOrderActor,
  ): Promise<PrintCancelResolveResult> {
    const { row, cancelSales } = await this.manager.resolveCancel(id, outcome, actor.userId);
    if (!cancelSales) return { printOrder: row, salesCancel: null };
    // 실패 시각은 참고용 기록이다. 보드는 판매주문 줄의 남은 수량으로 환불 안 열림을 판정한다
    let salesCancel: AdminCancelResult | null;
    try {
      salesCancel = await this.openSalesCancel(id, row, actor);
    } catch (error) {
      await this.manager.noteSalesCancelFailed(id, error);
      throw error;
    }
    return { printOrder: await this.manager.get(id), salesCancel };
  }

  private async openSalesCancel(
    id: string,
    row: PrintOrderRow,
    actor: PrintOrderActor,
  ): Promise<AdminCancelResult | null> {
    const target = await this.manager.salesCancelTarget(row);
    const quantity = target ? await this.remaining.remaining(target) : 0;
    if (!target || quantity === 0) return null;
    return this.storeSalesOrders.adminCancelRequest(target.salesOrderId, {
      reasonCode: 'ADMIN_CANCEL',
      lines: [{ salesOrderLineId: target.salesOrderLineId, quantity }],
      fulfillmentCommandContext: {
        idempotencyKey: `print-order-resolve-cancel:${id}`,
        actorId: actor.userId,
        actorRoles: actor.roles ?? [],
      },
    });
  }
}
