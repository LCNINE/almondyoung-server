/**
 * Fixed UUIDs for seed data (UUIDv7 format)
 *
 * UUIDv7 provides timestamp-based sorting while maintaining uniqueness.
 * These UUIDs are fixed to ensure idempotent seed operations.
 */

export const FIXED_UUIDS = {
  // ==================== WMS ====================

  // Warehouses
  WAREHOUSE_BUCHEON_DOMESTIC: '019d0001-0001-7000-a000-000000000001',
  WAREHOUSE_CHINA_OVERSEAS: '019d0001-0002-7000-a000-000000000002',

  // System Locations - Bucheon
  LOC_BUCHEON_RECEIVING: '019d0002-0001-7000-a000-000000000001',
  LOC_BUCHEON_SHIPPING: '019d0002-0002-7000-a000-000000000002',
  LOC_BUCHEON_DAMAGE: '019d0002-0003-7000-a000-000000000003',
  LOC_BUCHEON_RETURN: '019d0002-0004-7000-a000-000000000004',

  // System Locations - China
  LOC_CHINA_RECEIVING: '019d0002-0005-7000-a000-000000000005',
  LOC_CHINA_SHIPPING: '019d0002-0006-7000-a000-000000000006',
  LOC_CHINA_DAMAGE: '019d0002-0007-7000-a000-000000000007',
  LOC_CHINA_RETURN: '019d0002-0008-7000-a000-000000000008',

  // ==================== PIM ====================

  // Sales Channels
  CHANNEL_ALMONDYOUNG_MEDUSA: '019d0003-0001-7000-a000-000000000001',

  // ==================== User Service ====================

  // Roles
  ROLE_ADMIN: '019d0004-0001-7000-a000-000000000001',
  ROLE_MEMBERSHIP: '019d0004-0002-7000-a000-000000000002',
  ROLE_USER: '019d0004-0003-7000-a000-000000000003',
  ROLE_MASTER: '019d0004-0004-7000-a000-000000000004',

  // Users
  USER_ADMIN: '019d0004-2001-7000-a000-000000000001',
  /**
   * clip(다른 repo)의 시연용 데모 user.
   * 중요: clip/apps/backend/scripts/seeding/fixtures/demo.ts의 DEMO_USER_ID와
   *       동일한 값이어야 cross-repo demo 시드가 같은 계정을 인식한다.
   */
  USER_DEMO: '00000000-0000-4000-8000-000000000001',

  // ==================== Membership ====================

  // Tiers
  TIER_MEMBERSHIP: '019d0005-0001-7000-a000-000000000001',

  // Plans
  PLAN_30DAYS: '019d0005-1001-7000-a000-000000000001',
  PLAN_365DAYS: '019d0005-1002-7000-a000-000000000002',

  // ==================== Notification ====================

  // Providers
  PROVIDER_FCM_PUSH: '019d0007-0001-7000-a000-000000000001',
  PROVIDER_RESEND_EMAIL: '019d0007-0002-7000-a000-000000000002',
  PROVIDER_TWILIO_SMS: '019d0007-0003-7000-a000-000000000003',
  PROVIDER_NHN_KAKAO: '019d0007-0004-7000-a000-000000000004',
} as const;

export type FixedUUID = (typeof FIXED_UUIDS)[keyof typeof FIXED_UUIDS];
