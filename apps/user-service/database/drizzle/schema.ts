import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const tokenTypeEnum = pgEnum('token_type', [
  'access',
  'refresh',
  'verification',
]);

export const providerTypeEnum = pgEnum('provider_type', [
  'kakao',
  'google',
  'naver',
]);

const timestampColumns = {
  createdAt: timestamp('created_at')
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp('updated_at')
    .default(sql`now()`)
    .notNull(),
};

/**
 *  유저 동의 항목 테이블 - 마케팅 수신 동의 통합
 */
export const userConsents = pgTable('user_consents', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  // 필수 동의 항목들
  isOver14: boolean('is_over_14').notNull().default(false), // 만 14세 이상
  termsOfService: boolean('terms_of_service').notNull().default(false), // 서비스 이용약관 동의
  electronicTransaction: boolean('electronic_transaction')
    .notNull()
    .default(false), // 전자금융거래 이용약관 동의
  privacyPolicy: boolean('privacy_policy').notNull().default(false), // 개인정보 수집 및 이용 동의
  thirdPartySharing: boolean('third_party_sharing').notNull().default(false), // 개인정보 제3자 제공 동의
  // 마케팅 수신 동의 (통합)
  marketingConsent: boolean('marketing_consent').notNull().default(false), // 마케팅 수신 동의 (모든 채널)
  consentedAt: timestamp('consented_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/***
 * user schema
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  loginId: varchar('login_id', { length: 255 }).notNull().unique(),
  username: varchar('username', { length: 255 }).notNull(),
  nickname: varchar('nickname', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }),
  isEmailVerified: boolean('is_email_verified').notNull().default(false),
  lastActivityAt: timestamp('last_activity_at')
    .default(sql`now()`)
    .notNull(),
  deletedAt: timestamp('deleted_at'),
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
export const userRoleAssignments = pgTable(
  'user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.roleId, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
    assignedBy: uuid('assigned_by').references(() => users.id),
    ...timestampColumns,
  },
  (table) => ({
    userRoleUnique: unique('user_role_unique').on(table.userId, table.roleId),
  }),
);

// 역할-스코프 연결 테이블
export const roleScopeMappings = pgTable(
  'role_scope_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.roleId, { onDelete: 'cascade' }),
    scopeId: uuid('scope_id')
      .notNull()
      .references(() => scopes.scopeId, { onDelete: 'cascade' }),
    ...timestampColumns,
  },
  (table) => ({
    roleScopeUnique: unique('role_scope_unique').on(table.roleId, table.scopeId),
  }),
);

// 사용자 세션 테이블
export const userSessions = pgTable('user_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 500 }).notNull().unique(),
  type: tokenTypeEnum('type').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  isRevoked: boolean('is_revoked').default(false).notNull(),
  ...timestampColumns,
});

// 소셜 로그인 연동 테이블
export const userProviders = pgTable('user_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: providerTypeEnum('provider').notNull(),
  providerId: varchar('provider_id', { length: 255 }).notNull(),
  providerData: jsonb('provider_data'),
  ...timestampColumns,
}, (table) => ({
  providerUnique: unique('provider_unique').on(table.provider, table.providerId),
}));

// 사용자 주소 테이블
export const userAddresses = pgTable('user_addresses', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  isDefault: boolean('is_default').default(false).notNull(),
  recipientName: varchar('recipient_name', { length: 100 }).notNull(),
  recipientPhone: varchar('recipient_phone', { length: 20 }).notNull(),
  postalCode: varchar('postal_code', { length: 10 }).notNull(),
  address: text('address').notNull(),
  detailAddress: text('detail_address'),
  deliveryInstructions: text('delivery_instructions'),
  ...timestampColumns,
});

// 사업자 등록 정보 테이블
export const businessLicenses = pgTable('business_licenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  businessNumber: varchar('business_number', { length: 20 }).notNull().unique(),
  businessName: varchar('business_name', { length: 255 }).notNull(),
  businessType: varchar('business_type', { length: 100 }),
  businessCategory: varchar('business_category', { length: 100 }),
  representativeName: varchar('representative_name', { length: 100 }).notNull(),
  businessAddress: text('business_address').notNull(),
  businessPhone: varchar('business_phone', { length: 20 }),
  isVerified: boolean('is_verified').default(false).notNull(),
  verifiedAt: timestamp('verified_at'),
  verifiedBy: uuid('verified_by').references(() => users.id),
  ...timestampColumns,
});

