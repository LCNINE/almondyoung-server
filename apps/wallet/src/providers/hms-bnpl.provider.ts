// providers/hms-bnpl.provider.ts

import { Injectable, Logger } from '@nestjs/common';
import {
  HmsAPI,
  MockHmsAPI,
  AgreementFileResponseDto,
  UpdateMemberRequestDto,
  CreateMemberRequestDto,
  CreateMemberResponseDto,
  PaymentResponseDto,
} from 'hms-api-wrapper';

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
  ProfileRegistrationResult,
  PaymentProvider_ID,
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
    this.logger.log(`HMS BNPL 승인 요청 - Intent=${request.intentId}`);

    if (!request.profileId) {
      throw new Error('BNPL 결제는 저장된 프로필이 필요합니다');
    }

    return {
      success: true,
      transactionId: `BNPL_AUTH_${Date.now()}`,
      authorizationId: `BNPL_AUTH_${Date.now()}`,
      metadata: {
        provider: 'HMS_BNPL',
        method: 'authorize',
        approvedAmount: request.amount,
        paymentDate: new Date().toISOString(),
      },
    };
  }

  async capturePayment(request: CaptureRequest): Promise<CaptureResult> {
    const results: PaymentResponseDto[] = [];
    for (const txId of request.transactionIds!) {
      const resp = await this.hmsApi.withdrawals.get(txId);
      results.push(resp);
    }

    return {
      success: results.every((r) => r.payment.status === '완료'),
      failedIds: results
        .filter((r) => r.payment.status !== '완료')
        .map((r) => r.payment.transactionId),
      metadata: { provider: 'HMS_BNPL', method: 'capture' },
    };
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
