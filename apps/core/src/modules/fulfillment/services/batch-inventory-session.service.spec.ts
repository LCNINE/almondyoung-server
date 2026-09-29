import {
  canonicalBatchSessionRequestHash,
  handInRequestHash,
  isApprovedShortageReasonCode,
  remainingShortPickAllocation,
  shortPickOperationIntentOf,
} from './batch-inventory-session.service';

describe('BatchInventorySessionService short-pick accounting', () => {
  it('reserves sibling-safe capacity after active, returned, settled, and shortage attribution', () => {
    expect(
      remainingShortPickAllocation({
        allocatedQty: 10,
        activeAttributedQty: 2,
        returnedQty: 3,
        settledQty: 1,
        shortageQty: 2,
      }),
    ).toBe(2);
  });

  it('binds approval evidence into the canonical request hash', () => {
    const request = {
      shortPickOperationId: 'operation-1',
      shipmentLineId: 'line-1',
      sourceLocationId: 'location-1',
      reasonCode: 'DAMAGED',
      reason: 'cart damage confirmed',
      approverId: 'operator-1',
    };
    expect(canonicalBatchSessionRequestHash(request)).not.toBe(
      canonicalBatchSessionRequestHash({ ...request, approverId: 'operator-2' }),
    );
    expect(canonicalBatchSessionRequestHash(request)).not.toBe(
      canonicalBatchSessionRequestHash({ ...request, reasonCode: 'MISSING' }),
    );
  });

  it('canonicalizes object keys recursively while preserving array order', () => {
    const first = {
      eventType: 'MOVE_CUSTODY',
      context: {
        inspection: { outcome: 'accepted', station: 'pack-1' },
        toteIds: ['tote-2', 'tote-1'],
      },
      actorId: 'operator-1',
    };
    const reordered = {
      actorId: 'operator-1',
      context: {
        toteIds: ['tote-2', 'tote-1'],
        inspection: { station: 'pack-1', outcome: 'accepted' },
      },
      eventType: 'MOVE_CUSTODY',
    };
    expect(canonicalBatchSessionRequestHash(first)).toBe(canonicalBatchSessionRequestHash(reordered));
    expect(canonicalBatchSessionRequestHash(first)).not.toBe(
      canonicalBatchSessionRequestHash({
        ...reordered,
        context: { ...reordered.context, inspection: { station: 'pack-1', outcome: 'rejected' } },
      }),
    );
  });

  it('accepts only the closed shortage reason-code vocabulary', () => {
    expect(isApprovedShortageReasonCode('MISSING')).toBe(true);
    expect(isApprovedShortageReasonCode('DAMAGED')).toBe(true);
    expect(isApprovedShortageReasonCode('DEFECTIVE')).toBe(true);
    expect(isApprovedShortageReasonCode('OTHER')).toBe(false);
  });
});

describe('handInRequestHash', () => {
  it('배치·작업 항목·배정 신원을 묶어 해시한다(계획 id 없음)', () => {
    const allocation = {
      id: 'alloc-1',
      workItemId: 'wi-1',
      shipmentLineId: 'line-1',
      skuId: 'sku-1',
      sourceLocationId: 'loc-1',
      quantity: 2,
      sourceStockVersion: 3,
    };
    expect(handInRequestHash('batch-1', allocation)).toBe(
      canonicalBatchSessionRequestHash({
        eventType: 'HAND_IN',
        batchId: 'batch-1',
        workItemId: 'wi-1',
        allocationId: 'alloc-1',
        skuId: 'sku-1',
        sourceLocationId: 'loc-1',
        shipmentLineId: 'line-1',
        quantity: 2,
        sourceStockVersion: 3,
      }),
    );
    expect(handInRequestHash('batch-1', { ...allocation, workItemId: 'wi-2' })).not.toBe(
      handInRequestHash('batch-1', allocation),
    );
  });
});

describe('shortPickOperationIntentOf', () => {
  it('workItemId 가 없는 intent 는 거절한다', () => {
    const base = {
      kind: 'short_pick',
      operationId: 'op',
      shipmentId: 's',
      workItemId: 'wi-1',
      sessionId: 'se',
      actorId: 'a',
      reason: 'r',
      lines: [{ shipmentLineId: 'l', sourceLocationId: 'loc', shortQty: 1, allocationQty: 2 }],
    };
    expect(shortPickOperationIntentOf({ intent: base })?.workItemId).toBe('wi-1');
    const withoutWorkItem: Partial<typeof base> = { ...base };
    delete withoutWorkItem.workItemId;
    expect(shortPickOperationIntentOf({ intent: withoutWorkItem })).toBeNull();
  });
});
