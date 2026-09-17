import * as bcrypt from 'bcrypt';
import { SeedStep } from './base-seed-step';
import { SeedApplyResult, SeedCheckResult } from '../lib/types';
import { FIXED_UUIDS } from '../constants/uuids';

export const DEMO_AUTH_ACCOUNTS = [
  {
    id: '019f1010-0001-7000-a000-000000000001',
    login: 'demoadmin',
    name: '시연 관리자',
    passwordEnv: 'DEMO_ADMIN_PASSWORD',
    roles: [FIXED_UUIDS.ROLE_ADMIN, FIXED_UUIDS.ROLE_MASTER, FIXED_UUIDS.ROLE_LOGISTICS_MANAGER],
  },
  {
    id: '019f1010-0002-7000-a000-000000000002',
    login: 'demoworker',
    name: '시연 작업자',
    passwordEnv: 'DEMO_WORKER_PASSWORD',
    roles: [FIXED_UUIDS.ROLE_LOGISTICS_WORKER],
  },
];

function assertDemo(): void {
  const resourceStage = process.env.SST_RESOURCE_App ? JSON.parse(process.env.SST_RESOURCE_App).stage : undefined;
  const stages = [process.env.SST_STAGE, resourceStage].filter(Boolean);
  if (!stages.length || stages.some((stage) => stage !== 'demo'))
    throw new Error('Logistics accounts can only be seeded in demo');
}

export class DemoLogisticsAuthSeedStep extends SeedStep {
  readonly groups = ['demo-logistics'] as const;
  constructor(databaseUrl: string) {
    super('Demo logistics authentication', databaseUrl);
  }

  async check(): Promise<SeedCheckResult> {
    assertDemo();
    const users = await this
      .client`SELECT id,login_id,password FROM users WHERE id = ANY(${DEMO_AUTH_ACCOUNTS.map((account) => account.id)})`;
    for (const account of DEMO_AUTH_ACCOUNTS) {
      const existing = users.find((user) => user.id === account.id);
      const supplied = process.env[account.passwordEnv];
      if (existing && supplied && !(await bcrypt.compare(supplied, existing.password))) {
        throw new Error(
          `Existing ${account.login} password does not match supplied credentials; use explicit password reset`,
        );
      }
    }
    const clients = await this
      .client`SELECT client_id,client_type,redirect_uris,post_logout_redirect_uris,client_secret_hash FROM oauth_clients WHERE client_id IN ('admin-web','warehouse-app') AND is_active`;
    const validClients = clients.filter((client) =>
      client.client_id === 'admin-web'
        ? client.client_type === 'confidential' &&
          JSON.stringify(client.redirect_uris) ===
            JSON.stringify(['https://admin.almondyoung-next.com/auth/callback']) &&
          JSON.stringify(client.post_logout_redirect_uris) ===
            JSON.stringify(['https://admin.almondyoung-next.com/login'])
        : client.client_type === 'public' &&
          JSON.stringify(client.redirect_uris) ===
            JSON.stringify(['http://127.0.0.1/callback', 'almondwms-demo://oauth/callback']),
    );
    const adminClient = clients.find((client) => client.client_id === 'admin-web');
    if (
      adminClient &&
      process.env.ADMIN_WEB_OIDC_CLIENT_SECRET &&
      !(await bcrypt.compare(process.env.ADMIN_WEB_OIDC_CLIENT_SECRET, adminClient.client_secret_hash))
    ) {
      throw new Error(
        'Existing demo admin-web secret does not match the supplied secret; use explicit client secret rotation',
      );
    }
    const rolePairs = DEMO_AUTH_ACCOUNTS.reduce((count, account) => count + account.roles.length, 0);
    const roles = await this
      .client`SELECT user_id,role_id FROM user_roles WHERE user_id = ANY(${DEMO_AUTH_ACCOUNTS.map((account) => account.id)})`;
    const presentRoles = DEMO_AUTH_ACCOUNTS.reduce(
      (count, account) =>
        count +
        account.roles.filter((role) => roles.some((row) => row.user_id === account.id && row.role_id === role)).length,
      0,
    );
    const validUsers = DEMO_AUTH_ACCOUNTS.filter((account) =>
      users.some((user) => user.id === account.id && user.login_id === account.login),
    );
    const unexpectedWorkerRoles = roles.filter(
      (role) => role.user_id === DEMO_AUTH_ACCOUNTS[1].id && role.role_id !== FIXED_UUIDS.ROLE_LOGISTICS_WORKER,
    );
    const items = [
      {
        entity: 'worker privilege isolation',
        expected: 0,
        existing: unexpectedWorkerRoles.length,
        missing: unexpectedWorkerRoles.length,
      },
      { entity: 'demo accounts', expected: 2, existing: validUsers.length, missing: 2 - validUsers.length },
      { entity: 'demo OAuth clients', expected: 2, existing: validClients.length, missing: 2 - validClients.length },
      { entity: 'demo roles', expected: rolePairs, existing: presentRoles, missing: rolePairs - presentRoles },
    ];
    return {
      service: this.serviceName,
      items,
      isFullySeeded: items.every((item) => item.missing === 0),
      summary: 'Demo administrators, warehouse operators and OAuth clients',
    };
  }

