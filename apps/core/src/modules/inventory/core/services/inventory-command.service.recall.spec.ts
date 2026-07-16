import { BadRequestException } from '@nestjs/common';
import { InventoryCommandService } from './inventory-command.service';

function queuedTx(rows: unknown[]) {
  return {
    select: jest.fn(() => {
      const value = rows.shift();
      const chain: Record<string, unknown> = {};
      for (const method of ['from', 'innerJoin', 'where', 'limit', 'orderBy']) {
        chain[method] = jest.fn(() => chain);
      }
      chain.then = (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve(value).then(resolve, reject);
      return chain;
    }),
  };
}

describe('InventoryCommandService shipment dispatch reversal', () => {
  const operationId = '10000000-0000-4000-8000-000000000001';
  const actorId = '10000000-0000-4000-8000-000000000002';
  const attemptId = '10000000-0000-4000-8000-000000000003';
  const journalId = '10000000-0000-4000-8000-000000000004';

  function makeService(rows: unknown[]) {
    const tx = queuedTx(rows);
    const eventStore = { reverseShipmentDispatchEvent: jest.fn() };
    const location = {
      getSystemLocationByRole: jest.fn().mockResolvedValue({ id: '10000000-0000-4000-8000-000000000005' }),
    };
    const service = new InventoryCommandService(
      { db: {} } as never,
      eventStore as never,
      {} as never,
      location as never,
    );
    return { service, tx, eventStore, location };
  }

  it('reverses every sorted exact source and returns a unique affected SKU set without publishing early', async () => {
    const sourceEvent1 = '10000000-0000-4000-8000-000000000011';
    const sourceEvent2 = '10000000-0000-4000-8000-000000000012';
    const { service, tx, eventStore, location } = makeService([
      [{ id: journalId, sourceType: 'SHIPMENT_RECALL', sourceId: operationId, actorId }],
      [{ warehouseId: '10000000-0000-4000-8000-000000000006' }],
      [
        { id: '10000000-0000-4000-8000-000000000021', stockEventId: sourceEvent1 },
        { id: '10000000-0000-4000-8000-000000000022', stockEventId: sourceEvent2 },
      ],
    ]);
    eventStore.reverseShipmentDispatchEvent
      .mockResolvedValueOnce({
        dispatchAttemptSourceId: '10000000-0000-4000-8000-000000000021',
        shipmentLineId: '10000000-0000-4000-8000-000000000031',
        skuId: '10000000-0000-4000-8000-000000000041',
        warehouseId: '10000000-0000-4000-8000-000000000006',
        outboundReworkLocationId: '10000000-0000-4000-8000-000000000005',
        quantity: 2,
        originalEventId: sourceEvent1,
        reversalEventId: '10000000-0000-4000-8000-000000000051',
      })
      .mockResolvedValueOnce({
        dispatchAttemptSourceId: '10000000-0000-4000-8000-000000000022',
        shipmentLineId: '10000000-0000-4000-8000-000000000032',
        skuId: '10000000-0000-4000-8000-000000000041',
        warehouseId: '10000000-0000-4000-8000-000000000006',
        outboundReworkLocationId: '10000000-0000-4000-8000-000000000005',
        quantity: 1,
        originalEventId: sourceEvent2,
        reversalEventId: '10000000-0000-4000-8000-000000000052',
      });

    const result = await service.reverseShipmentDispatch(
      {
        dispatchAttemptId: attemptId,
        reversalJournalId: journalId,
        recallOperationId: operationId,
        actorId,
        reason: 'CS',
      },
      tx as never,
    );

    expect(location.getSystemLocationByRole).toHaveBeenCalledWith(
      '10000000-0000-4000-8000-000000000006',
      'outbound_rework',
      tx,
    );
    expect(eventStore.reverseShipmentDispatchEvent).toHaveBeenCalledTimes(2);
    expect(eventStore.reverseShipmentDispatchEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        dispatchAttemptId: attemptId,
        dispatchAttemptSourceId: '10000000-0000-4000-8000-000000000021',
        originalShipEventId: sourceEvent1,
        reversalJournalId: journalId,
        recallOperationId: operationId,
      }),
      tx,
    );
    expect(result.affectedSkuIds).toEqual(['10000000-0000-4000-8000-000000000041']);
    expect(result.sources).toHaveLength(2);
  });

  it('rejects a journal owned by another operation before touching stock', async () => {
    const { service, tx, eventStore } = makeService([
      [{ id: journalId, sourceType: 'SHIPMENT_RECALL', sourceId: operationId, actorId: 'wrong-actor' }],
    ]);
    await expect(
      service.reverseShipmentDispatch(
        {
          dispatchAttemptId: attemptId,
          reversalJournalId: journalId,
          recallOperationId: operationId,
          actorId,
          reason: 'CS',
        },
        tx as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(eventStore.reverseShipmentDispatchEvent).not.toHaveBeenCalled();
  });
});
