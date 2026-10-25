import { projectFulfillmentOrderItemProgress, projectFulfillmentOrderProgress } from './fulfillment-progress.service';

const item = (overrides: Partial<Parameters<typeof projectFulfillmentOrderItemProgress>[0]> = {}) => ({
  id: 'foi-1',
  qty: 10,
  shippedQty: 0,
  canceledQty: 0,
  confirmedReservedQty: 0,
  activeLineQty: 10,
  supplierLineQty: 0,
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

  it('직배분만 남은 항목은 ready', () => {
    expect(
      projectFulfillmentOrderItemProgress(item({ qty: 2, activeLineQty: 2, supplierLineQty: 2, confirmedReservedQty: 0 })),
    ).toMatchObject({ status: 'ready', confirmedReservedQty: 0 });
  });

  it('창고분 다 예약 + 직배 항목 → 주문 ready, 요약 confirmedReservedQty 는 창고 예약만', () => {
    const order = projectFulfillmentOrderProgress([
      item({ id: 'a', qty: 3, activeLineQty: 3, confirmedReservedQty: 3 }),
      item({ id: 'b', qty: 2, activeLineQty: 2, supplierLineQty: 2 }),
    ]);
    expect(order.status).toBe('ready');
    expect(order.confirmedReservedQty).toBe(3);
  });

  it('창고분 예약 0 + 직배 항목 → 주문 partially_reserved', () => {
    const order = projectFulfillmentOrderProgress([
      item({ id: 'a', qty: 3, activeLineQty: 3, confirmedReservedQty: 0 }),
      item({ id: 'b', qty: 2, activeLineQty: 2, supplierLineQty: 2 }),
    ]);
    expect(order.status).toBe('partially_reserved');
    expect(order.confirmedReservedQty).toBe(0);
  });

  it('supplierLineQty > activeLineQty 면 던진다', () => {
    expect(() => projectFulfillmentOrderItemProgress(item({ activeLineQty: 1, supplierLineQty: 2 }))).toThrow(
      /supplierLineQty/,
    );
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

  it('qty 0 항목(구성 변경으로 대체됨)은 미출고 0 · canceled 로 투영하고 FO 합계에 섞이지 않는다', () => {
    expect(projectFulfillmentOrderItemProgress(item({ qty: 0, activeLineQty: 0 }))).toMatchObject({
      outstandingQty: 0,
      status: 'canceled',
    });
    expect(
      projectFulfillmentOrderProgress([
        item({ id: 'foi-0', qty: 0, activeLineQty: 0 }),
        item({ id: 'foi-1', qty: 3, activeLineQty: 3 }),
      ]),
    ).toMatchObject({ status: 'created', totalQty: 3, canceledQty: 0, outstandingQty: 3 });
  });
});
