import type { SalesOrderLineReservationStatePayload } from '@packages/event-contracts/streams/orders.stream';
import { ReservationProjectionService } from './reservation-projection.service';

type Line = SalesOrderLineReservationStatePayload['lines'][number];
const line = (over: Partial<Line>): Line => ({
  salesOrderLineId: 'sol',
  channelOrderItemId: 'li',
  variantId: 'v1',
  ordered: 2,
  canceledBeforeShipment: 0,
  demand: 2,
  heldUnits: 1,
  ...over,
});

describe('ReservationProjectionService.toWrites', () => {
  const asOf = new Date('2026-11-10T00:00:00Z');
  const now = new Date('2026-11-10T01:00:00Z');
  const gate = { blockedVariantIds: jest.fn() };
  const service = new ReservationProjectionService(gate as never);

  beforeEach(() => gate.blockedVariantIds.mockResolvedValue(new Set(['vBlocked'])));

  it('막힌 variant 는 allowDecrease false, 아니면 true', async () => {
    const writes = await service.toWrites(
      [
        line({ channelOrderItemId: 'a', variantId: 'vBlocked' }),
        line({ channelOrderItemId: 'b', variantId: 'vOk', demand: 1, heldUnits: 3 }),
      ],
      asOf,
      now,
    );
    expect(writes).toEqual([
      { lineItemId: 'a', quantity: 1, allowDecrease: false },
      { lineItemId: 'b', quantity: 0, allowDecrease: true },
    ]);
    expect(gate.blockedVariantIds).toHaveBeenCalledWith(['vBlocked', 'vOk'], asOf, now);
  });

  it('channelOrderItemId 가 null 인 줄은 뺀다', async () => {
    const writes = await service.toWrites([line({ channelOrderItemId: null }), line({ channelOrderItemId: 'c' })], asOf, now);
    expect(writes.map((w) => w.lineItemId)).toEqual(['c']);
  });
});
