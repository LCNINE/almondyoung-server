import { Injectable, Logger } from '@nestjs/common';
import { CmsMemberService } from './cms-member.service';
import { CmsAgreementService, CmsAgreementRetryableError } from './cms-agreement.service';
import { BillingMethodService } from '../billing/billing-method.service';
import { BillingMethod, CmsMember, CmsAgreementRecord } from '../types';
import { isCmsOperationError } from './cms-errors';

const CMS_AGREEMENT_FILE_TYPE = '서면';

export interface RegisterCmsWithAgreementDto {
  paymentCompany: string;
  payerName: string;
  payerNumber: string;
  paymentNumber: string;
  phone: string;
}

export interface RegisterCmsWithAgreementResult {
  billingMethod: BillingMethod;
  cmsMember: CmsMember;
  agreement: CmsAgreementRecord | null;
  agreementUploadFailed: boolean;
  agreementFailureReason?: string;
}

/**
 * CMS 계좌 등록 + 동의자료 업로드를 하나의 업무 단위로 조율.
 *
 * 효성 CMS 외부 API 2단계 특성상 DB 트랜잭션으로 원자적 롤백이 불가능하다.
 * - Phase 1 (회원등록) 실패 → 예외를 그대로 던진다. billing_method 미생성.
 * - Phase 1 성공 + Phase 2 (동의자료) 실패 → billing_method·cms_member는 PENDING 유지하고
 *   cms_agreements에 실패 레코드를 남긴다. agreementUploadFailed: true로 반환.
 *   admin 화면 classifyCmsRow가 PENDING + 비등록 동의자료를 needsAction으로 자동 분류한다.
 */
@Injectable()
export class CmsRegistrationService {
  private readonly logger = new Logger(CmsRegistrationService.name);

  constructor(
    private readonly cmsMemberService: CmsMemberService,
    private readonly cmsAgreementService: CmsAgreementService,
    private readonly billingMethodService: BillingMethodService,
  ) {}

  async registerWithAgreement(
    userId: string,
    dto: RegisterCmsWithAgreementDto,
    file: Buffer,
    fileExtension: string,
  ): Promise<RegisterCmsWithAgreementResult> {
    const { billingMethod, cmsMember } = await this.cmsMemberService.registerMember(userId, dto);

    try {
      const agreement = await this.cmsAgreementService.uploadAgreement(
        cmsMember.cmsMemberId,
        file,
        CMS_AGREEMENT_FILE_TYPE,
        fileExtension,
      );
      return { billingMethod, cmsMember, agreement, agreementUploadFailed: false };
    } catch (err) {
      // 5xx/네트워크 일시 장애는 재시도 가능 — 영구 실패로 기록하지 않고 예외를 그대로 전파한다.
      if (err instanceof CmsAgreementRetryableError) {
        this.logger.error(
          `Agreement upload retryable error. cmsMemberId=${cmsMember.cmsMemberId} reason=${err.message}`,
        );
        throw err;
      }
      if (isCmsOperationError(err)) {
        this.logger.error(
          `Agreement upload provider error. cmsMemberId=${cmsMember.cmsMemberId} code=${err.code} reason=${err.providerMessage ?? err.message}`,
        );
        throw err;
      }
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Agreement upload failed after member registration. cmsMemberId=${cmsMember.cmsMemberId} reason=${reason}`,
      );

      const failedRecord = await this.cmsAgreementService.recordAgreementFailure(
        cmsMember.cmsMemberId,
        CMS_AGREEMENT_FILE_TYPE,
        fileExtension,
        reason,
      );

      return {
        billingMethod,
        cmsMember,
        agreement: failedRecord,
        agreementUploadFailed: true,
        agreementFailureReason: reason,
      };
    }
  }

  /**
   * CMS 계좌 변경 + 새 동의자료 업로드를 하나의 업무 단위로 조율.
   *
   * updateBankAccount() 내부에서 기존 '등록' 동의자료를 '변경됨'으로 무효화한다.
   * Phase 2 (동의자료 업로드) 실패 시 registerWithAgreement와 동일한 처리 전략을 따른다.
   */
  async updateWithAgreement(
    billingMethodId: string,
    userId: string,
    dto: RegisterCmsWithAgreementDto,
    file: Buffer,
    fileExtension: string,
  ): Promise<RegisterCmsWithAgreementResult> {
    const updatedMember = await this.cmsMemberService.updateBankAccount(billingMethodId, userId, dto);

    const billingMethod = await this.billingMethodService.findById(billingMethodId);
    if (!billingMethod) {
      throw new Error(`Billing method not found after update: ${billingMethodId}`);
    }

    try {
      const agreement = await this.cmsAgreementService.uploadAgreement(
        updatedMember.cmsMemberId,
        file,
        CMS_AGREEMENT_FILE_TYPE,
        fileExtension,
      );
      return { billingMethod, cmsMember: updatedMember, agreement, agreementUploadFailed: false };
    } catch (err) {
      if (err instanceof CmsAgreementRetryableError) {
        this.logger.error(
          `Agreement upload retryable error after bank account update. cmsMemberId=${updatedMember.cmsMemberId} reason=${err.message}`,
        );
        throw err;
      }
      if (isCmsOperationError(err)) {
        this.logger.error(
          `Agreement upload provider error after bank account update. cmsMemberId=${updatedMember.cmsMemberId} code=${err.code} reason=${err.providerMessage ?? err.message}`,
        );
        throw err;
      }
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Agreement upload failed after bank account update. cmsMemberId=${updatedMember.cmsMemberId} reason=${reason}`,
      );

      const failedRecord = await this.cmsAgreementService.recordAgreementFailure(
        updatedMember.cmsMemberId,
        CMS_AGREEMENT_FILE_TYPE,
        fileExtension,
        reason,
      );

      return {
        billingMethod,
        cmsMember: updatedMember,
        agreement: failedRecord,
        agreementUploadFailed: true,
        agreementFailureReason: reason,
      };
    }
  }
}
