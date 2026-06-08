import { ServiceConfig } from './types';

/**
 * Single source of truth for service → database → drizzle config mapping.
 *
 * Use getServiceRegistry(deployment) to get the correct registry for a deployment.
 *   - undefined / 'root'  → core (catalog+inventory 통합) + 부속 서비스
 */

const ROOT_REGISTRY: ServiceConfig[] = [
  { name: 'core', database: 'core', drizzleConfig: 'apps/core/drizzle.config.ts', hasSeedStep: true },
  { name: 'user-service', database: 'user_service', drizzleConfig: 'apps/user-service/database/drizzle/drizzle.config.ts', hasSeedStep: true },
  { name: 'analytics', database: 'analytics', drizzleConfig: 'apps/analytics/drizzle.config.ts', hasSeedStep: false },
  { name: 'channel-adapter', database: 'channel_adapter', drizzleConfig: 'apps/channel-adapter/drizzle.config.ts', hasSeedStep: false },
  { name: 'membership', database: 'membership', drizzleConfig: 'apps/membership/drizzle.config.ts', hasSeedStep: true },
  { name: 'notification', database: 'notification', drizzleConfig: 'apps/notification/database/drizzle/drizzle.config.ts', hasSeedStep: true },
  { name: 'ugc-service', database: 'ugc', drizzleConfig: 'apps/ugc-service/src/db/drizzle.config.ts', hasSeedStep: false },
  { name: 'wallet', database: 'wallet', drizzleConfig: 'apps/wallet/drizzle.config.ts', hasSeedStep: true },
  { name: 'file-service', database: 'file_service', drizzleConfig: 'apps/file-service/drizzle.config.ts', hasSeedStep: true },
  { name: 'medusa', database: 'medusa', hasSeedStep: false },
];

/**
 * lcnine-auth 배포: IdP 전용. user-service 한 개만 포함.
 * DB는 `sst.aws.Postgres("IdpDb")` 리소스 (db-connection.ts가 자동 감지).
 */
const LCNINE_AUTH_REGISTRY: ServiceConfig[] = [
  { name: 'user-service', database: 'user_service', drizzleConfig: 'apps/user-service/database/drizzle/drizzle.config.ts', hasSeedStep: true },
];

/**
 * lcnine-services 배포: 커머스/물류/결제 도메인 서비스.
 * user-service는 lcnine-auth가 별도 소유하므로 제외.
 * core 에 catalog+inventory 가 통합되어 있음.
 * DB는 `sst.aws.Postgres("Db")` 리소스 (db-connection.ts가 자동 감지).
 */
const LCNINE_SERVICES_REGISTRY: ServiceConfig[] = [
  { name: 'core', database: 'core', drizzleConfig: 'apps/core/drizzle.config.ts', hasSeedStep: true },
  { name: 'analytics', database: 'analytics', drizzleConfig: 'apps/analytics/drizzle.config.ts', hasSeedStep: false },
  { name: 'channel-adapter', database: 'channel_adapter', drizzleConfig: 'apps/channel-adapter/drizzle.config.ts', hasSeedStep: false },
  { name: 'membership', database: 'membership', drizzleConfig: 'apps/membership/drizzle.config.ts', hasSeedStep: true },
  { name: 'notification', database: 'notification', drizzleConfig: 'apps/notification/database/drizzle/drizzle.config.ts', hasSeedStep: true },
  { name: 'ugc-service', database: 'ugc', drizzleConfig: 'apps/ugc-service/src/db/drizzle.config.ts', hasSeedStep: false },
  { name: 'wallet', database: 'wallet', drizzleConfig: 'apps/wallet/drizzle.config.ts', hasSeedStep: true },
  { name: 'file-service', database: 'file_service', drizzleConfig: 'apps/file-service/drizzle.config.ts', hasSeedStep: true },
  { name: 'medusa', database: 'medusa', hasSeedStep: false },
];

const REGISTRIES: Record<string, ServiceConfig[]> = {
  root: ROOT_REGISTRY,
  'lcnine-auth': LCNINE_AUTH_REGISTRY,
  'lcnine-services': LCNINE_SERVICES_REGISTRY,
};

export function getServiceRegistry(deployment?: string): ServiceConfig[] {
  const key = deployment ?? 'root';
  const registry = REGISTRIES[key];
  if (!registry) {
    throw new Error(`Unknown deployment "${key}". Available: ${Object.keys(REGISTRIES).join(', ')}`);
  }
  return registry;
}

/** @deprecated Use getServiceRegistry() instead */
export const SERVICE_REGISTRY = ROOT_REGISTRY;
