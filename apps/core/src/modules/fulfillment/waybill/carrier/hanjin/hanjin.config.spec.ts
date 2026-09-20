import { loadHanjinConfig, isHanjinConfigured, missingHanjinConfig } from './hanjin.config';

// insert-order(정본 §4.2)가 실제로 요구하는 최소 집합. 여기서 하나를 빼면 게이트가 false 여야 한다 —
// 통과시키면 한진이 ERROR-01 로 거절하고, 그 거절은 되돌릴 수 없는 waybill `failed` 로 기록된다.
const FULL_ENV = {
  HANJIN_CLIENT_ID: 'EDI',
  HANJIN_API_KEY: 'k',
  HANJIN_SECRET_KEY: 's',
  HANJIN_CONTRACT_NO: '9117159',
  HANJIN_ORDER_BASE_URL: 'https://api-stg.hanjin.com',
  HANJIN_PRINT_BASE_URL: 'https://ebbapd.hjt.co.kr',
  HANJIN_SENDER_NAME: '아몬드영 부천센터',
  HANJIN_SENDER_ZIP: '08588',
  HANJIN_SENDER_BASE_ADDR: '서울 금천구 가산디지털1로 1',
  HANJIN_SENDER_DTL_ADDR: '3층',
  HANJIN_SENDER_TEL: '02-100-2000',
} as NodeJS.ProcessEnv;

const configWith = (overrides: NodeJS.ProcessEnv = {}) => loadHanjinConfig({ ...FULL_ENV, ...overrides });

describe('hanjin.config', () => {
  it('필수 키가 모두 있으면 isHanjinConfigured=true', () => {
    const c = configWith();
    expect(isHanjinConfigured(c)).toBe(true);
    expect(c.boxType).toBe('A'); // 기본값
    expect(c.payType).toBe('PP');
    expect(c.timeoutMs).toBe(15000);
  });

  it('secretKey 누락 시 isHanjinConfigured=false', () => {
    const c = loadHanjinConfig({ HANJIN_CLIENT_ID: 'EDI', HANJIN_API_KEY: 'k' } as NodeJS.ProcessEnv);
    expect(isHanjinConfigured(c)).toBe(false);
  });

  // #912 — sndrZip · sndrBaseAddr · sndrDtlAddr · sndrNm · sndrTelNo 는 정본 §4.2 의 필수 항목이다.
  describe('송하인 필수 5필드', () => {
    it.each([
      ['HANJIN_SENDER_NAME'],
      ['HANJIN_SENDER_ZIP'],
      ['HANJIN_SENDER_BASE_ADDR'],
      ['HANJIN_SENDER_DTL_ADDR'],
      ['HANJIN_SENDER_TEL'],
    ])('%s 가 비면 isHanjinConfigured=false', (key) => {
      expect(isHanjinConfigured(configWith({ [key]: '' }))).toBe(false);
    });

    it('공백만 채워도 통과하지 않는다', () => {
      expect(isHanjinConfigured(configWith({ HANJIN_SENDER_TEL: '   ' }))).toBe(false);
    });
  });

  // #912 — 허용값 밖이면 한진이 ERROR-10(지불조건) / ERROR-11(박스타입) 로 거절한다.
  describe('boxTypCd / payTypCd 허용값', () => {
    it('허용값 밖의 boxType 은 isHanjinConfigured=false', () => {
      expect(isHanjinConfigured(configWith({ HANJIN_BOX_TYPE: 'X' }))).toBe(false);
    });

    it('허용값 밖의 payType 은 isHanjinConfigured=false', () => {
      expect(isHanjinConfigured(configWith({ HANJIN_PAY_TYPE: 'XX' }))).toBe(false);
    });

    it.each([['S'], ['A'], ['B'], ['C'], ['D'], ['E']])('boxType %s 는 허용된다', (v) => {
      expect(isHanjinConfigured(configWith({ HANJIN_BOX_TYPE: v }))).toBe(true);
    });

    it.each([['CD'], ['CT'], ['PP'], ['CC']])('payType %s 는 허용된다', (v) => {
      expect(isHanjinConfigured(configWith({ HANJIN_PAY_TYPE: v }))).toBe(true);
    });
  });

  // 게이트가 넓어진 만큼 «무엇이 비었는지»를 말할 수 있어야 한다 — 스모크가 SKIP 할 때
  // 「HANJIN_* 미설정」 한 줄만 찍으면 운영자가 엉뚱한 키를 쫓는다.
  describe('missingHanjinConfig', () => {
    it('다 채워져 있으면 빈 배열', () => {
      expect(missingHanjinConfig(configWith())).toEqual([]);
    });

    it('비어 있는 env 키 이름을 돌려준다', () => {
      expect(missingHanjinConfig(configWith({ HANJIN_SENDER_DTL_ADDR: '', HANJIN_API_KEY: '' }))).toEqual([
        'HANJIN_API_KEY',
        'HANJIN_SENDER_DTL_ADDR',
      ]);
    });

    it('허용값 밖의 코드도 이름으로 보고한다', () => {
      expect(missingHanjinConfig(configWith({ HANJIN_PAY_TYPE: 'XX' }))).toEqual(['HANJIN_PAY_TYPE']);
    });

    it('isHanjinConfigured 와 항상 일치한다', () => {
      for (const env of [{}, { HANJIN_SENDER_TEL: '' }, { HANJIN_BOX_TYPE: 'X' }]) {
        const c = configWith(env);
        expect(isHanjinConfigured(c)).toBe(missingHanjinConfig(c).length === 0);
      }
    });
  });
});
