import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { roles, scopes, roleScopeMapping } from './auth.schema';

export type Role = InferSelectModel<typeof roles>;
export type NewRole = InferInsertModel<typeof roles>;

export type Scope = InferSelectModel<typeof scopes>;
export type NewScope = InferInsertModel<typeof scopes>;

export type RoleScopeMapping = InferSelectModel<typeof roleScopeMapping>;
export type NewRoleScopeMapping = InferInsertModel<typeof roleScopeMapping>;

export interface ScopeDefinition {
  key: string;
  category: string;
  description: string;
}

