import { ReceiptActionBlockReason } from '../dto/inbound-receipt-state.dto';
import { InboundCancelBlockReason } from '../dto/inbound-response.dto';

export interface ReceiptPolicyFacts {
  receiptStatus: 'posted' | 'voided';
  quantity: number;
  canceledQty: number;
  putawayFromOriginQty: number;
  returnedQty: number;
  originValid: boolean;
  eventExists: boolean;
  isStagingOrigin: boolean;
  invalidReceipt: boolean;
  onHandQty: number;
  bucketPendingQty: number;
  custodyQty: number;
  isToday: boolean;
}

/** Read policy only: commands still validate under their existing locks. */
export function receiptActionPolicy(f: ReceiptPolicyFacts) {
  const pendingQty = f.quantity - f.putawayFromOriginQty - f.returnedQty - f.canceledQty;
  let common: ReceiptActionBlockReason | null = null;
  if (f.canceledQty > 0 || f.receiptStatus === 'voided') common = 'CANCELED';
  else if (!f.originValid || !f.eventExists) common = 'MISSING_ORIGIN_OR_EVENT';
  else if (
    f.invalidReceipt ||
    f.quantity <= 0 ||
    f.canceledQty < 0 ||
    f.returnedQty < 0 ||
    f.putawayFromOriginQty < 0 ||
    pendingQty < 0 ||
    f.onHandQty < f.bucketPendingQty + f.custodyQty
  )
    common = 'ORIGIN_STOCK_INCONSISTENT';
  const putawayBlockReason: ReceiptActionBlockReason | null =
    common ?? (!f.isStagingOrigin ? 'NOT_STAGING_ORIGIN' : pendingQty === 0 ? 'NOTHING_PENDING' : null);
  const cancelBlockReason: ReceiptActionBlockReason | null =
    common ??
    (f.putawayFromOriginQty > 0
      ? 'ALREADY_PUTAWAY'
      : f.returnedQty > 0
        ? 'RETURN_EXISTS'
        : !f.isToday
          ? 'NOT_TODAY'
          : // A shelf receipt has no protected claim to release. Never consume other claims/custody.
            f.quantity > f.onHandQty - f.bucketPendingQty - f.custodyQty + (f.isStagingOrigin ? pendingQty : 0)
            ? 'ORIGIN_STOCK_INCONSISTENT'
            : null);
  return {
    canPutaway: putawayBlockReason === null,
    putawayBlockReason,
    canCancel: cancelBlockReason === null,
    cancelBlockReason,
  };
}

export function toHistoryCancelBlockReason(reason: ReceiptActionBlockReason | null): InboundCancelBlockReason | null {
  switch (reason) {
    case 'CANCELED':
      return 'ALREADY_CANCELED';
    case 'ALREADY_PUTAWAY':
      return 'PUTAWAY_EXISTS';
    case 'ORIGIN_STOCK_INCONSISTENT':
      return 'INSUFFICIENT_ORIGIN_STOCK';
    case 'NOT_STAGING_ORIGIN':
    case 'NOTHING_PENDING':
      return 'INSUFFICIENT_ORIGIN_STOCK';
    default:
      return reason;
  }
}
