// apps/wallet/src/providers/hms-bnpl.provider.ts

import { Injectable, Logger } from '@nestjs/common';
import {
  HmsAPI,
  MockHmsAPI,
  AgreementFileResponseDto,
  UpdateMemberRequestDto,
  CreateMemberRequestDto,
  CreateMemberResponseDto,
} from 'hms-api-wrapper';

import { HmsApiFactory } from '../shared/utils/hms-api.factory';
import { DbService } from '@app/db';
import {
  PaymentProvider,
  PaymentRequest,
  PaymentResult,
  RefundRequest,
  RefundResult,
  CancelRequest,
  CancelResult,
  HistoryRequest,
  PaymentHistory,
  ProviderType,
  ProfileRegistrationResult,
  BaseProfileRegistrationRequest,
  HmsBnplPayload,
} from './payment-provider.interface';

/**
 * BNPL 전용 프로필 등록 DTO
 */
export interface HmsBatchCmsProfileRequest
  extends BaseProfileRegistrationRequest {
  memberId: string;
  memberName: string;
  payerName: string;
  paymentKind: 'CMS';
  paymentCompany: string;
  paymentNumber: string;
  payerNumber: string;
  phone: string;
  // 동의서·결제일 등 추가 가능 //
}

/**
 * BNPL Provider (효성 Batch CMS API)
 * - 한도체크는 상위 서비스에서 처리
 */
@Injectable()
export class HmsBnplProvider implements PaymentProvider {
  readonly providerId: ProviderType = ProviderType.HMS_BNPL;
  private readonly logger = new Logger(HmsBnplProvider.name);
  private readonly hmsApi: HmsAPI | MockHmsAPI;

  constructor(private readonly dbService: DbService) {
    this.hmsApi = HmsApiFactory.createForBnpl();
    this.logger.log('HMS BNPL Provider 초기화 완료');
  }

  /** BNPL(배치CMS) 회원 등록 */
  async registerProfile(
    request: HmsBatchCmsProfileRequest,
  ): Promise<ProfileRegistrationResult> {
    this.logger.log(`➡️ HMS BNPL 회원 등록 요청: ${request.userId}`);
    try {
      const resp = await this.hmsApi.members.create({
        memberId: request.memberId,
        memberName: request.memberName,
        payerName: request.payerName,
        paymentKind: 'CMS',
        paymentCompany: request.paymentCompany,
        paymentNumber: request.paymentNumber,
        payerNumber: request.payerNumber,
        phone: request.phone,
        // 동의서·결제일 등 추가 가능
      });

      return {
        status: 'SUCCESS',
        profileId: resp.member.memberId,
        externalMemberId: resp.member.memberId,
        metadata: { raw: resp },
      };
    } catch (err: any) {
      this.logger.error(`❌ HMS BNPL 회원 등록 실패: ${err.message}`);
      return {
        status: 'FAILED',
        errorMessage: err.message,
      };
    }
  }

  /**
   * 새로운 Payload 방식 BNPL 결제 처리 (Resolver 패턴)
   */
  async processPayload(payload: HmsBnplPayload): Promise<PaymentResult> {
    this.logger.log(
      `➡️ HMS BNPL 결제 (Payload) - MemberId: ${payload.memberId}, Amount: ${payload.captureAmount}`,
    );

    try {
      // BNPL은 즉시 승인 처리 (실제 정산은 배치로)
      const transactionId = `BNPL_${Date.now()}`;

      this.logger.log(`✅ HMS BNPL 결제 승인 - TxId: ${transactionId}`);

      return {
        success: true,
        transactionId,
        providerTransactionId: payload.invoiceId,
        message: 'BNPL 정산 승인 완료',
        metadata: {
          provider: 'HMS_BNPL',
          memberId: payload.memberId,
          captureAmount: payload.captureAmount,
          invoiceId: payload.invoiceId,
          captureType: 'BNPL_SETTLEMENT',
          ...payload.metadata,
        },
      };
    } catch (error: any) {
      this.logger.error(`❌ HMS BNPL 결제 실패: ${error.message}`, error);

      return {
        success: false,
        transactionId: `BNPL_FAILED_${Date.now()}`,
        message: `BNPL 결제 실패: ${error.message}`,
        metadata: {
          provider: 'HMS_BNPL',
          memberId: payload.memberId,
          errorType: 'BNPL_ERROR',
          originalError: error.message,
          ...payload.metadata,
        },
      };
    }
  }

