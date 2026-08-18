import {
  CATALOG_SEGMENT_HEADER,
  CATALOG_SEGMENT_KEY_HEADER,
  catalogSegmentPricingMiddleware,
  getAppliedCatalogSegment,
} from '../catalog-segment';

const SECRET = 'shared-secret';
const GROUP = 'cusgroup_test';

const makeReq = (headers: Record<string, string> = {}, pricingContext?: Record<string, unknown>) =>
  ({ headers, ...(pricingContext ? { pricingContext } : {}) }) as any;

const makeRes = () => {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res as any;
};

const withSegment = (segment: string, key: string = SECRET) => ({
  [CATALOG_SEGMENT_HEADER]: segment,
  [CATALOG_SEGMENT_KEY_HEADER]: key,
});

describe('catalogSegmentPricingMiddleware', () => {
  beforeEach(() => {
    process.env.CATALOG_SEGMENT_SECRET = SECRET;
    process.env.MEDUSA_MEMBERSHIP_GROUP_ID = GROUP;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.CATALOG_SEGMENT_SECRET;
    delete process.env.MEDUSA_MEMBERSHIP_GROUP_ID;
    jest.restoreAllMocks();
  });

  it('회원 세그먼트는 멤버십 그룹으로 가격을 계산하게 한다', () => {
    const req = makeReq(withSegment('mem'), { region_id: 'reg_1', currency_code: 'krw' });
    const next = jest.fn();

    catalogSegmentPricingMiddleware(req, makeRes(), next);

    expect(req.pricingContext).toEqual({
      region_id: 'reg_1',
      currency_code: 'krw',
      customer: { groups: [{ id: GROUP }] },
    });
    expect(getAppliedCatalogSegment(req)).toBe('mem');
    expect(next).toHaveBeenCalled();
  });

  it('코어가 채운 region/currency 를 지우지 않는다', () => {
    const req = makeReq(withSegment('mem'), { region_id: 'reg_1', currency_code: 'krw' });

    catalogSegmentPricingMiddleware(req, makeRes(), jest.fn());

    expect(req.pricingContext.region_id).toBe('reg_1');
    expect(req.pricingContext.currency_code).toBe('krw');
  });

  it('비회원 세그먼트는 가격 컨텍스트를 건드리지 않는다', () => {
    // `customer: { groups: [] }` 를 넣으면 익명 요청과 컨텍스트 해시가 달라져
    // Medusa 쿼리 캐시에 같은 응답이 두 벌 잡힌다.
    const req = makeReq(withSegment('reg'), { region_id: 'reg_1' });

    catalogSegmentPricingMiddleware(req, makeRes(), jest.fn());

    expect(req.pricingContext).toEqual({ region_id: 'reg_1' });
    expect(getAppliedCatalogSegment(req)).toBe('reg');
  });

  it('컨텍스트가 아직 없는 라우트에서도 reg 은 컨텍스트를 만들지 않는다', () => {
    const req = makeReq(withSegment('reg'));

    catalogSegmentPricingMiddleware(req, makeRes(), jest.fn());

    expect(req.pricingContext).toBeUndefined();
  });

  it('멤버십 그룹 id 가 없으면 mem 을 적용하지도 표시하지도 않는다', () => {
    // 표시만 서고 가격은 비회원가인 반쪽 응답이 회원 칸에 캐시되는 걸 막는다.
    delete process.env.MEDUSA_MEMBERSHIP_GROUP_ID;
    const req = makeReq(withSegment('mem'), { currency_code: 'krw' });
    const next = jest.fn();

    catalogSegmentPricingMiddleware(req, makeRes(), next);

    expect(getAppliedCatalogSegment(req)).toBeUndefined();
    expect(req.pricingContext).toEqual({ currency_code: 'krw' });
    expect(next).toHaveBeenCalled();
  });

  it('시크릿이 틀리면 400 으로 막는다', () => {
    const req = makeReq(withSegment('mem', 'forged'), { region_id: 'reg_1' });
    const res = makeRes();
    const next = jest.fn();

    catalogSegmentPricingMiddleware(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
    expect(req.pricingContext).toEqual({ region_id: 'reg_1' });
    expect(getAppliedCatalogSegment(req)).toBeUndefined();
  });

  it('서버에 시크릿이 없는데 세그먼트 키가 오면 400 으로 막는다', () => {
    // 한쪽만 배포된 구간. 조용히 비회원 응답을 주면 그게 회원 칸에 캐시된다.
    delete process.env.CATALOG_SEGMENT_SECRET;
    const req = makeReq(withSegment('mem'));
    const res = makeRes();

    catalogSegmentPricingMiddleware(req, res, jest.fn());

    expect(res.statusCode).toBe(400);
  });

  it('토큰과 세그먼트를 같이 보내면 400 으로 막는다', () => {
    const req = makeReq({ ...withSegment('mem'), authorization: 'Bearer x' });
    const res = makeRes();
    const next = jest.fn();

    catalogSegmentPricingMiddleware(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('세그먼트 키 없이 주장만 하면 무시하고 토큰 판정으로 떨어진다', () => {
    const req = makeReq({ [CATALOG_SEGMENT_HEADER]: 'mem' }, { region_id: 'reg_1' });
    const next = jest.fn();

    catalogSegmentPricingMiddleware(req, makeRes(), next);

    expect(getAppliedCatalogSegment(req)).toBeUndefined();
    expect(req.pricingContext).toEqual({ region_id: 'reg_1' });
    expect(next).toHaveBeenCalled();
  });

  it('알 수 없는 세그먼트 값은 적용하지 않는다', () => {
    const req = makeReq(withSegment('admin'));

    catalogSegmentPricingMiddleware(req, makeRes(), jest.fn());

    expect(getAppliedCatalogSegment(req)).toBeUndefined();
  });

  it('세그먼트를 안 보낸 요청은 그대로 통과시킨다', () => {
    const req = makeReq({}, { region_id: 'reg_1' });
    const next = jest.fn();

    catalogSegmentPricingMiddleware(req, makeRes(), next);

    expect(getAppliedCatalogSegment(req)).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});
