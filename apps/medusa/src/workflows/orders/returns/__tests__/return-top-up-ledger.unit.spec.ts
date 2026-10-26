import { capRevertToUnheld } from '../return-top-up-ledger';
import type { ReturnableOrderItem } from '../plan-return-request';

const item = (o: Partial<ReturnableOrderItem> = {}): ReturnableOrderItem => ({
  id: 'i1', quantity: 2, fulfilled: 0, returnRequested: 0, returnReceived: 0, returnDismissed: 0, ...o,
});

describe('capRevertToUnheld', () => {
  it('아무 반품도 안 잡은 출고 수량이면 남은 몫 그대로', () => {
    expect(capRevertToUnheld([{ id: 'i1', quantity: 1 }], [item({ fulfilled: 1 })])).toEqual({
      items: [{ id: 'i1', quantity: 1 }],
      short: false,
    });
  });

  it('다른 반품이 올림 0 으로 앉은 몫은 내리지 않는다 — fulfilled − (요청 + 수령 + 폐기) 로 자르고 short', () => {
    expect(capRevertToUnheld([{ id: 'i1', quantity: 1 }], [item({ fulfilled: 1, returnRequested: 1 })])).toEqual({
      items: [],
      short: true,
    });
    expect(
      capRevertToUnheld(
        [{ id: 'i1', quantity: 2 }],
        [item({ quantity: 3, fulfilled: 3, returnRequested: 0, returnReceived: 1, returnDismissed: 1 })],
      ),
    ).toEqual({ items: [{ id: 'i1', quantity: 1 }], short: true });
  });

  it('줄마다 따로 자른다 — 주문에 없는 줄은 0', () => {
    expect(
      capRevertToUnheld(
        [
          { id: 'i1', quantity: 1 },
          { id: 'i2', quantity: 1 },
          { id: 'gone', quantity: 1 },
        ],
        [item({ fulfilled: 1 }), item({ id: 'i2', fulfilled: 1, returnRequested: 1 })],
      ),
    ).toEqual({ items: [{ id: 'i1', quantity: 1 }], short: true });
  });
});
