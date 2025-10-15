// types.ts - 리팩토링된 타입 정의

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { membershipSchema } from './entities/schema';
import { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { ExtractTablesWithRelations } from 'drizzle-orm';

// ====== Drizzle 스키마 기반 엔티티 타입 ======

export type DrizzleTransaction = PostgresJsTransaction<
  typeof membershipSchema,
  ExtractTablesWithRelations<typeof membershipSchema>
>;
