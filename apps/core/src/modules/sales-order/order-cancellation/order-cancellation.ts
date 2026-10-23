import { Injectable } from '@nestjs/common';
import { BadRequestError, NotFoundError } from '@app/shared';
import { DbService, InjectTypedDb } from '@app/db';
import { eq } from 'drizzle-orm';
import { inventoryTables, wmsSchema } from '../../inventory/schema/inventory.schema';
import { PrintOrderReader } from '../../print-order/services/print-order.reader';
import { isLivePrint } from '../../print-order/services/print-order-board.rules';
import { isDigitalFulfillmentLine } from '../../product-matching/line-composition/line-composition';
import {
  PrintInProductionError,
  PrintOrderCancellationManager,
  PrintPartialCancelAvailableError,
  PrintShippedError,
  type PrintCancelResult,
} from '../../print-order/services/print-order-cancellation.manager';
import { SalesOrdersService } from '../services/sales-orders.service';
import { ChannelCancelRequestService } from '../channel-cancel-request/channel-cancel-request.service';
import type { CancelRequestView } from '../channel-cancel-request/channel-cancel-request.types';
import { cancellationCapabilityOf, sellerCenterMessage } from './channel-cancellation-capability';
import type { CancelLine, CancellationRequest } from './order-cancellation.types';

type OperatorRequest = Extract<CancellationRequest, { requester: { kind: 'operator' } }>;
type CustomerRequest = Extract<CancellationRequest, { requester: { kind: 'customer' } }>;

// 요청자 종류는 requester 안에 있어 TS 가 바깥 합집합을 좁히지 못한다 — 판정을 한 곳에 둔다
function isOperatorRequest(intent: CancellationRequest): intent is OperatorRequest {
  return intent.requester.kind === 'operator';
}

/**
 * 주문 취소 커널 (K7 PR1, 스펙 §5).
 *
 * 호출자(고객·운영자 문)는 «무엇을 왜 취소하나»만 말하고, 채널 판정 → 키 → 재전송 → 줄 → 판정 → 인쇄 gate → 확정
 * 순서는 여기 한 곳이 정한다. 채널 주문은 채널이 환불하고 core 는 문지기다(ADR-0042·0044) — 커널은 Wallet 을 부르지 않는다.
 */
