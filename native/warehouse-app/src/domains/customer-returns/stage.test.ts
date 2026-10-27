import { describe, expect, it } from 'vitest';
import { receivingStageOf } from './stage';
import { item, view } from './fixtures';

describe('receivingStageOf', () => {
  it('expected -> receive', () => {
    expect(receivingStageOf(view([item()]))).toEqual({ kind: 'receive' });
  });
  it('arrived 덜 옴 -> receive, 닫힘 있으면 inspect', () => {
    const it2 = item({ expectedQty: 2, arrivedQty: 1 });
    expect(receivingStageOf(view([it2], { status: 'arrived' }))).toEqual({
      kind: 'receive',
    });
    expect(
      receivingStageOf(
        view([it2], { status: 'arrived', csResolution: { missing: {} } })
      )
    ).toEqual({ kind: 'inspect' });
  });
  it('arrived 다 옴 -> inspect', () => {
    const it2 = item({ expectedQty: 2, arrivedQty: 2 });
    expect(receivingStageOf(view([it2], { status: 'arrived' }))).toEqual({
      kind: 'inspect',
    });
  });
  it.each(['inspected', 'held', 'refund_pending', 'settled'])(
    '%s -> closed inspected',
    (status) => {
      expect(receivingStageOf(view([item()], { status }))).toEqual({
        kind: 'closed',
        reason: 'inspected',
      });
    }
  );
  it('cancelled -> closed cancelled', () => {
    expect(receivingStageOf(view([item()], { status: 'cancelled' }))).toEqual({
      kind: 'closed',
      reason: 'cancelled',
    });
  });
});
