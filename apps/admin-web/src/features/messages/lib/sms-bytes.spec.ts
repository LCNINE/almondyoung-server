import { isLongSms, smsByteLength } from './sms-bytes';

describe('smsByteLength', () => {
  it('한글은 2바이트, 영문·숫자는 1바이트로 센다', () => {
    expect(smsByteLength('가a1')).toBe(4);
  });

  it('90바이트를 넘으면 장문이다', () => {
    expect(isLongSms('가'.repeat(45))).toBe(false);
    expect(isLongSms('가'.repeat(46))).toBe(true);
  });
});
