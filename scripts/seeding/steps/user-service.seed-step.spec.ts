import { readFileSync } from 'fs';
import { join } from 'path';
import {
  UserServiceSeedStep,
  USER_SERVICE_REFERENCE_ROLES as ORCHESTRATED_ROLES,
  USER_SERVICE_REFERENCE_ROLE_SCOPE_MAP as ORCHESTRATED_ROLE_SCOPE_MAP,
  STOREFRONT_APP_CLIENT_SEED as ORCHESTRATED_APP_CLIENT,
  STOREFRONT_APP_LOGIN_REDIRECT as ORCHESTRATED_APP_LOGIN_REDIRECT,
  STOREFRONT_APP_WEBVIEW_REDIRECT as ORCHESTRATED_APP_WEBVIEW_REDIRECT,
} from './user-service.seed-step';
import {
  USER_SERVICE_REFERENCE_ROLES as LEGACY_ROLES,
  USER_SERVICE_REFERENCE_ROLE_SCOPE_MAP as LEGACY_ROLE_SCOPE_MAP,
} from '../../seed-data/seeders/03-user-service.seeder';
import {
  STOREFRONT_APP_CLIENT_SEED as LEGACY_APP_CLIENT,
  STOREFRONT_APP_LOGIN_REDIRECT as LEGACY_APP_LOGIN_REDIRECT,
  STOREFRONT_APP_WEBVIEW_REDIRECT as LEGACY_APP_WEBVIEW_REDIRECT,
} from '../../seed-data/shared/oauth-client-seeds';
import { FIXED_UUIDS as ORCHESTRATED_UUIDS } from '../constants/uuids';
import { FIXED_UUIDS as LEGACY_UUIDS } from '../../seed-data/constants/uuids';
import { PgDialect } from 'drizzle-orm/pg-core';

describe('storefront app OAuth client seed', () => {
  const APP_ROOT = join(__dirname, '../../../native/storefront-app/src');

  /** 앱 소스에서 `export const <NAME> = "<uri>"` 의 문자열 리터럴을 뽑는다. */
  function readAppConstant(relativePath: string, name: string): string {
    const source = readFileSync(join(APP_ROOT, relativePath), 'utf8');
    const match = new RegExp(`export const ${name}\\s*=\\s*"([^"]+)"`).exec(source);
    if (!match) throw new Error(`${name} not found in ${relativePath}`);
    return match[1];
  }

  // 앱과 시드가 어긋나면 로그인이 invalid redirect_uri 로 죽는다. 커스텀 스킴은
  // exact match 만 허용되므로 오타 한 글자도 통과하지 못한다.
  it('matches the redirect URIs hardcoded in the app source', () => {
    expect(ORCHESTRATED_APP_LOGIN_REDIRECT).toBe(
      readAppConstant('auth/pkce-login.ts', 'APP_LOGIN_REDIRECT'),
    );
    expect(ORCHESTRATED_APP_WEBVIEW_REDIRECT).toBe(
      readAppConstant('login/callback.ts', 'WEBVIEW_LOGIN_REDIRECT'),
    );
  });

  it('keeps both idempotent reference seed paths in sync', () => {
    expect(ORCHESTRATED_APP_LOGIN_REDIRECT).toBe(LEGACY_APP_LOGIN_REDIRECT);
    expect(ORCHESTRATED_APP_WEBVIEW_REDIRECT).toBe(LEGACY_APP_WEBVIEW_REDIRECT);
    expect(ORCHESTRATED_APP_CLIENT).toEqual(LEGACY_APP_CLIENT);
  });

  // public client 는 PKCE 전용 — secret 이 붙으면 앱이 secret 을 들고 다녀야 한다는 뜻이 된다.
  it('registers the app client as a public PKCE client with the scopes the app requests', () => {
    expect(ORCHESTRATED_APP_CLIENT.clientType).toBe('public');
    expect(ORCHESTRATED_APP_CLIENT.clientSecret).toBeUndefined();
    expect(ORCHESTRATED_APP_CLIENT.allowedScopes).toEqual(['openid', 'profile', 'email']);
  });
});

