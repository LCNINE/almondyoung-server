import { MatchingLinkResolver } from './matching-link-resolver';
import { SkuCreationSource } from '../../inventory/sku-catalog/dto/create-sku.dto';

const EXISTING = '44444444-4444-4444-4444-444444444444';

function makeResolver() {
  let seq = 0;
  const order: string[] = [];
  const skuCatalogService = {
    create: jest.fn(async (dto: { name: string; source?: SkuCreationSource }) => {
      order.push(dto.name);
      seq += 1;
      return { id: `created-${seq}` };
    }),
  };
  return { resolver: new MatchingLinkResolver(skuCatalogService as never), skuCatalogService, order };
}

describe('MatchingLinkResolver', () => {
  const trx = { marker: 'tx' } as never;

  it('passes an existing SKU reference through with its quantity', async () => {
    const { resolver, skuCatalogService } = makeResolver();

    const result = await resolver.resolve([{ skuId: EXISTING, quantity: 2 }], trx);

    expect(result).toEqual([{ skuId: EXISTING, quantity: 2 }]);
    expect(skuCatalogService.create).not.toHaveBeenCalled();
  });

  it('creates a SKU on the caller transaction and returns its id', async () => {
    const { resolver, skuCatalogService } = makeResolver();

    const result = await resolver.resolve([{ newSku: { name: 'S / 검정' } as never, quantity: 3 }], trx);

    expect(result).toEqual([{ skuId: 'created-1', quantity: 3 }]);
    expect(skuCatalogService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'S / 검정', source: SkuCreationSource.AUTO_MATCHING }),
      trx,
    );
  });

  it('forces source=auto_matching even when the caller supplies another', async () => {
    const { resolver, skuCatalogService } = makeResolver();

    await resolver.resolve([{ newSku: { name: 'X', source: SkuCreationSource.MANUAL_ENTRY } as never }], trx);

    expect(skuCatalogService.create.mock.calls[0][0].source).toBe(SkuCreationSource.AUTO_MATCHING);
  });

  it('preserves input order and creates sequentially', async () => {
    const { resolver, order } = makeResolver();

    const result = await resolver.resolve(
      [{ newSku: { name: 'a' } as never }, { skuId: EXISTING, quantity: 5 }, { newSku: { name: 'b' } as never }],
      trx,
    );

    expect(result).toEqual([
      { skuId: 'created-1', quantity: 1 },
      { skuId: EXISTING, quantity: 5 },
      { skuId: 'created-2', quantity: 1 },
    ]);
    expect(order).toEqual(['a', 'b']);
  });

  it('defaults and normalizes quantity', async () => {
    const { resolver } = makeResolver();

    const result = await resolver.resolve(
      [{ skuId: EXISTING }, { skuId: EXISTING, quantity: 2.7 }, { skuId: EXISTING, quantity: 0 }],
      trx,
    );

    expect(result.map((m) => m.quantity)).toEqual([1, 2, 1]);
  });

  it('returns an empty list for no links', async () => {
    const { resolver } = makeResolver();
    expect(await resolver.resolve([], trx)).toEqual([]);
  });
});
