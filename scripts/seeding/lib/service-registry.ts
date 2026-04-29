import { ServiceConfig } from './types';

/**
 * Single source of truth for service → database → drizzle config mapping.
 *
 * Use getServiceRegistry(deployment) to get the correct registry for a deployment.
 *   - undefined / 'root'  → original multi-service layout (pim, wms separate)
 *   - 'df'                → monolithic layout (pim/wms absorbed into almondyoung-server, DB = "core")
 */

const ROOT_REGISTRY: ServiceConfig[] = [
  { name: 'user-service', database: 'user_service', drizzleConfig: 'apps/user-service/database/drizzle/drizzle.config.ts', hasSeedStep: true },
  { name: 'analytics', database: 'analytics', drizzleConfig: 'apps/analytics/drizzle.config.ts', hasSeedStep: false },
  { name: 'channel-adapter', database: 'channel_adapter', drizzleConfig: 'apps/channel-adapter/drizzle.config.ts', hasSeedStep: false },
  { name: 'membership', database: 'membership', drizzleConfig: 'apps/membership/drizzle.config.ts', hasSeedStep: true },
  { name: 'notification', database: 'notification', drizzleConfig: 'apps/notification/database/drizzle/drizzle.config.ts', hasSeedStep: true },
  { name: 'pim', database: 'pim', drizzleConfig: 'apps/pim/drizzle.config.ts', hasSeedStep: true },
  { name: 'ugc-service', database: 'ugc', drizzleConfig: 'apps/ugc-service/src/db/drizzle.config.ts', hasSeedStep: false },
  { name: 'wms', database: 'wms', drizzleConfig: 'apps/wms/database/drizzle/drizzle.config.ts', hasSeedStep: true },
  { name: 'wallet', database: 'wallet', drizzleConfig: 'apps/wallet/drizzle.config.ts', hasSeedStep: false },
  { name: 'file-service', database: 'file_service', drizzleConfig: 'apps/file-service/src/database/drizzle/drizzle.config.ts', hasSeedStep: true },
  { name: 'almondyoung-server', database: 'almondyoung_server', drizzleConfig: 'apps/almondyoung-server/drizzle.config.ts', hasSeedStep: false },
  { name: 'medusa', database: 'medusa', hasSeedStep: false },
];

/**
 * df 배포: pim/wms가 almondyoung-server에 흡수됨.
 * - almondyoung-server → DB "core", drizzle config가 catalog+inventory 스키마 모두 포함
 * - pim, wms → 별도 항목 제거 (스키마/DB가 core에 통합)
 * - notification → df에 배포되지 않으므로 제거
 */
const DF_REGISTRY: ServiceConfig[] = [
  { name: 'almondyoung-server', database: 'core', drizzleConfig: 'apps/almondyoung-server/drizzle.config.ts', hasSeedStep: true },
  { name: 'user-service', database: 'user_service', drizzleConfig: 'apps/user-service/database/drizzle/drizzle.config.ts', hasSeedStep: true },
  { name: 'analytics', database: 'analytics', drizzleConfig: 'apps/analytics/drizzle.config.ts', hasSeedStep: false },
  { name: 'channel-adapter', database: 'channel_adapter', drizzleConfig: 'apps/channel-adapter/drizzle.config.ts', hasSeedStep: false },
  { name: 'membership', database: 'membership', drizzleConfig: 'apps/membership/drizzle.config.ts', hasSeedStep: true },
  { name: 'ugc-service', database: 'ugc', drizzleConfig: 'apps/ugc-service/src/db/drizzle.config.ts', hasSeedStep: false },
  { name: 'wallet', database: 'wallet', drizzleConfig: 'apps/wallet/drizzle.config.ts', hasSeedStep: false },
  { name: 'file-service', database: 'file_service', drizzleConfig: 'apps/file-service/src/database/drizzle/drizzle.config.ts', hasSeedStep: true },
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
 * pim/wms는 almondyoung-server(core)에 흡수되어 별도 항목 없음.
 * DB는 `sst.aws.Postgres("Db")` 리소스 (db-connection.ts가 자동 감지).
 */
const LCNINE_SERVICES_REGISTRY: ServiceConfig[] = [
  { name: 'almondyoung-server', database: 'core', drizzleConfig: 'apps/almondyoung-server/drizzle.config.ts', hasSeedStep: true },
  { name: 'analytics', database: 'analytics', drizzleConfig: 'apps/analytics/drizzle.config.ts', hasSeedStep: false },
  { name: 'channel-adapter', database: 'channel_adapter', drizzleConfig: 'apps/channel-adapter/drizzle.config.ts', hasSeedStep: false },
  { name: 'membership', database: 'membership', drizzleConfig: 'apps/membership/drizzle.config.ts', hasSeedStep: true },
  { name: 'notification', database: 'notification', drizzleConfig: 'apps/notification/database/drizzle/drizzle.config.ts', hasSeedStep: true },
  { name: 'ugc-service', database: 'ugc', drizzleConfig: 'apps/ugc-service/src/db/drizzle.config.ts', hasSeedStep: false },
  { name: 'wallet', database: 'wallet', drizzleConfig: 'apps/wallet/drizzle.config.ts', hasSeedStep: false },
  { name: 'file-service', database: 'file_service', drizzleConfig: 'apps/file-service/src/database/drizzle/drizzle.config.ts', hasSeedStep: true },
  { name: 'medusa', database: 'medusa', hasSeedStep: false },
];

const REGISTRIES: Record<string, ServiceConfig[]> = {
  root: ROOT_REGISTRY,
  df: DF_REGISTRY,
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
