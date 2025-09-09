// payment-profile.types.ts - 결제프로필 타입 정의 (리뉴얼.md 3.1절)
//
// 핵심 구분:
// - 결제수단(Method): Provider가 제공하는 추상 API 집합 (코드에 존재)
// - 결제프로필(Profile): 사용자가 등록/보유한 수단의 인스턴스 (DB에 저장)
// - Instrument(ephemeral): 일회성 토큰/키 (세션 중에만 존재)

/**
 * 결제프로필 타입 (사용자별 등록된 결제 수단)
 */
export type PaymentProfileType =
  | 'CARD' // 저장카드 (빌링키) - HMS 연동
  | 'BANK_ACCOUNT' // CMS 계좌 - HMS 연동
  | 'BNPL'; // BNPL 계정 - HMS 연동

// ❌ REWARD_POINT는 결제프로필이 아님!
// ✅ 포인트는 내부 원장 기반 Provider로 profileId 없이 바로 사용

/**
 * 결제프로필 상태
 */
export type PaymentProfileStatus =
  | 'PENDING' // 등록 중
  | 'ACTIVE' // 사용 가능
  | 'INACTIVE' // 비활성화
  | 'EXPIRED' // 만료됨
  | 'BLOCKED'; // 차단됨

/**
 * 결제프로필 용도
 */
export type PaymentProfilePurpose =
  | 'SUBSCRIPTION' // 정기결제 전용
  | 'PURCHASE' // 일반 구매 전용
  | 'BOTH'; // 모든 용도

/**
 * 결제프로필 등록 요청
 */
export interface PaymentProfileCreateRequest {
  userId: string;
  profileType: PaymentProfileType;
  profileName: string;
  paymentPurpose: PaymentProfilePurpose;
  isDefault: boolean;

  // 카드 프로필 등록 시
  cardToken?: string;
  billingKey?: string;

  // BNPL 프로필 등록 시
  creditLimit?: number;
  billingCycleDay?: number;
}

/**
 * 결제프로필 응답
 */
export interface PaymentProfileResponse {
  profileId: string;
  userId: string;
  profileType: PaymentProfileType;
  profileName: string;
  status: PaymentProfileStatus;
  paymentPurpose: PaymentProfilePurpose;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;

  // HMS 관련 (카드/BNPL)
  hmsMemberId?: string;
}

/**
 * 사용자 결제프로필 목록 응답
 */
export interface UserPaymentProfilesResponse {
  userId: string;
  profiles: PaymentProfileResponse[];
  summary: {
    totalCount: number;
    activeCount: number;
    defaultProfileId?: string;
  };
}
