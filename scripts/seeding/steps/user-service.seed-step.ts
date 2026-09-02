import { sql } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { SeedStep } from './base-seed-step';
import { SeedCheckResult, SeedApplyResult } from '../lib/types';
import { FIXED_UUIDS } from '../constants/uuids';

/**
 * OAuth RP 시드 정의. 새 RP 가 추가되면 여기 항목을 늘리고 orchestrator 의 collectConfig 에
 * 대응 env 키만 추가하면 된다.
 *
 * - clientSecret 은 env 로 주입을 권장. 미주입 시 시더가 1회 생성·로그하고, 이후 실행에서는
 *   `ON CONFLICT ... DO UPDATE` 가 secret_hash 를 건드리지 않으므로 안정적이다.
 *   secret 회전이 필요하면 `/admin/oauth-clients/:clientId/rotate-secret` API 사용.
 * - URL 이 비어 있으면 (env 미설정) 해당 client 는 시드 대상에서 제외된다.
 */
export type OAuthClientSeed = {
  clientId: string;
  clientType: 'confidential' | 'public';
  redirectUris: string[];
  postLogoutRedirectUris?: string[];
  allowedScopes?: string[];
  clientSecret?: string;
};

export type UserServiceSeedConfig = {
  adminPassword: string;
  oauthClients?: OAuthClientSeed[];
};

/**
 * OAuth client upsert 의 ON CONFLICT 절. 신규 client 를 추가하는 모든 시드가 이걸 쓴다.
 *
 * **redirect_uris / post_logout_redirect_uris 는 합집합이다.** 시드는 "이 URI 들이 등록돼
 * 있음을 보장"할 뿐, 전체집합을 선언하지 않는다. 라이브에는 시드가 모르는 URI 가 흔히 있고
 * (www 변형, 로컬 개발용 localhost, RP 쪽에서 나중에 추가한 것), 배열을 통째로 교체하면
 * 그것들이 조용히 사라져 해당 경로의 로그인이 즉시 깨진다. 실제로 라이브 medusa-storefront
 * 에는 시드 정의에 없는 www·localhost 콜백이 들어 있었다.
 *
 * 대가: **시드로는 URI 를 제거할 수 없다.** 오래된 URI 를 지우려면 사람이 직접 지워야 한다
 * (`/admin/oauth-clients/:clientId` PATCH 또는 SQL). 등록 누락보다 잔존이 훨씬 덜 위험하다는
 * 판단이다.
 *
 * allowed_scopes 는 의도적으로 교체(EXCLUDED)다 — 스코프는 권한 부여라 합집합으로 두면
 * 축소가 영영 불가능해진다. client_secret_hash 는 건드리지 않는다(회전은 rotate-secret API).
 */
export const OAUTH_CLIENT_UPSERT_ON_CONFLICT = sql`
  ON CONFLICT (client_id) DO UPDATE SET
    redirect_uris = COALESCE(
      (
        SELECT jsonb_agg(DISTINCT u)
          FROM jsonb_array_elements(oauth_clients.redirect_uris || EXCLUDED.redirect_uris) AS u
      ),
      '[]'::jsonb
    ),
    post_logout_redirect_uris = (
      SELECT jsonb_agg(DISTINCT u)
        FROM jsonb_array_elements(
               COALESCE(oauth_clients.post_logout_redirect_uris, '[]'::jsonb)
               || COALESCE(EXCLUDED.post_logout_redirect_uris, '[]'::jsonb)
             ) AS u
    ),
    allowed_scopes = EXCLUDED.allowed_scopes,
    is_active = true,
    updated_at = now()
`;

