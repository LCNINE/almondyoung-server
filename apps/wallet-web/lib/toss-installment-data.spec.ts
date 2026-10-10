import { normalizeGuidePromotions } from './toss-installment-data';

describe('Toss guide installment data', () => {
  const card = {
    code: '61',
    isForeign: false,
    installments: [
      {
        minAmount: 50000,
        dueDate: '2026-10-31T23:59:59.999999999',
        data: Array.from({ length: 13 }, (_, month) => ({
          month,
          interestFreeInstallmentTypes: month === 2 || month === 3 ? ['CONTRACT_CARD'] : [],
        })),
      },
    ],
  };

  it('marks only months with an eligible interest-free type', () => {
    expect(normalizeGuidePromotions({ data: { cards: [card] } })).toEqual([
      {
        issuerCode: '61',
        minimumPaymentAmount: 50000,
        dueDate: '2026-10-31',
        installmentFreeMonths: [2, 3],
      },
    ]);
  });

  it('excludes foreign cards as the guide does', () => {
    expect(normalizeGuidePromotions({ cards: [{ ...card, isForeign: true }] })).toEqual([]);
  });
});
