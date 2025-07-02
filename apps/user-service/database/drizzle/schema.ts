import { relations, sql } from 'drizzle-orm';
import {
  pgEnum,
  pgTable,
  timestamp,
  varchar,
  uuid,
  text,
  boolean,
  unique,
  integer,
  jsonb,
} from 'drizzle-orm/pg-core';

export const tokenTypeEnum = pgEnum('token_type', [
  'access',
  'refresh',
  'verification',
]);

const timestampColumns = {
  createdAt: timestamp('created_at')
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp('updated_at')
    .default(sql`now()`)
    .notNull(),
};

/***
 * user schema
 */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: varchar('user_id', { length: 255 }).notNull().unique(),
  username: varchar('username', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  isEmailVerified: boolean('is_email_verified').notNull().default(false),
  ...timestampColumns,
});

export const scopes = pgTable('scopes', {
  scopeId: uuid('scope_id').primaryKey().defaultRandom(),
  scopeName: varchar('scope_name', { length: 100 }).notNull().unique(),
  description: text('description').notNull(),
  ...timestampColumns,
});

// 역할 정의 테이블
export const roles = pgTable('roles', {
  roleId: uuid('role_id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
  ...timestampColumns,
});

// 사용자-역할 할당 테이블
export const userRoleAssignments = pgTable('user_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  roleId: uuid('role_id')
    .references(() => roles.roleId, { onDelete: 'cascade' })
    .notNull(),
  assignedAt: timestamp('assigned_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
  ...timestampColumns,
});

// 역할-스코프 할당 테이블
export const roleScopes = pgTable('role_scopes', {
  id: uuid('id').primaryKey().defaultRandom(),
  roleId: uuid('role_id')
    .references(() => roles.roleId, { onDelete: 'cascade' })
    .notNull(),
  scopeId: uuid('scope_id')
    .references(() => scopes.scopeId, { onDelete: 'cascade' })
    .notNull(),
  ...timestampColumns,
});

export const tokens = pgTable(
  'tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    value: varchar('value', { length: 255 }).notNull(),
    type: tokenTypeEnum('type').notNull(),
    scopes: varchar('scopes', { length: 65535 }).notNull(),
    issuedAt: timestamp('issued_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    isRevoked: boolean('is_revoked').default(false),
    ...timestampColumns,
  },
  (table) => ({
    userTypeIdx: unique().on(table.userId, table.type),
  }),
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  tokens: many(tokens),
  userRoles: many(userRoleAssignments),
}));

export const tokensRelations = relations(tokens, ({ one }) => ({
  user: one(users, {
    fields: [tokens.userId],
    references: [users.id],
  }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoleAssignments),
  roleScopes: many(roleScopes),
}));

export const scopesRelations = relations(scopes, ({ many }) => ({
  roleScopes: many(roleScopes),
}));

export const userRoleAssignmentsRelations = relations(
  userRoleAssignments,
  ({ one }) => ({
    user: one(users, {
      fields: [userRoleAssignments.userId],
      references: [users.id],
    }),
    role: one(roles, {
      fields: [userRoleAssignments.roleId],
      references: [roles.roleId],
    }),
  }),
);

export const roleScopesRelations = relations(roleScopes, ({ one }) => ({
  role: one(roles, {
    fields: [roleScopes.roleId],
    references: [roles.roleId],
  }),
  scope: one(scopes, {
    fields: [roleScopes.scopeId],
    references: [scopes.scopeId],
  }),
}));

export const userSchema = { users };
export type UserSchema = typeof userSchema;

export type User = typeof users.$inferSelect;

/***
 * shope schema
 */

export const shopCategoryEnum = pgEnum('shop_category', [
  'hair',
  'nail',
  'makeup',
  'skincare',
  'massage',
  'beauty',
  'etc',
]);

export const shopTypeEnum = pgEnum('shop_type', ['solo', 'small', 'large']);

export const customerTypeEnum = pgEnum('customer_type', [
  'female',
  'male',
  'teens',
  'twenties',
  'thirties',
  'forties',
  'fifties_plus',
  'all_ages',
]);

export const dayOfWeekEnum = pgEnum('day_of_week', [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

export const shops = pgTable('shops', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  isOperating: boolean('is_operating').notNull().default(false),
  yearsOperating: integer('years_operating'),
  shopType: shopTypeEnum('shop_type').notNull(),
  categories: shopCategoryEnum('categories').notNull(), // 예: ["hair", "nail"]
  customCategory: jsonb('custom_category'), // etc일 때 추가 값, 예: ["특수업종1", "특수업종2"]
  targetCustomers: customerTypeEnum('target_customers'), // 예: ["female", "twenties"]
  openDays: dayOfWeekEnum('open_days'),

  ...timestampColumns,
});

export type Shop = typeof shops.$inferSelect;

export type ShopCategory = (typeof shopCategoryEnum.enumValues)[number];
export const SHOP_CATEGORIES = shopCategoryEnum.enumValues;

export type ShopType = (typeof shopTypeEnum.enumValues)[number];
export const SHOP_TYPES = shopTypeEnum.enumValues;

export type CustomerType = (typeof customerTypeEnum.enumValues)[number];
export const CUSTOMER_TYPES = customerTypeEnum.enumValues;

export type DayOfWeek = (typeof dayOfWeekEnum.enumValues)[number];
export const DAYS_OF_WEEK = dayOfWeekEnum.enumValues;
