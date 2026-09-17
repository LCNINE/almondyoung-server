import { positiveNumberEnv, urlEnv } from './env';

describe('숫자 env', () => {
  afterEach(() => {
    delete process.env.TEST_NUM;
  });

  it('값이 없으면 기본값', () => {
    expect(positiveNumberEnv('TEST_NUM', 6)).toBe(6);
  });

  // `??` 로 기본값을 주던 때의 버그. 템플릿이 값 없는 키를 이렇게 남긴다.
  it('있지만 빈 문자열이면 0 이 아니라 기본값', () => {
    process.env.TEST_NUM = '';
    expect(positiveNumberEnv('TEST_NUM', 6)).toBe(6);
  });

  it('숫자가 아니거나 0 이하면 기본값', () => {
    process.env.TEST_NUM = 'abc';
    expect(positiveNumberEnv('TEST_NUM', 6)).toBe(6);
    process.env.TEST_NUM = '0';
    expect(positiveNumberEnv('TEST_NUM', 6)).toBe(6);
  });

  it('정상 값은 그대로', () => {
    process.env.TEST_NUM = '12';
    expect(positiveNumberEnv('TEST_NUM', 6)).toBe(12);
  });
});

describe('URL env', () => {
  afterEach(() => {
    delete process.env.TEST_URL;
  });

  it('빈 문자열이면 기본값, 뒤 슬래시는 뗀다', () => {
    process.env.TEST_URL = '';
    expect(urlEnv('TEST_URL', 'http://localhost:3100')).toBe('http://localhost:3100');
    process.env.TEST_URL = 'http://core/';
    expect(urlEnv('TEST_URL', 'http://localhost:3100')).toBe('http://core');
  });
});
