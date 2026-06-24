import { rejectAwaitingDepositCompleteMiddleware } from '../reject-awaiting-deposit-complete';

type GraphArgs = { entity: string; fields?: string[]; filters?: Record<string, unknown> };
type GraphFn = (args: GraphArgs) => Promise<{ data: any[] }> | { data: any[] };

function makeReq(opts: { cartId?: string | undefined; graph?: GraphFn } = {}) {
  const query = { graph: jest.fn(opts.graph ?? (async () => ({ data: [] }))) };
  return {
    params: { id: 'cartId' in opts ? opts.cartId : 'cart_1' },
    // ContainerRegistrationKeys.QUERY === 'query'
    scope: { resolve: jest.fn((key: string) => (key === 'query' ? query : undefined)) },
    _query: query,
  } as any;
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const sessionGraph =
  (provider: string, intentId: string | undefined): GraphFn =>
  ({ entity }) => {
    if (entity === 'cart') {
      return {
        data: [
          {
            id: 'cart_1',
            payment_collection: {
              payment_sessions: [{ provider_id: provider, data: intentId ? { intentId } : {} }],
            },
          },
        ],
      };
    }
    return { data: [] };
  };

const ALMOND = 'pp_almond-payment_almond-payment';

function mockFetchStatus(status: string) {
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WALLET_BASE_URL = 'http://wallet.test';
  process.env.WALLET_API_KEY = 'test-key';
});

describe('rejectAwaitingDepositCompleteMiddleware', () => {
  it('AWAITING_DEPOSIT intent 의 cart complete 는 409 로 거부하고 next 를 호출하지 않는다', async () => {
    mockFetchStatus('AWAITING_DEPOSIT');
    const req = makeReq({ graph: sessionGraph(ALMOND, 'intent_1') });
    const res = makeRes();
    const next = jest.fn();

    await rejectAwaitingDepositCompleteMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'BANK_TRANSFER_AWAITING_DEPOSIT' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('카드 등 비-AWAITING_DEPOSIT intent 는 통과시킨다(next 호출, 409 없음)', async () => {
    mockFetchStatus('CAPTURED');
    const req = makeReq({ graph: sessionGraph(ALMOND, 'intent_1') });
    const res = makeRes();
    const next = jest.fn();

    await rejectAwaitingDepositCompleteMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('almond-payment 세션/intentId 가 없으면 wallet 조회 없이 통과시킨다', async () => {
    (global as any).fetch = jest.fn();
    const req = makeReq({ graph: sessionGraph('pp_system_default', 'intent_1') });
    const res = makeRes();
    const next = jest.fn();

    await rejectAwaitingDepositCompleteMiddleware(req, res, next);

    expect((global as any).fetch).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('wallet 조회 실패(!ok)는 fail-open: 통과시킨다', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    const req = makeReq({ graph: sessionGraph(ALMOND, 'intent_1') });
    const res = makeRes();
    const next = jest.fn();

    await rejectAwaitingDepositCompleteMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('cart graph 조회 자체가 throw 하면 fail-open: 통과시킨다', async () => {
    const req = makeReq({
      graph: () => {
        throw new Error('db down');
      },
    });
    const res = makeRes();
    const next = jest.fn();

    await rejectAwaitingDepositCompleteMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('cartId 파라미터가 없으면 즉시 통과시킨다', async () => {
    const req = makeReq({ cartId: undefined });
    const res = makeRes();
    const next = jest.fn();

    await rejectAwaitingDepositCompleteMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req._query.graph).not.toHaveBeenCalled();
  });
});
