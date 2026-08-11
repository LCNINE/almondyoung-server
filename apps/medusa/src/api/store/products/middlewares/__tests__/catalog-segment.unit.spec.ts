import {
  CATALOG_SEGMENT_HEADER,
  CATALOG_SEGMENT_KEY_HEADER,
  CATALOG_SEGMENT_STATE,
  catalogSegmentPricingMiddleware,
  resolveTrustedCatalogSegment,
} from '../catalog-segment';

const SECRET = 'shared-secret';
const GROUP = 'cusgroup_test';

const makeReq = (headers: Record<string, string> = {}, pricingContext?: Record<string, unknown>) =>
  ({ headers, ...(pricingContext ? { pricingContext } : {}) }) as any;

const withSegment = (segment: string, key: string = SECRET) => ({
  [CATALOG_SEGMENT_HEADER]: segment,
  [CATALOG_SEGMENT_KEY_HEADER]: key,
});

describe('resolveTrustedCatalogSegment', () => {
  beforeEach(() => {
    process.env.CATALOG_SEGMENT_SECRET = SECRET;
    process.env.MEDUSA_MEMBERSHIP_GROUP_ID = GROUP;
  });

  afterEach(() => {
    delete process.env.CATALOG_SEGMENT_SECRET;
    delete process.env.MEDUSA_MEMBERSHIP_GROUP_ID;
  });

  it('시크릿이 맞으면 세그먼트를 받아들인다', () => {
    expect(resolveTrustedCatalogSegment(makeReq(withSegment('mem')))).toBe('mem');
    expect(resolveTrustedCatalogSegment(makeReq(withSegment('reg')))).toBe('reg');
  });

  it('시크릿이 틀리면 세그먼트를 무시한다', () => {
    expect(resolveTrustedCatalogSegment(makeReq(withSegment('mem', 'wrong')))).toBeNull();
  });

  it('시크릿 헤더가 없으면 세그먼트를 무시한다', () => {
    expect(resolveTrustedCatalogSegment(makeReq({ [CATALOG_SEGMENT_HEADER]: 'mem' }))).toBeNull();
  });

  it('서버에 시크릿이 설정돼 있지 않으면 아무 세그먼트도 신뢰하지 않는다', () => {
    delete process.env.CATALOG_SEGMENT_SECRET;

    expect(resolveTrustedCatalogSegment(makeReq(withSegment('mem')))).toBeNull();
  });

  it('알 수 없는 세그먼트 값은 받아들이지 않는다', () => {
    expect(resolveTrustedCatalogSegment(makeReq(withSegment('admin')))).toBeNull();
  });
});

describe('catalogSegmentPricingMiddleware', () => {
  beforeEach(() => {
    process.env.CATALOG_SEGMENT_SECRET = SECRET;
    process.env.MEDUSA_MEMBERSHIP_GROUP_ID = GROUP;
  });

  afterEach(() => {
    delete process.env.CATALOG_SEGMENT_SECRET;
    delete process.env.MEDUSA_MEMBERSHIP_GROUP_ID;
  });

  it('회원 세그먼트는 멤버십 그룹으로 가격을 계산하게 한다', () => {
    const req = makeReq(withSegment('mem'), { region_id: 'reg_1', currency_code: 'krw' });
    const next = jest.fn();

    catalogSegmentPricingMiddleware(req, {} as any, next);

    expect(req.pricingContext).toEqual({
      region_id: 'reg_1',
      currency_code: 'krw',
      customer: { groups: [{ id: GROUP }] },
    });
    expect(req[CATALOG_SEGMENT_STATE]).toBe(true);
    expect(next).toHaveBeenCalled();
  });

  it('비회원 세그먼트는 그룹을 비워 비회원가로 계산하게 한다', () => {
    const req = makeReq(withSegment('reg'), { region_id: 'reg_1' });

    catalogSegmentPricingMiddleware(req, {} as any, jest.fn());

    expect(req.pricingContext.customer).toEqual({ groups: [] });
    expect(req[CATALOG_SEGMENT_STATE]).toBe(false);
  });

  it('위조된 회원 세그먼트는 가격 컨텍스트를 건드리지 못한다', () => {
    const req = makeReq(withSegment('mem', 'forged'), { region_id: 'reg_1' });

    catalogSegmentPricingMiddleware(req, {} as any, jest.fn());

    expect(req.pricingContext).toEqual({ region_id: 'reg_1' });
    expect(req[CATALOG_SEGMENT_STATE]).toBeUndefined();
  });

  it('코어가 채운 region/currency 를 지우지 않는다', () => {
    const req = makeReq(withSegment('mem'), { region_id: 'reg_1', currency_code: 'krw' });

    catalogSegmentPricingMiddleware(req, {} as any, jest.fn());

    expect(req.pricingContext.region_id).toBe('reg_1');
    expect(req.pricingContext.currency_code).toBe('krw');
  });
});