describe('OAuth client upsert semantics', () => {
  async function renderOAuthUpsert() {
    const execute = jest.fn().mockResolvedValue(undefined);
    const step = Object.create(UserServiceSeedStep.prototype) as UserServiceSeedStep;
    Object.assign(step as object, {
      db: { execute },
      logger: { step: jest.fn(), success: jest.fn(), warn: jest.fn(), error: jest.fn() },
      adminPassword: 'seed-test-password',
      oauthClients: [ORCHESTRATED_APP_CLIENT],
    });

    await expect(step.apply()).resolves.toMatchObject({ success: true });

    const dialect = new PgDialect();
    const rendered = execute.mock.calls
      .map(([query]) => dialect.sqlToQuery(query).sql)
      .filter((s) => /insert into oauth_clients/i.test(s));
    expect(rendered).toHaveLength(1);
    return rendered[0];
  }

  // 배열을 통째로 교체하면 시드가 모르는 URI(www 변형, localhost, RP 가 나중에 추가한 것)가
  // 조용히 사라져 해당 경로의 로그인이 즉시 깨진다. 실제 라이브 medusa-storefront 가 그 상태였다.
  it('unions redirect URIs instead of replacing them', async () => {
    const upsert = await renderOAuthUpsert();

    expect(upsert).not.toMatch(/redirect_uris\s*=\s*EXCLUDED\.redirect_uris/i);
    expect(upsert).not.toMatch(/post_logout_redirect_uris\s*=\s*EXCLUDED\.post_logout_redirect_uris/i);
    expect(upsert).toMatch(/redirect_uris\s*=\s*COALESCE/i);
    expect(upsert).toMatch(/jsonb_agg\(DISTINCT/i);
    expect(upsert).toMatch(/oauth_clients\.redirect_uris\s*\|\|\s*EXCLUDED\.redirect_uris/i);
  });

  // 스코프는 권한 부여다 — 합집합으로 두면 축소가 영영 불가능해진다.
  it('still replaces allowed_scopes so scopes can be narrowed', async () => {
    expect(await renderOAuthUpsert()).toMatch(/allowed_scopes\s*=\s*EXCLUDED\.allowed_scopes/i);
  });

  // 한 번 발급된 secret 을 시드가 유실시키면 RP 가 즉시 인증 불가가 된다.
  it('never overwrites an existing client_secret_hash', async () => {
    expect(await renderOAuthUpsert()).not.toMatch(/client_secret_hash\s*=/i);
  });
});

describe('user-service logistics reference roles', () => {
  const expectedLogisticsRoles = [
    {
      roleId: '019d0004-0005-7000-a000-000000000005',
      name: 'logistics_worker',
      description: '물류 작업자',
    },
    {
      roleId: '019d0004-0006-7000-a000-000000000006',
      name: 'logistics_manager',
      description: '물류 관리자',
    },
  ];

  it('uses the same fixed role identities in both idempotent reference seed paths', () => {
    const logisticsOnly = (roles: typeof ORCHESTRATED_ROLES) =>
      roles.filter((role) => role.name.startsWith('logistics_'));

    expect(logisticsOnly(ORCHESTRATED_ROLES)).toEqual(expectedLogisticsRoles);
    expect(logisticsOnly(LEGACY_ROLES)).toEqual(expectedLogisticsRoles);
    expect(ORCHESTRATED_UUIDS.ROLE_LOGISTICS_WORKER).toBe(LEGACY_UUIDS.ROLE_LOGISTICS_WORKER);
    expect(ORCHESTRATED_UUIDS.ROLE_LOGISTICS_MANAGER).toBe(LEGACY_UUIDS.ROLE_LOGISTICS_MANAGER);
    expect(new Set(ORCHESTRATED_ROLES.map((role) => role.roleId)).size).toBe(ORCHESTRATED_ROLES.length);
    expect(new Set(LEGACY_ROLES.map((role) => role.roleId)).size).toBe(LEGACY_ROLES.length);
  });

  it('does not seed role-scope or user assignments for logistics roles', () => {
    expect(ORCHESTRATED_ROLE_SCOPE_MAP).not.toHaveProperty('logistics_worker');
    expect(ORCHESTRATED_ROLE_SCOPE_MAP).not.toHaveProperty('logistics_manager');
    expect(LEGACY_ROLE_SCOPE_MAP).not.toHaveProperty('logistics_worker');
    expect(LEGACY_ROLE_SCOPE_MAP).not.toHaveProperty('logistics_manager');
  });

  it('runs the reference seed path twice with conflict-safe role inserts and no logistics user assignment', async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const step = Object.create(UserServiceSeedStep.prototype) as UserServiceSeedStep;
    Object.assign(step as object, {
      db: { execute },
      logger: {
        step: jest.fn(),
        success: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
      adminPassword: 'seed-test-password',
      oauthClients: [],
    });

    await expect(step.apply()).resolves.toMatchObject({ success: true });
    await expect(step.apply()).resolves.toMatchObject({ success: true });

    const dialect = new PgDialect();
    const renderedQueries = execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));
    const roleInserts = renderedQueries.filter(({ sql }) => /insert into roles/i.test(sql));
    const userRoleInserts = renderedQueries.filter(({ sql }) => /insert into user_roles/i.test(sql));

    expect(roleInserts).toHaveLength(ORCHESTRATED_ROLES.length * 2);
    expect(roleInserts.every(({ sql }) => /on conflict \(role_id\) do nothing/i.test(sql))).toBe(true);
    expect(roleInserts.filter(({ params }) => params.includes(ORCHESTRATED_UUIDS.ROLE_LOGISTICS_WORKER))).toHaveLength(
      2,
    );
    expect(roleInserts.filter(({ params }) => params.includes(ORCHESTRATED_UUIDS.ROLE_LOGISTICS_MANAGER))).toHaveLength(
      2,
    );
    expect(
      userRoleInserts.some(({ params }) =>
        params.some(
          (param) =>
            param === ORCHESTRATED_UUIDS.ROLE_LOGISTICS_WORKER || param === ORCHESTRATED_UUIDS.ROLE_LOGISTICS_MANAGER,
        ),
      ),
    ).toBe(false);
  });
});
