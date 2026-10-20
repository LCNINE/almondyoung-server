import { maskPiiValue } from './mask';

describe('maskPiiValue', () => {
  it('masks a Korean name keeping first and last', () => {
    expect(maskPiiValue('name', '홍길동')).toBe('홍*동');
    expect(maskPiiValue('name', '남궁민수')).toBe('남**수');
    expect(maskPiiValue('name', '홍길')).toBe('홍*');
    expect(maskPiiValue('name', '김')).toBe('*');
    expect(maskPiiValue('name', ' 홍길동 ')).toBe('홍*동');
  });

  it('masks every phone digit except the first three and the last four', () => {
    expect(maskPiiValue('phone', '010-1234-5678')).toBe('010-****-5678');
    expect(maskPiiValue('phone', '01012345678')).toBe('010****5678');
    expect(maskPiiValue('phone', '02-123-4567')).toBe('02-1**-4567');
    expect(maskPiiValue('phone', '+82 10-1234-5678')).toBe('+82 1*-****-5678');
  });

  it('masks a short phone number entirely', () => {
    expect(maskPiiValue('phone', '1234567')).toBe('*******');
  });

  it('keeps two characters of an email local part', () => {
    expect(maskPiiValue('email', 'abcdef@x.com')).toBe('ab***@x.com');
    expect(maskPiiValue('email', 'a@x.com')).toBe('a***@x.com');
    expect(maskPiiValue('email', 'no-at-sign')).toBe('no***');
  });

  it('keeps an address up to the district', () => {
    expect(maskPiiValue('address', '서울특별시 송파구 중대로 135 101동')).toBe('서울특별시 송파구 …');
    expect(maskPiiValue('address', '서울 송파구')).toBe('서울 …');
    expect(maskPiiValue('address', '중대로135')).toBe('…');
  });

  it('hides a postal code', () => {
    expect(maskPiiValue('postal', '05510')).toBe('*****');
  });

  it('keeps the last four digits of an account', () => {
    expect(maskPiiValue('account', '110-123-456789')).toBe('****6789');
    expect(maskPiiValue('account', '12')).toBe('****');
  });

  it('replaces secrets and free text', () => {
    expect(maskPiiValue('secret', '1234#')).toBe('[가림]');
    expect(maskPiiValue('text', '문 앞에 두세요 010-1234-5678')).toBe('[가림]');
  });

  it('leaves an empty string empty', () => {
    expect(maskPiiValue('name', '')).toBe('');
    expect(maskPiiValue('text', '   ')).toBe('   ');
  });
});
