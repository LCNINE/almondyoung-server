import type { SalesOrderLineReservationStatePayload } from '@packages/event-contracts/streams/orders.stream';
import { inboxEvents } from '../schema';
import { LineReservationStateConsumer } from './line-reservation-state.consumer';

const PAYLOAD: SalesOrderLineReservationStatePayload = {
  salesOrderId: 'so-1',
  salesChannel: 'medusa',
  channelOrderId: 'order_1',
  orderedAt: '2026-11-09T00:00:00.000Z',
  version: 3,
  asOf: '2026-11-09T00:01:00.000Z',
  lines: [],
};
// 소비자가 읽는 세 필드만 채운 부분 봉투 — 전체 타입은 테스트에 불필요하다.
const ENVELOPE = { correlationId: 'c', causationId: 'k', messageId: 'm' } as never;

describe('LineReservationStateConsumer', () => {
  it('(salesOrderId, version) 키로 inbox 에 적재하고 충돌은 무시한다', async () => {
    const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoNothing });
    const insert = jest.fn().mockReturnValue({ values });
    const consumer = new LineReservationStateConsumer({ db: { insert } } as never);

    await consumer.onLineReservationState(PAYLOAD, ENVELOPE);
    await consumer.onLineReservationState(PAYLOAD, ENVELOPE);

    expect(insert).toHaveBeenCalledWith(inboxEvents);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'SalesOrderLineReservationState',
        idempotencyKey: 'so-1:3',
        aggregateType: 'Order',
        aggregateId: 'so-1',
        partitionKey: 'so-1',
        status: 'pending',
      }),
    );
    expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
  });
});
