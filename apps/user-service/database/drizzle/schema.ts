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
  check,
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

/***
 * user schema
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  loginId: varchar('login_id', { length: 255 }).notNull().unique(),
  username: varchar('username', { length: 255 }).notNull(),
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
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    roleId: uuid('role_id')
      .references(() => roles.roleId, { onDelete: 'cascade' })
      .notNull(),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at'),
    ...timestampColumns,
  },
  (table) => ({
    userRoleUniqueIdx: unique().on(table.userId, table.roleId),
  }),
);

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

// User_profile
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  phoneNumber: varchar('phone_number', { length: 20 }),
  address: jsonb('address'),
  birthDate: timestamp('birth_date'),
  profileImageUrl: varchar('profile_image_url', { length: 1024 }),
  ...timestampColumns,
});

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, {
    fields: [profiles.userId],
    references: [users.id],
  }),
}));

// 소셜 로그인 제공자별 사용자 식별 정보 테이블
export const userIdentities = pgTable(
  'user_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    provider: providerTypeEnum('provider').notNull(),
    providerId: varchar('provider_id', { length: 255 }).notNull(),
    providerData: jsonb('provider_data'),
    ...timestampColumns,
  },
  (table) => ({
    // 각 사용자는 provider 당 하나의 identity만 가질 수 있음
    providerUserIdx: unique().on(table.userId, table.provider),
    // 각 provider의 providerId는 unique해야 함
    providerIdIdx: unique().on(table.provider, table.providerId),
  }),
);

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  tokens: many(tokens),
  userRoles: many(userRoleAssignments),
  profile: one(profiles, {
    fields: [users.id],
    references: [profiles.userId],
  }),
  identities: many(userIdentities),
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

export const userIdentitiesRelations = relations(userIdentities, ({ one }) => ({
  user: one(users, {
    fields: [userIdentities.userId],
    references: [users.id],
  }),
}));

export const userSchema = { users };
export type UserSchema = typeof userSchema;

export type User = typeof users.$inferSelect;

/***
 * shope schema
 */
export const shopTypeEnum = pgEnum('shop_type', ['solo', 'small', 'large']);

export const shops = pgTable('shops', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  isOperating: boolean('is_operating').notNull().default(false),
  yearsOperating: integer('years_operating'),
  shopType: shopTypeEnum('shop_type').notNull(),
  categories: jsonb('categories').notNull(),
  targetCustomers: jsonb('target_customers'),
  openDays: jsonb('open_days'),
  ...timestampColumns,
});

export type Shop = typeof shops.$inferSelect;

export type ShopType = (typeof shopTypeEnum.enumValues)[number];
export const SHOP_TYPES = shopTypeEnum.enumValues;

/***
 * wishlist (찜하기)
 */
export const wishlist = pgTable(
  'wishlist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    productId: varchar('product_id', { length: 255 }).notNull(),
    ...timestampColumns,
  },
  (table) => ({
    userProductUniqueIdx: unique().on(table.userId, table.productId),
  }),
);

export const userWishlistRelations = relations(wishlist, ({ one }) => ({
  user: one(users, {
    fields: [wishlist.userId],
    references: [users.id],
  }),
}));

export type Wishlist = typeof wishlist.$inferSelect;

/***
 * recent views (최근 본 상품)
 */
export const userRecentViews = pgTable(
  'recent_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    productId: varchar('product_id', { length: 255 }).notNull(),

    ...timestampColumns,
  },
  (table) => ({
    userProductUniqueIdx: unique().on(table.userId, table.productId),
  }),
);

export const userRecentViewsRelations = relations(
  userRecentViews,
  ({ one }) => ({
    user: one(users, {
      fields: [userRecentViews.userId],
      references: [users.id],
    }),
  }),
);

export type RecentView = typeof userRecentViews.$inferSelect;

/***
 * business registrations (사업자등록번호)
 */

export const statusEnum = pgEnum('status', [
  'under_review', // 검토중
  'approved', // 승인됨
  'rejected', // 거절됨
]);

export const businessRegistrations = pgTable(
  'business_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    businessNumber: varchar('business_number', { length: 10 }),
    representativeName: varchar('representative_name', { length: 100 }), // 대표자명
    status: statusEnum('status').notNull().default('under_review'),
    reviewComment: text('review_comment'), // 검토 코멘트
    reviewedAt: timestamp('reviewed_at'),
    verifiedAt: timestamp('verified_at'),
    verificationFile: varchar('verification_file', { length: 1024 }), // 증빙 검증 파일 url
    // 부가 정보 저장 가능
    metadata: jsonb('metadata'),
    ...timestampColumns,
  },
  (table) => ({
    businessNumberUniqueIdx: unique().on(table.businessNumber),
    verificationOrFullInfo: check(
      'business_registrations_verification_or_full_info',
      sql`${table.verificationFile} is not null OR (${table.businessNumber} is not null AND ${table.representativeName} is not null)`,
    ),
  }),
);

export const businessRegistrationsRelations = relations(
  businessRegistrations,
  ({ one }) => ({
    user: one(users, {
      fields: [businessRegistrations.userId],
      references: [users.id],
    }),
    shop: one(shops, {
      fields: [businessRegistrations.shopId],
      references: [shops.id],
    }),
  }),
);

export const shopsRelations = relations(shops, ({ many }) => ({
  businessRegistrations: many(businessRegistrations),
}));

export type BusinessRegistration = typeof businessRegistrations.$inferSelect;
