import { productCatalogSkill } from '../product-catalog/skill';
import type { SkillContext } from '../types';

const setPrice = productCatalogSkill.tools.find(
  (tool) => tool.definition.name === 'set_product_price'
)!;

function fakeCtx(basePriceRules: unknown[]) {
  const puts: unknown[] = [];

  global.fetch = (async (_url: string | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      puts.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 200 });
    }
    return new Response(
      JSON.stringify({
        basePriceRules,
        membershipPriceRules: [],
        tieredPriceRules: [],
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  const ctx: SkillContext = {
    coreHeaders: async () => ({}),
    coreApiUrl: 'http://core',
    fileServiceUrl: 'http://files',
    attachments: [],
  };
  return { ctx, puts };
}

const baseRule = {
  layer: 'base_price',
  order: 1,
  scopeType: 'all_variants',
  operationType: 'override',
  operationValue: 20000,
};

describe('set_product_price 검증', () => {
  it('0원은 Core 에 보내지 않고 거부한다', async () => {
    const { ctx, puts } = fakeCtx([baseRule]);

    const result = await setPrice.execute(
      { versionId: 'v1', memberPrice: 0 },
      ctx
    );

    expect(result).toMatchObject({ ok: false });
    expect(puts).toHaveLength(0);
  });

  it('판매가가 없는 Draft 에 멤버십가만 주면 거부한다', async () => {
    const { ctx, puts } = fakeCtx([]);

    const result = await setPrice.execute(
      { versionId: 'v1', memberPrice: 9000 },
      ctx
    );

    expect(result).toMatchObject({ ok: false });
    expect(puts).toHaveLength(0);
  });

  it('판매가가 있으면 멤버십가만 바꿔 저장한다', async () => {
    const { ctx, puts } = fakeCtx([baseRule]);

    await setPrice.execute({ versionId: 'v1', memberPrice: 9000 }, ctx);

    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({
      basePriceRules: [expect.objectContaining({ operationValue: 20000 })],
      membershipPriceRules: [expect.objectContaining({ operationValue: 9000 })],
    });
  });
});
