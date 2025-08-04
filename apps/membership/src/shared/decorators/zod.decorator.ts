// shared/decorators/zod.decorator.ts
import { SetMetadata } from '@nestjs/common';
import type { ZodType } from 'zod';

export const ZOD_SCHEMA_KEY = 'zod:schema';
export const ValidateWithZod = (schema: ZodType) =>
  SetMetadata(ZOD_SCHEMA_KEY, schema);
