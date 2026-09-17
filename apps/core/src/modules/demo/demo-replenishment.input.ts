import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const requestSchema = z.discriminatedUnion('mode', [
  z
    .object({
      requestId: z.string().uuid(),
      mode: z.literal('random'),
      count: z.number().int().min(1).max(20).default(5),
    })
    .strict(),
  z
    .object({
      requestId: z.string().uuid(),
      mode: z.literal('specified'),
      skuIds: z
        .array(z.string().uuid())
        .min(1)
        .max(20)
        .refine((ids) => new Set(ids).size === ids.length)
        .transform((ids) => [...ids].sort()),
    })
    .strict(),
]);
export function parseDemoReplenishmentRequest(body: unknown) {
  const normalized =
    typeof body === 'object' && body !== null && !Array.isArray(body) ? { mode: 'random', ...body } : body;
  const result = requestSchema.safeParse(normalized);
  if (!result.success)
    throw new BadRequestException('실제 상품을 중복 없이 1~20개 선택하거나 무작위 상품 수를 1~20개로 입력해 주세요.');
  return result.data;
}
export type DemoReplenishmentRequest = ReturnType<typeof parseDemoReplenishmentRequest>;