@Injectable()
export class OrderCancellation {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
    private readonly salesOrders: SalesOrdersService,
    private readonly cancelRequests: ChannelCancelRequestService,
    private readonly printOrders: PrintOrderReader,
    private readonly printCancellation: PrintOrderCancellationManager,
  ) {}

  async request(intent: CancellationRequest): Promise<CancelRequestView> {
    const so = await this.db.db
      .select()
      .from(inventoryTables.salesOrders)
      .where(eq(inventoryTables.salesOrders.id, intent.salesOrderId))
      .limit(1)
      .then((r) => r[0]);
    if (!so) throw new NotFoundError('주문을 찾을 수 없습니다.');

    // 마켓은 판매자센터로 — 키가 없어도 이 안내가 먼저다
    const route = cancellationCapabilityOf(so.salesChannel).cancel;
    if (route === 'seller_center') throw new BadRequestError(sellerCenterMessage(so.salesChannel));
    if (route === 'core') throw new Error(`Sales channel ${so.salesChannel} does not take cancel commands`);

    if (!intent.sourceKey) throw new BadRequestError('Idempotency-Key header is required');
    const replay = await this.cancelRequests.findBySourceKey(so.id, intent.sourceKey);
    if (replay) return replay;

    return isOperatorRequest(intent)
      ? this.requestAsOperator(intent, intent.sourceKey)
      : this.requestAsCustomer(intent, intent.sourceKey);
  }

  private async requestAsOperator(intent: OperatorRequest, sourceKey: string): Promise<CancelRequestView> {
    // 판정은 잠그지 않고 먼저 한다 — 인쇄 취소는 되돌릴 수 없어 그 전에 부른다
    await this.cancelRequests.precheck(intent.salesOrderId, intent.lines, intent.alreadyRefundedAmount);
    // 와우프레스는 외부 HTTP 라 트랜잭션 밖에서 부른다 — 잠금을 쥔 채 기다리지 않는다
    const printed = await this.printCancellation.cancelForOrder(intent.salesOrderId, 'gate', intent.lines);
    return this.afterPrintCancel(printed, () =>
      this.cancelRequests.request({
        salesOrderId: intent.salesOrderId,
        ...(intent.lines ? { lines: intent.lines } : {}),
        requester: intent.requester,
        sourceKey,
        reasonCode: intent.reasonCode,
        reasonDetail: intent.reasonDetail,
        ...(intent.alreadyRefundedAmount !== undefined ? { alreadyRefundedAmount: intent.alreadyRefundedAmount } : {}),
      }),
    );
  }

  private async requestAsCustomer(intent: CustomerRequest, sourceKey: string): Promise<CancelRequestView> {
    const salesOrderId = intent.salesOrderId;
    // 고객이 인쇄 상품을 빼고 나머지만 취소하겠다고 동의한 두 번째 요청이다
    const lines = intent.excludePrint ? await this.linesWithoutPrint(salesOrderId) : undefined;
    if (lines?.length === 0) throw new PrintInProductionError();
    await this.cancelRequests.precheck(salesOrderId, lines);
    const printed = await this.printCancellation
      .cancelForOrder(salesOrderId, 'gate', lines, { keepOnRefusal: true })
      .catch(async (error: unknown) => {
        const locked = error instanceof PrintInProductionError || error instanceof PrintShippedError;
        if (locked && !lines && (await this.linesWithoutPrint(salesOrderId)).length > 0) {
          throw new PrintPartialCancelAvailableError();
        }
        throw error;
      });
    return this.afterPrintCancel(printed, () =>
      this.cancelRequests.request({
        salesOrderId,
        ...(lines ? { lines } : {}),
        requester: intent.requester,
        sourceKey,
        reasonCode: intent.reasonCode,
        reasonDetail: intent.reasonDetail,
      }),
    );
  }

  // 인쇄를 이미 멈춘 뒤 판매주문 취소가 실패하면 인쇄 행에 남겨 운영자가 찾게 한다
  private async afterPrintCancel<T>(printed: PrintCancelResult, salesCancel: () => Promise<T>): Promise<T> {
    try {
      return await salesCancel();
    } catch (error) {
      await this.printCancellation.noteSalesCancelFailed(printed, error);
      throw error;
    }
  }

  /**
   * 고객이 인쇄를 빼고 취소할 줄. 전체 취소 계획에서 취소되지 않은 인쇄 줄(실패·미지원도 재전송될 수 있다)과
   * 디지털 줄을 뺀다 — 부분 취소는 디지털 이용권을 회수하지 않으므로 디지털은 전체 취소로만 돌려준다
   */
  private async linesWithoutPrint(salesOrderId: string): Promise<CancelLine[]> {
    const printLineIds = new Set(
      (await this.printOrders.forSalesOrder(salesOrderId)).filter(isLivePrint).map((r) => r.salesOrderLineId),
    );
    const digitalLineIds = new Set(
      (
        await this.db.db
          .select({
            id: inventoryTables.salesOrderLines.id,
            fulfillmentKind: inventoryTables.salesOrderLines.fulfillmentKind,
            requiresShipping: inventoryTables.salesOrderLines.requiresShipping,
          })
          .from(inventoryTables.salesOrderLines)
          .where(eq(inventoryTables.salesOrderLines.salesOrderId, salesOrderId))
      )
        .filter(isDigitalFulfillmentLine)
        .map((line) => line.id),
    );
    const plan = await this.db.db.transaction((trx) => this.salesOrders.planCancellation(salesOrderId, undefined, trx));
    return plan.lines
      .filter((line) => !printLineIds.has(line.salesOrderLineId) && !digitalLineIds.has(line.salesOrderLineId))
      .map((line) => ({ salesOrderLineId: line.salesOrderLineId, quantity: line.quantity }));
  }
}
