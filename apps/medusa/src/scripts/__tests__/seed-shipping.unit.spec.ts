import { getMissingSalesChannelIdsForStockLocation } from '../seed-shipping';

describe('seed-shipping helpers', () => {
  it('returns required sales channels that are not linked to the stock location', () => {
    expect(
      getMissingSalesChannelIdsForStockLocation([{ id: 'sc_existing' }], ['sc_existing', 'sc_default']),
    ).toEqual(['sc_default']);
  });

  it('does not return sales channels that are already linked', () => {
    expect(
      getMissingSalesChannelIdsForStockLocation([{ id: 'sc_default' }, { id: 'sc_other' }], ['sc_default']),
    ).toEqual([]);
  });
});
