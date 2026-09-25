import { deliveryProfileViolation, requiresDeliveryProfile, type SkuProfileState } from './sku-delivery-profile.rule';
import { SkuDeliveryProfileNotFoundError, SkuDeliveryProfileRequiredError } from './sku-catalog.errors';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const s = (stockType: SkuProfileState['stockType'], deliveryProfileId: string | null): SkuProfileState => ({
  stockType,
  deliveryProfileId,
});

describe('requiresDeliveryProfile', () => {
  it.each([
    ['physical', true],
    ['consignment', true],
    ['drop_shipped', false],
    ['infinite', false],
  ] as const)('%s → %s', (stockType, expected) => {
    expect(requiresDeliveryProfile(stockType)).toBe(expected);
  });
});

describe('deliveryProfileViolation — 생성(before=null)', () => {
  it('physical·consignment 는 프로필 없으면 위반', () => {
    expect(deliveryProfileViolation(null, s('physical', null))).toBe('SKU_DELIVERY_PROFILE_REQUIRED');
    expect(deliveryProfileViolation(null, s('consignment', null))).toBe('SKU_DELIVERY_PROFILE_REQUIRED');
  });
  it('프로필이 있으면 통과', () => {
    expect(deliveryProfileViolation(null, s('physical', P1))).toBeNull();
  });
  it('drop_shipped·infinite 는 프로필 없어도 통과', () => {
    expect(deliveryProfileViolation(null, s('drop_shipped', null))).toBeNull();
    expect(deliveryProfileViolation(null, s('infinite', null))).toBeNull();
  });
});

describe('deliveryProfileViolation — 수정(값 변화 기준)', () => {
  // admin-web 수정 폼은 stockType 을 항상 보낸다. 값이 그대로면 옛 SKU 도 통과해야 한다.
  it('재고 유형·프로필이 그대로면 프로필 없는 옛 physical SKU 도 통과', () => {
    expect(deliveryProfileViolation(s('physical', null), s('physical', null))).toBeNull();
  });
  it('physical SKU 의 프로필을 지우면 위반', () => {
    expect(deliveryProfileViolation(s('physical', P1), s('physical', null))).toBe('SKU_DELIVERY_PROFILE_REQUIRED');
  });
  it('drop_shipped → physical 로 바꾸면서 프로필 없으면 위반', () => {
    expect(deliveryProfileViolation(s('drop_shipped', null), s('physical', null))).toBe(
      'SKU_DELIVERY_PROFILE_REQUIRED',
    );
  });
  it('drop_shipped → physical 로 바꾸면서 프로필을 주면 통과', () => {
    expect(deliveryProfileViolation(s('drop_shipped', null), s('physical', P1))).toBeNull();
  });
  it('프로필을 다른 것으로 바꾸는 건 통과', () => {
    expect(deliveryProfileViolation(s('physical', P1), s('physical', P2))).toBeNull();
  });
  it('physical → drop_shipped 로 바꾸며 프로필을 지우는 건 통과', () => {
    expect(deliveryProfileViolation(s('physical', P1), s('drop_shipped', null))).toBeNull();
  });
});

describe('에러', () => {
  it('코드와 상태', () => {
    const required = new SkuDeliveryProfileRequiredError('x');
    expect(required.getErrorCode()).toBe('SKU_DELIVERY_PROFILE_REQUIRED');
    expect(required.getHttpStatus()).toBe(400);
    const notFound = new SkuDeliveryProfileNotFoundError('x');
    expect(notFound.getErrorCode()).toBe('SKU_DELIVERY_PROFILE_NOT_FOUND');
    expect(notFound.getHttpStatus()).toBe(400);
  });
});
