import { z } from 'zod';

export const productAiLookupSchema = z
  .object({ kind: z.enum(['categories', 'inventory', 'tags']), query: z.string().trim().min(1).max(100) })
  .strict();

const money = z.number().int().min(0).max(2_000_000_000);
export const productAiSalesSchema = z
  .object({
    marketPrice: money.nullable(),
    supplyPrice: money.nullable(),
    salePrice: money.positive().nullable(),
    membershipPrice: money.positive().nullable(),
    membershipPricing: z.enum(['unknown', 'same', 'custom']),
    options: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(100),
            values: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
          })
          .strict(),
      )
      .max(3)
      .nullable(),
    categories: z
      .array(
        z
          .object({ id: z.uuid().nullable(), name: z.string().trim().min(1).max(255), parentId: z.uuid().nullable() })
          .strict(),
      )
      .max(10),
    primaryCategoryIndex: z.number().int().min(0).max(9).nullable(),
    tagValueIds: z.array(z.uuid()).max(15),
    inventory: z
      .array(
        z
          .object({
            optionValues: z.array(z.string().trim().min(1).max(100)).max(3),
            skuId: z.uuid().nullable(),
            newSkuName: z.string().trim().min(1).max(255).nullable(),
            quantity: z.number().int().min(1).max(10000),
            salePrice: money.positive().nullable(),
            membershipPrice: money.positive().nullable(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type ProductAiSales = z.infer<typeof productAiSalesSchema>;

export function salesProblems(sales: ProductAiSales | null | undefined): string[] {
  if (!sales) return ['판매 정보를 입력해 주세요.'];
  const problems: string[] = [];
  if (!sales.salePrice) problems.push('판매가를 알려주세요.');
  if (sales.membershipPricing === 'unknown' || (sales.membershipPricing === 'custom' && !sales.membershipPrice))
    problems.push('멤버십 가격을 알려주세요. 일반 판매가와 같게 설정할 수도 있어요.');
  if (sales.options === null) problems.push('옵션을 알려주세요. 옵션이 없으면 없다고 말씀해 주세요.');
  if (!sales.categories.length || sales.primaryCategoryIndex === null || !sales.categories[sales.primaryCategoryIndex])
    problems.push('카테고리와 대표카테고리를 선택해 주세요.');
  const combinations =
    sales.options?.reduce((rows, group) => rows.flatMap((row) => group.values.map((value) => [...row, value])), [
      [],
    ] as string[][]) ?? [];
  if (combinations.length > 100) problems.push('옵션 조합은 100개까지 등록할 수 있어요.');
  if (
    sales.options &&
    (sales.options.some((group) => new Set(group.values).size !== group.values.length) ||
      new Set(sales.options.map((group) => group.name)).size !== sales.options.length)
  )
    problems.push('중복된 옵션 이름이나 값을 확인해 주세요.');
  if (
    combinations.some(
      (values) =>
        sales.inventory.filter((item) => JSON.stringify(item.optionValues) === JSON.stringify(values)).length !== 1,
    ) ||
    sales.inventory.length !== combinations.length
  )
    problems.push('각 옵션에 연결할 재고를 선택하거나 새 재고 품목 생성을 요청해 주세요.');
  if (sales.inventory.some((item) => Boolean(item.skuId) === Boolean(item.newSkuName)))
    problems.push('재고는 기존 품목 또는 신규 생성 중 하나를 선택해 주세요.');
  return problems;
}

// Only a direct user command authorizes publication, never quoted/image/model text.
export function requestsPublication(content: string): boolean {
  return /^(?:(?:응|네|좋아|오케이)[,\s]*)?(?:(?:이대로|지금|바로|상품|이 상품|등록하고)\s*)*(?:등록|발행|등록\s*발행)(?:까지)?\s*(?:해\s*줘|해주세요|해\s*주세요|하자|해)[.!\s]*$/.test(
    content.trim(),
  );
}

export function hasPublicationIntent(history: { role: string; content: string }[]): boolean {
  let requested = false;
  let previousRole: string | null = null;
  for (const message of history) {
    if (message.role !== 'user') {
      previousRole = message.role;
      continue;
    }
    // A cancelled/failed turn has no committed assistant answer. A new input
    // after that turn must not silently resume its publication authority.
    if (previousRole === 'user') requested = false;
    if (requestsPublication(message.content)) requested = true;
    else if (
      /(취소|중지|초안|미리보기|다른\s*상품|다음\s*상품|(?:등록|발행).*(?:말|아니|나중|아직))/.test(message.content)
    )
      requested = false;
    previousRole = message.role;
  }
  return requested;
}
