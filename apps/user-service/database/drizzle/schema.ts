// apps/user-service/src/database/schema.ts

import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/*───────────────────────────
 * ENUM DECLARATIONS
 *──────────────────────────*/
export const tokenTypeEnum = pgEnum('token_type', ['access', 'refresh', 'verification']);

export const providerTypeEnum = pgEnum('provider_type', ['kakao', 'google', 'naver']);

export const shopTypeEnum = pgEnum('shop_type', ['solo', 'small', 'large']);

export const statusEnum = pgEnum('status', [
  'under_review', // 검토중
  'approved', // 승인됨
  'rejected', // 거절됨
]);

export const phoneVerificationPurposeEnum = pgEnum('phone_verification_purpose', ['phone_verify', 'pin_reset']);

export const oauthCodeChallengeMethodEnum = pgEnum('oauth_code_challenge_method', ['S256']);

// confidential: server-side RP (client_secret + PKCE), public: SPA/모바일 (PKCE only, RFC 8252).
export const oauthClientTypeEnum = pgEnum('oauth_client_type', ['confidential', 'public']);

/*───────────────────────────
 * HELPER COLUMNS
 *──────────────────────────*/
const timestampColumns = {
  createdAt: timestamp('created_at')
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp('updated_at')
    .default(sql`now()`)
    .notNull(),
};

/*───────────────────────────
 * USER TABLES
 *──────────────────────────*/

/**
 *  유저 동의 항목 테이블
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
  electronicTransaction: boolean('electronic_transaction').notNull().default(false), // 전자금융거래 이용약관 동의
  privacyPolicy: boolean('privacy_policy').notNull().default(false), // 개인정보 수집 및 이용 동의
  thirdPartySharing: boolean('third_party_sharing').notNull().default(false), // 개인정보 제3자 제공 동의
  marketingConsent: boolean('marketing_consent').notNull().default(false), // 마케팅 동의
  consentedAt: timestamp('consented_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/***
 * user schema
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  loginId: varchar('login_id', { length: 30 }).notNull().unique(),
  username: varchar('username', { length: 30 }).notNull(),
  nickname: varchar('nickname', { length: 30 }).notNull(),
  email: varchar('email', { length: 60 }).notNull().unique(),
  password: varchar('password', { length: 255 }),
  isEmailVerified: boolean('is_email_verified').notNull().default(false),
  lastActivityAt: timestamp('last_activity_at')
    .default(sql`now()`)
    .notNull(),
  deletedAt: timestamp('deleted_at'),
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

export const tokens = pgTable(
  'tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    value: text('value').notNull(),
    type: tokenTypeEnum('type').notNull(),
    scopes: varchar('scopes', { length: 65535 }).notNull(),
    autoLogin: boolean('auto_login').default(false),
    issuedAt: timestamp('issued_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    isRevoked: boolean('is_revoked').default(false),
    ...timestampColumns,
  },
  (table) => ({
    userTypeIdx: unique().on(table.userId, table.type),
  }),
);

export const cafe24Tokens = pgTable(
  'cafe24_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mallId: varchar('mall_id', { length: 64 }).notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    lastRefreshedAt: timestamp('last_refreshed_at'),
    lastError: text('last_error'),
    ...timestampColumns,
  },
  (table) => ({
    mallIdUniqueIdx: unique().on(table.mallId),
    expiresAtIdx: index('cafe24_tokens_expires_at_idx').on(table.expiresAt),
  }),
);

export const cafe24Links = pgTable(
  'cafe24_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    mallId: varchar('mall_id', { length: 64 }).notNull(),
    cafe24MemberId: varchar('cafe24_member_id', { length: 128 }).notNull(),
    linkedAt: timestamp('linked_at').defaultNow().notNull(),
    unlinkedAt: timestamp('unlinked_at'),
    ...timestampColumns,
  },
  (table) => ({
    userMallIdx: uniqueIndex('cafe24_links_user_mall_active_idx')
      .on(table.userId, table.mallId)
      .where(sql`${table.unlinkedAt} IS NULL`),
    mallMemberIdx: uniqueIndex('cafe24_links_mall_member_active_idx')
      .on(table.mallId, table.cafe24MemberId)
      .where(sql`${table.unlinkedAt} IS NULL`),
  }),
);

export const cafe24Snapshots = pgTable(
  'cafe24_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .references(() => cafe24Links.id, { onDelete: 'cascade' })
      .notNull(),
    email: varchar('email', { length: 255 }),
    name: varchar('name', { length: 100 }),
    birthDate: timestamp('birth_date'),
    phoneNumber: varchar('phone_number', { length: 20 }),
    rawData: jsonb('raw_data').notNull(),
    fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
    ...timestampColumns,
  },
  (table) => ({
    linkIdUniqueIdx: unique().on(table.linkId),
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
  interestCategoryKeys: text('interest_category_keys').array(),
  ...timestampColumns,
});

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

/*───────────────────────────
 * SHOP TABLES
 *──────────────────────────*/

