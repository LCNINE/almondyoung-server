import { ConflictError } from '@app/shared';
import { StockPriorityBlock } from '../dto/stock-priority.dto';

export class StockPriorityBlockedError extends ConflictError {
  constructor(
    shipmentId: string,
    private readonly block: StockPriorityBlock,
  ) {
    super(`Stock priority is not allowed for shipment ${shipmentId}: ${block}`);
  }

  getErrorCode(): string {
    return `STOCK_PRIORITY_${this.block}`;
  }
}

/** 화면이 본 뒤 재고나 다른 주문이 바뀌었다 — 다시 불러와 확인해야 한다 */
export class StockPriorityPlanChangedError extends ConflictError {
  constructor(shipmentId: string) {
    super(`Stock priority plan changed for shipment ${shipmentId}`);
  }

  getErrorCode(): string {
    return 'STOCK_PRIORITY_PLAN_CHANGED';
  }
}
