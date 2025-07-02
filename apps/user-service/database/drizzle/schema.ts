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
  'hair', // 헤어
  'nail', // 네일
  'makeup', // 메이크업
  'skincare', // 스킨케어
  'massage', // 마사지
  'beauty', // 뷰티
  'etc', // 기타
]);

export const shopTypeEnum = pgEnum('shop_type', [
  'solo', // 1인샵
  'small', // 소형샵
  'large', // 대형샵
]);

export const customerTypeEnum = pgEnum('customer_type', [
  'female', // 여성
  'male', // 남성
  'teens', // 10대
  'twenties', // 20대
  'thirties', // 30대
  'forties', // 40대
  'fifties_plus', // 50대 이상
  'all_ages', // 전 연령
]);

export const dayOfWeekEnum = pgEnum('day_of_week', [
  'monday', // 월
  'tuesday', // 화
  'wednesday', // 수
  'thursday', // 목
  'friday', // 금
  'saturday', // 토
  'sunday', // 일
]);

// 메인 샵 테이블
export const shops = pgTable('shops', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  isOperating: boolean('is_operating').notNull().default(false), // 샵 운영 중 여부
  yearsOperating: integer('years_operating'), // 운영 연수
  shopType: shopTypeEnum('shop_type'), // 샵 유형
  ...timestampColumns,
});

// 샵 카테고리 (다중 선택 가능)
export const shopCategories = pgTable('shop_categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  shopId: uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  category: shopCategoryEnum('category').notNull(),
  customCategory: varchar('custom_category', { length: 100 }),
  ...timestampColumns,
});

// 샵 주요 고객층 (다중 선택 가능)
export const shopTargetCustomers = pgTable('shop_target_customers', {
  id: uuid('id').defaultRandom().primaryKey(),
  shopId: uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  customerType: customerTypeEnum('customer_type').notNull(),
  ...timestampColumns,
});

// 샵 운영 요일 (다중 선택 가능)
export const shopOpenDays = pgTable('shop_open_days', {
  id: uuid('id').defaultRandom().primaryKey(),
  shopId: uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  dayOfWeek: dayOfWeekEnum('day_of_week').notNull(),
  ...timestampColumns,
});

export const shopRelations = relations(shops, ({ one, many }) => ({
  user: one(users, {
    fields: [shops.userId],
    references: [users.id],
  }),
  categories: many(shopCategories),
  targetCustomers: many(shopTargetCustomers),
  openDays: many(shopOpenDays),
}));

export type ShopSchema = typeof shops;

export type Shop = typeof shops.$inferSelect;
