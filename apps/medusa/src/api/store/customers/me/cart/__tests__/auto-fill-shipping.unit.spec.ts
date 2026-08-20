/**
 * 자동 채우기는 배송메모 **유형**만 앞으로 나른다 — 공동현관 비번은 나르지 않는다.
 *
 * 나르면 보관 시계가 스스로 갱신된다: 고객이 이번 세션에서 다시 입력하지 않았는데도 새 카트에
 * 값이 실리고, 그 카트가 주문이 되면 14일 시계가 처음부터 다시 간다. 주문을 반복하는 고객의
 * 비번은 그렇게 **영원히** 살아남는다. 유형만 나르고 비번은 안 나르는 것이 보관 상한을
 * 실제로 상한이게 만드는 유일한 지점이다.
 */
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { autoFillShipping } from '../auto-fill-shipping';

const CUSTOMER_ID = 'cus_1';
const CART_ID = 'cart_1';

function makeContainer(options: { customerMetadata?: Record<string, unknown>; orderMetadata?: Record<string, unknown> }) {
  const updateCarts = jest.fn(() => Promise.resolve([]));

  const graph = jest.fn(({ entity }: { entity: string }) => {
    if (entity === 'customer') {
      return Promise.resolve({ data: [{ metadata: options.customerMetadata ?? {} }] });
    }
    return Promise.resolve({ data: options.orderMetadata ? [{ metadata: options.orderMetadata }] : [] });
  });

  const registry: Record<string, unknown> = {
    [ContainerRegistrationKeys.QUERY]: { graph },
    [Modules.CUSTOMER]: { listCustomerAddresses: jest.fn(() => Promise.resolve([])) },
    [Modules.CART]: { updateCarts },
  };

  const container = { resolve: (key: string) => registry[key] } as never;
  return { container, updateCarts };
}

const cart = {
  id: CART_ID,
  customer_id: CUSTOMER_ID,
  shipping_address: { first_name: '홍', last_name: '길동', phone: '01000000000' },
  metadata: {},
} as never;

function metadataOf(updateCarts: jest.Mock): Record<string, unknown> {
  const [[[update]]] = updateCarts.mock.calls as unknown as [[[{ metadata: Record<string, unknown> }]]];
  return update.metadata;
}

describe('autoFillShipping — 공동현관 비번은 앞으로 나르지 않는다', () => {
  it('고객 기본 배송메모에서 유형은 나르고 비번은 빼놓는다', async () => {
    const { container, updateCarts } = makeContainer({
      customerMetadata: {
        default_shipping_memo_type: 'door',
        default_shipping_memo_custom: '',
        default_entrance_password: '1234*',
        default_has_entrance: true,
      },
    });

    await expect(autoFillShipping(container, cart)).resolves.toBe(true);

    const metadata = metadataOf(updateCarts);
    expect(metadata).toMatchObject({ shipping_memo_type: 'door', shipping_memo_custom: '', has_entrance: true });
    expect(metadata).not.toHaveProperty('entrance_password');
    expect(JSON.stringify(metadata)).not.toContain('1234*');
  });

  it('마지막 주문 폴백에서도 유형만 나르고 비번은 빼놓는다', async () => {
    const { container, updateCarts } = makeContainer({
      customerMetadata: {},
      orderMetadata: {
        shipping_memo_type: 'door',
        shipping_memo_custom: '',
        entrance_password: '9876#',
        has_entrance: true,
      },
    });

    await expect(autoFillShipping(container, cart)).resolves.toBe(true);

    const metadata = metadataOf(updateCarts);
    expect(metadata).toMatchObject({ shipping_memo_type: 'door', shipping_memo_custom: '', has_entrance: true });
    expect(metadata).not.toHaveProperty('entrance_password');
    expect(JSON.stringify(metadata)).not.toContain('9876#');
  });
});
