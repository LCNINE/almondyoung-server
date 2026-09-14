import { ProductAiSalesService } from './product-ai-sales.service';
import type { ProductAiSales } from '@packages/product-ai/sales';
import type { DbTransaction } from '../../../catalog.types';
import { ForbiddenException } from '@nestjs/common';

const id = '550e8400-e29b-41d4-a716-446655440000';
const sales = (): ProductAiSales => ({
  marketPrice: 5000,
  supplyPrice: 1000,
  salePrice: 3000,
  membershipPrice: 2500,
  membershipPricing: 'custom',
  options: [],
  categories: [{ id, name: '스티커', parentId: null }],
  primaryCategoryIndex: 0,
  tagValueIds: [],
  inventory: [{ optionValues: [], skuId: id, newSkuName: null, quantity: 1, salePrice: null, membershipPrice: null }],
});
function setup() {
  const masters = { updateVersion: jest.fn() };
  const pricing = { replaceVersionRules: jest.fn() };
  const matching = { upsert: jest.fn().mockResolvedValue({ links: [{ skuId: id }] }) };
  const authorization = { getScopesByRoles: jest.fn().mockResolvedValue(new Set()) };
  const service = new ProductAiSalesService(
    {} as never,
    {} as never,
    masters as never,
    pricing as never,
    matching as never,
    authorization as never,
  );
  const rows: object[][] = [[{ id }], []];
  const tx = {
    select: jest.fn(() => {
      const result = rows.shift()!;
      const chain = {
        from: () => chain,
        where: () => chain,
        innerJoin: () => chain,
        orderBy: () => Promise.resolve(result),
        then: (resolve: (value: object[]) => void) => Promise.resolve(result).then(resolve),
      };
      return chain;
    }),
  } as unknown as DbTransaction;
  return { service, masters, pricing, matching, authorization, tx };
}
it('writes market/supply to product fields and sale/member amounts to their pricing layers', async () => {
  const { service, masters, pricing, matching, tx } = setup();
  await service.apply(id, id, sales(), sales(), tx);
  expect(masters.updateVersion).toHaveBeenCalledWith(
    id,
    expect.objectContaining({ marketPrice: 5000, supplyPrice: 1000, categoryIds: [id], primaryCategoryId: id }),
    tx,
  );
  expect(pricing.replaceVersionRules).toHaveBeenCalledWith(
    id,
    expect.objectContaining({
      basePriceRules: [expect.objectContaining({ layer: 'base_price', operationValue: 3000 })],
      membershipPriceRules: [expect.objectContaining({ layer: 'membership_price', operationValue: 2500 })],
    }),
    tx,
  );
  expect(matching.upsert).toHaveBeenCalledWith(
    id,
    expect.objectContaining({
      links: [{ skuId: id, quantity: 1 }],
      policy: { preStockSellable: false, alwaysSellableZeroStock: false },
    }),
    tx,
  );
});
it('preserves unknown market/supply and replaces new SKU intent with the actual generated ID', async () => {
  const { service, masters, matching, tx } = setup();
  const draft = sales();
  draft.marketPrice = null;
  draft.supplyPrice = null;
  draft.inventory[0].skuId = null;
  draft.inventory[0].newSkuName = '냥이';
  await service.apply(id, id, draft, sales(), tx);
  expect(masters.updateVersion.mock.calls[0][1]).not.toHaveProperty('marketPrice');
  expect(masters.updateVersion.mock.calls[0][1]).not.toHaveProperty('supplyPrice');
  expect(matching.upsert.mock.calls[0][1].links[0]).toMatchObject({ newSku: { name: '냥이', stockType: 'physical' } });
  expect(draft.inventory[0]).toMatchObject({ skuId: id, newSkuName: null });
});
it('requires inventory.manage independently of model output', async () => {
  const { service, tx } = setup();
  const draft = sales();
  draft.inventory[0].skuId = null;
  draft.inventory[0].newSkuName = 'new';
  await expect(service.validate(draft, ['admin'], false, tx)).rejects.toBeInstanceOf(ForbiddenException);
  expect(tx.select).not.toHaveBeenCalled();
});
it('blocks missing prices before performing any product writes', async () => {
  const { service, tx, masters } = setup();
  await expect(service.validate({ ...sales(), salePrice: null }, ['master'], true, tx)).rejects.toThrow('판매가');
  expect(tx.select).not.toHaveBeenCalled();
  expect(masters.updateVersion).not.toHaveBeenCalled();
});
