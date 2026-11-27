import { waivedShippingAmount } from '../waived-shipping';

const snapshot = {
  policySnapshot: {
    policy: { type: 'flat', baseFee: 3000, jejuExtraFee: 3000, islandExtraFee: 5000 },
    shippingGroupCode: 'bucheon',
    shippingProfileId: 'sp_bucheon',
  },
};

function queryWith(orderRow: Record<string, any>) {
  return {
    graph: jest.fn(async ({ entity, filters }: { entity: string; filters?: Record<string, any> }) => {
      if (entity === 'order') return { data: [orderRow] };
      if (entity === 'product')
        return { data: (filters?.id as string[]).map((id) => ({ id, shipping_profile: { id: 'sp_bucheon' } })) };

      return { data: [] };
    }),
  };
}

describe('waivedShippingAmount', () => {
  it('결제 시점 정책 스냅샷으로 기본 배송비와 제주 추가비를 낸다', async () => {
    const query = queryWith({
      id: 'order_c',
      shipping_address: { postal_code: '63100' },
      shipping_methods: [{ data: snapshot }],
      items: [{ product_id: 'prod_b', requires_shipping: true, subtotal: 6500, quantity: 1 }],
    });

    await expect(waivedShippingAmount(query, 'order_c')).resolves.toBe(6000);
  });

  it('스냅샷이 없으면 0', async () => {
    const query = queryWith({
      id: 'order_c',
      shipping_address: { postal_code: '14500' },
      shipping_methods: [{ data: {} }],
      items: [{ product_id: 'prod_b', requires_shipping: true, subtotal: 6500, quantity: 1 }],
    });

    await expect(waivedShippingAmount(query, 'order_c')).resolves.toBe(0);
  });

  it('주문이 없으면 0', async () => {
    const query = { graph: jest.fn(async () => ({ data: [] })) };

    await expect(waivedShippingAmount(query, 'nope')).resolves.toBe(0);
  });

  it('결제 뒤 상품의 배송비 그룹이 바뀌거나 상품이 지워져도 결제 때 면제액이 그대로다', async () => {
    const graph = jest.fn(async ({ entity }: { entity: string }) => {
      if (entity === 'order') {
        return {
          data: [
            {
              id: 'order_c',
              shipping_address: { postal_code: '14500' },
              shipping_methods: [{ data: snapshot }],
              items: [{ product_id: null, requires_shipping: true, subtotal: 6500, quantity: 1 }],
            },
          ],
        };
      }

      return { data: [] };
    });

    await expect(waivedShippingAmount({ graph }, 'order_c')).resolves.toBe(3000);
    expect(graph).not.toHaveBeenCalledWith(expect.objectContaining({ entity: 'product' }));
  });
});
