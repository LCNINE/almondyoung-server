import { z } from 'zod';

export const createProductAiSessionSchema = z
  .object({
    requestId: z.uuid(),
    title: z.string().trim().min(1).max(200).default('새 상품등록'),
  })
  .strict();

// 역할, 도구 결과, 사용자 ID를 클라이언트가 지정할 수 없다.
export const appendProductAiMessageSchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: z.number().int().min(0).max(2_147_483_646),
    content: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const productAiSessionIdSchema = z.uuid();
export const respondProductAiSchema = z.object({ messageId: z.uuid() }).strict();
export type RespondProductAiInput = z.infer<typeof respondProductAiSchema>;
export const productAiListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export const productAiMessagesQuerySchema = z
  .object({
    after: z.coerce.number().int().min(0).max(2_147_483_647).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export type CreateProductAiSessionInput = z.infer<typeof createProductAiSessionSchema>;
export type AppendProductAiMessageInput = z.infer<typeof appendProductAiMessageSchema>;
export type ListProductAiSessionsQuery = z.infer<typeof productAiListQuerySchema>;
export type ListProductAiMessagesQuery = z.infer<typeof productAiMessagesQuerySchema>;
