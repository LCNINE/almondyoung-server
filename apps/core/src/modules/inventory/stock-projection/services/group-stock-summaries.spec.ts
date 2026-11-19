import { groupStockSummaries, GroupStockSummaryRow } from './group-stock-summaries';

function row(overrides: Partial<GroupStockSummaryRow> = {}): GroupStockSummaryRow {
  return {
    groupId: 'group-1',
    groupName: 'Product',
    groupCode: 'PRODUCT',
    skuId: 'sku-1',
    skuName: 'Option A',
    skuCode: 'A',
    warehouseId: 'warehouse-1',
    warehouseName: 'Warehouse',
    shelfPosition: null,
    onHandQty: 2,
    defectiveQty: 1,
    inTransferQty: 3,
    returnedQty: 4,
    availableQuantity: 1,
    unshippedQuantity: 12,
    safetyStock: 2,
    ...overrides,
  };
}

describe('groupStockSummaries', () => {
  it('keeps every SKU × warehouse row in each group and preserves database ordering', () => {
    const result = groupStockSummaries([
      row({ groupId: 'urgent', groupName: 'Z product' }),
      row({ groupId: 'other', groupName: 'A product' }),
      row({ groupId: 'urgent', skuId: 'sku-2', skuName: 'Option B', unshippedQuantity: 0 }),
      row({ groupId: 'urgent', warehouseId: 'warehouse-2' }),
    ]);

    expect(result.map((group) => group.groupId)).toEqual(['urgent', 'other']);
    expect(result[0].skus.map((sku) => [sku.skuId, sku.warehouseId])).toEqual([
      ['sku-1', 'warehouse-1'],
      ['sku-2', 'warehouse-1'],
      ['sku-1', 'warehouse-2'],
    ]);
    expect(result[0].imageFileId).toBeNull();
  });

  it('separates ungrouped SKUs even when names match and a SKU id equals a group id', () => {
    const result = groupStockSummaries([
      row({ groupId: null, skuId: 'group-1', skuName: 'Same name' }),
      row({ groupId: null, skuId: 'sku-2', skuName: 'Same name' }),
      row(),
      row({ groupId: null, skuId: 'group-1', warehouseId: 'warehouse-2', skuName: 'Same name' }),
    ]);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ groupId: null, groupName: 'Same name', groupCode: null });
    expect(result[0].skus).toHaveLength(2);
  });

  it('counts shortage against on-hand stock only, current quantity over all physical states, safety against available', () => {
    const [group] = groupStockSummaries([row({ shelfPosition: 'A-01' })]);

    expect(group.skus[0]).toMatchObject({
      currentQuantity: 10,
      availableQuantity: 1,
      unshippedQuantity: 12,
      shortageQuantity: 10,
      safetyStock: 2,
      belowSafetyStock: true,
      shelfPosition: 'A-01',
    });
  });

  it.each([
    { safetyStock: null, availableQuantity: -1, belowSafetyStock: false },
    { safetyStock: 0, availableQuantity: 0, belowSafetyStock: false },
    { safetyStock: 0, availableQuantity: -1, belowSafetyStock: true },
    { safetyStock: 2, availableQuantity: 2, belowSafetyStock: false },
  ])('handles safety boundary $safetyStock / $availableQuantity', (input) => {
    const [group] = groupStockSummaries([row({ ...input, unshippedQuantity: 3, onHandQty: 3 })]);

    expect(group.skus[0].belowSafetyStock).toBe(input.belowSafetyStock);
    expect(group.skus[0].shortageQuantity).toBe(0);
  });

  it('takes the group image from the first SKU row that has a matched product image', () => {
    const [group] = groupStockSummaries(
      [row({ skuId: 'no-image' }), row({ skuId: 'with-image' }), row({ skuId: 'later' })],
      new Map([
        ['with-image', 'file-1'],
        ['later', 'file-2'],
      ]),
    );

    expect(group.imageFileId).toBe('file-1');
  });

  it('returns no groups for an empty page', () => {
    expect(groupStockSummaries([])).toEqual([]);
  });
});