/***
 * shope schema
 */
export const shops = pgTable('shops', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  isOperating: boolean('is_operating'), // 현재 운영 중 여부
  yearsOperating: integer('years_operating'), // 운영 연수
  shopType: shopTypeEnum('shop_type'), // 매장 유형 (shopTypeEnum 정의된 값 중 하나)
  categories: jsonb('categories'), // 취급 카테고리 (JSON 배열 형태로 저장, 예: [미용재료, 화장품])
  targetCustomers: jsonb('target_customers'), // 주요 고객층 (JSON, 예: ["여성","남성","20대","30대","40대 이상"])
  openDays: jsonb('open_days'), // 영업 요일 정보 (JSON, 예: { mon: true, tue: false })
  remind_at: timestamp('remind_at'), // 리마인드 일시
  ...timestampColumns,
});

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

//  business_licenses (사업자등록번호)
/**
 * 첨부파일을 업로드하면 사업자 번호, 사업자 대표이름은 입력 X,
 * 첨부파일을 업로드하지 않으면 사업자 번호, 사업자 대표이름은 입력필수.
 */
export const businessLicenses = pgTable(
  'business_licenses',
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
    verifiedAt: timestamp('verified_at'), // 인증 완료 일시
    deletedAt: timestamp('deleted_at'), // 삭제 일시
    fileUrl: varchar('file_url', { length: 1024 }), // 증빙 검증 파일 url
    // 부가 정보 저장 가능
    metadata: jsonb('metadata'),
    ...timestampColumns,
  },
  (table) => ({
    businessNumberUniqueIdx: unique().on(table.businessNumber),
    userUniqueIdx: unique().on(table.userId), // 사용자당 하나의 사업자 등록만 허용
    shopUniqueIdx: unique().on(table.shopId), // 상점당 하나의 사업자 등록만 허용
    verificationOrFullInfo: check(
      'business_licenses_verification_or_full_info',
      sql`${table.fileUrl} is not null OR (${table.businessNumber} is not null AND ${table.representativeName} is not null)`,
    ),
  }),
);

// ==================== 번호 인증 테이블 ====================
export const phoneVerifications = pgTable(
  'phone_verifications',
  {
    id: serial('id').primaryKey(),
    phoneNumber: varchar('phone_number', { length: 20 }).notNull(),
    code: varchar('code', { length: 6 }).notNull(),

    // 용도 구분
    purpose: phoneVerificationPurposeEnum('purpose').notNull(), // 'phone_verify' | 'pin_reset' ...

    // 검증 관련
    isVerified: boolean('is_verified').default(false).notNull(),
    verifiedAt: timestamp('verified_at'),
    isExpired: boolean('is_expired').default(false).notNull(),

    // 보안 관련
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(3).notNull(),

    // 시간 관련
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    phoneNumberIdx: index('phone_verifications_phone_number_idx').on(table.phoneNumber),
    purposeIdx: index('phone_verifications_purpose_idx').on(table.purpose),
  }),
);

/*───────────────────────────
 * OAUTH 2.0 (Authorization Code + PKCE) — IdP role
 *──────────────────────────*/
