export const PO_RECEIVE_ORDER_CHANGED = 'PO_RECEIVE_ORDER_CHANGED';
export const PO_RECEIVE_DIFFERENT_SKU = 'PO_RECEIVE_DIFFERENT_SKU';
export const PO_RECEIVE_SKU_NOT_IN_ORDER = 'PO_RECEIVE_SKU_NOT_IN_ORDER';
export const PO_RECEIVE_BARCODE_NOT_FOUND = 'PO_RECEIVE_BARCODE_NOT_FOUND';

/** The failed queue head is known not to have changed the receipt draft. */
export abstract class PoReceiveConfirmedUnappliedError extends Error {}

/** A persisted scan was not applied because its saved purchase-order draft is stale. */
export class PoReceiveScanNotAppliedError extends PoReceiveConfirmedUnappliedError {
  readonly code = PO_RECEIVE_ORDER_CHANGED;

  constructor() {
    super(
      '발주 상태가 바뀌어 이 스캔을 반영하지 못했어요. 입고내역을 확인해 주세요.'
    );
    this.name = 'PoReceiveScanNotAppliedError';
  }
}

export class PoReceiveDifferentSkuError extends PoReceiveConfirmedUnappliedError {
  readonly code = PO_RECEIVE_DIFFERENT_SKU;

  constructor() {
    super('다른 상품을 찍었어요. 현재 상품 수량은 유지됩니다.');
    this.name = 'PoReceiveDifferentSkuError';
  }
}

export class PoReceiveSkuNotInOrderError extends PoReceiveConfirmedUnappliedError {
  readonly code = PO_RECEIVE_SKU_NOT_IN_ORDER;

  constructor() {
    super('이 발주에 없는 상품이에요. 현재 상품 수량은 유지됩니다.');
    this.name = 'PoReceiveSkuNotInOrderError';
  }
}

export class PoReceiveBarcodeNotFoundError extends PoReceiveConfirmedUnappliedError {
  readonly code = PO_RECEIVE_BARCODE_NOT_FOUND;

  constructor() {
    super('등록되지 않은 바코드예요. 현재 상품 수량은 유지됩니다.');
    this.name = 'PoReceiveBarcodeNotFoundError';
  }
}
