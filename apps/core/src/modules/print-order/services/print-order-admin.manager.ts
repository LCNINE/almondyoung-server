import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { type PrintOrderRow } from '../schema/print-order.schema';
import { awaitsCancelResolution, orderMayBeInFlight, shippedAfterCancel } from './print-order-board.rules';
import { PrintOrderReader } from './print-order.reader';
import { isPreservedLastError, PrintOrderRepository } from './print-order.repository';

export type PrintCancelOutcome = 'cancelled' | 'proceed';

export interface PrintSalesCancelTarget {
  salesOrderId: string;
  salesOrderLineId: string;
  lineQuantity: number;
}

export interface PrintCancelResolution {
  row: PrintOrderRow;
  // 이 행의 판매주문 취소를 (다시) 열어야 하는가. 대상·수량은 salesCancelTarget 과 남은 수량으로 정한다
  cancelSales: boolean;
}

const RETRYABLE = ['failed', 'unsupported'];
const PROCEEDED = ['submitted', 'shipped', 'delivered'];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class PrintOrderAdminManager {
  private readonly logger = new Logger(PrintOrderAdminManager.name);

  constructor(
    private readonly repository: PrintOrderRepository,
    private readonly reader: PrintOrderReader,
  ) {}

  async retry(id: string, actorId: string, confirmNoWowpressOrder: boolean): Promise<PrintOrderRow> {
    const row = await this.load(id);
    if (!RETRYABLE.includes(row.status)) {
      throw new BadRequestError(`Only failed or unsupported print orders can be retried (current: ${row.status})`);
    }
    if (isPreservedLastError(row.lastError)) {
      throw new ConflictError(
        'This print order has a duplicate or unsaved WowPress order record; resolve it on WowPress',
      );
    }
    // 주문권을 썼는데 번호가 없으면 와우프레스에 주문이 있을 수 있다. 운영자가 없음을 확인했을 때만 주문권을 되돌린다
    const releaseOrderRight = row.orderAttemptedAt !== null && row.vendorOrderNumber === null;
    if (releaseOrderRight && !confirmNoWowpressOrder) {
      throw new BadRequestError(
        'An order may already exist on WowPress. Verify on WowPress that there is no order, then retry with confirmNoWowpressOrder',
      );
    }
    const patch: Partial<PrintOrderRow> = {
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      submittingAt: null,
      ...(releaseOrderRight ? { orderAttemptedAt: null } : {}),
    };
    if (!(await this.repository.compareAndSetUnprotected(row, patch))) {
      throw new ConflictError('Print order changed while retrying; reload and try again');
    }
    this.logger.log(
      `print order ${id} retried by ${actorId} from ${row.status}${releaseOrderRight ? ' (order right released: operator confirmed no wowpress order)' : ''}`,
    );
    return this.load(id);
  }

  async confirmTest(id: string, actorId: string, note: string): Promise<PrintOrderRow> {
    const text = note.trim();
    if (!text) throw new BadRequestError('note is required');
    const row = await this.load(id);
    if (!row.testMemo) throw new BadRequestError('This print order was not sent as a test');
    if (await this.repository.confirmTest(id, actorId, text)) {
      this.logger.log(`print order ${id} test confirmed by ${actorId}`);
    }
    return this.load(id);
  }

  async resolveCancel(id: string, outcome: PrintCancelOutcome, actorId: string): Promise<PrintCancelResolution> {
    const row = await this.load(id);
    const now = Date.now();
    // 재클릭(멱등) 경로보다 먼저 본다. 주문 응답이 오는 중이면 어떤 판매주문 취소도 열지 않는다
    if (orderMayBeInFlight(row, now)) {
      throw new ConflictError('A WowPress order may still be in flight for this print order; try again later');
    }
    const refundNotOpened = row.status === 'cancelled' && (await this.reader.refundNotOpened(id));
    // 판매주문 줄에 남은 수량이 없으면 열 환불이 없다
    if (outcome === 'cancelled' && row.status === 'cancelled' && !refundNotOpened) return { row, cancelSales: false };
    if (outcome === 'proceed' && PROCEEDED.includes(row.status) && !shippedAfterCancel(row)) {
      return { row, cancelSales: false };
    }
    if (!awaitsCancelResolution(row, now, refundNotOpened)) {
      throw new BadRequestError(`Only refused or stuck cancellations can be resolved (current: ${row.status})`);
    }
    if (outcome === 'cancelled' && shippedAfterCancel(row)) {
      throw new BadRequestError('This print order has already shipped; it cannot be cancelled');
    }
    if (outcome === 'proceed' && row.status === 'cancelled') {
      throw new BadRequestError('This print order is already cancelled; it cannot go back to production');
    }
    // 생산 진행도 운영자의 마무리다. 같은 취소 이벤트가 다시 와도 이 결정을 뒤집지 않게 남긴다
    const status = outcome === 'cancelled' ? 'cancelled' : this.proceedStatus(row);
    const patch: Partial<PrintOrderRow> = { status, cancelResolvedAt: new Date(), cancelResolvedBy: actorId };
    if (status === 'pending') patch.nextAttemptAt = new Date();
    if (!(await this.repository.updateIfUntouched(row, patch))) {
      throw new ConflictError('Print order changed while resolving; reload and try again');
    }
    // 보존된 lastError(중복 의심·번호 미저장·취소 뒤 주문)는 그대로 두고, 누가 어떻게 마무리했는지는 로그로 남긴다
    this.logger.warn(
      `print order ${id} cancel resolved by ${actorId}: ${outcome} (was ${row.status}, ordnum ${row.vendorOrderNumber ?? 'none'}, lastError ${row.lastError ?? 'none'})`,
    );
    return { row: await this.load(id), cancelSales: outcome === 'cancelled' };
  }

  async noteSalesCancelFailed(id: string, cause: unknown): Promise<void> {
    const lastError = `print order cancelled but sales cancel failed: ${errorMessage(cause)}`;
    this.logger.error(`print order ${id}: ${lastError}`);
    await this.repository.update(id, { lastError, salesCancelFailedAt: new Date() }).catch((error: unknown) => {
      this.logger.error(`print order ${id}: could not record "${lastError}" (${errorMessage(error)})`);
    });
  }

  get(id: string): Promise<PrintOrderRow> {
    return this.load(id);
  }

  // 번호가 없으면 추적할 주문이 없으므로 주문 대기열이 아니라 failed 로 보낸다(재전송은 운영자가 따로 누른다)
  private proceedStatus(row: PrintOrderRow): PrintOrderRow['status'] {
    if (row.status === 'shipped' || row.status === 'delivered') return row.status;
    if (!row.vendorOrderNumber) return 'failed';
    if (row.trackingNumber) return 'shipped';
    // 발주 응답을 기다리는 사이 취소가 와서 파일을 못 보낸 주문이다. 워커가 번호로 파일 전달부터 이어 간다
    return row.fileDeliveredAt ? 'submitted' : 'pending';
  }

  async salesCancelTarget(row: PrintOrderRow): Promise<PrintSalesCancelTarget | null> {
    const line = await this.reader.salesLine(row.salesOrderLineId);
    if (!line || line.salesOrderStatus === 'cancelled' || line.lineStatus === 'cancelled') return null;
    return { salesOrderId: row.salesOrderId, salesOrderLineId: row.salesOrderLineId, lineQuantity: line.quantity };
  }

  private async load(id: string): Promise<PrintOrderRow> {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundError(`Print order not found: ${id}`);
    return row;
  }
}
