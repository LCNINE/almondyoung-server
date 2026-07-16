import {
  buildChannelDispatchTargets,
  buildChannelDispatchViewModel,
  type ChannelDispatchOperation,
} from './channel-dispatch-model';

const ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDER_A = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb';
const ORDER_B = 'cccccccc-cccc-4ccc-accc-cccccccccccc';

const operation = (
  salesOrderId: string,
  status: ChannelDispatchOperation['status']
): ChannelDispatchOperation => ({
  dispatchAttemptId: ATTEMPT_ID,
  shipmentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  salesOrderId,
  operation: 'dispatch',
  channel: 'coupang',
  externalOrderId: `external-${salesOrderId}`,
  status,
  attempts: 1,
  errorMessage: null,
  lastAttemptAt: null,
  updatedAt: '2026-07-15T00:00:00.000Z',
});

describe('channel dispatch shipment view model', () => {
  it('queries every unique attempt and source-order pair in a consolidation', () => {
    expect(
      buildChannelDispatchTargets({
        lines: [
          { id: 'line-a1', origin: { salesOrderId: ORDER_A } },
          { id: 'line-a2', origin: { salesOrderId: ORDER_A } },
          { id: 'line-b', origin: { salesOrderId: ORDER_B } },
          { id: 'line-legacy', origin: null },
        ],
        dispatchAttempts: [
          {
            id: ATTEMPT_ID,
            sources: [
              { shipmentLineId: 'line-a1' },
              { shipmentLineId: 'line-a2' },
              { shipmentLineId: 'line-b' },
              { shipmentLineId: 'line-legacy' },
            ],
          },
        ],
      })
    ).toEqual([
      { dispatchAttemptId: ATTEMPT_ID, salesOrderId: ORDER_A },
      { dispatchAttemptId: ATTEMPT_ID, salesOrderId: ORDER_B },
    ]);
  });

  it('aggregates manual state without treating an unavailable order as succeeded', () => {
    const view = buildChannelDispatchViewModel([
      {
        target: { dispatchAttemptId: ATTEMPT_ID, salesOrderId: ORDER_A },
        availability: 'ready',
        operations: [operation(ORDER_A, 'manual_adjustment_required')],
      },
      {
        target: { dispatchAttemptId: ATTEMPT_ID, salesOrderId: ORDER_B },
        availability: 'error',
        operations: [],
      },
    ]);

    expect(view.manualOperations).toHaveLength(1);
    expect(view.hasUnavailable).toBe(true);
    expect(view.attempts[0].orders).toEqual([
      expect.objectContaining({ salesOrderId: ORDER_A, availability: 'ready' }),
      expect.objectContaining({ salesOrderId: ORDER_B, availability: 'error' }),
    ]);
  });
});