  async apply(): Promise<SeedApplyResult> {
    assertDemo();
    const started = Date.now();
    for (const key of ['DEMO_ADMIN_PASSWORD', 'DEMO_WORKER_PASSWORD', 'ADMIN_WEB_OIDC_CLIENT_SECRET']) {
      if ((process.env[key]?.length ?? 0) < 16) throw new Error(`${key} must be supplied with at least 16 characters`);
    }
    for (const key of ['DEMO_ADMIN_PASSWORD', 'DEMO_WORKER_PASSWORD']) {
      if (process.env[key]!.length > 20) throw new Error(`${key} must fit the sign-in limit of 20 characters`);
    }
    const hashes = await Promise.all(
      DEMO_AUTH_ACCOUNTS.map((account) => bcrypt.hash(process.env[account.passwordEnv]!, 10)),
    );
    const clientHash = await bcrypt.hash(process.env.ADMIN_WEB_OIDC_CLIENT_SECRET!, 10);
    const publicHash = await bcrypt.hash('public-client-does-not-use-a-secret', 10);
    await this.client.begin(async (transaction) => {
      const tx = transaction as unknown as typeof this.client;
      for (let i = 0; i < DEMO_AUTH_ACCOUNTS.length; i++) {
        const account = DEMO_AUTH_ACCOUNTS[i];
        await tx`INSERT INTO users (id,login_id,username,nickname,email,password,is_email_verified)
          VALUES (${account.id},${account.login},${account.name},${account.name},${account.login + '@almondyoung-next.com'},${hashes[i]},true)
          ON CONFLICT (id) DO UPDATE SET login_id=EXCLUDED.login_id`;
        for (const role of account.roles)
          await tx`INSERT INTO user_roles (user_id,role_id) VALUES (${account.id},${role}) ON CONFLICT DO NOTHING`;
      }
      await tx`DELETE FROM user_roles WHERE user_id=${DEMO_AUTH_ACCOUNTS[1].id} AND role_id <> ${FIXED_UUIDS.ROLE_LOGISTICS_WORKER}`;
      const scopes = JSON.stringify(['openid', 'profile', 'email', 'offline_access']);
      await tx`INSERT INTO oauth_clients (client_id,client_type,client_secret_hash,redirect_uris,post_logout_redirect_uris,allowed_scopes,is_active)
        VALUES ('admin-web','confidential',${clientHash},${JSON.stringify(['https://admin.almondyoung-next.com/auth/callback'])}::jsonb,${JSON.stringify(['https://admin.almondyoung-next.com/login'])}::jsonb,${scopes}::jsonb,true)
        ON CONFLICT (client_id) DO UPDATE SET client_type='confidential',redirect_uris=EXCLUDED.redirect_uris,post_logout_redirect_uris=EXCLUDED.post_logout_redirect_uris,allowed_scopes=EXCLUDED.allowed_scopes,is_active=true`;
      await tx`INSERT INTO oauth_clients (client_id,client_type,client_secret_hash,redirect_uris,allowed_scopes,is_active)
        VALUES ('warehouse-app','public',${publicHash},${JSON.stringify(['http://127.0.0.1/callback', 'almondwms-demo://oauth/callback'])}::jsonb,${scopes}::jsonb,true)
        ON CONFLICT (client_id) DO UPDATE SET client_type='public',redirect_uris=EXCLUDED.redirect_uris,allowed_scopes=EXCLUDED.allowed_scopes,is_active=true`;
    });
    return { service: this.serviceName, success: true, itemsApplied: 9, duration: Date.now() - started };
  }
}
