import { relations, sql } from "drizzle-orm";
import { pgEnum, pgTable, timestamp, varchar, uuid, text, boolean, AnyPgColumn, uniqueIndex } from "drizzle-orm/pg-core";

export const tokenTypeEnum = pgEnum("token_type", ["access", "refresh"]);
export const clientTypeEnum = pgEnum("client_type", ["public", "confidential"]);
export const grantTypeEnum = pgEnum("grant_type", ["authorization_code", "refresh_token"]);

const timestampColumns = {
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
}

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  ...timestampColumns,
});

export const usersRelations = relations(users, ({ many }) => ({
  tokens: many(oauthTokens),
  consents: many(consents),
  authCodes: many(authCodes),
  roleAssignments: many(userRoleAssignments),
}))

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  secret: varchar("secret", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  clientType: clientTypeEnum("client_type").notNull(),
  allowedGrantTypes: grantTypeEnum("allowed_grant_types").array(),
  // allowedScopes: varchar("allowed_scopes", { length: 255 }).array(),
  isTrusted: boolean("is_trusted").default(false),
  ...timestampColumns,
})

export const clientsRelations = relations(clients, ({ many }) => ({
  tokens: many(oauthTokens),
  consents: many(consents),
  authCodes: many(authCodes),
  scopeAssignments: many(clientScopeAssignments),
}))

export const oauthTokens = pgTable("oauth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  value: varchar("value", { length: 255 }).notNull(),
  type: tokenTypeEnum("type").notNull(),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: 'cascade' }).notNull(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  parentRefreshTokenId: uuid("parent_refresh_token_id").references((): AnyPgColumn => oauthTokens.id, { onDelete: 'set null' }),
  isRevoked: boolean("is_revoked").default(false),
})

export const oauthTokensRelations = relations(oauthTokens, ({ one, many }) => ({
  user: one(users, {
    fields: [oauthTokens.userId],
    references: [users.id],
  }),
  client: one(clients, {
    fields: [oauthTokens.clientId],
    references: [clients.id],
  }),
  parentToken: one(oauthTokens, {
    fields: [oauthTokens.parentRefreshTokenId],
    references: [oauthTokens.id],
  }),
  childTokens: many(oauthTokens, {
    relationName: "parent_child_tokens",
  }),
}))


export const authCodes = pgTable("auth_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  value: varchar("code", { length: 255 }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: 'cascade' }).notNull(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  redirectUri: varchar("redirect_uri", { length: 2083 }).notNull(),
  scopes: varchar("scopes", { length: 255 }).array().notNull(),
  codeChallenge: varchar("code_challenge", { length: 255 }),
  codeChallengeMethod: varchar("code_challenge_method", { length: 10 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  isUsed: boolean('is_used').notNull().default(false),
})

export const authCodesRelations = relations(authCodes, ({ one }) => ({
  user: one(users, {
    fields: [authCodes.userId],
    references: [users.id],
  }),
  client: one(clients, {
    fields: [authCodes.clientId],
    references: [clients.id],
  }),
}))


export const scopes = pgTable('scopes', {
  scopeId: uuid('scope_id').primaryKey().defaultRandom(),
  scopeName: varchar('scope_name', { length: 100 }).notNull().unique(),
  description: text('description').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  ...timestampColumns,
});

export const scopeRelations = relations(scopes, ({ many }) => ({
  roleAssignments: many(roleScopeAssignments),
  clientAssignments: many(clientScopeAssignments),
  consents: many(consents),
}));

export const consents = pgTable("consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: 'cascade' }).notNull(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  scopeIds: uuid("scope_ids").references(() => scopes.scopeId).array(),
  grantedAt: timestamp('granted_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
  isActive: boolean('is_active').notNull().default(true),
})

export const consentsRelations = relations(consents, ({ one, many }) => ({
  user: one(users, {
    fields: [consents.userId],
    references: [users.id],
  }),
  client: one(clients, {
    fields: [consents.clientId],
    references: [clients.id],
  }),
  scopes: many(scopes, {
    relationName: "consents_scopes",
  }),
}))

// 역할 정의 테이블
export const roles = pgTable('roles', {
  roleId: uuid('role_id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
  isSystemRole: boolean('is_system_role').default(false).notNull(),
  ...timestampColumns,
});

export const roleRelations = relations(roles, ({ many }) => ({
  userAssignments: many(userRoleAssignments),
  scopeAssignments: many(roleScopeAssignments),
}));

// 사용자-역할 할당 테이블
export const userRoleAssignments = pgTable('user_role_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  roleId: uuid('role_id').references(() => roles.roleId, { onDelete: 'cascade' }).notNull(),
  assignedAt: timestamp('assigned_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
  isActive: boolean('is_active').default(true).notNull(),
  ...timestampColumns,
});

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

// 역할-스코프 할당 테이블
export const roleScopeAssignments = pgTable('role_scope_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  roleId: uuid('role_id').references(() => roles.roleId, { onDelete: 'cascade' }).notNull(),
  scopeId: uuid('scope_id').references(() => scopes.scopeId, { onDelete: 'cascade' }).notNull(),
  ...timestampColumns,
});

export const roleScopeAssignmentsRelations = relations(roleScopeAssignments, ({ one }) => ({
  role: one(roles, {
    fields: [roleScopeAssignments.roleId],
    references: [roles.roleId],
  }),
  scope: one(scopes, {
    fields: [roleScopeAssignments.scopeId],
    references: [scopes.scopeId],
  }),
}));

// 클라이언트-스코프 할당 테이블
export const clientScopeAssignments = pgTable('client_scope_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  scopeId: uuid('scope_id').references(() => scopes.scopeId, { onDelete: 'cascade' }).notNull(),
  ...timestampColumns,
}, (table) => ({
  uniqueClientScope: uniqueIndex('client_scope_unique_idx').on(table.clientId, table.scopeId)
}));

export const clientScopeAssignmentsRelations = relations(clientScopeAssignments, ({ one }) => ({
  client: one(clients, {
    fields: [clientScopeAssignments.clientId],
    references: [clients.id],
  }),
  scope: one(scopes, {
    fields: [clientScopeAssignments.scopeId],
    references: [scopes.scopeId],
  }),
}));

