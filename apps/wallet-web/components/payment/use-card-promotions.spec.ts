import { getInterestFreeMonths, verifiedCardPromotions } from './use-card-promotions';

describe('installment eligibility', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-06T03:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());
  const promotion = {
    issuerCode: '61',
    minimumPaymentAmount: 50000,
    dueDate: '2026-10-31',
    installmentFreeMonths: [2, 3],
  };
  it('rejects test fixtures that advertise every installment month', () => {
    const fixture = { ...promotion, installmentFreeMonths: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] };
    expect(verifiedCardPromotions({ source: 'GENERAL_TEST_API', interestFreeCards: [fixture] })).toEqual([]);
    expect(verifiedCardPromotions({ interestFreeCards: [fixture] })).toEqual([]);
    expect(verifiedCardPromotions({ source: 'TOSS_WIDGET_GUIDE', interestFreeCards: [promotion] })).toEqual([
      promotion,
    ]);
  });
  it('does not advertise a benefit below the minimum, for another issuer, or after expiry', () => {
    expect(getInterestFreeMonths([promotion], '61', 49999)).toEqual([]);
    expect(getInterestFreeMonths([promotion], '41', 50000)).toEqual([]);
    expect(getInterestFreeMonths([{ ...promotion, dueDate: '2026-10-05' }], '61', 50000)).toEqual([]);
  });
  it('combines eligible promotions without duplicate months', () => {
    expect(getInterestFreeMonths([promotion, { ...promotion, installmentFreeMonths: [3, 4] }], '61', 50000)).toEqual([
      2, 3, 4,
    ]);
  });
  it('does not invent interest-free months when lookup is unavailable', () => {
    expect(getInterestFreeMonths([], '61', 50000)).toEqual([]);
  });
});
