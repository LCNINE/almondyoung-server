import { ServiceConfig } from './types';

/**
 * Single source of truth for service → database → drizzle config mapping.
 * Single source of truth for all service → database → drizzle config mapping.
 */
export const SERVICE_REGISTRY: ServiceConfig[] = [
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
  { name: 'medusa', database: 'medusa', hasSeedStep: false },
];
