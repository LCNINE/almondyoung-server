// providers/capabilities/withdrawal-consent.capability.ts

import {
  CreateMemberRequestDto,
  CreateMemberResponseDto,
  RegisterAgreementRequest,
  AgreementFileResponseDto,
  BatchCmsResult,
} from 'hms-api-wrapper';

/**
 * BNPL 출금동의서 관련 Capability
 * - 출금동의서 제출
 * - 심사 상태 조회 (2-3일 심사 과정)
 * - 승인 후 정식 결제프로필 등록
 */

/**
 * 출금동의서 제출 요청
 */
export interface WithdrawalConsentRequest {
  userId: string;
  memberInfo: CreateMemberRequestDto;
  agreementFiles: RegisterAgreementRequest[];
  metadata?: {
    applicationReason?: string;
    expectedUsage?: string;
    [key: string]: any;
  };
}

/**
 * 출금동의서 제출 결과
 */
export interface WithdrawalConsentResult {
  success: boolean;
  consentId: string; // 동의서 심사 추적 ID
  hmsMemberId?: string; // HMS 회원 ID (성공 시)
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
  submittedAt: string;
  expectedReviewDays: number; // 예상 심사 기간 (일)
  reviewMessage?: string;
  error?: string;
  metadata?: {
    batchCmsResult?: BatchCmsResult;
    agreementResults?: AgreementFileResponseDto[];
    [key: string]: any;
  };
}

/**
 * 출금동의서 심사 상태 조회 결과
 */
export interface ConsentStatusResult {
  consentId: string;
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
  submittedAt: string;
  reviewedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  hmsMemberId?: string; // 승인된 경우
  canCreateProfile: boolean; // 프로필 생성 가능 여부
  nextAction?: 'WAIT' | 'CREATE_PROFILE' | 'RESUBMIT' | 'CONTACT_SUPPORT';
  metadata?: {
    reviewerComments?: string;
    additionalRequirements?: string[];
    [key: string]: any;
  };
}

/**
 * 출금동의서 Capability 인터페이스
 * BNPL Provider만 구현
 */
export interface WithdrawalConsentCapability {
  /**
   * 출금동의서 제출
   */
  submitWithdrawalConsent(
    request: WithdrawalConsentRequest,
  ): Promise<WithdrawalConsentResult>;

  /**
   * 출금동의서 심사 상태 조회
   */
  checkConsentStatus(consentId: string): Promise<ConsentStatusResult>;

  /**
   * 승인된 동의서로 정식 결제프로필 생성
   */
  createProfileFromApprovedConsent(
    consentId: string,
    profileOptions: {
      profileName: string;
      paymentPurpose: 'ORDER' | 'RECURRING' | 'BOTH';
      isDefault?: boolean;
      userId?: string; // 사용자 ID 추가
    },
  ): Promise<{
    success: boolean;
    profileId?: string;
    error?: string;
  }>;
}

/**
 * Provider가 WithdrawalConsentCapability를 지원하는지 확인
 */
export function hasWithdrawalConsentCapability(
  provider: any,
): provider is WithdrawalConsentCapability {
  return (
    typeof provider.submitWithdrawalConsent === 'function' &&
    typeof provider.checkConsentStatus === 'function' &&
    typeof provider.createProfileFromApprovedConsent === 'function'
  );
}
