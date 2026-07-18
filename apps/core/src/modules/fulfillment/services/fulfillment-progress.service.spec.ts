import { projectFulfillmentOrderItemProgress, projectFulfillmentOrderProgress } from './fulfillment-progress.service';

const item = (overrides: Partial<Parameters<typeof projectFulfillmentOrderItemProgress>[0]> = {}) => ({
  id: 'foi-1',
  qty: 10,
  shippedQty: 0,
  canceledQty: 0,
  confirmedReservedQty: 0,
  activeLineQty: 10,
  processing: false,
  recoveryRequired: false,
  ...overrides,
});

describe('fulfillment progress projection', () => {
  it.each([
    [{}, 'created'],
    [{ confirmedReservedQty: 4 }, 'partially_reserved'],
    [{ confirmedReservedQty: 10 }, 'ready'],
    [{ confirmedReservedQty: 10, processing: true }, 'processing'],
    [{ shippedQty: 4, confirmedReservedQty: 6, activeLineQty: 6 }, 'partially_shipped'],
    [{ shippedQty: 7, canceledQty: 3, activeLineQty: 0 }, 'completed'],
    [{ canceledQty: 10, activeLineQty: 0 }, 'canceled'],
    [{ recoveryRequired: true }, 'recovery_required'],
  ])('projects item %j as %s', (overrides, expected) => {
    expect(projectFulfillmentOrderItemProgress(item(overrides))).toMatchObject({ status: expected });
  });

  it('treats shipped+canceled=qty as completed even when neither alone equals qty', () => {
    expect(
      projectFulfillmentOrderProgress([item({ qty: 8, shippedQty: 5, canceledQty: 3, activeLineQty: 0 })]),
    ).toMatchObject({ status: 'completed', outstandingQty: 0 });
  });

  it('reopens a previously completed FO after recall restores outstanding demand', () => {
    const beforeRecall = projectFulfillmentOrderProgress([
      item({ shippedQty: 10, confirmedReservedQty: 0, activeLineQty: 0 }),
    ]);
    const afterRecall = projectFulfillmentOrderProgress([
      item({ shippedQty: 0, confirmedReservedQty: 10, activeLineQty: 10 }),
    ]);

    expect(beforeRecall.status).toBe('completed');
    expect(afterRecall).toMatchObject({ status: 'ready', shippedQty: 0, outstandingQty: 10 });
  });

  it('never accepts delivery state as projection input', () => {
    expect('delivered' in item()).toBe(false);
    expect(projectFulfillmentOrderProgress([item()]).status).toBe('created');
  });

  it('rejects over-settled demand', () => {
    expect(() => projectFulfillmentOrderProgress([item({ shippedQty: 8, canceledQty: 3 })])).toThrow('exceeds qty');
  });
});
