export const PO_RECEIVE_ORDER_CHANGED = 'PO_RECEIVE_ORDER_CHANGED';

/** A persisted scan was not applied because its saved purchase-order draft is stale. */
export class PoReceiveScanNotAppliedError extends Error {
  readonly code = PO_RECEIVE_ORDER_CHANGED;

  constructor() {
    super(
      '발주 상태가 바뀌어 이 스캔을 반영하지 못했어요. 입고내역을 확인해 주세요.'
    );
    this.name = 'PoReceiveScanNotAppliedError';
  }
}
