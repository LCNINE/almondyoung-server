import type { MedusaOrder, MedusaReturn } from '../../adapters/medusa/medusa.client';
import { medusaReturnObservations } from './medusa-return-observations';

const record = (over: Record<string, unknown> = {}) => ({
  almondReturn: {
    requestId: 'req_1',
    requestHash: 'h',
    requestedBy: 'customer',
    reasonValue: 'change_of_mind',
    feeBearer: 'customer',
    windowOverride: null,
    ...over,
  },
});

const ret = (over: Partial<MedusaReturn> = {}): MedusaReturn => ({
  id: 'ret_1',
  status: 'requested',
  requested_at: '2026-10-27T01:00:00.000Z',
  canceled_at: null,
  metadata: record(),
  items: [{ item_id: 'item_1', quantity: 1 }],
  ...over,
});

const order = (returns?: MedusaReturn[]): MedusaOrder =>
  ({ id: 'order_1', updated_at: '2026-10-27T02:00:00.000Z', ...(returns ? { returns } : {}) }) as MedusaOrder;

describe('medusaReturnObservations', () => {
  it('확정된 반품 하나 → requested 관측 하나', () => {
    const { observations, skipped } = medusaReturnObservations(order([ret()]));
    expect(skipped).toEqual([]);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      eventType: 'ChannelReturnRequested',
      eventKey: 'return:ret_1:requested',
      payload: {
        returnId: 'ret_1',
        requestId: 'req_1',
        reason: 'change_of_mind',
        feeBearer: 'customer',
        requestedBy: 'customer',
        requestedAt: '2026-10-27T01:00:00.000Z',
        items: [{ channelOrderItemId: 'item_1', quantity: 1 }],
      },
    });
  });

  it('취소된 반품 → requested 다음 cancelled', () => {
    const { observations } = medusaReturnObservations(
      order([ret({ status: 'canceled', canceled_at: '2026-10-27T01:30:00.000Z' })]),
    );
    expect(observations.map((o) => o.eventKey)).toEqual(['return:ret_1:requested', 'return:ret_1:cancelled']);
    expect(observations[1]).toMatchObject({
      eventType: 'ChannelReturnCancelled',
      payload: { returnId: 'ret_1', cancelledAt: '2026-10-27T01:30:00.000Z' },
    });
  });

  it('canceled_at 이 비면 주문의 갱신 시각으로 대신한다', () => {
    const { observations } = medusaReturnObservations(order([ret({ status: 'canceled', canceled_at: null })]));
    expect(observations[1]).toMatchObject({ payload: { cancelledAt: '2026-10-27T02:00:00.000Z' } });
  });

  it('CS 가 기한을 넘긴 반품은 windowOverrideReason 을 싣는다', () => {
    const { observations } = medusaReturnObservations(
      order([
        ret({
          metadata: record({ requestedBy: 'operator', windowOverride: { reason: '고객 사정', actorId: 'u1' } }),
        }),
      ]),
    );
    expect(observations[0]).toMatchObject({
      payload: { requestedBy: 'operator', windowOverrideReason: '고객 사정' },
    });
  });

  it('확정 전·기록 없음·사유 6종 밖·품목 0 반품은 관측하지 않고 이유를 남긴다', () => {
    const { observations, skipped } = medusaReturnObservations(
      order([
        ret({ id: 'r_open', status: 'open', requested_at: null }),
        ret({ id: 'r_norec', metadata: {} }),
        ret({ id: 'r_badreason', metadata: record({ reasonValue: 'nope' }) }),
        ret({ id: 'r_noitems', items: [{ item_id: 'item_1', quantity: 0 }, { quantity: 2 }] }),
      ]),
    );
    expect(observations).toEqual([]);
    expect(skipped).toEqual([
      { returnId: 'r_open', reason: 'unconfirmed' },
      { returnId: 'r_norec', reason: 'no_record' },
      { returnId: 'r_badreason', reason: 'no_record' },
      { returnId: 'r_noitems', reason: 'no_items' },
    ]);
  });

  it('반품이 여럿이면 requested_at 오름차순', () => {
    const { observations } = medusaReturnObservations(
      order([
        ret({ id: 'ret_b', requested_at: '2026-10-27T03:00:00.000Z' }),
        ret({ id: 'ret_a', requested_at: '2026-10-27T01:00:00.000Z' }),
      ]),
    );
    expect(observations.map((o) => o.eventKey)).toEqual(['return:ret_a:requested', 'return:ret_b:requested']);
  });

  it('returns 칸이 없는 옛 응답 → 관측 0, skipped 0', () => {
    expect(medusaReturnObservations(order())).toEqual({ observations: [], skipped: [] });
  });
});
