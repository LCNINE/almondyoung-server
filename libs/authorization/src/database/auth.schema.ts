import { pgSchema } from 'drizzle-orm/pg-core';
import { uuid, varchar, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

const authSchema = pgSchema('auth');

export const roles = authSchema.table('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  scopeId: uuid('scope_id').notNull().references(() => scopes.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  uniqueMapping: uniqueIndex('role_scope_unique_idx').on(table.roleId, table.scopeId),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  mappings: many(roleScopeMapping),
}));

export const scopesRelations = relations(scopes, ({ many }) => ({
  mappings: many(roleScopeMapping),
}));

export const roleScopeMappingRelations = relations(roleScopeMapping, ({ one }) => ({
  role: one(roles, { fields: [roleScopeMapping.roleId], references: [roles.id] }),
  scope: one(scopes, { fields: [roleScopeMapping.scopeId], references: [scopes.id] }),
}));

export const authorizationSchema = {
  roles,
  scopes,
  roleScopeMapping,
  rolesRelations,
  scopesRelations,
  roleScopeMappingRelations,
};

