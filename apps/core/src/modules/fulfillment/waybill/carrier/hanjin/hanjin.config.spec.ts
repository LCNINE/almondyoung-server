import { loadHanjinConfig, isHanjinConfigured } from './hanjin.config';

describe('hanjin.config', () => {
  it('필수 키가 모두 있으면 isHanjinConfigured=true', () => {
    const c = loadHanjinConfig({
      HANJIN_CLIENT_ID: 'EDI',
      HANJIN_API_KEY: 'k',
      HANJIN_SECRET_KEY: 's',
      HANJIN_CONTRACT_NO: '9117159',
      HANJIN_ORDER_BASE_URL: 'https://api-stg.hanjin.com',
      HANJIN_PRINT_BASE_URL: 'https://ebbapd.hjt.co.kr',
    } as NodeJS.ProcessEnv);
    expect(isHanjinConfigured(c)).toBe(true);
    expect(c.boxType).toBe('A'); // 기본값
    expect(c.payType).toBe('PP');
    expect(c.timeoutMs).toBe(15000);
  });

  it('secretKey 누락 시 isHanjinConfigured=false', () => {
    const c = loadHanjinConfig({ HANJIN_CLIENT_ID: 'EDI', HANJIN_API_KEY: 'k' } as NodeJS.ProcessEnv);
    expect(isHanjinConfigured(c)).toBe(false);
  });
});
