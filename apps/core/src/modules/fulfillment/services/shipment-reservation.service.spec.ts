import { ConflictException } from '@nestjs/common';
import {
  assertExactRecallReservationEvidence,
  computePartialReservationQuantity,
  earliestReservationDemandAt,
  normalizeReservationDemandAt,
  planOldestReservationInvalidation,
  ShipmentReservationService,
} from './shipment-reservation.service';

describe('ShipmentReservationService allocation policy', () => {
  const recallLine = {
    id: 'line-1',
    skuId: 'sku-1',
    warehouseId: 'warehouse-1',
    qty: 3,
  };
  const recallReservation = {
    id: 'reservation-1',
    targetType: 'SHIPMENT_LINE',
    targetId: recallLine.id,
    shipmentLineId: recallLine.id,
    skuId: recallLine.skuId,
    warehouseId: recallLine.warehouseId,
    quantity: recallLine.qty,
  };

  it('rejects recalled dispatch reservation evidence with the wrong SKU', () => {
    expect(() =>
      assertExactRecallReservationEvidence(
        'Dispatch attempt attempt-1',
        [recallLine],
        [{ ...recallReservation, skuId: 'sku-corrupt' }],
      ),
    ).toThrow(ConflictException);
  });

  it('rejects recalled dispatch reservation evidence with the wrong warehouse', () => {
    expect(() =>
      assertExactRecallReservationEvidence(
        'Dispatch attempt attempt-1',
        [recallLine],
        [{ ...recallReservation, warehouseId: 'warehouse-corrupt' }],
      ),
    ).toThrow(ConflictException);
  });

  it('rejects an idempotent recall replay whose per-line quantity is not exact', () => {
    expect(() =>
      assertExactRecallReservationEvidence(
        'Recall operation recall-1 replay',
        [recallLine],
        [{ ...recallReservation, quantity: recallLine.qty - 1 }],
      ),
    ).toThrow(ConflictException);
  });

  it('reserves only the currently available part of a shipment-line shortage', () => {
    expect(
      computePartialReservationQuantity({
        requestedQty: 10,
        outstandingQty: 10,
        availableQty: 6,
      }),
    ).toBe(6);
  });

  it('caps a retry increment by the remaining line shortage', () => {
    expect(
      computePartialReservationQuantity({
        requestedQty: 10,
        outstandingQty: 4,
        availableQty: 20,
      }),
    ).toBe(4);
  });

  it('returns zero when no stock is currently reservable', () => {
    expect(
      computePartialReservationQuantity({
        requestedQty: 2,
        outstandingQty: 4,
        availableQty: 0,
      }),
    ).toBe(0);
  });

  it('never returns a negative quantity for an already-filled line', () => {
    expect(
      computePartialReservationQuantity({
        requestedQty: 2,
        outstandingQty: 0,
        availableQty: 10,
      }),
    ).toBe(0);
  });

  it('invalidates only the requested quantity from oldest confirmed rows and preserves the good remainder', () => {
    expect(
      planOldestReservationInvalidation(
        [
          { id: 'oldest', quantity: 3 },
          { id: 'newer', quantity: 5 },
          { id: 'newest', quantity: 2 },
        ],
        6,
      ),
    ).toEqual([
      { id: 'oldest', invalidatedQty: 3, remainingQty: 0 },
      { id: 'newer', invalidatedQty: 3, remainingQty: 2 },
    ]);
  });

  it('preserves the oldest demand timestamp across short-pick release and retry', () => {
    const lineCreatedAt = new Date('2026-07-15T03:00:00.000Z');
    const confirmedRequestedAt = new Date('2026-07-15T02:00:00.000Z');
    const releasedShortPickRequestedAt = new Date('2026-07-15T01:00:00.000Z');

    expect(earliestReservationDemandAt(lineCreatedAt, confirmedRequestedAt, releasedShortPickRequestedAt)).toEqual(
      releasedShortPickRequestedAt,
    );
  });

  it('normalizes PostgreSQL aggregate timestamps before comparing retry fairness', () => {
    const fallback = new Date('2026-07-15T03:00:00.000Z');
    expect(normalizeReservationDemandAt('2026-07-15 01:00:00+00', fallback)).toEqual(
      new Date('2026-07-15T01:00:00.000Z'),
    );
    expect(normalizeReservationDemandAt('not-a-timestamp', fallback)).toBe(fallback);
    expect(normalizeReservationDemandAt(null, fallback)).toBe(fallback);
  });

  it('locks the operation before the reservation graph and rejects graph membership changed during acquisition', async () => {
    const order: string[] = [];
    const transaction = {};
    const db = {
      run: (work: (tx: unknown) => Promise<unknown>) => work(transaction),
    };
    const service = new ShipmentReservationService(db as never, {} as never, {} as never, {} as never);
    const line = {
      id: 'line-1',
      shipmentId: 'shipment-1',
      fulfillmentOrderItemId: 'foi-1',
      fulfillmentOrderId: 'fo-1',
      skuId: 'sku-1',
      qty: 3,
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
      warehouseId: 'warehouse-1',
      shipmentStatus: 'planned',
    };
    const internals = service as unknown as {
      loadLineContext: (shipmentLineId: string, tx: unknown) => Promise<typeof line>;
      loadShortPickOperationOwner: (
        operationId: string,
        shipmentId: string,
        tx: unknown,
      ) => Promise<
        | {
            memberOperationId: string;
            shipmentId: string;
            type: string;
            status: string;
            intent: {
              kind: 'short_pick';
              operationId: string;
              shipmentId: string;
              sessionId: string;
              actorId: string;
              reason: string;
              lines: Array<{
                shipmentLineId: string;
                sourceLocationId: string;
                shortQty: number;
                allocationQty: number;
              }>;
            };
          }
        | undefined
      >;
      lockConnectedComponents: (contexts: readonly (typeof line)[], tx: unknown) => Promise<void>;
    };
    let lineReadCount = 0;
    jest.spyOn(internals, 'loadLineContext').mockImplementation(() => {
      const optimistic = lineReadCount++ === 0;
      order.push(optimistic ? 'line:optimistic' : 'line:locked');
      return Promise.resolve(optimistic ? line : { ...line, shipmentId: 'shipment-changed' });
    });
    jest.spyOn(internals, 'loadShortPickOperationOwner').mockImplementation(() => {
      order.push('operation:locked');
      return Promise.resolve({
        memberOperationId: 'operation-1',
        shipmentId: line.shipmentId,
        type: 'short_pick',
        status: 'pending',
        intent: {
          kind: 'short_pick',
          operationId: 'operation-1',
          shipmentId: line.shipmentId,
          sessionId: 'session-1',
          actorId: 'actor-1',
          reason: 'inventory_shortage',
          lines: [
            {
              shipmentLineId: line.id,
              sourceLocationId: 'source-1',
              shortQty: 1,
              allocationQty: 3,
            },
          ],
        },
      });
    });
    jest.spyOn(internals, 'lockConnectedComponents').mockImplementation(() => {
      order.push('graph:locked');
      return Promise.resolve();
    });

    await expect(service.invalidateForShortPick(line.id, 1, 'operation-1')).rejects.toThrow(ConflictException);
    expect(order).toEqual(['line:optimistic', 'operation:locked', 'graph:locked', 'line:locked']);
  });
});