export const oauthClients = pgTable(
  'oauth_clients',
  {
    clientId: varchar('client_id', { length: 64 }).primaryKey(),
    clientType: oauthClientTypeEnum('client_type').default('confidential').notNull(),
    clientSecretHash: varchar('client_secret_hash', { length: 255 }).notNull(),
    previousSecretHash: varchar('previous_secret_hash', { length: 255 }),
    secretRotatedAt: timestamp('secret_rotated_at'),
    redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
    postLogoutRedirectUris: jsonb('post_logout_redirect_uris').$type<string[] | null>(),
    allowedScopes: jsonb('allowed_scopes').$type<string[] | null>(),
    isActive: boolean('is_active').default(true).notNull(),
    deactivatedAt: timestamp('deactivated_at'),
    ...timestampColumns,
  },
  (table) => ({
    isActiveIdx: index('oauth_clients_is_active_idx').on(table.isActive),
  }),
);

export const oauthAuthorizationCodes = pgTable(
  'oauth_authorization_codes',
  {
    code: varchar('code', { length: 128 }).primaryKey(),
    clientId: varchar('client_id', { length: 64 })
      .references(() => oauthClients.clientId)
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    redirectUri: varchar('redirect_uri', { length: 1024 }).notNull(),
    codeChallenge: varchar('code_challenge', { length: 256 }).notNull(),
    codeChallengeMethod: oauthCodeChallengeMethodEnum('code_challenge_method').notNull(),
    scope: varchar('scope', { length: 1024 }),
    nonce: varchar('nonce', { length: 512 }),
    expiresAt: timestamp('expires_at').notNull(),
    consumedAt: timestamp('consumed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    expiresAtIdx: index('oauth_codes_expires_at_idx').on(table.expiresAt),
    userClientIdx: index('oauth_codes_user_client_idx').on(table.userId, table.clientId),
  }),
);

export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: varchar('client_id', { length: 64 })
      .references(() => oauthClients.clientId)
      .notNull(),
    refreshToken: text('refresh_token').notNull(),
    scope: varchar('scope', { length: 1024 }),
    isRevoked: boolean('is_revoked').default(false).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    rotatedFrom: uuid('rotated_from'),
    ...timestampColumns,
  },
  (table) => ({
    refreshTokenUniqueIdx: uniqueIndex('oauth_tokens_refresh_token_idx').on(table.refreshToken),
    userClientIdx: index('oauth_tokens_user_client_idx').on(table.userId, table.clientId),
  }),
);

/**
 * 블랙리스트 관리 테이블
 * 레코드가 존재하면서 deletedAt이 nulll이면  = 블랙리스트
 * 레코드가 없거나 deletedAt이 null이 아니면 = 정상 고객
 */
export const blacklists = pgTable('blacklists', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  // 사유
  reason: text('reason').notNull(),
  // 내부 메모 (CS팀용)
  internalNote: text('internal_note'),
  // 등록 정보
  createdBy: uuid('created_by').references(() => users.id), // 등록한 관리자 ID
  createdAt: timestamp('created_at')
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp('updated_at')
    .default(sql`now()`)
    .notNull(),
  deletedAt: timestamp('deleted_at'),
  deletedBy: uuid('deleted_by').references(() => users.id), // 블랙리스트 해제한 관리자 ID
});

/*───────────────────────────
 * RELATIONS
 *──────────────────────────*/

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  tokens: many(tokens),
  userRoles: many(userRoleAssignments),
  profile: one(profiles, {
    fields: [users.id],
    references: [profiles.userId],
  }),
  identities: many(userIdentities),
  consents: one(userConsents, {
    fields: [users.id],
    references: [userConsents.userId],
  }),
  shop: one(shops, {
    fields: [users.id],
    references: [shops.userId],
  }),
  businessLicenses: many(businessLicenses),
  blacklist: one(blacklists, {
    fields: [users.id],
    references: [blacklists.userId],
  }),
  wishlist: many(wishlist),
  recentViews: many(userRecentViews),
  createdBlacklists: many(blacklists, {
    relationName: 'createdBy',
  }),
  deletedBlacklists: many(blacklists, {
    relationName: 'deletedBy',
  }),
}));

export const tokensRelations = relations(tokens, ({ one }) => ({
  user: one(users, {
    fields: [tokens.userId],
    references: [users.id],
  }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoleAssignments),
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

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, {
    fields: [profiles.userId],
    references: [users.id],
  }),
}));

