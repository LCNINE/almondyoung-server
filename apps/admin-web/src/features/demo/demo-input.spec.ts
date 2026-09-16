import {
  buildRunInput,
  buildPracticeItems,
  retryRunInput,
  runWithActionLock,
} from './demo-input';

describe('demo console request identity', () => {
  it('preserves a legacy run when requesting retry', () => {
    const run = {
      requestId: 'id',
      scenario: 'happy_path' as const,
      count: 2,
      variantId: 'v',
      quantity: 3,
    };
    expect(retryRunInput(run)).toEqual(run);
  });
  it('preserves the normalized random pool on retry', () => {
    const run = {
      requestId: 'id',
      scenario: 'happy_path' as const,
      count: 5,
      variantId: 'compat',
      quantity: 1,
      input: {
        mode: 'random' as const,
        variantIds: ['a', 'b'],
        productsPerOrder: 2,
        minQuantity: 1,
        maxQuantity: 3,
      },
    };
    expect(retryRunInput(run)).toEqual({
      requestId: 'id',
      scenario: 'happy_path',
      count: 5,
      ...run.input,
    });
  });
  it('does not submit more distinct products than the selected pool', () => {
    expect(() =>
      buildRunInput({
        requestId: 'id',
        scenario: 'happy_path',
        count: 1,
        mode: 'specified',
        variantIds: ['one'],
        productsPerOrder: 2,
        minQuantity: 1,
        maxQuantity: 3,
      })
    ).toThrow();
  });
  it('sums shared component quantities for stock preparation', () => {
    expect(
      buildPracticeItems(
        [
          {
            components: [
              { skuId: 'a', quantity: 2 },
              { skuId: 'b', quantity: 1 },
            ],
          },
          { components: [{ skuId: 'a', quantity: 3 }] },
        ],
        10
      )
    ).toEqual([
      { skuId: 'a', quantity: 50 },
      { skuId: 'b', quantity: 10 },
    ]);
  });

  it('shares one synchronous lock across order and practice actions', async () => {
    let finishOrder!: () => void;
    const lock = { current: false };
    const orderAction = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishOrder = resolve;
        })
    );
    const practiceAction = jest.fn(async () => undefined);

    const first = runWithActionLock(lock, orderAction);
    const duplicate = runWithActionLock(lock, orderAction);
    const competingPractice = runWithActionLock(lock, practiceAction);

    expect(orderAction).toHaveBeenCalledTimes(1);
    await expect(duplicate).resolves.toBe(false);
    await expect(competingPractice).resolves.toBe(false);
    expect(practiceAction).not.toHaveBeenCalled();

    finishOrder();
    await expect(first).resolves.toBe(true);
    await expect(runWithActionLock(lock, practiceAction)).resolves.toBe(true);
    expect(practiceAction).toHaveBeenCalledTimes(1);
  });
});
