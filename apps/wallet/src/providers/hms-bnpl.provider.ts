// providers/hms-bnpl.provider.ts

import { Injectable, Logger } from '@nestjs/common';
import {
  HmsAPI,
  MockHmsAPI,
  CreatePaymentProfileDto,
  PaymentTransactionRequest,
  CreateMemberRequestDto,
  CreateMemberResponseDto,
  RegisterAgreementRequest,
  AgreementFileResponseDto,
  BatchCmsResult,
} from 'hms-api-wrapper';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { HmsApiFactory } from '../shared/utils/hms-api.factory';
import { getTsid } from 'tsid-ts';
import { Money } from '../shared/utils/money.util';
import {
  WithdrawalConsentCapability,
  WithdrawalConsentRequest,
  WithdrawalConsentResult,
  ConsentStatusResult,
} from './capabilities/withdrawal-consent.capability';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import {
  PaymentProvider,
  PaymentRequest,
  RefundRequest,
  CaptureRequest,
  ProfileRegistrationRequest,
  PaymentType,
  PaymentProvider_ID,
  ProfileRegistrationResult,
} from './payment-provider.interface';
import {
  PaymentResult,
  RefundResult,
  CaptureResult,
  PaymentMetadata,
  PaymentMethodRegistrationRequest,
} from '../interfaces/payment-gateway.interface';

/**
 * HMS BNPL 결제 Provider (통합 구현)
 * - 효성 BNPL API 직접 통신
 * - 승인 → 확정 2단계 처리
 * - Adapter 레이어 제거하고 Provider에서 직접 PG 호출
 */
