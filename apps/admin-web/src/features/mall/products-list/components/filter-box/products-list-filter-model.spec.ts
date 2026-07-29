import {
  CLASSIFICATION_OPTIONS,
  classificationFromParams,
  classificationToParams,
} from './products-list-filter-model';

describe('products-list 분류 필터', () => {
  it('모든 분류가 파라미터 왕복을 견딘다', () => {
    for (const { value } of CLASSIFICATION_OPTIONS) {
      const params = classificationToParams(value);
      expect(classificationFromParams(params.status, params.stock)).toBe(value);
    }
  });

  it('품절/부분품절은 판매중 조건을 함께 싣는다', () => {
    expect(classificationToParams('sold_out')).toEqual({
      status: 'active',
      stock: 'sold_out',
    });
    expect(classificationToParams('partial')).toEqual({
      status: 'active',
      stock: 'partial',
    });
  });

  it('재고 조건이 판매 상태보다 우선한다', () => {
    expect(classificationFromParams('active', 'sold_out')).toBe('sold_out');
    expect(classificationFromParams('active', null)).toBe('active');
  });

  it('알 수 없는 값은 전체로 떨어진다', () => {
    expect(classificationFromParams('bogus', 'nonsense')).toBe('all');
    expect(classificationFromParams(undefined, undefined)).toBe('all');
  });
});
