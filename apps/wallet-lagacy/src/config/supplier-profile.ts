/**
 * 공급자 프로필 (우리 회사 정보)
 *
 * 세금계산서 발행 시 공급자(우리 회사) 정보로 사용됩니다.
 */
export const SUPPLIER_PROFILE = {
  businessNumber: '123-45-67890',
  name: '알몬드영 주식회사',
  ownerName: '홍길동',
  address: '서울시 강남구 테헤란로 123, 4층',
  businessType: '도소매업',
  businessItem: '화장품 유통',
  email: 'tax@almondyoung.com',
} as const;

export type SupplierProfile = typeof SUPPLIER_PROFILE;

