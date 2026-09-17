import { receiptActionPolicy, ReceiptPolicyFacts, toHistoryCancelBlockReason } from './inbound-receipt-policy';

const facts: ReceiptPolicyFacts = {
  receiptStatus: 'posted',
  quantity: 10,
  canceledQty: 0,
  returnedQty: 0,
  putawayFromOriginQty: 0,
  originValid: true,
  eventExists: true,
  isStagingOrigin: true,
  invalidReceipt: false,
  onHandQty: 10,
  bucketPendingQty: 10,
  custodyQty: 0,
  isToday: true,
};

describe('receiptActionPolicy priority contract', () => {
  it.each([
    ['canceled beats missing', { canceledQty: 1, originValid: false }, 'CANCELED', 'CANCELED'],
    ['voided', { receiptStatus: 'voided' }, 'CANCELED', 'CANCELED'],
    [
      'missing origin beats inconsistent',
      { originValid: false, onHandQty: 0 },
      'MISSING_ORIGIN_OR_EVENT',
      'MISSING_ORIGIN_OR_EVENT',
    ],
    ['missing event', { eventExists: false }, 'MISSING_ORIGIN_OR_EVENT', 'MISSING_ORIGIN_OR_EVENT'],
    [
      'insufficient ledger beats shelf',
      { onHandQty: 9, isStagingOrigin: false },
      'ORIGIN_STOCK_INCONSISTENT',
      'ORIGIN_STOCK_INCONSISTENT',
    ],
    ['custody overlaps pending', { custodyQty: 1 }, 'ORIGIN_STOCK_INCONSISTENT', 'ORIGIN_STOCK_INCONSISTENT'],
    ['invalid counters', { invalidReceipt: true }, 'ORIGIN_STOCK_INCONSISTENT', 'ORIGIN_STOCK_INCONSISTENT'],
    ['shelf direct inbound can cancel', { isStagingOrigin: false, bucketPendingQty: 0 }, 'NOT_STAGING_ORIGIN', null],
    [
      'shelf cancellation cannot consume another pending line',
      { isStagingOrigin: false, bucketPendingQty: 2 },
      'NOT_STAGING_ORIGIN',
      'ORIGIN_STOCK_INCONSISTENT',
    ],
    [
      'nothing pending precedes putaway',
      { putawayFromOriginQty: 10, bucketPendingQty: 0 },
      'NOTHING_PENDING',
      'ALREADY_PUTAWAY',
    ],
    [
      'partial putaway beats return and date for cancellation',
      { putawayFromOriginQty: 2, returnedQty: 1, isToday: false },
      null,
      'ALREADY_PUTAWAY',
    ],
    ['partial return beats date', { returnedQty: 2, isToday: false }, null, 'RETURN_EXISTS'],
    ['old receipt can putaway', { isToday: false }, null, 'NOT_TODAY'],
    ['eligible', {}, null, null],
  ])('%s', (_name, changes, putawayBlockReason, cancelBlockReason) => {
    expect(receiptActionPolicy({ ...facts, ...changes } as ReceiptPolicyFacts)).toEqual({
      canPutaway: putawayBlockReason === null,
      putawayBlockReason,
      canCancel: cancelBlockReason === null,
      cancelBlockReason,
    });
  });
  it.each([
    ['CANCELED', 'ALREADY_CANCELED'],
    ['ALREADY_PUTAWAY', 'PUTAWAY_EXISTS'],
    ['ORIGIN_STOCK_INCONSISTENT', 'INSUFFICIENT_ORIGIN_STOCK'],
    [null, null],
  ] as const)('maps %s to legacy %s', (reason, expected) => {
    expect(toHistoryCancelBlockReason(reason)).toBe(expected);
  });
});
