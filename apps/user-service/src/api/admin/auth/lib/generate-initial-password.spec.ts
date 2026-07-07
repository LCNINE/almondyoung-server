import { generateInitialPassword } from './generate-initial-password';

const POLICY = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).+$/;

describe('generateInitialPassword', () => {
  it('16자 이상이고 비번 정책(영문+숫자+특수문자)을 만족한다', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateInitialPassword();
      expect(pw.length).toBeGreaterThanOrEqual(16);
      expect(pw.length).toBeLessThanOrEqual(20);
      expect(POLICY.test(pw)).toBe(true);
    }
  });

  it('호출마다 다른 값을 만든다', () => {
    const a = generateInitialPassword();
    const b = generateInitialPassword();
    expect(a).not.toEqual(b);
  });
});
