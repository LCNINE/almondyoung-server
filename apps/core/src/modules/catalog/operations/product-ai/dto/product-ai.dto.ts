import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  appendProductAiMessageSchema,
  createProductAiSessionSchema,
  productAiListQuerySchema,
  productAiMessagesQuerySchema,
  productAiSessionIdSchema,
  respondProductAiSchema,
} from './product-ai.schema';

export class CreateProductAiSessionDto extends createZodDto(createProductAiSessionSchema) {}
export class AppendProductAiMessageDto extends createZodDto(appendProductAiMessageSchema) {}
export class ListProductAiSessionsQueryDto extends createZodDto(productAiListQuerySchema) {}
export class ListProductAiMessagesQueryDto extends createZodDto(productAiMessagesQuerySchema) {}
export class RespondProductAiDto extends createZodDto(respondProductAiSchema) {}
export class ProductAiSessionParamsDto extends createZodDto(z.object({ id: productAiSessionIdSchema }).strict()) {}
export class ProductAiMessageParamsDto extends createZodDto(z.object({ id: z.uuid(), messageId: z.uuid() }).strict()) {}
export class ProductAiFeedbackDto extends createZodDto(
  z.object({ rating: z.enum(['up', 'down']).nullable() }).strict(),
) {}

export class RenameProductAiSessionDto extends createZodDto(
  z.object({ title: z.string().trim().min(1).max(200) }).strict(),
) {}