/**
 * 쇼핑몰 Android 앱(native/storefront-app)의 redirect URI 2종.
 *
 * 앱 소스의 상수와 **문자 단위로 일치해야 한다** — user-service 의 redirect_uri 매칭은
 * 커스텀 스킴에 대해 exact match 만 허용한다(apps/user-service/src/api/oauth/redirect-uri.ts).
 *   APP_LOGIN     ↔ native/storefront-app/src/auth/pkce-login.ts  APP_LOGIN_REDIRECT
 *   APP_WEBVIEW   ↔ native/storefront-app/src/login/callback.ts   WEBVIEW_LOGIN_REDIRECT
 *
 * 이 값들은 admin API(`POST/PATCH /admin/oauth-clients`)로는 등록할 수 없다 — DTO 의
 * `@IsUrl` 이 http/https/ftp 만 통과시켜 커스텀 스킴을 거부한다. 그래서 시드가 유일한
 * 등록 경로다.
 */
export const STOREFRONT_APP_LOGIN_REDIRECT = 'almondyoung://oauth/callback';
export const STOREFRONT_APP_WEBVIEW_REDIRECT = 'almondyoung://callback/oidc';

/**
 * 앱 자체 public client (PKCE). public 이므로 secret 은 발급되지 않는다.
 * scope 는 앱의 loginWithPkce 요청값과 일치시킨다.
 */
export const STOREFRONT_APP_CLIENT_SEED: OAuthClientSeed = {
  clientId: 'almondyoung-android-app',
  clientType: 'public',
  redirectUris: [STOREFRONT_APP_LOGIN_REDIRECT],
  allowedScopes: ['openid', 'profile', 'email'],
};

export const USER_SERVICE_REFERENCE_ROLES = [
  { roleId: FIXED_UUIDS.ROLE_MASTER, name: 'master', description: '마스터' },
  { roleId: FIXED_UUIDS.ROLE_ADMIN, name: 'admin', description: '관리자' },
  { roleId: FIXED_UUIDS.ROLE_MEMBERSHIP, name: 'membership', description: '멤버십 회원' },
  { roleId: FIXED_UUIDS.ROLE_USER, name: 'user', description: '일반 회원' },
  {
    roleId: FIXED_UUIDS.ROLE_LOGISTICS_WORKER,
    name: 'logistics_worker',
    description: '물류 작업자',
  },
  {
    roleId: FIXED_UUIDS.ROLE_LOGISTICS_MANAGER,
    name: 'logistics_manager',
    description: '물류 관리자',
  },
];

const ROLES = USER_SERVICE_REFERENCE_ROLES;

const SCOPES = [
  { key: 'master', description: '마스터 권한', microservice_name: 'user-service' },
  { key: 'user:read', description: '사용자 - 사용자 정보 조회', microservice_name: 'user-service' },
  { key: 'user:modify', description: '사용자 - 사용자 정보 생성, 수정', microservice_name: 'user-service' },
  { key: 'user:delete', description: '사용자 - 사용자 정보 삭제', microservice_name: 'user-service' },
  { key: 'admin:access', description: '관리자 페이지 접근 권한 (베이스라인)', microservice_name: 'user-service' },
  { key: 'admin:users:*', description: '관리자 - 사용자 전체 권한', microservice_name: 'user-service' },
  { key: 'admin:users:read', description: '관리자 - 회원 조회', microservice_name: 'user-service' },
  { key: 'admin:users:modify', description: '관리자 - 회원 수정', microservice_name: 'user-service' },
  { key: 'admin:users:archive', description: '관리자 - 회원 보관', microservice_name: 'user-service' },
  { key: 'admin:users:purge', description: '관리자 - 회원 완전삭제', microservice_name: 'user-service' },
  { key: 'admin:settings:*', description: '관리자 - 설정 전체 권한', microservice_name: 'user-service' },
  { key: 'admin:logs:read', description: '관리자 - 로그 조회', microservice_name: 'user-service' },
];

export const USER_SERVICE_REFERENCE_ROLE_SCOPE_MAP: Record<string, string[]> = {
  master: ['master'],
  admin: SCOPES.map((s) => s.key).filter((k) => k !== 'master'),
  // user:delete 는 "본인 계정 탈퇴" 다. 관리자 권한이 아니라 고객이 당연히 가져야 하는 스코프.
  membership: ['user:read', 'user:modify', 'user:delete'],
  user: ['user:read', 'user:modify', 'user:delete'],
};

