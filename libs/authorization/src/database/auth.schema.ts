import { pgSchema } from 'drizzle-orm/pg-core';
import { uuid, varchar, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

const authSchema = pgSchema('auth');

export const scopes = authSchema.table('scopes', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  category: varchar('category', { length: 50 }),
  description: text('description'),
  microserviceName: varchar('microservice_name', { length: 50 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const roleScopeMapping = authSchema.table('role_scope_mapping', {
  id: uuid('id').primaryKey().defaultRandom(),
  roleName: varchar('role_name', { length: 100 }).notNull(),
  scopeId: uuid('scope_id').notNull().references(() => scopes.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  uniqueMapping: uniqueIndex('role_scope_unique_idx').on(table.roleName, table.scopeId),
}));

export const scopesRelations = relations(scopes, ({ many }) => ({
  mappings: many(roleScopeMapping),
}));

export const roleScopeMappingRelations = relations(roleScopeMapping, ({ one }) => ({
  scope: one(scopes, { fields: [roleScopeMapping.scopeId], references: [scopes.id] }),
}));

export const authorizationSchema = {
  scopes,
  roleScopeMapping,
  scopesRelations,
  roleScopeMappingRelations,
};
