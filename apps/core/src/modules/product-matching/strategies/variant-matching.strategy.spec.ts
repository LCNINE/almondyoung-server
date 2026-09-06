import { VariantMatchingStrategy } from './variant-matching.strategy';
import { MatchingContext } from './matching-strategy.interface';

const CONTEXT: MatchingContext = {
  variantId: '22222222-2222-2222-2222-222222222222',
  productMatchingId: '11111111-1111-1111-1111-111111111111',
};
const SKU_A = '44444444-4444-4444-4444-444444444444';
const SKU_B = '55555555-5555-5555-5555-555555555555';

function makeReader(rows: Array<{ id: string }>) {
  const builder: Record<string, unknown> = {};
  builder.from = jest.fn(() => builder);
  builder.where = jest.fn(() => builder);
  builder.then = jest.fn((resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve));
  return { select: jest.fn(() => builder) };
}

describe('VariantMatchingStrategy.validate', () => {
  it('reads through the supplied transaction, not the ambient db', async () => {
    const ambient = makeReader([]); // tx 밖에서는 아직 안 보이는 상태
    const trx = makeReader([{ id: SKU_A }]);
    const strategy = new VariantMatchingStrategy({ db: ambient } as never);

    const result = await strategy.validate(CONTEXT, [{ skuId: SKU_A, quantity: 1 }], trx as never);

    expect(result).toBe(true);
    expect(trx.select).toHaveBeenCalled();
    expect(ambient.select).not.toHaveBeenCalled();
  });

  it('falls back to the ambient db when no transaction is given', async () => {
    const ambient = makeReader([{ id: SKU_A }]);
    const strategy = new VariantMatchingStrategy({ db: ambient } as never);

    expect(await strategy.validate(CONTEXT, [{ skuId: SKU_A, quantity: 1 }])).toBe(true);
    expect(ambient.select).toHaveBeenCalled();
  });

  it('rejects when one of the mapped SKUs does not exist', async () => {
    const trx = makeReader([{ id: SKU_A }]);
    const strategy = new VariantMatchingStrategy({ db: makeReader([]) } as never);

    const result = await strategy.validate(
      CONTEXT,
      [
        { skuId: SKU_A, quantity: 1 },
        { skuId: SKU_B, quantity: 1 },
      ],
      trx as never,
    );

    expect(result).toBe(false);
  });

  it('rejects an empty mapping list without querying', async () => {
    const trx = makeReader([]);
    const strategy = new VariantMatchingStrategy({ db: makeReader([]) } as never);

    expect(await strategy.validate(CONTEXT, [], trx as never)).toBe(false);
    expect(trx.select).not.toHaveBeenCalled();
  });

  it('queries once for duplicated SKU ids', async () => {
    const trx = makeReader([{ id: SKU_A }]);
    const strategy = new VariantMatchingStrategy({ db: makeReader([]) } as never);

    const result = await strategy.validate(
      CONTEXT,
      [
        { skuId: SKU_A, quantity: 1 },
        { skuId: SKU_A, quantity: 2 },
      ],
      trx as never,
    );

    expect(result).toBe(true);
    expect(trx.select).toHaveBeenCalledTimes(1);
  });
});
