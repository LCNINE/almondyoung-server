import { z } from 'zod';

const guideData = z.object({
  cards: z.array(
    z.object({
      code: z.string(),
      isForeign: z.boolean(),
      installments: z.array(
        z.object({
          minAmount: z.number(),
          dueDate: z.string(),
          data: z.array(z.object({ month: z.number(), interestFreeInstallmentTypes: z.array(z.string()) })),
        }),
      ),
    }),
  ),
});

/** 토스 무이자 안내 화면과 같은 판정: 해당 개월의 무이자 유형이 있는 항목만 추출한다. */
export function normalizeGuidePromotions(raw: unknown) {
  const wrapped = z.object({ data: guideData }).safeParse(raw);
  const data = wrapped.success ? wrapped.data.data : guideData.parse(raw);
  return data.cards
    .filter((card) => !card.isForeign)
    .flatMap((card) =>
      card.installments.map((installment) => ({
        issuerCode: card.code,
        minimumPaymentAmount: installment.minAmount,
        dueDate: installment.dueDate.slice(0, 10),
        installmentFreeMonths: installment.data
          .filter((item) => item.month >= 2 && item.interestFreeInstallmentTypes.length > 0)
          .map((item) => item.month),
      })),
    );
}
