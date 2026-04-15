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
import { CmsApiClient } from './cms-api.client';
import { CmsMemberService } from './cms-member.service';
import { CmsAgreementService } from './cms-agreement.service';

@Injectable()
export class CmsBatchProvider implements PaymentProvider {
  readonly providerType = 'CMS_BATCH';
  readonly autoCapture = true;

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
    const hasRegistered = agreements.some((a) => a.status === '등록');
    if (!hasRegistered) {
      return {
        status: 'FAILED',
        errorCode: 'CMS_AGREEMENT_NOT_REGISTERED',
        errorMessage: 'CMS agreement document not registered for this member',
      };
    }

    // 4. 출금일 계산 (다음 영업일 — 마감시간 D-1 17:00 고려)
    const paymentDate = this.calculateNextPaymentDate();

    // 5. transactionId 생성
    const transactionId = this.generateTransactionId(params.chargeId);

    // 6. 효성 출금신청 API 호출
    const result = await this.cmsApi.requestWithdrawal({
      memberId: member.cmsMemberId,
      paymentDate,
      amount: params.amount,
      transactionId,
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
    const transactionId = params.providerData?.transactionId as string | undefined
      ?? await this.getTransactionId(params.chargeId);

    if (!transactionId) {
      return {
        status: 'FAILED',
        errorCode: 'CMS_TRANSACTION_NOT_FOUND',
        errorMessage: 'CMS withdrawal transaction not found',
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

    const apiStatus = result.data.status ?? '';
    switch (apiStatus) {
      case '출금성공':
      case 'SUCCEEDED':
        return {
          status: 'SUCCEEDED',
          raw: result.data as unknown as Record<string, unknown>,
        };
      case '출금실패':
      case 'FAILED':
        return {
          status: 'FAILED',
          raw: result.data as unknown as Record<string, unknown>,
        };
      default:
        // 출금중, 출금대기 등
        return {
          status: 'PENDING',
          raw: result.data as unknown as Record<string, unknown>,
        };
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * 다음 출금일 계산.
   * 마감시간 D-1 17:00 기준 — 현재 시각이 17:00 이전이면 내일, 이후이면 모레.
   * 주말/공휴일은 건너뛴다 (공휴일은 단순화를 위해 주말만 처리).
   */
  private calculateNextPaymentDate(): string {
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstOffset);

    const kstHour = kstNow.getUTCHours();
    // 17:00 이전이면 다음 영업일, 이후이면 그 다음 영업일
    let daysToAdd = kstHour < 17 ? 1 : 2;

    const target = new Date(kstNow);
    target.setUTCDate(target.getUTCDate() + daysToAdd);

    // 주말 건너뛰기
    while (target.getUTCDay() === 0 || target.getUTCDay() === 6) {
      target.setUTCDate(target.getUTCDate() + 1);
    }

    const year = target.getUTCFullYear();
    const month = String(target.getUTCMonth() + 1).padStart(2, '0');
    const day = String(target.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private generateTransactionId(chargeId: string): string {
    // chargeId(UUID)에서 하이픈 제거 후 앞 20자 + 타임스탬프 뒤 10자 = 최대 30자
    const prefix = chargeId.replace(/-/g, '').slice(0, 20);
    const suffix = String(Date.now()).slice(-10);
    return `${prefix}${suffix}`;
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
