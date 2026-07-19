import { CMS_BANK_CODES, isValidCmsBankCode } from './cms-banks';

describe('isValidCmsBankCode', () => {
  it('accepts supported CMS bank codes', () => {
    expect(isValidCmsBankCode('004')).toBe(true); // 국민
    expect(isValidCmsBankCode('088')).toBe(true); // 신한
    expect(isValidCmsBankCode('090')).toBe(true); // 카카오뱅크
  });

  it('rejects unknown or malformed codes', () => {
    expect(isValidCmsBankCode('999')).toBe(false);
    expect(isValidCmsBankCode('04')).toBe(false);
    expect(isValidCmsBankCode('abc')).toBe(false);
    expect(isValidCmsBankCode('')).toBe(false);
  });

  it('mirrors the wallet-web CMS bank list size (keep both in sync)', () => {
    expect(CMS_BANK_CODES.size).toBe(22);
  });
});
