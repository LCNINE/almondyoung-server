import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import {
  ChargeParams,
  ChargeResult,
  ChargeStatusResult,
  DeleteMethodParams,
  GetStatusParams,
  PaymentMethod,
  PaymentProvider,
  RefundParams,
  RefundResult,
  ValidateMethodParams,
} from '../providers/payment-provider.interface';
import { WalletSchema, cmsWithdrawals } from '../schema';
import { isCmsAgreementRegistered } from './cms-agreement-status';
import { CmsApiClient } from './cms-api.client';
import { CmsMemberService } from './cms-member.service';
import { CmsAgreementService } from './cms-agreement.service';
import { nextCmsPaymentDate } from './cms-date.util';

@Injectable()
export class CmsBatchProvider implements PaymentProvider {
  readonly providerType = 'CMS_BATCH';
  readonly autoCapture = true;
  readonly actionMode = 'interactive' as const;

  private readonly logger = new Logger(CmsBatchProvider.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly cmsApi: CmsApiClient,
    private readonly cmsMemberService: CmsMemberService,
    private readonly cmsAgreementService: CmsAgreementService,
  ) {}

  async getUserMethods(_userId: string): Promise<PaymentMethod[]> {
    // CMS billing methods are managed through BillingMethodService
    return [];
  }

  async validateMethod(_params: ValidateMethodParams): Promise<void> {
    // Validation is done during CMS member registration
  }

  async deleteMethod(_params: DeleteMethodParams): Promise<void> {
    // Deletion handled via BillingMethodService.revoke()
  }

  async authorize(params: ChargeParams): Promise<ChargeResult> {
    if (params.currency.toUpperCase() !== 'KRW') {
      return {
        status: 'FAILED',
        errorCode: 'CMS_CURRENCY_NOT_SUPPORTED',
        errorMessage: `CMS_BATCH provider supports KRW only: ${params.currency}`,
      };
    }

    const billingMethodId = params.providerData?.billingMethodId as string | undefined;
    if (!billingMethodId) {
      return {
        status: 'FAILED',
        errorCode: 'CMS_BILLING_METHOD_ID_REQUIRED',
        errorMessage: 'billingMethodId is required in providerData',
      };
    }

    // 1. billingMethod에서 cmsMemberId 조회
    const member = await this.cmsMemberService.findByBillingMethodId(billingMethodId);
    if (!member) {
      return {
        status: 'FAILED',
        errorCode: 'CMS_MEMBER_NOT_FOUND',
        errorMessage: 'CMS member not found for the given billing method',
      };
    }

    // 2. 회원 상태 확인 (REGISTERED인지)
    if (member.status !== 'REGISTERED') {
      return {
        status: 'FAILED',
        errorCode: 'CMS_MEMBER_NOT_REGISTERED',
        errorMessage: `CMS member status is ${member.status}, expected REGISTERED`,
      };
    }

    // 3. 동의자료 등록 여부 확인
    const agreements = await this.cmsAgreementService.findByCmsMemberId(member.cmsMemberId);
    const hasRegistered = agreements.some((a) => isCmsAgreementRegistered(a.status));
    if (!hasRegistered) {
      return {
        status: 'FAILED',
        errorCode: 'CMS_AGREEMENT_NOT_REGISTERED',
        errorMessage: 'CMS agreement document not registered for this member',
      };
    }

    // 4. 이미 출금신청이 있으면 기존 상태 반환 (authorize 재시도 idempotency)
    const existingTransactionId = await this.getTransactionId(params.chargeId);
    if (existingTransactionId) {
      this.logger.log(
        `[CmsBatchProvider] idempotent return for chargeId=${params.chargeId}, transactionId=${existingTransactionId}`,
      );
      return { status: 'PENDING', providerTransactionId: existingTransactionId, raw: {} };
    }

    const paymentDate = nextCmsPaymentDate();

    // 5. transactionId 생성 (chargeId 기반 결정론적 — 재시도 시 동일 ID 보장)
    const transactionId = this.generateTransactionId(params.chargeId);

    // 6. 효성 출금신청 API 호출
    const result = await this.cmsApi.requestWithdrawal({
      transactionId,
      memberId: member.cmsMemberId,
      paymentDate,
      callAmount: params.amount,
    });

    if (!result.ok) {
      // 5xx: throw to trigger DLQ retry
      if (result.statusCode >= 500) {
        throw new Error(`CMS withdrawal API 5xx: ${result.error.code} ${result.error.message}`);
      }
      // 4xx / business error: immediate failure
      return {
        status: 'FAILED',
        errorCode: result.error.code,
        errorMessage: result.error.message,
      };
    }

    // 7. cms_withdrawals 레코드 생성
    await this.dbService.db.insert(cmsWithdrawals).values({
      cmsMemberId: member.cmsMemberId,
      transactionId,
      chargeId: params.chargeId,
      intentId: params.intentId,
      paymentDate,
      amount: params.amount,
      status: 'REQUESTED',
    });

    // 8. return PENDING (배치 결과 대기)
    return {
      status: 'PENDING',
      providerTransactionId: transactionId,
      raw: result.data as unknown as Record<string, unknown>,
    };
  }

