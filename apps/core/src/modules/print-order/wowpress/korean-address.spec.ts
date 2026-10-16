import { splitKoreanAddress } from './korean-address';

describe('splitKoreanAddress', () => {
  it.each([
    ['서울특별시 강남구 테헤란로 152', { sd: '서울', sgg: '강남구', umd: '테헤란로' }],
    ['경기도 성남시 분당구 판교역로 235', { sd: '경기', sgg: '성남시 분당구', umd: '판교역로' }],
    ['세종특별자치시 한누리대로 2130', { sd: '세종', sgg: '세종시', umd: '한누리대로' }],
    ['대구 달서구 월배로5길 76', { sd: '대구', sgg: '달서구', umd: '월배로5길' }],
    ['강원특별자치도 춘천시 중앙로 1', { sd: '강원', sgg: '춘천시', umd: '중앙로' }],
    ['  충청북도   청주시 상당구  상당로 82 ', { sd: '충북', sgg: '청주시 상당구', umd: '상당로' }],
  ])('%s', (input, expected) => {
    expect(splitKoreanAddress(input)).toEqual(expected);
  });

  it('throws on an unknown 시·도', () => {
    expect(() => splitKoreanAddress('어딘가 강남구 테헤란로 1')).toThrow('어딘가');
  });

  it('throws when the address has no road part', () => {
    expect(() => splitKoreanAddress('서울특별시 강남구')).toThrow();
  });
});
