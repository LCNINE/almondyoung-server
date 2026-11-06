import { buildTierPrices, validateQuantityDiscount } from './quantity-discount.math';
import {
  buildTierPrices as previewTierPrices,
  validateQuantityDiscount as previewValidate,
} from '../../../../../../admin-web/src/lib/pricing/quantity-discount';

/**
 * 관리자 화면은 저장 전에 같은 식으로 결과 가격과 위반을 미리 보여 준다.
 * 둘이 갈리면 화면이 «저장 가능»이라 했는데 서버가 거부하거나, 미리보기 가격이 발행 가격과 다르다.
 */
describe('admin preview matches the server calculation', () => {
  const prices = [
    { basePrice: 10000, membershipPrice: 8000 },
    { basePrice: 15900, membershipPrice: 15900 },
    { basePrice: 9990, membershipPrice: 9000 },
    { basePrice: 1230, membershipPrice: 1110 },
  ];
  const tierSets = [
    [{ minQuantity: 3, regularRateBp: 500, membershipRateBp: 1000 }],
    [
      { minQuantity: 5, regularRateBp: 1000, membershipRateBp: 1500 },
      { minQuantity: 3, regularRateBp: 500, membershipRateBp: 1000 },
    ],
    [{ minQuantity: 2, regularRateBp: 2000, membershipRateBp: 500 }],
    [
      { minQuantity: 2, regularRateBp: 300, membershipRateBp: 300 },
      { minQuantity: 2, regularRateBp: 300, membershipRateBp: 200 },
    ],
    [{ minQuantity: 1, regularRateBp: 150, membershipRateBp: 10000 }],
    Array.from({ length: 6 }, (_, i) => ({ minQuantity: i + 2, regularRateBp: (i + 1) * 100, membershipRateBp: (i + 1) * 100 })),
    [
      { minQuantity: 3, regularRateBp: 0, membershipRateBp: 1000 },
      { minQuantity: 6, regularRateBp: 500, membershipRateBp: 2000 },
    ],
    [{ minQuantity: 3, regularRateBp: 0, membershipRateBp: 0 }],
    [
      { minQuantity: 3, regularRateBp: 500, membershipRateBp: 1000 },
      { minQuantity: 6, regularRateBp: 0, membershipRateBp: 2000 },
    ],
    [],
  ];
  const periods: Array<[string | null, string | null]> = [
    [null, null],
    ['2026-12-31', '2026-12-01'],
    ['2026-02-30', null],
    ['2026-12-01', null],
  ];

  it('gives the same tier prices', () => {
    for (const price of prices) {
      for (const tiers of tierSets) {
        expect(previewTierPrices({ ...price, tiers })).toEqual(buildTierPrices({ ...price, tiers }));
      }
    }
  });

  it('finds the same violations', () => {
    const variants = prices.map((p, i) => ({ variantId: `v${i}`, ...p }));
    for (const tiers of tierSets) {
      for (const [startsOn, endsOn] of periods) {
        const input = { tiers, startsOn, endsOn };
        expect(previewValidate(input, variants)).toEqual(validateQuantityDiscount(input, variants));
      }
    }
  });
});
