// providers/hms-bnpl.provider.ts

import { Injectable, Logger } from '@nestjs/common';
import {
  HmsAPI,
  MockHmsAPI,
  AgreementFileResponseDto,
  UpdateMemberRequestDto,
  CreateMemberRequestDto,
  CreateMemberResponseDto,
} from 'hms-api-wrapper';
import { generateUUIDv7 } from '../shared/utils/id-generator';
import { eq } from 'drizzle-orm';
import { HmsApiFactory } from '../shared/utils/hms-api.factory';
import { getTsid } from 'tsid-ts';

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
      const bnplEventId = generateUUIDv7();
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

  // 회원 등록 API 호출
  async createMember(
    memberData: CreateMemberRequestDto,
  ): Promise<CreateMemberResponseDto> {
    this.logger.log(`➡️ HMS 회원 등록 요청: ${memberData.memberId}`);
    return this.hmsApi.members.create(memberData);
  }

  // 회원 수정 API 호출
  async updateMember(memberId: string, data: UpdateMemberRequestDto) {
    this.logger.log(`➡️ HMS 회원 수정 요청: ${memberId}`);
    return this.hmsApi.members.update(memberId, data);
  }

  // 회원 조회
  async getMember(memberId: string) {
    this.logger.log(`➡️ HMS 회원 조회: ${memberId}`);
    return this.hmsApi.members.get(memberId);
  }

  // 회원 삭제
  async deleteMember(memberId: string) {
    this.logger.log(`➡️ HMS 회원 삭제: ${memberId}`);
    return this.hmsApi.members.delete(memberId);
  }

  // 동의서 파일 업로드
  async uploadAgreement(
    custId: string,
    memberId: string,
    fileInput: { file: Buffer | Blob; filename: string },
  ): Promise<AgreementFileResponseDto> {
    this.logger.log(
      `➡️ HMS 동의서 업로드 요청: ${memberId} (${fileInput.filename})`,
    );
    return this.hmsApi.agreements.register(custId, memberId, fileInput);
  }
}
