import { shouldManageMedusaInventoryForSellableProjection } from './medusa-inventory-projection';

describe('shouldManageMedusaInventoryForSellableProjection', () => {
  it('keeps manual out-of-stock stock-gated so Medusa projects zero managed inventory', () => {
    expect(
      shouldManageMedusaInventoryForSellableProjection({
        reason: 'MANUAL_OUT_OF_STOCK',
        isSellable: false,
      }),
    ).toBe(true);
  });

  it('keeps matching-missing non-stock-gated for unresolved variants', () => {
    expect(
      shouldManageMedusaInventoryForSellableProjection({
        reason: 'MATCHING_MISSING',
        isSellable: false,
      }),
    ).toBe(false);
  });
});
