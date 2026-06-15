import { getBreadcrumbItems } from './breadcrumb-items';

describe('admin breadcrumb items', () => {
  it('labels mall product pages as product management', () => {
    expect(getBreadcrumbItems('/mall/products-list').map((item) => item.label)).toEqual([
      '홈',
      '상품관리',
      '상품 목록',
    ]);
    expect(getBreadcrumbItems('/mall/products-list/master-1').map((item) => item.label)).toEqual([
      '홈',
      '상품관리',
      '상품 목록',
    ]);
    expect(getBreadcrumbItems('/mall/pricing/master-1').map((item) => item.label)).toEqual([
      '홈',
      '상품관리',
      '가격 관리',
    ]);
  });

  it('labels inventory pages as inventory management', () => {
    expect(getBreadcrumbItems('/inventory/status').map((item) => item.label)).toEqual([
      '홈',
      '재고관리',
      '재고 현황',
    ]);
  });

  it('keeps mall marketing pages under own mall management', () => {
    expect(getBreadcrumbItems('/mall/marketing/coupons').map((item) => item.label)).toEqual([
      '홈',
      '자사몰 관리',
    ]);
  });
});
