import {
  buildChannelDispatchUpstreamUrl,
  canReadChannelDispatch,
  isUuid,
  normalizeChannelDispatchResponse,
} from './channel-dispatch-route';

const ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb';
const SHIPMENT_ID = 'cccccccc-cccc-4ccc-accc-cccccccccccc';

describe('channel dispatch Admin BFF contract', () => {
  it('accepts only canonical UUID path parameters and builds one fixed upstream path', () => {
    expect(isUuid(ATTEMPT_ID)).toBe(true);
    expect(isUuid('../internal/secrets')).toBe(false);
    expect(isUuid(`${ATTEMPT_ID}?admin=true`)).toBe(false);
    expect(
      buildChannelDispatchUpstreamUrl(
        'https://channel.example/base?leak=true',
        ATTEMPT_ID,
        ORDER_ID
      )
    ).toBe(
      `https://channel.example/base/internal/channel-dispatch-operations/attempts/${ATTEMPT_ID}/orders/${ORDER_ID}`
    );
  });

  it('allows only the fulfillment logistics role boundary or master', () => {
    expect(canReadChannelDispatch(['logistics_worker'])).toBe(true);
    expect(canReadChannelDispatch(['logistics_manager'])).toBe(true);
    expect(canReadChannelDispatch(['master'])).toBe(true);
    expect(canReadChannelDispatch(['admin'])).toBe(false);
    expect(canReadChannelDispatch(undefined)).toBe(false);
  });

  it('keeps only known fields and allowlisted statuses', () => {
    const normalized = normalizeChannelDispatchResponse(
      {
        dispatchAttemptId: ATTEMPT_ID,
        salesOrderId: ORDER_ID,
        secret: 'must-not-cross-the-BFF',
        operations: [
          {
            dispatchAttemptId: ATTEMPT_ID,
            shipmentId: SHIPMENT_ID,
            salesOrderId: ORDER_ID,
            operation: 'recall',
            channel: 'coupang',
            externalOrderId: 'external-1',
            status: 'manual_adjustment_required',
            attempts: 1,
            errorMessage: 'manual action required',
            lastAttemptAt: null,
            updatedAt: '2026-07-15T00:00:00.000Z',
            internalResultSnapshot: { token: 'hidden' },
          },
        ],
      },
      ATTEMPT_ID,
      ORDER_ID
    );

    expect(normalized).toEqual({
      dispatchAttemptId: ATTEMPT_ID,
      salesOrderId: ORDER_ID,
      operations: [
        {
          dispatchAttemptId: ATTEMPT_ID,
          shipmentId: SHIPMENT_ID,
          salesOrderId: ORDER_ID,
          operation: 'recall',
          channel: 'coupang',
          externalOrderId: 'external-1',
          status: 'manual_adjustment_required',
          attempts: 1,
          errorMessage: 'manual action required',
          lastAttemptAt: null,
          updatedAt: '2026-07-15T00:00:00.000Z',
        },
      ],
    });
    expect(
      normalizeChannelDispatchResponse(
        {
          dispatchAttemptId: ATTEMPT_ID,
          salesOrderId: ORDER_ID,
          operations: [
            {
              dispatchAttemptId: ATTEMPT_ID,
              shipmentId: SHIPMENT_ID,
              salesOrderId: ORDER_ID,
              operation: 'dispatch',
              channel: 'coupang',
              externalOrderId: 'external-1',
              status: 'provider_acknowledged',
              attempts: 1,
              errorMessage: null,
              lastAttemptAt: null,
              updatedAt: '2026-07-15T00:00:00.000Z',
            },
          ],
        },
        ATTEMPT_ID,
        ORDER_ID
      )
    ).toBeNull();
  });

  it.each([
    'pending',
    'succeeded',
    'recovery_required',
    'manual_adjustment_required',
  ])('normalizes the allowlisted %s status', (status) => {
    const normalized = normalizeChannelDispatchResponse(
      {
        dispatchAttemptId: ATTEMPT_ID,
        salesOrderId: ORDER_ID,
        operations: [
          {
            dispatchAttemptId: ATTEMPT_ID,
            shipmentId: SHIPMENT_ID,
            salesOrderId: ORDER_ID,
            operation: 'delivery',
            channel: 'medusa',
            externalOrderId: 'external-2',
            status,
            attempts: 0,
            errorMessage: null,
            lastAttemptAt: null,
            updatedAt: '2026-07-15T00:00:00.000Z',
          },
        ],
      },
      ATTEMPT_ID,
      ORDER_ID
    );

    expect(normalized?.operations[0].status).toBe(status);
  });
});
