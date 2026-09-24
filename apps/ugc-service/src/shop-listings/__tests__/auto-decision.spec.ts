import {
  autoDecisionPolicyFromEnv,
  classifySafely,
  decide,
  type AutoDecisionPolicy,
} from '../classifier/auto-decision';
import {
  NullShopListingClassifier,
  type ShopListingClassifier,
  type ShopListingClassifierInput,
} from '../classifier/shop-listing-classifier';

const ON: AutoDecisionPolicy = { enabled: true, approveThreshold: 0.9, rejectThreshold: 0.8 };
const OFF: AutoDecisionPolicy = { ...ON, enabled: false };

const INPUT: ShopListingClassifierInput = {
  title: '강남 네일샵 양도',
  content: '본문',
  region: 'seoul',
  businessType: 'nail',
  dealType: 'transfer',
  deposit: null,
  monthlyRent: null,
  keyMoney: null,
};

describe('decide', () => {
  it.each([
    ['shop_listing', 0.9, 'published'],
    ['shop_listing', 0.89, 'pending'],
    ['not_shop_listing', 0.8, 'rejected'],
    ['not_shop_listing', 0.79, 'pending'],
  ] as const)('%s @ %s → %s', (label, confidence, expected) => {
    expect(decide({ label, confidence }, ON)).toBe(expected);
  });

  it('결과가 없으면 pending', () => {
    expect(decide(null, ON)).toBe('pending');
  });

  it('플래그가 꺼져 있으면 확신도와 무관하게 pending — 섀도 모드', () => {
    expect(decide({ label: 'shop_listing', confidence: 1 }, OFF)).toBe('pending');
    expect(decide({ label: 'not_shop_listing', confidence: 1 }, OFF)).toBe('pending');
  });
});

describe('classifySafely', () => {
  it('NullShopListingClassifier 는 null', async () => {
    await expect(classifySafely(new NullShopListingClassifier(), INPUT)).resolves.toBeNull();
  });

  it('판정기가 던지면 null — 글쓰기를 막지 않는다', async () => {
    const failing: ShopListingClassifier = { classify: () => Promise.reject(new Error('503')) };
    await expect(classifySafely(failing, INPUT)).resolves.toBeNull();
  });

  it('타임아웃을 넘기면 null', async () => {
    const slow: ShopListingClassifier = {
      classify: () =>
        new Promise((resolve) => setTimeout(() => resolve({ label: 'shop_listing', confidence: 1 }), 50)),
    };
    await expect(classifySafely(slow, INPUT, 10)).resolves.toBeNull();
  });

  it('제때 오면 그 결과', async () => {
    const fast: ShopListingClassifier = {
      classify: () => Promise.resolve({ label: 'shop_listing', confidence: 0.97 }),
    };
    await expect(classifySafely(fast, INPUT)).resolves.toEqual({ label: 'shop_listing', confidence: 0.97 });
  });
});

describe('autoDecisionPolicyFromEnv', () => {
  it('기본은 꺼짐', () => {
    expect(autoDecisionPolicyFromEnv({}).enabled).toBe(false);
  });

  it('"on" 일 때만 켜진다', () => {
    expect(autoDecisionPolicyFromEnv({ SHOP_LISTING_AUTO_DECISION: 'on' }).enabled).toBe(true);
    expect(autoDecisionPolicyFromEnv({ SHOP_LISTING_AUTO_DECISION: 'true' }).enabled).toBe(false);
  });
});