const ROLE_SCOPE_MAP = USER_SERVICE_REFERENCE_ROLE_SCOPE_MAP;

export class UserServiceSeedStep extends SeedStep {
  readonly groups = ['baseline'] as const;

  private adminPassword: string;
  private oauthClients: OAuthClientSeed[];

  constructor(databaseUrl: string, config: UserServiceSeedConfig) {
    super('User Service', databaseUrl);
    this.adminPassword = config.adminPassword;
    this.oauthClients = config.oauthClients ?? [];
  }

  async check(): Promise<SeedCheckResult> {
    // Roles
    const roleIds = ROLES.map((r) => r.roleId);
    const existingRoles = await this.findExistingIds('roles', roleIds, 'role_id');
    const missingRoles = ROLES.filter((r) => !existingRoles.has(r.roleId));

    // Scopes
    const scopeKeys = SCOPES.map((s) => s.key);
    const existingScopes = await this.findExistingKeys('scopes', scopeKeys, 'key', 'auth');
    const missingScopes = SCOPES.filter((s) => !existingScopes.has(s.key));

    // Role-scope mappings: count total expected vs existing
    const expectedMappings = Object.values(ROLE_SCOPE_MAP).reduce((sum, keys) => sum + keys.length, 0);
    const existingMappingRows = await this.client.unsafe(`SELECT count(*)::int as count FROM auth.role_scope_mapping`);
    const existingMappingCount = existingMappingRows[0].count;

    // Admin user
    const existingUsers = await this.findExistingIds('users', [FIXED_UUIDS.USER_ADMIN]);
    const adminMissing = existingUsers.has(FIXED_UUIDS.USER_ADMIN) ? 0 : 1;

    // Admin user roles
    const adminRoleRows = await this.client`
      SELECT role_id::text FROM user_roles WHERE user_id = ${FIXED_UUIDS.USER_ADMIN}
    `;
    const adminRoleIds = new Set(adminRoleRows.map((r) => r.role_id));
    const expectedAdminRoles = [FIXED_UUIDS.ROLE_MASTER, FIXED_UUIDS.ROLE_ADMIN];
    const missingAdminRoles = expectedAdminRoles.filter((id) => !adminRoleIds.has(id));

    // OAuth clients: 행 자체 존재 + redirectUris/postLogoutRedirectUris 매칭까지 확인.
    // (secret hash 는 회전 가능하므로 "있다 / 일치한다" 만 본다.)
    let oauthMissing = 0;
    const oauthMissingDetails: string[] = [];
    if (this.oauthClients.length > 0) {
      const expectedIds = this.oauthClients.map((c) => c.clientId);
      const existingRows = await this.client.unsafe(
        `SELECT client_id, redirect_uris, post_logout_redirect_uris
           FROM oauth_clients
          WHERE client_id = ANY($1) AND is_active = true`,
        [expectedIds],
      );
      const byId = new Map<string, { redirect_uris: string[]; post_logout_redirect_uris: string[] | null }>(
        existingRows.map((r) => [
          r.client_id as string,
          {
            redirect_uris: (r.redirect_uris as string[]) ?? [],
            post_logout_redirect_uris: (r.post_logout_redirect_uris as string[] | null) ?? null,
          },
        ]),
      );
      for (const seed of this.oauthClients) {
        const existing = byId.get(seed.clientId);
        if (!existing) {
          oauthMissing++;
          oauthMissingDetails.push(`${seed.clientId} (missing row)`);
          continue;
        }
        const redirectsOk = seed.redirectUris.every((u) => existing.redirect_uris.includes(u));
        const postLogout = seed.postLogoutRedirectUris ?? [];
        const postLogoutOk =
          postLogout.length === 0 ||
          ((existing.post_logout_redirect_uris ?? []).length > 0 &&
            postLogout.every((u) => (existing.post_logout_redirect_uris ?? []).includes(u)));
        if (!redirectsOk || !postLogoutOk) {
          oauthMissing++;
          oauthMissingDetails.push(`${seed.clientId} (uri drift)`);
        }
      }
    }

    const items = [
      {
        entity: 'roles',
        expected: ROLES.length,
        existing: existingRoles.size,
        missing: missingRoles.length,
        missingDetails: missingRoles.map((r) => r.name),
      },
      {
        entity: 'auth.scopes',
        expected: SCOPES.length,
        existing: existingScopes.size,
        missing: missingScopes.length,
        missingDetails: missingScopes.map((s) => s.key),
      },
      {
        entity: 'auth.role_scope_mapping',
        expected: expectedMappings,
        existing: Math.min(existingMappingCount, expectedMappings),
        missing: Math.max(0, expectedMappings - existingMappingCount),
      },
      {
        entity: 'users (admin)',
        expected: 1,
        existing: 1 - adminMissing,
        missing: adminMissing,
        missingDetails: adminMissing > 0 ? ['admin'] : undefined,
      },
      {
        entity: 'user_roles (admin)',
        expected: expectedAdminRoles.length,
        existing: expectedAdminRoles.length - missingAdminRoles.length,
        missing: missingAdminRoles.length,
        missingDetails: missingAdminRoles.map((id) => ROLES.find((r) => r.roleId === id)?.name ?? id),
      },
      ...(this.oauthClients.length > 0
        ? [
            {
              entity: 'oauth_clients',
              expected: this.oauthClients.length,
              existing: this.oauthClients.length - oauthMissing,
              missing: oauthMissing,
              missingDetails: oauthMissing > 0 ? oauthMissingDetails : undefined,
            },
          ]
        : []),
    ];

    const isFullySeeded = items.every((i) => i.missing === 0);
    const totalMissing = items.reduce((sum, i) => sum + i.missing, 0);

    return {
      service: 'User Service',
      items,
      isFullySeeded,
      summary: isFullySeeded ? 'All User Service seed data present' : `${totalMissing} missing record(s)`,
    };
  }

