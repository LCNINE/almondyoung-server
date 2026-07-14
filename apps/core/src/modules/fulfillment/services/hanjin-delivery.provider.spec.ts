import { DeliveryProviderError } from './delivery-provider.interface';
import { HanjinDeliveryProvider } from './hanjin-delivery.provider';

describe('HanjinDeliveryProvider', () => {
  const HANJIN_ENV_KEYS = [
    'HANJIN_API_URL',
    'HANJIN_API_KEY',
    'HANJIN_CUSTOMER_CODE',
    'HANJIN_SENDER_CODE',
    'HANJIN_PICKUP_SITE_CODE',
    'HANJIN_SENDER_NAME',
    'HANJIN_SENDER_PHONE',
    'HANJIN_TIMEOUT_MS',
  ];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of HANJIN_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of HANJIN_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('env 미설정 시 isConfigured() = false', () => {
    const provider = new HanjinDeliveryProvider();
    expect(provider.isConfigured()).toBe(false);
  });

  it('공식 계약 미확정 상태에서는 normalized unsupported 오류로 fail-closed 한다', async () => {
    const provider = new HanjinDeliveryProvider();

    const promise = provider.issueInvoice({
      centerCode: '',
      recipientName: '홍길동',
      recipientAddress: '서울시 강남구',
      recipientPhone: '010-1234-5678',
      carrierCode: 'HANJIN',
      items: [],
    });

    await expect(promise).rejects.toBeInstanceOf(DeliveryProviderError);
    await expect(promise).rejects.toMatchObject({ outcome: 'unsupported' });
  });

  it('credential 3종이 있어도 계약 검증 전에는 실행 가능 상태로 광고하지 않는다', async () => {
    process.env.HANJIN_API_URL = 'https://api.hanjin.example';
    process.env.HANJIN_API_KEY = 'test-key';
    process.env.HANJIN_CUSTOMER_CODE = 'TEST01';
    const fetchSpy = jest.spyOn(global, 'fetch');

    const provider = new HanjinDeliveryProvider();
    expect(provider.hasCredentials()).toBe(true);
    expect(provider.isConfigured()).toBe(false);
    expect(provider.capabilities).toEqual({
      issue: { safeToRepeat: false, lookupByIdempotencyKey: false },
      void: { safeToRepeat: false, lookupByServiceId: false },
    });

    await expect(
      provider.issueInvoice({
        centerCode: '',
        recipientName: '홍길동',
        recipientAddress: '서울시 강남구',
        recipientPhone: '010-1234-5678',
        carrierCode: 'HANJIN',
        items: [],
      }),
    ).rejects.toMatchObject({ outcome: 'unsupported' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
