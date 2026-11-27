import { skuSearchEmptyMessage, skuSearchIgnored } from './sku-search';

describe('skuSearchIgnored', () => {
  it('검색어가 없으면 서버 응답을 그대로 믿는다', () => {
    expect(skuSearchIgnored(undefined, {})).toBe(false);
  });

  it('서버가 같은 검색어를 돌려주면 적용된 것이다', () => {
    expect(skuSearchIgnored('880900000027', { q: '880900000027' })).toBe(false);
  });

  it('서버가 검색어를 돌려주지 않으면 무시된 것이다', () => {
    expect(skuSearchIgnored('880900000027', {})).toBe(true);
  });

  it('서버가 다른 검색어를 돌려주면 무시된 것으로 본다', () => {
    expect(skuSearchIgnored('A', { q: '' })).toBe(true);
  });
});

describe('skuSearchEmptyMessage', () => {
  it('검색어가 있으면 어떤 값으로 찾는지 알려 준다', () => {
    expect(skuSearchEmptyMessage('8809')).toContain('바코드는 전체 번호');
  });

  it('검색어가 없으면 기존 문구', () => {
    expect(skuSearchEmptyMessage(undefined)).toBe('SKU 데이터가 없습니다.');
  });
});