  async capture(_params: ChargeParams): Promise<ChargeResult> {
    // CMS는 autoCapture=true + 출금 완료가 곧 capture
    // 폴링 cron에서 처리하므로 여기서는 no-op
    return { status: 'SUCCEEDED' };
  }

  async cancel(params: ChargeParams): Promise<ChargeResult> {
    const transactionId =
      (params.providerData?.transactionId as string | undefined) ?? (await this.getTransactionId(params.chargeId));

    if (!transactionId) {
      return {
        status: 'FAILED',
        errorCode: 'CMS_TRANSACTION_NOT_FOUND',
        errorMessage: 'CMS withdrawal transaction not found',
      };
    }

    // 멱등/상태 가드: deleteWithdrawal을 무조건 호출하면 (1) 이미 삭제된 출금 재취소가 FAILED로 보이고
    // (2) 이미 정산성공한 출금을 취소시도해 잘못 FAILED 처리된다.
    const [wd] = await this.dbService.db
      .select({ status: cmsWithdrawals.status })
      .from(cmsWithdrawals)
      .where(eq(cmsWithdrawals.transactionId, transactionId))
      .limit(1);
    if (wd?.status === 'DELETED') {
      // 이미 취소됨 → 재시도는 멱등 성공으로 간주
      return { status: 'SUCCEEDED' };
    }
    if (wd?.status === 'SUCCEEDED') {
      // 이미 은행 출금이 정산 완료 → 취소 불가(별도 환불/입금으로 처리)
      return {
        status: 'FAILED',
        errorCode: 'CMS_ALREADY_SETTLED',
        errorMessage: '이미 정산 완료된 출금은 취소할 수 없습니다.',
      };
    }

    // 마감 전이면 효성 출금삭제 API 호출
    const result = await this.cmsApi.deleteWithdrawal(transactionId);
    if (!result.ok) {
      // 마감 후면 취소 불가
      return {
        status: 'FAILED',
        errorCode: result.error.code,
        errorMessage: result.error.message,
      };
    }

    // cms_withdrawals 상태 업데이트
    await this.dbService.db
      .update(cmsWithdrawals)
      .set({ status: 'DELETED', updatedAt: new Date() })
      .where(eq(cmsWithdrawals.transactionId, transactionId));

    return { status: 'SUCCEEDED' };
  }

  async refund(_params: RefundParams): Promise<RefundResult> {
    // CMS는 환불 개념이 없음. 별도 입금으로 처리해야 함.
    return {
      status: 'FAILED',
      errorCode: 'CMS_REFUND_NOT_SUPPORTED',
      errorMessage: 'CMS batch provider does not support refunds. Use a separate deposit process.',
    };
  }

  async getStatus(params: GetStatusParams): Promise<ChargeStatusResult> {
    const transactionId = params.providerTransactionId;
    if (!transactionId) {
      return { status: 'FAILED' };
    }

    const result = await this.cmsApi.getWithdrawal(transactionId);
    if (!result.ok) {
      this.logger.warn(`CMS withdrawal query failed for ${transactionId}: ${result.error.code}`);
      return { status: 'PENDING' };
    }

    const payment = result.data.payment;
    switch (payment.status ?? '') {
      case '출금성공':
        return { status: 'SUCCEEDED', raw: payment as unknown as Record<string, unknown> };
      case '출금실패':
        return { status: 'FAILED', raw: payment as unknown as Record<string, unknown> };
      default:
        // 출금중, 출금대기 등
        return { status: 'PENDING', raw: payment as unknown as Record<string, unknown> };
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private generateTransactionId(chargeId: string): string {
    // chargeId UUID 기반 결정론적 생성 (CMS varchar(30) 제한)
    // 재시도 시 동일한 transactionId → CMS API 멱등 처리 가능
    return chargeId.replace(/-/g, '').slice(0, 30);
  }

  private async getTransactionId(chargeId: string): Promise<string | undefined> {
    const rows = await this.dbService.db
      .select({ transactionId: cmsWithdrawals.transactionId })
      .from(cmsWithdrawals)
      .where(eq(cmsWithdrawals.chargeId, chargeId))
      .limit(1);
    return rows[0]?.transactionId;
  }
}
