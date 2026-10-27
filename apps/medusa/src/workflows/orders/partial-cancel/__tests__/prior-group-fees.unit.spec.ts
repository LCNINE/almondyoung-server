import type { ReturnSettlementRecord } from '../../returns/return-settlement-record';
import { priorGroupFeesFor } from '../prior-group-fees';

const ret = (stage: ReturnSettlementRecord['stage'], groupFees: Record<string, number>, orderVersion: number): ReturnSettlementRecord => ({
  requestId: 'r', requestHash: 'h', stage, items: [], owed: 0, chargeShippingOptionId: null,
  deduction: { returnShipping: 0, freeShippingBreak: 0, roundTrip: 0 },
  feeNotAdjusted: false, refundAmount: 0, groupFees, orderVersion, receivedAt: 't',
});
const partial = [{ orderVersion: 2, groupFees: { sp: 1000 } }];

describe('priorGroupFeesFor', () => {
  it('received 정산은 그룹 요금을 바꾸지 않는다', () => {
    expect(priorGroupFeesFor(partial, [ret('received', { sp: 3000 }, 3)])).toEqual({ sp: 1000 });
  });
  it.each(['charged', 'refunded'] as const)('%s 정산은 겹친다', (stage) => {
    expect(priorGroupFeesFor(partial, [ret(stage, { sp: 3000 }, 3)])).toEqual({ sp: 3000 });
  });
});