@Injectable()
export class HmsBnplProvider
  implements PaymentProvider, WithdrawalConsentCapability
{
  private readonly logger = new Logger(HmsBnplProvider.name);
  private readonly hmsApi: HmsAPI | MockHmsAPI;

  readonly providerId: PaymentProvider_ID = 'HMS_BNPL';
  readonly supportedTypes: PaymentType[] = ['ORDER', 'BNPL_CAPTURE'];

  constructor(private readonly dbService: DbService) {
    // HMS API 초기화 (Adapter 제거하고 Provider에서 직접 관리)
    this.hmsApi = HmsApiFactory.createForBnpl();
    this.logger.log(
      'HMS BNPL Provider 초기화 완료 - Mock 서버 사용 (수동 승인 시뮬레이션)',
    );
  }

  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    this.logger.log(
      `HMS BNPL 승인 처리 시작 - Intent: ${request.intentId}, Amount: ${request.amount}KRW`,
    );

    // Profile 기반 결제만 지원
    if (!request.profileId) {
      throw new Error('HMS BNPL은 저장된 프로필이 필요합니다');
    }

    const metadata: PaymentMetadata = {
      userId: request.userId,
      sessionId: request.intentId,
      paymentMethodId: request.profileId,
      bnplAccountId: request.metadata?.bnplAccountId,
      ...request.metadata,
    };

    try {
      // 1. BNPL Account 조회 (profileId로부터)
      const batchProfile = await this.dbService.db
        .select()
        .from(schema.cmsBatchProfiles)
        .where(eq(schema.cmsBatchProfiles.id, request.profileId))
        .limit(1);

      if (batchProfile.length === 0) {
        throw new Error(
          `BNPL Account not found for profile: ${request.profileId}`,
        );
      }

      // 효성 비즈니스 규칙: BNPL Account ID는 21자로 제한
      const bnplAccountId = batchProfile[0].memberId.substring(0, 21);

      // 2. Mock BNPL 승인 처리 (실제 HMS API 구현 예정)
      const mockTransactionId = `BNPL_${getTsid().toString()}`;

      // 3. 🎯 내부 원장에 BNPL 사용 기록 (DEBIT)
      const bnplEventId = ulid();
      await this.dbService.db.insert(schema.bnplEvents).values({
        id: bnplEventId,
        bnplAccountId: bnplAccountId,
        paymentSessionId: request.intentId,
        transactionType: 'DEBIT', // 사용자가 BNPL로 구매 (차감)
        status: 'AUTHORIZED', // 승인만, 실제 출금은 월별 billing
        amount: request.amount,
      });

      this.logger.log(
        `✅ BNPL 내부 원장 기록 완료 - EventId: ${bnplEventId}, AccountId: ${bnplAccountId}`,
      );

      const result = {
        success: true,
        transactionId: mockTransactionId,
        authorizationId: mockTransactionId,
        metadata: {
          provider: 'hms_bnpl',
          method: 'authorization_mock',
          approvalNumber: `BNPL_${Date.now()}`,
          paymentDate: new Date().toISOString(),
          actualAmount: request.amount,
          fee: 0,
          bnplEventId, // 내부 원장 이벤트 ID 추가
        },
      };

      this.logger.log(
        `HMS BNPL 승인 완료 - AuthorizationId: ${result.authorizationId}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `HMS BNPL 승인 실패 - Intent: ${request.intentId}`,
        error,
      );
      return {
        success: false,
        transactionId: '',
        error: `HMS BNPL 승인 실패: ${error.message}`,
        metadata: { providerId: this.providerId },
      };
    }
  }

  async capturePayment(request: CaptureRequest): Promise<CaptureResult> {
    this.logger.log(
      `HMS BNPL 확정 처리 시작 - AttemptIds: ${request.attemptIds.join(', ')}`,
    );

    try {
      // TODO: attemptIds에서 authorizationId 목록 추출 필요
      const authorizationIds = request.attemptIds; // 임시로 동일하게 처리

      // Mock BNPL 확정 처리
      const result = {
        success: true,
        captureIds: authorizationIds,
        failedIds: [],
        metadata: {
          provider: 'hms_bnpl',
          method: 'capture_mock',
          batchId: request.batchId,
          captureDate: new Date().toISOString(),
        },
      };

      this.logger.log(
        `HMS BNPL 확정 완료 - CaptureIds: ${result.captureIds.join(', ')}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `HMS BNPL 확정 실패 - AttemptIds: ${request.attemptIds.join(', ')}`,
        error,
      );
      return {
        success: false,
        captureIds: [],
        failedIds: request.attemptIds,
        error: `HMS BNPL 확정 실패: ${error.message}`,
        metadata: { providerId: this.providerId },
      };
    }
  }

  async refundPayment(request: RefundRequest): Promise<RefundResult> {
    this.logger.log(
      `HMS BNPL 환불 처리 시작 - RefundId: ${request.refundId}, Amount: ${request.amount}KRW`,
    );

    try {
      // Mock BNPL 환불 처리
      const mockRefundId = `BNPL_REFUND_${getTsid().toString()}`;
      const result = {
        success: true,
        refundId: mockRefundId,
        refundedAmount: request.amount,
        pgTransactionId: mockRefundId,
        metadata: {
          provider: 'hms_bnpl',
          method: 'refund_mock',
          refundDate: new Date().toISOString(),
          originalTransactionId: request.originalTransactionId,
        },
      };

      this.logger.log(`HMS BNPL 환불 완료 - RefundId: ${result.refundId}`);
      return result;
    } catch (error) {
      this.logger.error(
        `HMS BNPL 환불 실패 - RefundId: ${request.refundId}`,
        error,
      );
      return {
        success: false,
        refundId: request.refundId,
        refundedAmount: 0,
        error: `HMS BNPL 환불 실패: ${error.message}`,
        metadata: { providerId: this.providerId },
      };
    }
  }

  async registerProfile(
    request: ProfileRegistrationRequest,
  ): Promise<ProfileRegistrationResult> {
    this.logger.log(
      `HMS BNPL 프로필 등록 시작 - UserId: ${request.userId}, Type: ${request.profileType}`,
    );

    if (request.profileType !== 'BNPL') {
      throw new Error('HMS BNPL Provider는 BNPL 타입만 지원합니다');
    }

    if (!request.creditLimit) {
      throw new Error('BNPL 등록에는 creditLimit이 필요합니다');
    }

    try {
      const registrationRequest: PaymentMethodRegistrationRequest = {
        userId: request.userId,
        memberName: request.profileName,
        phone: request.metadata?.phone || '',
        creditLimit: request.creditLimit,
        billingCycleDay: request.billingCycleDay || 1,
        ...request.metadata,
      };

      // Mock BNPL 프로필 등록 처리
      const mockProfileId = `BNPL_PROFILE_${getTsid().toString()}`;
      const mockHmsMemberId = `HMS_BNPL_${getTsid().toString()}`;

      this.logger.log(
        `HMS BNPL 프로필 등록 완료 - ProfileId: ${mockProfileId}`,
      );

      return {
        success: true,
        profileId: mockProfileId,
        hmsMemberId: mockHmsMemberId,
        metadata: {
          providerId: this.providerId,
          creditLimit: request.creditLimit,
          billingCycleDay: request.billingCycleDay,
          method: 'register_mock',
          registrationDate: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error(
        `HMS BNPL 프로필 등록 실패 - UserId: ${request.userId}`,
        error,
      );
      return {
        success: false,
        profileId: '',
        error: `HMS BNPL 프로필 등록 실패: ${error.message}`,
        metadata: { providerId: this.providerId },
      };
    }
  }

  // === WithdrawalConsentCapability 구현 ===

  /**
   * BNPL 출금동의서 제출
   * - HMS BatchCMS API를 통한 회원 등록
   * - 동의서 파일 업로드 및 심사 요청
   */
  async submitWithdrawalConsent(
    request: WithdrawalConsentRequest,
  ): Promise<WithdrawalConsentResult> {
    this.logger.log(`BNPL 출금동의서 제출 시작 - UserId: ${request.userId}`);

    const consentId = `consent_${getTsid().toString()}`;

    try {
      // 1. HMS 회원 등록
      const memberResult = await this.hmsApi.members.create(request.memberInfo);

      if (
        !memberResult.member?.result ||
        memberResult.member.result.flag !== 'Y'
      ) {
        throw new Error(
          `HMS 회원 등록 실패: ${memberResult.member?.result?.message || 'Unknown error'}`,
        );
      }

      const hmsMemberId = memberResult.member.memberId;
      if (!hmsMemberId) {
        throw new Error('HMS 회원 ID를 받지 못했습니다');
      }

      // 2. 동의서 파일 등록 (임시로 Mock 처리)
      const agreementResults: AgreementFileResponseDto[] = [];

      // Node.js 환경에서 Blob 타입 이슈를 피하기 위해 임시 Mock 처리
      this.logger.log('동의서 파일 등록 (Mock 처리)');

      for (const agreement of request.agreementFiles) {
        // Mock 동의서 결과 생성
        const mockAgreementResult: AgreementFileResponseDto = {
          agreementFile: {
            registerStatus: '등록',
            agreementKey: `agreement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            memberId: hmsMemberId,
            memberName: request.memberInfo.memberName,
            agreementWay: 'F', // File
            agreementKind: '서면',
            fileExtension: 'pdf',
            agreementTime: new Date().toISOString(),
            result: {
              code: '0000',
              message: '정상처리',
            },
          },
        };

        agreementResults.push(mockAgreementResult);
        this.logger.log(
          `Mock 동의서 등록: ${mockAgreementResult.agreementFile.agreementKey}`,
        );
      }

      // 3. 심사 요청 상태로 설정
      const result: WithdrawalConsentResult = {
        success: true,
        consentId,
        hmsMemberId,
        status: 'UNDER_REVIEW',
        submittedAt: new Date().toISOString(),
        expectedReviewDays: 3, // 2-3일 심사 기간
        reviewMessage:
          '출금동의서가 접수되었습니다. 2-3일 내 심사 완료 예정입니다.',
        metadata: {
          batchCmsResult: memberResult.member.result,
          agreementResults,
          applicationReason: request.metadata?.applicationReason,
          expectedUsage: request.metadata?.expectedUsage,
        },
      };

      this.logger.log(`BNPL 출금동의서 제출 완료 - ConsentId: ${consentId}`);
      return result;
    } catch (error) {
      this.logger.error(`BNPL 출금동의서 제출 실패`, error);

      return {
        success: false,
        consentId,
        status: 'REJECTED',
        submittedAt: new Date().toISOString(),
        expectedReviewDays: 0,
        error: error.message,
        metadata: {
          errorDetails: error,
        },
      };
    }
  }

  /**
   * 출금동의서 심사 상태 조회
   * - 실제로는 HMS API로 상태 확인
   * - Mock으로 심사 상태 시뮬레이션
   */
  async checkConsentStatus(consentId: string): Promise<ConsentStatusResult> {
    this.logger.log(`BNPL 출금동의서 상태 조회 - ConsentId: ${consentId}`);

    try {
      // Mock: 실제로는 HMS BatchCMS API로 회원 상태 조회
      // const memberStatus = await this.hmsApi.batchCms.members.getMember(hmsMemberId);

      // 시뮬레이션: 심사 상태 랜덤 생성
      const statuses = ['UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;
      const randomStatus =
        statuses[Math.floor(Math.random() * statuses.length)];

      const baseResult: ConsentStatusResult = {
        consentId,
        submittedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1일 전 제출
        status: randomStatus,
        canCreateProfile: randomStatus === 'APPROVED',
      };

      switch (randomStatus) {
        case 'UNDER_REVIEW':
          return {
            ...baseResult,
            nextAction: 'WAIT',
            metadata: {
              reviewerComments: '서류 검토 중입니다',
              expectedCompletionDate: new Date(
                Date.now() + 48 * 60 * 60 * 1000,
              ).toISOString(),
            },
          };

        case 'APPROVED':
          return {
            ...baseResult,
            reviewedAt: new Date().toISOString(),
            approvedAt: new Date().toISOString(),
            hmsMemberId: `hms_approved_${getTsid().toString()}`,
            nextAction: 'CREATE_PROFILE',
            metadata: {
              reviewerComments: '출금동의서가 승인되었습니다',
              approvalMessage: '이제 정식 결제프로필을 생성할 수 있습니다',
            },
          };

        case 'REJECTED':
          return {
            ...baseResult,
            reviewedAt: new Date().toISOString(),
            rejectedAt: new Date().toISOString(),
            rejectionReason:
              '제출된 서류가 불충분하거나 정책에 부합하지 않습니다',
            nextAction: 'RESUBMIT',
            metadata: {
              reviewerComments: '추가 서류 제출 후 재신청해 주세요',
              additionalRequirements: [
                '신분증 사본',
                '소득 증명서',
                '통장 사본',
              ],
            },
          };
      }
    } catch (error) {
      this.logger.error(`BNPL 출금동의서 상태 조회 실패`, error);

      return {
        consentId,
        status: 'REJECTED',
        submittedAt: new Date().toISOString(),
        canCreateProfile: false,
        nextAction: 'CONTACT_SUPPORT',
        metadata: {
          error: error.message,
        },
      };
    }
  }

  /**
   * 승인된 출금동의서로 정식 결제프로필 생성
   */
  async createProfileFromApprovedConsent(
    consentId: string,
    profileOptions: {
      profileName: string;
      paymentPurpose: 'ORDER' | 'RECURRING' | 'BOTH';
      isDefault?: boolean;
      userId?: string; // 사용자 ID 추가
    },
  ): Promise<{ success: boolean; profileId?: string; error?: string }> {
    this.logger.log(
      `승인된 출금동의서로 프로필 생성 - ConsentId: ${consentId}`,
    );

    try {
      // 1. 동의서 상태 확인
      const consentStatus = await this.checkConsentStatus(consentId);

      if (
        consentStatus.status !== 'APPROVED' ||
        !consentStatus.canCreateProfile
      ) {
        throw new Error(
          `동의서가 승인되지 않았습니다: ${consentStatus.status}`,
        );
      }

      if (!consentStatus.hmsMemberId) {
        throw new Error('HMS 회원 ID가 없습니다');
      }

      // 2. 정식 결제프로필 생성 및 실제 DB 저장
      const profileId = `pp_bnpl_${getTsid().toString()}`;

      // 🔥 1. paymentProfiles에 기본 정보 저장
      const paymentPurposeMapping = {
        ORDER: 'PURCHASE',
        RECURRING: 'SUBSCRIPTION',
        BOTH: 'BOTH',
      } as const;

      await this.dbService.db.insert(schema.paymentProfiles).values({
        id: profileId,
        userId: profileOptions.userId || 'unknown_user',
        kind: 'BATCH', // BNPL은 배치 CMS로 처리
        name: profileOptions.profileName,
        // paymentPurpose: paymentPurposeMapping[profileOptions.paymentPurpose], // paymentPurpose 필드 제거됨
        status: 'ACTIVE',
        // isDefault: profileOptions.isDefault || false, // isDefault 필드 제거됨
      });

      // 🔥 2. batchCmsProfile에 BNPL 전용 정보 저장
      await this.dbService.db.insert(schema.cmsBatchProfiles).values({
        id: profileId,
        // paymentProfileId: profileId, // 정규화된 스키마에서는 id가 곧 paymentProfileId
        memberId: consentStatus.hmsMemberId,
        cmsStatus: 'REGISTERED',
        billingDay: 28, // 매월 28일
        // hmsMetadata는 선택사항이므로 제거하거나 필요시 추가
      });

      this.logger.log(
        `BNPL 결제프로필 생성 및 DB 저장 완료 - ProfileId: ${profileId}`,
      );

      return {
        success: true,
        profileId,
      };
    } catch (error) {
      this.logger.error(`BNPL 프로필 생성 실패`, error);

      return {
        success: false,
        error: error.message,
      };
    }
  }
}