// 최근 본 상품 테이블
export const recentViews = pgTable('recent_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  productId: varchar('product_id', { length: 100 }).notNull(),
  viewedAt: timestamp('viewed_at').defaultNow().notNull(),
  ...timestampColumns,
}, (table) => ({
  userProductUnique: unique('user_product_unique').on(table.userId, table.productId),
}));

// 위시리스트 테이블
export const wishlists = pgTable('wishlists', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  productId: varchar('product_id', { length: 100 }).notNull(),
  addedAt: timestamp('added_at').defaultNow().notNull(),
  ...timestampColumns,
}, (table) => ({
  userWishlistUnique: unique('user_wishlist_unique').on(table.userId, table.productId),
}));

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  consent: one(userConsents),
  roleAssignments: many(userRoleAssignments),
  sessions: many(userSessions),
  providers: many(userProviders),
  addresses: many(userAddresses),
  businessLicense: one(businessLicenses),
  recentViews: many(recentViews),
  wishlists: many(wishlists),
}));

export const userConsentsRelations = relations(userConsents, ({ one }) => ({
  user: one(users, {
    fields: [userConsents.userId],
    references: [users.id],
  }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  userAssignments: many(userRoleAssignments),
  scopeMappings: many(roleScopeMappings),
}));

export const scopesRelations = relations(scopes, ({ many }) => ({
  roleMappings: many(roleScopeMappings),
}));

export const userRoleAssignmentsRelations = relations(userRoleAssignments, ({ one }) => ({
  user: one(users, {
    fields: [userRoleAssignments.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [userRoleAssignments.roleId],
    references: [roles.roleId],
  }),
}));

export const roleScopeMappingsRelations = relations(roleScopeMappings, ({ one }) => ({
  role: one(roles, {
    fields: [roleScopeMappings.roleId],
    references: [roles.roleId],
  }),
  scope: one(scopes, {
    fields: [roleScopeMappings.scopeId],
    references: [scopes.scopeId],
  }),
}));

export const userSessionsRelations = relations(userSessions, ({ one }) => ({
  user: one(users, {
    fields: [userSessions.userId],
    references: [users.id],
  }),
}));

export const userProvidersRelations = relations(userProviders, ({ one }) => ({
  user: one(users, {
    fields: [userProviders.userId],
    references: [users.id],
  }),
}));

export const userAddressesRelations = relations(userAddresses, ({ one }) => ({
  user: one(users, {
    fields: [userAddresses.userId],
    references: [users.id],
  }),
}));

export const businessLicensesRelations = relations(businessLicenses, ({ one }) => ({
  user: one(users, {
    fields: [businessLicenses.userId],
    references: [users.id],
  }),
}));

export const recentViewsRelations = relations(recentViews, ({ one }) => ({
  user: one(users, {
    fields: [recentViews.userId],
    references: [users.id],
  }),
}));

export const wishlistsRelations = relations(wishlists, ({ one }) => ({
  user: one(users, {
    fields: [wishlists.userId],
    references: [users.id],
  }),
}));

// Export schema
export const userSchema = {
  users,
  userConsents,
  scopes,
  roles,
  userRoleAssignments,
  roleScopeMappings,
  userSessions,
  userProviders,
  userAddresses,
  businessLicenses,
  recentViews,
  wishlists,
};

// Export types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserConsent = typeof userConsents.$inferSelect;
export type NewUserConsent = typeof userConsents.$inferInsert;
export type Scope = typeof scopes.$inferSelect;
export type NewScope = typeof scopes.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type UserRoleAssignment = typeof userRoleAssignments.$inferSelect;
export type NewUserRoleAssignment = typeof userRoleAssignments.$inferInsert;
export type RoleScopeMapping = typeof roleScopeMappings.$inferSelect;
export type NewRoleScopeMapping = typeof roleScopeMappings.$inferInsert;
export type UserSession = typeof userSessions.$inferSelect;
export type NewUserSession = typeof userSessions.$inferInsert;
export type UserProvider = typeof userProviders.$inferSelect;
export type NewUserProvider = typeof userProviders.$inferInsert;
export type UserAddress = typeof userAddresses.$inferSelect;
export type NewUserAddress = typeof userAddresses.$inferInsert;
export type BusinessLicense = typeof businessLicenses.$inferSelect;
export type NewBusinessLicense = typeof businessLicenses.$inferInsert;
export type RecentView = typeof recentViews.$inferSelect;
export type NewRecentView = typeof recentViews.$inferInsert;
export type Wishlist = typeof wishlists.$inferSelect;
export type NewWishlist = typeof wishlists.$inferInsert;

// UserServiceSchema type
export type UserServiceSchema = typeof userSchema;