  async apply(): Promise<SeedApplyResult> {
    const start = Date.now();
    let itemsApplied = 0;

    try {
      // Step 1: Roles
      this.logger.step(1, 6, 'Inserting roles');
      for (const role of ROLES) {
        await this.db.execute(sql`
          INSERT INTO roles (role_id, name, description)
          VALUES (${role.roleId}, ${role.name}, ${role.description})
          ON CONFLICT (role_id) DO NOTHING
        `);
      }
      itemsApplied += ROLES.length;

      // Step 2: Scopes
      this.logger.step(2, 6, 'Upserting auth.scopes');
      for (const scope of SCOPES) {
        await this.db.execute(sql`
          INSERT INTO auth.scopes (key, description, microservice_name)
          VALUES (${scope.key}, ${scope.description}, ${scope.microservice_name})
          ON CONFLICT (key) DO NOTHING
        `);
      }
      itemsApplied += SCOPES.length;

      // Step 3: Role-scope mappings
      this.logger.step(3, 6, 'Upserting auth.role_scope_mapping');
      for (const [roleName, scopeKeys] of Object.entries(ROLE_SCOPE_MAP)) {
        for (const scopeKey of scopeKeys) {
          await this.db.execute(sql`
            INSERT INTO auth.role_scope_mapping (role_name, scope_id)
            SELECT ${roleName}, id FROM auth.scopes WHERE key = ${scopeKey}
            ON CONFLICT (role_name, scope_id) DO NOTHING
          `);
        }
      }

      // Step 4: Admin user
      this.logger.step(4, 6, 'Creating admin user');
      const hashedPassword = await bcrypt.hash(this.adminPassword, 10);
      await this.db.execute(sql`
        INSERT INTO users (id, login_id, username, nickname, email, password, is_email_verified)
        VALUES (
          ${FIXED_UUIDS.USER_ADMIN}, ${'admin'}, ${'Admin User'}, ${'관리자'},
          ${'admin@almondyoung.com'}, ${hashedPassword}, ${true}
        )
        ON CONFLICT (id) DO NOTHING
      `);
      itemsApplied += 1;

      // Step 5: Admin roles
      this.logger.step(5, 6, 'Assigning master and admin roles to admin user');
      await this.db.execute(sql`
        INSERT INTO user_roles (user_id, role_id)
        VALUES (${FIXED_UUIDS.USER_ADMIN}, ${FIXED_UUIDS.ROLE_MASTER})
        ON CONFLICT DO NOTHING
      `);
      await this.db.execute(sql`
        INSERT INTO user_roles (user_id, role_id)
        VALUES (${FIXED_UUIDS.USER_ADMIN}, ${FIXED_UUIDS.ROLE_ADMIN})
        ON CONFLICT DO NOTHING
      `);
      itemsApplied += 2;

      // Step 6: Assign 'user' role to all existing users without any role
      const totalSteps = this.oauthClients.length > 0 ? 7 : 6;
      this.logger.step(6, totalSteps, 'Assigning user role to existing users without roles');
      await this.db.execute(sql`
        INSERT INTO user_roles (user_id, role_id)
        SELECT u.id, r.role_id
        FROM users u
          CROSS JOIN roles r
        WHERE r.name = 'user'
          AND NOT EXISTS (
            SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id
          )
        ON CONFLICT DO NOTHING
      `);

      // Step 7: OAuth clients (멱등 upsert — 기존 secret_hash 는 덮지 않음).
      if (this.oauthClients.length > 0) {
        this.logger.step(7, totalSteps, 'Upserting OAuth clients');
        for (const seed of this.oauthClients) {
          const isPublic = seed.clientType === 'public';
          const plaintextSecret = isPublic ? null : (seed.clientSecret ?? crypto.randomBytes(32).toString('base64url'));
          // public client 는 secret 미사용이지만 schema NOT NULL 만족용 dummy hash. confidential 은 진짜 hash.
          const secretHash = await bcrypt.hash(plaintextSecret ?? crypto.randomBytes(32).toString('hex'), 10);

          await this.db.execute(sql`
            INSERT INTO oauth_clients (
              client_id, client_type, client_secret_hash,
              redirect_uris, post_logout_redirect_uris, allowed_scopes, is_active
            )
            VALUES (
              ${seed.clientId},
              ${seed.clientType},
              ${secretHash},
              ${JSON.stringify(seed.redirectUris)}::jsonb,
              ${seed.postLogoutRedirectUris ? JSON.stringify(seed.postLogoutRedirectUris) : null}::jsonb,
              ${seed.allowedScopes ? JSON.stringify(seed.allowedScopes) : null}::jsonb,
              true
            )
            ${OAUTH_CLIENT_UPSERT_ON_CONFLICT}
          `);

          if (!isPublic && plaintextSecret && !seed.clientSecret) {
            // env 미주입으로 우리가 secret 을 생성한 경우에만 1회 출력. 캡처해서 RP env 에 옮겨야 함.
            // (다음 실행에서는 기존 행이 있어 ON CONFLICT 가 secret_hash 를 안 건드리므로 안전.)
            this.logger.warn(
              `Generated client_secret for "${seed.clientId}" — capture this value (will not be shown again):\n  ${plaintextSecret}`,
            );
          }
          itemsApplied += 1;
        }
      }

      this.logger.success('User Service seeding completed');
      return { service: 'User Service', success: true, itemsApplied, duration: Date.now() - start };
    } catch (error: any) {
      this.logger.error('User Service seeding failed', error);
      return {
        service: 'User Service',
        success: false,
        itemsApplied,
        duration: Date.now() - start,
        error: error.message,
      };
    }
  }
}
