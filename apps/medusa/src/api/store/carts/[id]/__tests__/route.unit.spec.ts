import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { refreshCartItemsWorkflow } from '@medusajs/medusa/core-flows';
import { GET } from '../route';
import { refetchCart } from '../../helpers';
import { findStaleTimeSalePriceLines } from '../../../../../workflows/hooks/cart/private-time-sale-price';

jest.mock('@medusajs/medusa/core-flows', () => ({ refreshCartItemsWorkflow: jest.fn() }));
jest.mock('../../helpers', () => ({ refetchCart: jest.fn() }));
jest.mock('../../../../../workflows/hooks/cart/private-time-sale-price', () => ({
  findStaleTimeSalePriceLines: jest.fn(),
}));

const refetch = jest.mocked(refetchCart);
const findStale = jest.mocked(findStaleTimeSalePriceLines);
const refreshWorkflow = jest.mocked(refreshCartItemsWorkflow);

const guestCart = (unitPrice: number) => ({
  id: 'cart_1',
  customer_id: null,
  shipping_address: null,
  metadata: null,
  items: [{ id: 'item_1', unit_price: unitPrice }],
});

function call() {
  const json = jest.fn();
  const res = { status: jest.fn(() => ({ json })) } as unknown as MedusaResponse;
  const req = { params: { id: 'cart_1' }, scope: {}, queryConfig: { fields: ['id'] } } as unknown as MedusaRequest;

  return { run: () => GET(req, res), json };
}

describe('GET /store/carts/:id', () => {
  const run = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    refreshWorkflow.mockReturnValue({ run } as unknown as ReturnType<typeof refreshCartItemsWorkflow>);
  });

  it('reprices the cart before answering when a line carries a time-sale price it no longer gets', async () => {
    findStale.mockResolvedValue([{ id: 'item_1', title: 'A' }]);
    refetch.mockResolvedValueOnce(guestCart(7000)).mockResolvedValueOnce(guestCart(10000));
    const { run: get, json } = call();

    await get();

    expect(run).toHaveBeenCalledWith({ input: { cart_id: 'cart_1', force_refresh: true } });
    expect(json).toHaveBeenCalledWith({ cart: guestCart(10000) });
  });

  it('answers without repricing when every time-sale line is still current', async () => {
    findStale.mockResolvedValue([]);
    refetch.mockResolvedValueOnce(guestCart(10000));
    const { run: get, json } = call();

    await get();

    expect(run).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ cart: guestCart(10000) });
  });
});
