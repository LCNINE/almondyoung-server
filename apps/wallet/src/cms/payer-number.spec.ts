import {
  isValidBirthDateYYMMDD,
  isValidBusinessRegistrationNumber,
  isValidPayerNumber,
} from './payer-number';

describe('isValidBusinessRegistrationNumber', () => {
  it('accepts checksum-valid business numbers', () => {
    expect(isValidBusinessRegistrationNumber('2088162517')).toBe(true);
    expect(isValidBusinessRegistrationNumber('1234567891')).toBe(true);
  });

  it('rejects a single-digit typo that breaks the checksum', () => {
    expect(isValidBusinessRegistrationNumber('2088162518')).toBe(false);
    expect(isValidBusinessRegistrationNumber('1234567890')).toBe(false);
  });

  it('rejects wrong-length or non-numeric input', () => {
    expect(isValidBusinessRegistrationNumber('208816251')).toBe(false);
    expect(isValidBusinessRegistrationNumber('20881625170')).toBe(false);
    expect(isValidBusinessRegistrationNumber('20881a2517')).toBe(false);
  });
});

describe('isValidBirthDateYYMMDD', () => {
  it('accepts valid dates', () => {
    expect(isValidBirthDateYYMMDD('000326')).toBe(true); // 유태림 케이스: 형식은 유효
    expect(isValidBirthDateYYMMDD('991231')).toBe(true);
    expect(isValidBirthDateYYMMDD('000229')).toBe(true); // 세기 미상 → 2/29 허용
  });

  it('rejects out-of-range month or day', () => {
    expect(isValidBirthDateYYMMDD('001301')).toBe(false); // 13월
    expect(isValidBirthDateYYMMDD('000001')).toBe(false); // 0월
    expect(isValidBirthDateYYMMDD('000230')).toBe(false); // 2/30
    expect(isValidBirthDateYYMMDD('000431')).toBe(false); // 4/31
    expect(isValidBirthDateYYMMDD('000300')).toBe(false); // 0일
  });

  it('rejects wrong length', () => {
    expect(isValidBirthDateYYMMDD('00032')).toBe(false);
    expect(isValidBirthDateYYMMDD('0003261')).toBe(false);
  });
});

describe('isValidPayerNumber', () => {
  it('routes 6 digits to birthdate and 10 digits to business number', () => {
    expect(isValidPayerNumber('000326')).toBe(true);
    expect(isValidPayerNumber('2088162517')).toBe(true);
    expect(isValidPayerNumber('001301')).toBe(false);
    expect(isValidPayerNumber('2088162518')).toBe(false);
  });

  it('rejects any other length', () => {
    expect(isValidPayerNumber('12345')).toBe(false);
    expect(isValidPayerNumber('12345678')).toBe(false);
    expect(isValidPayerNumber('')).toBe(false);
  });
});
