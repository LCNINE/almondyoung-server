import {
  listEligibleParents,
  resolveParent,
} from '../../../../modules/almond-fulfillment/add-to-delivery/resolve-parent';
import { waivedShippingAmount } from '../../../../modules/almond-fulfillment/add-to-delivery/waived-shipping';
import { listParentsForProduct, PARENT_UNAVAILABLE_MESSAGE, readLinks, startAddToDeliveryCart } from '../handlers';
import { GET as getParents } from '../parents/route';

jest.mock('../../../../modules/almond-fulfillment/add-to-delivery/resolve-parent', () => ({
  ...jest.requireActual('../../../../modules/almond-fulfillment/add-to-delivery/resolve-parent'),
  listEligibleParents: jest.fn(),
  resolveParent: jest.fn(),
}));
jest.mock('../../../../modules/almond-fulfillment/add-to-delivery/waived-shipping');
const listMock = jest.mocked(listEligibleParents);
const resolveMock = jest.mocked(resolveParent);
const waivedMock = jest.mocked(waivedShippingAmount);

const addr = {
  first_name: '길동',
  last_name: '홍',
  phone: '01012345678',
  postal_code: '14500',
  address_1: '부천로 1',
  address_2: '101호',
  country_code: 'kr',
};

function candidate(orderId: string, address = addr) {
  return {
    orderId,
    displayId: 1,
    createdAt: '2026-11-26T00:00:00.000Z',
    shippingProfileIds: ['sp_b'],
    shippingAddress: address,
  };
}

function query(rows: Record<string, Array<Record<string, any>>>) {
  return { graph: jest.fn(async ({ entity }: { entity: string }) => ({ data: rows[entity] ?? [] })) };
}

describe('add-to-delivery store handlers', () => {
  beforeEach(() => {
    listMock.mockReset();
    resolveMock.mockReset();
    waivedMock.mockReset();
  });

  it('배송지가 같은 부모는 가장 최근 하나만 보인다', async () => {
    listMock.mockResolvedValue([
      candidate('new'),
      candidate('old'),
      candidate('other', { ...addr, address_2: '202호' }),
    ]);
    const q = query({ product: [{ id: 'prod_1', shipping_profile: { id: 'sp_b' } }] });

    const parents = await listParentsForProduct(q, 'cus_1', 'prod_1');

    expect(parents.map((p) => p.order_id)).toEqual(['new', 'other']);
    expect(parents[0].address).toMatchObject({ name: '홍길동', postal_code: '14500' });
    expect(listMock).toHaveBeenCalledWith(q, { customerId: 'cus_1', shippingProfileId: 'sp_b' });
  });

  it('부모가 부적격이면 409 와 거절 문구, 카트를 만들지 않는다', async () => {
    resolveMock.mockResolvedValue(null);
    const createCart = jest.fn();
    const q = query({ product_variant: [{ id: 'var_1', product: { shipping_profile: { id: 'sp_b' } } }] });

    await expect(
      startAddToDeliveryCart({ query: q, createCart }, 'cus_1', { parent_order_id: 'order_p', variant_id: 'var_1' }),
    ).rejects.toMatchObject({ type: 'conflict', message: PARENT_UNAVAILABLE_MESSAGE });
    expect(createCart).not.toHaveBeenCalled();
  });

  it('부모 배송지와 region 으로 함께 배송 카트를 만든다', async () => {
    resolveMock.mockResolvedValue(candidate('order_p'));
    const createCart = jest.fn().mockResolvedValue({ id: 'cart_1' });
    const q = query({
      product_variant: [{ id: 'var_1', product: { shipping_profile: { id: 'sp_b' } } }],
      order: [{ id: 'order_p', region_id: 'reg_kr', sales_channel_id: 'sc_1', email: 'a@test' }],
    });

    await expect(
      startAddToDeliveryCart({ query: q, createCart }, 'cus_1', { parent_order_id: 'order_p', variant_id: 'var_1' }),
    ).resolves.toEqual({ cart_id: 'cart_1' });
    expect(createCart).toHaveBeenCalledWith({
      region_id: 'reg_kr',
      sales_channel_id: 'sc_1',
      customer_id: 'cus_1',
      email: 'a@test',
      shipping_address: addr,
      metadata: { cart_kind: 'add_to_delivery', add_to_delivery_parent_order_id: 'order_p' },
    });
  });

  it('links 는 다른 고객 주문을 빼고 면제·차감 금액을 낸다', async () => {
    waivedMock.mockResolvedValue(3000);
    const q = query({
      order: [
        { id: 'order_p', customer_id: 'cus_1', metadata: {}, display_id: 7, status: 'pending' },
        { id: 'order_c', customer_id: 'cus_1', metadata: { add_to_delivery_parent_order_id: 'order_p' } },
        { id: 'order_x', customer_id: 'cus_2', metadata: {} },
      ],
    });
    const knex = {
      raw: jest.fn(async (_sql: string, _b: unknown[]) => ({ rows: [{ id: 'order_c', parent_id: 'order_p' }] })),
    };

    const links = await readLinks({ query: q, knex }, 'cus_1', ['order_p', 'order_c', 'order_x']);

    expect(Object.keys(links).sort()).toEqual(['order_c', 'order_p']);
    expect(links.order_p).toEqual({
      parent_order_id: null,
      parent_display_id: null,
      parent_canceled: false,
      parent_withheld_amount: 0,
      children: ['order_c'],
      waived_amount: 0,
      withheld_amount: 3000,
    });
    expect(links.order_c).toEqual({
      parent_order_id: 'order_p',
      parent_display_id: 7,
      parent_canceled: false,
      parent_withheld_amount: 0,
      children: [],
      waived_amount: 3000,
      withheld_amount: 0,
    });
  });

  it('부모만 취소한 뒤에는 결제에 남은 보류액을 낸다', async () => {
    waivedMock.mockResolvedValue(3000);
    const q = query({
      order: [
        {
          id: 'order_p',
          customer_id: 'cus_1',
          metadata: { add_to_delivery_hold: { amount: 3000, released: 0, releases: {} } },
        },
      ],
    });
    const knex = { raw: jest.fn(async (_sql: string, _b: unknown[]) => ({ rows: [] as Array<Record<string, any>> })) };

    const links = await readLinks({ query: q, knex }, 'cus_1', ['order_p']);

    expect(links.order_p.withheld_amount).toBe(3000);
  });

  it('보류 없이 취소된 부모(판매자 탓 취소)는 차감액 0', async () => {
    waivedMock.mockResolvedValue(3000);
    const q = query({ order: [{ id: 'order_p', customer_id: 'cus_1', status: 'canceled', metadata: {} }] });
    const knex = {
      raw: jest.fn(async (_sql: string, _b: unknown[]) => ({ rows: [{ id: 'order_c', parent_id: 'order_p' }] })),
    };

    const links = await readLinks({ query: q, knex }, 'cus_1', ['order_p']);

    expect(links.order_p.withheld_amount).toBe(0);
  });

  it('비로그인은 401', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await getParents({ auth_context: undefined } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});
