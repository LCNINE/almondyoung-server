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