export const userIdentitiesRelations = relations(userIdentities, ({ one }) => ({
  user: one(users, {
    fields: [userIdentities.userId],
    references: [users.id],
  }),
}));

export const userConsentsRelations = relations(userConsents, ({ one }) => ({
  user: one(users, {
    fields: [userConsents.userId],
    references: [users.id],
  }),
}));

export const shopsRelations = relations(shops, ({ one, many }) => ({
  user: one(users, {
    fields: [shops.userId],
    references: [users.id],
  }),
  businessLicenses: many(businessLicenses),
}));

export const userWishlistRelations = relations(wishlist, ({ one }) => ({
  user: one(users, {
    fields: [wishlist.userId],
    references: [users.id],
  }),
}));

export const userRecentViewsRelations = relations(userRecentViews, ({ one }) => ({
  user: one(users, {
    fields: [userRecentViews.userId],
    references: [users.id],
  }),
}));

export const businessLicensesRelations = relations(businessLicenses, ({ one }) => ({
  user: one(users, {
    fields: [businessLicenses.userId],
    references: [users.id],
  }),
  shop: one(shops, {
    fields: [businessLicenses.shopId],
    references: [shops.id],
  }),
}));

export const blacklistsRelations = relations(blacklists, ({ one }) => ({
  user: one(users, {
    fields: [blacklists.userId],
    references: [users.id],
  }),
  createdByUser: one(users, {
    fields: [blacklists.createdBy],
    references: [users.id],
    relationName: 'createdBy',
  }),
  deletedByUser: one(users, {
    fields: [blacklists.deletedBy],
    references: [users.id],
    relationName: 'deletedBy',
  }),
}));

/*───────────────────────────
 * TABLES ONLY SCHEMA (enum 제외)
 *──────────────────────────*/
export const userServiceTables = {
  users,
  roles,
  userRoleAssignments,
  userIdentities,
  businessLicenses,
  shops,
  userConsents,
  tokens,
  cafe24Tokens,
  cafe24Links,
  cafe24Snapshots,
  profiles,
  blacklists,
  wishlist,
  userRecentViews,
  phoneVerifications,
  oauthClients,
  oauthAuthorizationCodes,
  oauthTokens,
} as const;

/*───────────────────────────
 * RELATIONS ONLY SCHEMA
 *──────────────────────────*/
export const userServiceRelations = {
  usersRelations,
  tokensRelations,
  rolesRelations,
  userRoleAssignmentsRelations,
  profilesRelations,
  userIdentitiesRelations,
  userConsentsRelations,
  shopsRelations,
  userWishlistRelations,
  userRecentViewsRelations,
  businessLicensesRelations,
  blacklistsRelations,
} as const;

/*───────────────────────────
 * ENUMS ONLY SCHEMA
 *──────────────────────────*/
export const userServiceEnums = {
  tokenTypeEnum,
  providerTypeEnum,
  shopTypeEnum,
  statusEnum,
  phoneVerificationPurposeEnum,
  oauthCodeChallengeMethodEnum,
} as const;

/*───────────────────────────
 * COMPLETE SCHEMA (테이블 + 관계만, enum 제외)
 *──────────────────────────*/
export const userServiceSchema = {
  ...userServiceTables,
  ...userServiceRelations,
} as const;

/*───────────────────────────
 * TYPE EXPORTS
 *──────────────────────────*/
export type UserServiceSchema = typeof userServiceSchema;
export type UserServiceTables = typeof userServiceTables;
export type UserServiceEnums = typeof userServiceEnums;

export type User = typeof users.$inferSelect;
export type UserWithoutPassword = Omit<User, 'password'>;
export type Shop = typeof shops.$inferSelect;
export type Wishlist = typeof wishlist.$inferSelect;
export type RecentView = typeof userRecentViews.$inferSelect;
export type BusinessLicense = typeof businessLicenses.$inferSelect;
export type Cafe24Token = typeof cafe24Tokens.$inferSelect;
export type Cafe24Link = typeof cafe24Links.$inferSelect;
export type Cafe24Snapshot = typeof cafe24Snapshots.$inferSelect;

export type ShopType = (typeof shopTypeEnum.enumValues)[number];
export const SHOP_TYPES = shopTypeEnum.enumValues;
