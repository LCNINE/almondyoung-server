// src/lib/services/customers/query-keys.ts
/**
 * 소비자 계정 관련 쿼리 키
 * - 소비자 목록 조회, 상세 정보, 동의 항목 관리 등에 사용
 * - 소비자 정보 조회 시 사용
 */
export const customerQueryKeys = {
  all: ['customers'] as const,

  list: (query: object) =>
    [...customerQueryKeys.all, 'list', query] as const,

  detailById: (id: string) =>
    [...customerQueryKeys.all, 'detailById', id] as const,
  detailByEmail: (email: string) =>
    [...customerQueryKeys.all, 'detailByEmail', email] as const,

  // 고객 동의
  consents: () => [...customerQueryKeys.all, 'consents'] as const,
  consent: (id: string) => [...customerQueryKeys.all, 'consents', id] as const,

  // 고객 사업자등록증
  businessLicenses: () =>
    [...customerQueryKeys.all, 'business-licenses'] as const,
  businessLicenseById: (id: string) =>
    [...customerQueryKeys.all, 'business-licenses', id] as const,
  businessLicenseByUserId: (userId: string) =>
    [...customerQueryKeys.all, 'business-licenses', userId] as const,

  // 고객 샵 관련
  shop: (userId: string) => [...customerQueryKeys.all, 'shop', userId] as const,

  // 단일 회원 동의 현황
  userConsent: (userId: string) =>
    [...customerQueryKeys.all, 'user-consent', userId] as const,

  // 회원 역할
  userRoles: (userId: string) =>
    [...customerQueryKeys.all, 'user-roles', userId] as const,
} as const;
