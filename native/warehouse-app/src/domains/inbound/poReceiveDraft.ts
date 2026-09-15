import type { ExpectedArrivalLine, FreshLine } from './types';
import { parseQuantity } from '../../core/design/QuantityInput';
export interface ReceiptQuantity {
  text: string;
  source: 'suggested' | 'manual' | 'scanned';
}
export interface PoReceiveDraft {
  active: ExpectedArrivalLine | null;
  scanBump: number;
  seen: string[];
  fresh: FreshLine | null;
  submitted: {
    target: ExpectedArrivalLine;
    quantity: number;
    key: string;
  } | null;
  quantity?: ReceiptQuantity | null;
}
/** Legacy drafts did not persist manual edits; only the scan count can be recovered. */
export function normalizePoReceiveDraft(draft: PoReceiveDraft): PoReceiveDraft {
  if (draft.quantity != null) return draft;
  return {
    ...draft,
    quantity: draft.active
      ? {
          text: String(
            draft.scanBump > 0 ? draft.scanBump : draft.active.outstandingQty
          ),
          source: draft.scanBump > 0 ? 'scanned' : 'suggested',
        }
      : null,
  };
}

/** This error permits editing, but never discarding the pending physical scan. */
export class PoReceiveQuantityError extends Error {
  constructor() {
    super(
      '수량을 수정한 뒤 다시 확인해 주세요. 이 스캔은 아직 반영하지 않았어요.'
    );
    this.name = 'PoReceiveQuantityError';
  }
}

export function scanReceiptQuantity(
  quantity: ReceiptQuantity,
  step: number
): ReceiptQuantity {
  const current = parseQuantity(quantity.text, 0);
  if (
    current === null ||
    !Number.isInteger(step) ||
    step < 1 ||
    step > 2147483647
  ) {
    throw new PoReceiveQuantityError();
  }
  const next = quantity.source === 'suggested' ? step : current + step;
  if (!Number.isSafeInteger(next) || next > 2147483647)
    throw new PoReceiveQuantityError();
  return { text: String(next), source: 'scanned' };
}
