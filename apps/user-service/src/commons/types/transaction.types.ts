import { type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

// ===== TRANSACTION 타입 =====
export type DbTransaction = PostgresJsDatabase<UserServiceSchema>;
