import { join } from 'node:path';
import type { StaffClient } from '../../tenancy/staff-token';
import { readEnvFile, REPO } from '../create-tenant/local-ports';

/** 로컬 테넌트 1 — 이 시드는 테넌트 1 만 다룬다(① ② 두 모드 공통). */
export const TENANT_ONE = '1';
/** 부천 물류창고 — WmsSeedStep 의 고정 id(`scripts/seeding/constants/uuids.ts`). */
export const BUCHEON_WAREHOUSE_ID = '019d0001-0001-7000-a000-000000000001';
/** seed-user-service-local.ts 가 등록한 스토어프론트 콜백 — Medusa SSO 의 callback_url 로도 쓴다. */
export const STOREFRONT_CALLBACK = 'http://localhost:8000/kr/callback/oidc';

export interface OrderPathConfig {
  coreUrl: string;
  userServiceUrl: string;
  walletUrl: string;
  channelAdapterUrl: string;
  medusaUrl: string;
  /** Medusa admin secret key(`sk_…`) — channel-adapter 가 쓰는 값. Basic 인증으로 싣는다. */
  medusaAdminKey: string;
  publishableKey: string;
  channelAdapterInternalKey: string;
  oauthInternalSecret: string;
  userServiceDbUrl: string;
  /** 직원 토큰 = signInStaff(adminWebClient, 'admin', adminPassword, TENANT_ONE) */
  adminWebClient: StaffClient;
  adminPassword: string;
}

interface AppRow {
  name: string;
  port: number;
  env: Record<string, string>;
}

/** 정본 표(`e2e-env-map.sh`)에서 — `order-path-local.sh` 가 `E2E_ENV_ROWS_FLAT` 로 넘긴다. */
function apps(): AppRow[] {
  const flat = process.env.E2E_ENV_ROWS_FLAT;
  if (!flat)
    throw new Error('E2E_ENV_ROWS_FLAT 가 없다 — npm run seed:order-path:local / order:place:local 로 부를 것');
  return flat
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, dest, , port] = line.split('|');
      return { name, port: Number(port), env: readEnvFile(join(REPO, dest)) };
    });
}

function localOnly(name: string, value: string): string {
  if (!/^(https?|postgres(ql)?):\/\/([^@/]*@)?(localhost|127\.0\.0\.1)[:/]/.test(value)) {
    throw new Error(`로컬 전용이다 — ${name} 이 localhost 가 아니다: ${value}`);
  }
  return value;
}

function need(row: AppRow | undefined, app: string, key: string): string {
  const v = row?.env[key];
  if (!v) throw new Error(`${app} 의 .env 에 ${key} 가 없다 → npm run bootstrap:e2e:local`);
  return v;
}

export function loadOrderPathConfig(): OrderPathConfig {
  const rows = apps();
  const row = (name: string) => rows.find((r) => r.name === name);
  const url = (name: string) => {
    const r = row(name);
    if (!r || Object.keys(r.env).length === 0) {
      throw new Error(`${name} 의 .env 가 없다 → npm run bootstrap:e2e:local -- --install-env`);
    }
    return localOnly(name, `http://localhost:${r.port}`);
  };
  const userService = row('user-service');
  const adminWeb = row('admin-web');
  const userServiceUrl = url('user-service');
  const oauthInternalSecret = need(userService, 'user-service', 'OAUTH_INTERNAL_SECRET');
  const pg = process.env.LOCAL_PG ?? 'postgresql://postgres:postgres@localhost:5432';

  return {
    coreUrl: url('core'),
    userServiceUrl,
    walletUrl: url('wallet'),
    channelAdapterUrl: url('channel-adapter'),
    medusaUrl: url('medusa'),
    medusaAdminKey: need(row('channel-adapter'), 'channel-adapter', 'MEDUSA_API_KEY'),
    publishableKey: need(row('storefront'), 'storefront', 'NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY'),
    channelAdapterInternalKey: need(row('channel-adapter'), 'channel-adapter', 'CHANNEL_ADAPTER_INTERNAL_KEY'),
    oauthInternalSecret,
    userServiceDbUrl: localOnly('user-service DB', process.env.USER_SERVICE_DATABASE_URL ?? `${pg}/user_service`),
    adminWebClient: {
      baseUrl: userServiceUrl,
      internalSecret: oauthInternalSecret,
      clientId: adminWeb?.env.OIDC_CLIENT_ID ?? 'admin-web',
      clientSecret: need(adminWeb, 'admin-web', 'OIDC_CLIENT_SECRET'),
      // seed-user-service-local.ts 가 등록한 주소 — host 가 토큰 테넌트(1)를 정한다.
      redirectUri: 'http://localhost:8002/auth/callback',
    },
    adminPassword: process.env.LOCAL_ADMIN_PASSWORD ?? 'Rehearsal1234!',
  };
}

/** Medusa admin API 헤더 — secret key 의 Basic 인증(`sync-medusa-keys.sh` 와 같은 방식). */
export function medusaAdminHeaders(cfg: OrderPathConfig): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`${cfg.medusaAdminKey}:`).toString('base64')}` };
}
