import { DeliveryProviderError, DeliveryRequest } from './delivery-provider.interface';
import { GoodsflowDeliveryProvider } from './goodsflow-delivery.provider';

describe('GoodsflowDeliveryProvider', () => {
  const envKeys = ['GOODSFLOW_API_URL', 'GOODSFLOW_API_KEY', 'GOODSFLOW_CENTER_CODE', 'GOODSFLOW_TIMEOUT_MS'];
  const savedEnv: Record<string, string | undefined> = {};

  const request: DeliveryRequest = {
    centerCode: '',
    recipientName: '홍길동',
    recipientAddress: '서울시 강남구',
    recipientPhone: '010-1234-5678',
    carrierCode: 'CJ',
    items: [{ productName: '아몬드', quantity: 2, price: 10_000 }],
  };

  function response(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: jest.fn().mockResolvedValue(body),
      text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    } as unknown as Response;
  }

  beforeEach(() => {
    for (const key of envKeys) savedEnv[key] = process.env[key];
    process.env.GOODSFLOW_API_URL = 'https://goodsflow.example';
    process.env.GOODSFLOW_API_KEY = 'test-key';
    process.env.GOODSFLOW_CENTER_CODE = 'CENTER-1';
    process.env.GOODSFLOW_TIMEOUT_MS = '1000';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('undocumented issue idempotency is advertised as unsupported while known-label lookup remains available', () => {
    const provider = new GoodsflowDeliveryProvider();

    expect(provider.capabilities).toEqual({
      issue: { safeToRepeat: false, lookupByIdempotencyKey: false },
      void: { safeToRepeat: false, lookupByServiceId: true },
    });
  });

  it('accepts stable operation context without inventing an undocumented provider idempotency header', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      response(200, {
        service_id: 'GF-SVC-1',
        invoice_number: 'GF-INV-1',
        carrier_code: 'CJ',
      }),
    );
    const provider = new GoodsflowDeliveryProvider();

    await expect(
      provider.issueInvoice(request, { operationId: 'op-1', idempotencyKey: 'stable-key-1' }),
    ).resolves.toEqual({
      serviceId: 'GF-SVC-1',
      invoiceNumber: 'GF-INV-1',
      carrierCode: 'CJ',
    });

    const [, options] = fetchSpy.mock.calls[0];
    expect(options?.headers).not.toHaveProperty('Idempotency-Key');
  });

  it('classifies a definitive 4xx rejection separately from an unknown remote outcome', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response(400, 'invalid recipient'));
    const provider = new GoodsflowDeliveryProvider();

    await expect(provider.issueInvoice(request)).rejects.toMatchObject({
      outcome: 'definitive_rejection',
      details: { provider: 'goodsflow', httpStatus: 400 },
    });
  });

  it.each([
    ['transport failure', () => Promise.reject(new Error('socket reset'))],
    ['provider 503', () => Promise.resolve(response(503, 'temporarily unavailable'))],
  ])('classifies %s as unknown_outcome', async (_label, fetchResult) => {
    jest.spyOn(global, 'fetch').mockImplementation(fetchResult as typeof fetch);
    const provider = new GoodsflowDeliveryProvider();

    await expect(provider.issueInvoice(request)).rejects.toMatchObject({ outcome: 'unknown_outcome' });
  });

  it('does not pretend to support recovery lookup by idempotency key', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const provider = new GoodsflowDeliveryProvider();

    await expect(provider.queryInvoice({ idempotencyKey: 'stable-key-1' })).rejects.toMatchObject({
      outcome: 'unsupported',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('looks up an existing known label through the established tracking endpoint', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      response(200, {
        service_id: 'GF/SVC 1',
        invoice_number: 'GF-INV-1',
        status: 'in_delivery',
        timestamp: '2026-07-15T00:00:00.000Z',
      }),
    );
    const provider = new GoodsflowDeliveryProvider();

    await expect(provider.queryInvoice({ serviceId: 'GF/SVC 1' })).resolves.toMatchObject({
      status: 'found',
      serviceId: 'GF/SVC 1',
      invoiceNumber: 'GF-INV-1',
      tracking: { status: 'in_transit' },
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://goodsflow.example/v1/invoices/GF%2FSVC%201/tracking',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('normalizes a known-label 404 into a not_found query result', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response(404, 'missing'));
    const provider = new GoodsflowDeliveryProvider();

    await expect(provider.queryInvoice({ serviceId: 'GF-SVC-missing' })).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('preserves known-service-id void and handles a successful empty response', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(response(204, ''));
    const provider = new GoodsflowDeliveryProvider();

    await expect(provider.cancelInvoice('GF/SVC 1')).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://goodsflow.example/v1/invoices/GF%2FSVC%201/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects calls with incomplete credentials before network I/O', async () => {
    delete process.env.GOODSFLOW_API_KEY;
    const fetchSpy = jest.spyOn(global, 'fetch');
    const provider = new GoodsflowDeliveryProvider();

    const promise = provider.issueInvoice(request);
    await expect(promise).rejects.toBeInstanceOf(DeliveryProviderError);
    await expect(promise).rejects.toMatchObject({
      outcome: 'definitive_rejection',
      details: { providerCode: 'configuration_error' },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
