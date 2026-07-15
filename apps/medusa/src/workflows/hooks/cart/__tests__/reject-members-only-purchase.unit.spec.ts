import { MedusaError } from '@medusajs/framework/utils';

type HookFn = (args: any, ctx: any) => Promise<void>;

const registered: { addToCart?: HookFn; completeCart?: HookFn } = {};

jest.mock('@medusajs/medusa/core-flows', () => ({
  addToCartWorkflow: {
    hooks: {
      validate: (fn: HookFn) => {
        registered.addToCart = fn;
      },
    },
  },
  completeCartWorkflow: {
    hooks: {
      validate: (fn: HookFn) => {
        registered.completeCart = fn;
      },
    },
  },
}));

const MEMBERSHIP_GROUP_ID = 'cusgroup_membership';

// 훅은 import 시점에 등록된다.
require('../reject-members-only-purchase');

function makeContainer({
  groups = [] as Array<{ id: string }>,
  variants = [] as Array<{ id: string; product: unknown }>,
} = {}) {
  const listProductVariants = jest.fn().mockResolvedValue(variants);
  const graph = jest.fn().mockResolvedValue({ data: [{ id: 'cus_1', groups }] });

  return {
    container: {
      resolve: (key: string) => (key === 'query' ? { graph } : { listProductVariants }),
    },
    listProductVariants,
    graph,
  };
}

const membersOnlyVariant = {
  id: 'variant_1',
  product: { metadata: { pimPurchaseConstraint: { requiresMembership: true } } },
};
const normalVariant = { id: 'variant_2', product: { metadata: {} } };

describe('reject-members-only-purchase 훅', () => {
  const originalGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID;

  beforeEach(() => {
    process.env.MEDUSA_MEMBERSHIP_GROUP_ID = MEMBERSHIP_GROUP_ID;
  });

  afterAll(() => {
    process.env.MEDUSA_MEMBERSHIP_GROUP_ID = originalGroupId;
  });

  it('두 워크플로에 모두 등록된다', () => {
    expect(registered.addToCart).toBeInstanceOf(Function);
    expect(registered.completeCart).toBeInstanceOf(Function);
  });

  describe('장바구니 담기', () => {
    it('비회원이 멤버십 전용 구매 상품을 담으면 막는다', async () => {
      const { container } = makeContainer({ variants: [membersOnlyVariant] });

      await expect(
        registered.addToCart!({ input: { items: [{ variant_id: 'variant_1' }] }, cart: {} }, { container }),
      ).rejects.toThrow(MedusaError);
    });

    it('일반회원(멤버십 그룹 없음)도 막는다', async () => {
      const { container } = makeContainer({ groups: [{ id: 'cusgroup_other' }], variants: [membersOnlyVariant] });

      await expect(
        registered.addToCart!(
          { input: { items: [{ variant_id: 'variant_1' }] }, cart: { customer_id: 'cus_1' } },
          { container },
        ),
      ).rejects.toThrow('멤버십 회원만 구매할 수 있는 상품입니다.');
    });

    it('멤버십 회원은 통과시킨다', async () => {
      const { container, listProductVariants } = makeContainer({
        groups: [{ id: MEMBERSHIP_GROUP_ID }],
        variants: [membersOnlyVariant],
      });

      await expect(
        registered.addToCart!(
          { input: { items: [{ variant_id: 'variant_1' }] }, cart: { customer_id: 'cus_1' } },
          { container },
        ),
      ).resolves.toBeUndefined();
      // 회원이면 상품 조회 자체를 건너뛴다
      expect(listProductVariants).not.toHaveBeenCalled();
    });

    it('일반 상품은 비회원도 통과시킨다', async () => {
      const { container } = makeContainer({ variants: [normalVariant] });

      await expect(
        registered.addToCart!({ input: { items: [{ variant_id: 'variant_2' }] }, cart: {} }, { container }),
      ).resolves.toBeUndefined();
    });

    it('섞여 있으면 막는다', async () => {
      const { container } = makeContainer({ variants: [normalVariant, membersOnlyVariant] });

      await expect(
        registered.addToCart!(
          { input: { items: [{ variant_id: 'variant_2' }, { variant_id: 'variant_1' }] }, cart: {} },
          { container },
        ),
      ).rejects.toThrow(MedusaError);
    });
  });

  describe('결제 완료', () => {
    it('게이트 적용 전에 담아둔 카트를 결제 시점에 막는다', async () => {
      const { container } = makeContainer({ variants: [membersOnlyVariant] });

      await expect(
        registered.completeCart!({ cart: { items: [{ variant_id: 'variant_1' }] } }, { container }),
      ).rejects.toThrow(MedusaError);
    });

    it('멤버십 회원의 결제는 통과시킨다', async () => {
      const { container } = makeContainer({
        groups: [{ id: MEMBERSHIP_GROUP_ID }],
        variants: [membersOnlyVariant],
      });

      await expect(
        registered.completeCart!(
          { cart: { customer_id: 'cus_1', items: [{ variant_id: 'variant_1' }] } },
          { container },
        ),
      ).resolves.toBeUndefined();
    });
  });

  it('멤버십 그룹 ID 가 설정 안 됐으면 아무도 회원으로 보지 않는다', async () => {
    delete process.env.MEDUSA_MEMBERSHIP_GROUP_ID;
    const { container } = makeContainer({ groups: [{ id: MEMBERSHIP_GROUP_ID }], variants: [membersOnlyVariant] });

    await expect(
      registered.addToCart!(
        { input: { items: [{ variant_id: 'variant_1' }] }, cart: { customer_id: 'cus_1' } },
        { container },
      ),
    ).rejects.toThrow(MedusaError);
  });
});
