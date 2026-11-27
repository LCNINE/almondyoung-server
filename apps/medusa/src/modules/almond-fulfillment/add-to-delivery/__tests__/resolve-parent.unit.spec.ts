import { fetchCoreSelfCancelable } from '../core-self-cancelable';
import { ADD_TO_DELIVERY_PARENT_KEY, listEligibleParents, resolveParent } from '../resolve-parent';

jest.mock('../core-self-cancelable');
const coreMock = jest.mocked(fetchCoreSelfCancelable);

const NOW = new Date('2026-11-27T03:00:00.000Z');
const BUCHEON = 'sp_bucheon';
const PRINT = 'sp_print';

type Row = Record<string, any>;

function order(over: Row = {}): Row {
  return {
    id: 'order_1',
    display_id: 101,
    customer_id: 'cus_1',
    status: 'pending',
    created_at: '2026-11-26T03:00:00.000Z',
    metadata: {},
    shipping_address: {
      first_name: '홍길동',
      phone: '01012345678',
      postal_code: '14500',
      address_1: '부천로 1',
      address_2: '101호',
    },
    items: [{ product_id: 'prod_b', requires_shipping: true }],
    ...over,
  };
}

function queryWith(orders: Row[], almondUserId: string | null = 'u1') {
  const graph = jest.fn(async ({ entity, filters }: { entity: string; filters?: Row }) => {
    if (entity === 'customer')
      return { data: [{ id: filters?.id, metadata: almondUserId ? { almond_user_id: almondUserId } : {} }] };
    if (entity === 'order') return { data: orders.filter((o) => o.customer_id === filters?.customer_id) };
    if (entity === 'product') {
      return {
        data: (filters?.id as string[]).map((id) => ({
          id,
          shipping_profile: { id: id === 'prod_p' ? PRINT : BUCHEON },
        })),
      };
    }

    return { data: [] };
  });

  return { graph };
}

describe('listEligibleParents / resolveParent', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    coreMock.mockReset();
    coreMock.mockImplementation(async (_u, ids) => ids);
  });

  afterEach(() => jest.useRealTimers());

  it('정상 부모 하나를 돌려준다', async () => {
    const query = queryWith([order()]);

    const parent = await resolveParent(query, {
      customerId: 'cus_1',
      parentOrderId: 'order_1',
      shippingProfileId: BUCHEON,
    });

    expect(parent).toMatchObject({ orderId: 'order_1', displayId: 101, shippingProfileIds: [BUCHEON] });
    expect(coreMock).toHaveBeenCalledWith('u1', ['order_1']);
  });

  it('parent of another customer is not eligible', async () => {
    const query = queryWith([order({ customer_id: 'cus_2' })]);

    await expect(
      resolveParent(query, { customerId: 'cus_1', parentOrderId: 'order_1', shippingProfileId: BUCHEON }),
    ).resolves.toBeNull();
  });

  it('취소·입금 대기·환불 요청·추가 주문·배송 없는 주문은 뺀다', async () => {
    const query = queryWith([
      order({ id: 'o_cancel', status: 'canceled' }),
      order({ id: 'o_deposit', metadata: { bank_transfer_status: 'awaiting_deposit' } }),
      order({ id: 'o_refund', metadata: { refund_status: 'requested' } }),
      order({ id: 'o_child', metadata: { [ADD_TO_DELIVERY_PARENT_KEY]: 'order_x' } }),
      order({ id: 'o_digital', items: [{ product_id: 'prod_b', requires_shipping: false }] }),
      order({ id: 'o_ok' }),
    ]);

    const parents = await listEligibleParents(query, { customerId: 'cus_1' });

    expect(parents.map((p) => p.orderId)).toEqual(['o_ok']);
  });

  it('7일보다 오래된 주문은 뺀다', async () => {
    const query = queryWith([order({ created_at: '2026-11-19T02:59:00.000Z' })]);

    await expect(listEligibleParents(query, { customerId: 'cus_1' })).resolves.toEqual([]);
  });

  it('다른 배송비 그룹 상품만 든 주문은 뺀다', async () => {
    const query = queryWith([order({ items: [{ product_id: 'prod_p', requires_shipping: true }] })]);

    await expect(listEligibleParents(query, { customerId: 'cus_1', shippingProfileId: BUCHEON })).resolves.toEqual([]);
  });

  it('Core 가 빼면 뺀다', async () => {
    coreMock.mockResolvedValue([]);
    const query = queryWith([order()]);

    await expect(listEligibleParents(query, { customerId: 'cus_1' })).resolves.toEqual([]);
  });

  it('almond_user_id 가 없으면 Core 를 부르지 않고 빈 목록', async () => {
    const query = queryWith([order()], null);

    await expect(listEligibleParents(query, { customerId: 'cus_1' })).resolves.toEqual([]);
    expect(coreMock).not.toHaveBeenCalled();
  });

  it('최신순으로 돌려준다', async () => {
    const query = queryWith([
      order({ id: 'old', created_at: '2026-11-25T00:00:00.000Z' }),
      order({ id: 'new', created_at: '2026-11-27T00:00:00.000Z' }),
    ]);

    const parents = await listEligibleParents(query, { customerId: 'cus_1' });

    expect(parents.map((p) => p.orderId)).toEqual(['new', 'old']);
  });

  it('Core 에는 최신 50건만 묻는다', async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      order({ id: `o${i}`, created_at: new Date(NOW.getTime() - (i + 1) * 60_000).toISOString() }),
    );
    const query = queryWith(many);

    await listEligibleParents(query, { customerId: 'cus_1' });

    const asked = coreMock.mock.calls[0][1];
    expect(asked).toHaveLength(50);
    expect(asked[0]).toBe('o0');
  });
});
