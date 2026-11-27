import { AlmondFulfillmentProviderService } from '../service';
import { resolveParent } from '../add-to-delivery/resolve-parent';

jest.mock('../add-to-delivery/resolve-parent', () => ({
  ...jest.requireActual('../add-to-delivery/resolve-parent'),
  resolveParent: jest.fn(),
}));
const resolveMock = jest.mocked(resolveParent);

const optionData = {
  shippingGroupCode: 'bucheon',
  shippingProfileId: 'sp_bucheon',
  policy: { type: 'flat', baseFee: 3000, jejuExtraFee: 3000 },
};
const context = {
  id: 'cart_1',
  shipping_address: { postal_code: '63100' },
  items: [{ product_id: 'prod_b', requires_shipping: true, subtotal: 6500, quantity: 1 }],
};

function provider(cartMetadata: Record<string, unknown>) {
  const graph = jest.fn(async ({ entity }: { entity: string }) => {
    if (entity === 'cart') return { data: [{ id: 'cart_1', customer_id: 'cus_1', metadata: cartMetadata }] };
    if (entity === 'product') return { data: [{ id: 'prod_b', shipping_profile: { id: 'sp_bucheon' } }] };

    return { data: [] };
  });

  return new AlmondFulfillmentProviderService({ query: { graph }, logger: console });
}

describe('calculatePrice 함께 배송', () => {
  beforeEach(() => resolveMock.mockReset());

  it('부모가 유효하면 지역 추가비까지 0원', async () => {
    resolveMock.mockResolvedValue({
      orderId: 'order_p',
      displayId: 1,
      createdAt: '2026-11-26T00:00:00.000Z',
      shippingProfileIds: ['sp_bucheon'],
      shippingAddress: {},
    });

    const price = await provider({ add_to_delivery_parent_order_id: 'order_p' }).calculatePrice(
      optionData,
      {},
      context,
    );

    expect(price.calculated_amount).toBe(0);
    expect(resolveMock).toHaveBeenCalledWith(expect.anything(), {
      customerId: 'cus_1',
      parentOrderId: 'order_p',
      shippingProfileId: 'sp_bucheon',
    });
  });

  it('부모가 유효하지 않으면 원래 배송비', async () => {
    resolveMock.mockResolvedValue(null);

    const price = await provider({ add_to_delivery_parent_order_id: 'order_p' }).calculatePrice(
      optionData,
      {},
      context,
    );

    expect(price.calculated_amount).toBe(6000);
  });

  it('부모 키가 없으면 부모를 판정하지 않는다', async () => {
    const price = await provider({}).calculatePrice(optionData, {}, context);

    expect(price.calculated_amount).toBe(6000);
    expect(resolveMock).not.toHaveBeenCalled();
  });
});
