import {
  isReturnAttemptSelectable,
  maxReturnAttemptSelectableQty,
  summarizeReturnAttemptIdentity,
} from './return-attempt-view-model';

describe('return attempt view model', () => {
  it('keeps historical nullable rows readable and labels them as legacy', () => {
    expect(
      summarizeReturnAttemptIdentity([
        { shipmentLineId: 'line-1', dispatchAttemptId: 'attempt-1' },
        { shipmentLineId: null, dispatchAttemptId: null },
        { shipmentLineId: 'line-2', dispatchAttemptId: null },
      ])
    ).toEqual({ exactCount: 1, legacyCount: 2 });
  });

  it('only selects an exact delivered attempt pool with remaining quantity', () => {
    expect(
      isReturnAttemptSelectable({
        shipmentLineId: 'line-1',
        dispatchAttemptId: 'attempt-1',
        remainingEligibleQty: 2,
      })
    ).toBe(true);
    expect(
      isReturnAttemptSelectable({
        shipmentLineId: 'line-1',
        dispatchAttemptId: 'attempt-1',
        remainingEligibleQty: 0,
      })
    ).toBe(false);
    expect(
      isReturnAttemptSelectable({
        shipmentLineId: null,
        dispatchAttemptId: null,
        remainingEligibleQty: 2,
      })
    ).toBe(false);
    expect(
      isReturnAttemptSelectable({
        shipmentLineId: 'line-2',
        dispatchAttemptId: 'attempt-2',
        remainingEligibleQty: 2,
        salesOrderLineRemainingEligibleQty: 0,
      })
    ).toBe(false);
    expect(
      maxReturnAttemptSelectableQty({
        remainingEligibleQty: 6,
        salesOrderLineRemainingEligibleQty: 4,
      })
    ).toBe(4);
  });
});