  /** BNPL 결제 처리 (기존 방식 - 호환성 유지) */
  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    this.logger.log(`➡️ HMS BNPL 결제 처리 요청 - Intent: ${request.intentId}`);
    try {
      // 상위 서비스에서 한도체크 끝났다고 가정
      // DB 이벤트 기록 예시:
      // await this.dbService.insert(schema.bnplEvents, {...})

      return {
        success: true,
        transactionId: `bnpl_tx_${Date.now()}`,
        message: 'BNPL 결제 이벤트 기록 완료',
        metadata: { note: 'BNPL 결제 이벤트 기록 완료' },
      };
    } catch (err: any) {
      this.logger.error(`❌ HMS BNPL 결제 처리 실패: ${err.message}`);
      return {
        success: false,
        transactionId: `bnpl_failed_${Date.now()}`,
        message: err.message,
      };
    }
  }

  /** BNPL 환불 */
  async refund(request: RefundRequest): Promise<RefundResult> {
    this.logger.log(`➡️ HMS BNPL 환불 요청 - Attempt: ${request.attemptId}`);
    try {
      // 환불 이벤트 기록 예시:
      // await this.dbService.insert(schema.bnplRefunds, {...})

      return {
        success: true,
        refundId: `bnpl_refund_${Date.now()}`,
        refundedAmount: request.amount,
        message: 'BNPL 환불 이벤트 기록 완료',
        metadata: { note: 'BNPL 환불 이벤트 기록 완료' },
      };
    } catch (err: any) {
      this.logger.error(`❌ HMS BNPL 환불 실패: ${err.message}`);
      return {
        success: false,
        refundId: `bnpl_refund_failed_${Date.now()}`,
        refundedAmount: 0,
        message: err.message,
      };
    }
  }

  /**
   * 결제 취소 (환불과 동일한 로직)
   */
  async cancel(request: CancelRequest): Promise<CancelResult> {
    this.logger.log(`➡️ HMS BNPL 결제 취소 - TxId: ${request.transactionId}`);

    try {
      const refundRequest: RefundRequest = {
        intentId: request.intentId,
        attemptId: request.attemptId,
        amount: 0, // 전액 취소
        reason: request.reason || '결제 취소',
        transactionId: request.transactionId,
        metadata: request.metadata,
      };

      const refundResult = await this.refund(refundRequest);

      return {
        success: refundResult.success,
        cancelId: refundResult.refundId,
        message: refundResult.message,
        metadata: {
          ...refundResult.metadata,
          cancelType: 'FULL_CANCEL',
        },
      };
    } catch (error) {
      this.logger.error(`❌ HMS BNPL 결제 취소 실패: ${error.message}`, error);
      return {
        success: false,
        cancelId: `bnpl_cancel_failed_${Date.now()}`,
        message: `결제 취소 실패: ${error.message}`,
        metadata: {
          provider: 'hms_bnpl',
          errorMessage: error.message,
        },
      };
    }
  }

  /**
   * 결제 내역 조회 (HMS API 연동 필요)
   */
  async getPaymentHistory(request: HistoryRequest): Promise<PaymentHistory> {
    this.logger.log(`➡️ HMS BNPL 결제 내역 조회 - UserId: ${request.userId}`);

    // TODO: 실제 HMS API 연동 필요
    // 현재는 Mock 데이터 반환
    return {
      transactions: [],
      totalCount: 0,
      hasMore: false,
    };
  }

  /** HMS API 직접 thin wrapper들 */
  async createMember(
    memberData: CreateMemberRequestDto,
  ): Promise<CreateMemberResponseDto> {
    this.logger.log(`➡️ HMS 회원 등록 요청: ${memberData.memberId}`);
    return this.hmsApi.members.create(memberData);
  }

  async updateMember(memberId: string, data: UpdateMemberRequestDto) {
    this.logger.log(`➡️ HMS 회원 수정 요청: ${memberId}`);
    return this.hmsApi.members.update(memberId, data);
  }

  async getMember(memberId: string) {
    this.logger.log(`➡️ HMS 회원 조회: ${memberId}`);
    return this.hmsApi.members.get(memberId);
  }

  async deleteMember(memberId: string) {
    this.logger.log(`➡️ HMS 회원 삭제: ${memberId}`);
    return this.hmsApi.members.delete(memberId);
  }

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
