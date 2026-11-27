import { resolveParent } from '../../../../modules/almond-fulfillment/add-to-delivery/resolve-parent';
import { ADD_TO_DELIVERY_REJECT_MESSAGE, validateAddToDelivery } from '../validate-add-to-delivery';

jest.mock('../../../../modules/almond-fulfillment/add-to-delivery/resolve-parent', () => ({
  ...jest.requireActual('../../../../modules/almond-fulfillment/add-to-delivery/resolve-parent'),
  resolveParent: jest.fn(),
}));
const resolveMock = jest.mocked(resolveParent);

const address = {
  first_name: '홍길동',
  last_name: '',
  phone: '01012345678',
  postal_code: '14500',
  address_1: '부천로 1',
  address_2: '101호',
};

function cartRow(over: Record<string, any> = {}) {
  return {
    id: 'cart_1',
    customer_id: 'cus_1',
    metadata: { add_to_delivery_parent_order_id: 'order_p' },
    shipping_address: { ...address, id: 'addr_cart' },
    shipping_methods: [
      { data: { policySnapshot: { shippingProfileId: 'sp_bucheon', policy: { type: 'flat', baseFee: 3000 } } } },
    ],
    ...over,
  };
}

function queryWith(row: Record<string, any>) {
  return { graph: jest.fn(async () => ({ data: [row] })) };
}

const parent = {
  orderId: 'order_p',
  displayId: 1,
  createdAt: '2026-11-26T00:00:00.000Z',
  shippingProfileIds: ['sp_bucheon'],
  shippingAddress: { ...address, id: 'addr_order' },
};

describe('validateAddToDelivery', () => {
  beforeEach(() => resolveMock.mockReset());

  it('부모 키가 없으면 통과하고 부모를 판정하지 않는다', async () => {
    await expect(
      validateAddToDelivery(queryWith(cartRow({ metadata: {} })), { id: 'cart_1' }),
    ).resolves.toBeUndefined();
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('부모가 그대로면 통과한다', async () => {
    resolveMock.mockResolvedValue(parent);

    await expect(validateAddToDelivery(queryWith(cartRow()), { id: 'cart_1' })).resolves.toBeUndefined();
    expect(resolveMock).toHaveBeenCalledWith(expect.anything(), {
      customerId: 'cus_1',
      parentOrderId: 'order_p',
      shippingProfileId: 'sp_bucheon',
    });
  });

  it('parent became ineligible between page and complete', async () => {
    resolveMock.mockResolvedValue(null);

    await expect(validateAddToDelivery(queryWith(cartRow()), { id: 'cart_1' })).rejects.toThrow(
      ADD_TO_DELIVERY_REJECT_MESSAGE,
    );
    expect(ADD_TO_DELIVERY_REJECT_MESSAGE).toBe(
      '함께 받을 주문이 방금 출고됐어요. 배송비를 포함해 다시 결제해 주세요.',
    );
  });

  it('awaiting deposit marker on add-on cart is rejected', async () => {
    const row = cartRow({
      metadata: { add_to_delivery_parent_order_id: 'order_p', bank_transfer_status: 'awaiting_deposit' },
    });

    await expect(validateAddToDelivery(queryWith(row), { id: 'cart_1' })).rejects.toThrow(
      '함께 배송 주문은 즉시 결제로만 결제할 수 있어요.',
    );
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('배송지가 부모와 다르면 거절한다', async () => {
    resolveMock.mockResolvedValue(parent);
    const row = cartRow({ shipping_address: { ...address, address_2: '102호' } });

    await expect(validateAddToDelivery(queryWith(row), { id: 'cart_1' })).rejects.toThrow(
      ADD_TO_DELIVERY_REJECT_MESSAGE,
    );
  });

  it('배송 방식 스냅샷이 없으면 거절한다', async () => {
    resolveMock.mockResolvedValue(parent);

    await expect(validateAddToDelivery(queryWith(cartRow({ shipping_methods: [] })), { id: 'cart_1' })).rejects.toThrow(
      ADD_TO_DELIVERY_REJECT_MESSAGE,
    );
  });
});
