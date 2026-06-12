import { ServiceUnavailableException } from '@nestjs/common';
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

  it('env 미설정 시 발행 호출은 ServiceUnavailableException (계약 승인 전 가드)', async () => {
    const provider = new HanjinDeliveryProvider();

    await expect(
      provider.issueInvoice({
        centerCode: '',
        recipientName: '홍길동',
        recipientAddress: '서울시 강남구',
        recipientPhone: '010-1234-5678',
        carrierCode: 'HANJIN',
        items: [],
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('필수 env 3종이 모두 있으면 isConfigured() = true', () => {
    process.env.HANJIN_API_URL = 'https://api.hanjin.example';
    process.env.HANJIN_API_KEY = 'test-key';
    process.env.HANJIN_CUSTOMER_CODE = 'TEST01';

    const provider = new HanjinDeliveryProvider();
    expect(provider.isConfigured()).toBe(true);
  });
});
