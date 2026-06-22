import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import {
  ChargeParams,
  ChargeResult,
  DeleteMethodParams,
  PaymentMethod,
  PaymentProvider,
  RefundParams,
  RefundResult,
  ValidateMethodParams,
} from '../payment-provider.interface';
import { WalletSchema, charges } from '../../schema';
import { NicepayBillingApiClient } from './nicepay-billing-api.client';
import { BillingMethodService } from '../../billing/billing-method.service';

@Injectable()
export class NicepayBillingProvider implements PaymentProvider {
  readonly providerType = 'NICEPAY_BILLING';
  readonly autoCapture = true;
  readonly actionMode = 'interactive' as const;

  private readonly logger = new Logger(NicepayBillingProvider.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly nicepayBillingApi: NicepayBillingApiClient,
    private readonly billingMethodService: BillingMethodService,
  ) {}

  async getUserMethods(_userId: string): Promise<PaymentMethod[]> {
    return [];
  }

  async validateMethod(_params: ValidateMethodParams): Promise<void> {}

  async deleteMethod(_params: DeleteMethodParams): Promise<void> {}

  async authorize(params: ChargeParams): Promise<ChargeResult> {
    if (params.currency.toUpperCase() !== 'KRW') {
      return {
        status: 'FAILED',
        errorCode: 'NICEPAY_BILLING_CURRENCY_NOT_SUPPORTED',
        errorMessage: `NICEPAY_BILLING provider supports KRW only: ${params.currency}`,
      };
    }

    const billingMethodId = params.providerData?.billingMethodId as string | undefined;
    if (!billingMethodId) {
      return {
        status: 'FAILED',
        errorCode: 'NICEPAY_BILLING_METHOD_ID_REQUIRED',
        errorMessage: 'billingMethodId is required in providerData',
      };
    }

    let bid: string;
    try {
      bid = await this.billingMethodService.getBillingKey(billingMethodId);
    } catch {
      return {
        status: 'FAILED',
        errorCode: 'NICEPAY_BILLING_KEY_NOT_FOUND',
        errorMessage: 'Billing key (bid) not found for the given billing method',
      };
    }

    const orderId = params.chargeId.replace(/-/g, '');
    const goodsName = (params.metadata?.orderName as string) ?? '정기결제';

    const result = await this.nicepayBillingApi.confirmBilling(bid, {
      orderId,
      amount: params.amount,
      goodsName,
    });

    if (result.ok) {
      return {
        status: 'SUCCEEDED',
        providerTransactionId: result.data.tid,
        raw: result.data as unknown as Record<string, unknown>,
      };
    }

    // 5xx: DLQ 재시도를 위해 throw
    if (result.statusCode >= 500) {
      throw new Error(`NicePay billing API 5xx: ${result.resultCode} ${result.resultMsg}`);
    }

    // 4xx / 비즈니스 오류: 즉시 실패
    return {
      status: 'FAILED',
      errorCode: result.resultCode,
      errorMessage: result.resultMsg,
    };
  }

  async capture(_params: ChargeParams): Promise<ChargeResult> {
    // NicePay 빌링은 confirmBilling 시점에 즉시 승인+캡처 완료
    return { status: 'SUCCEEDED' };
  }

  async cancel(params: ChargeParams): Promise<ChargeResult> {
    const tid = await this.getProviderTransactionId(params.chargeId);
    if (!tid) {
      return { status: 'FAILED', errorCode: 'NICEPAY_BILLING_TID_NOT_FOUND' };
    }
    return this.cancelByTid(tid, params.amount, params.chargeId);
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    const tid = await this.getProviderTransactionId(params.chargeId);
    if (!tid) {
      return { status: 'FAILED', errorCode: 'NICEPAY_BILLING_TID_NOT_FOUND' };
    }
    const result = await this.cancelByTid(tid, params.amount, params.chargeId);
    if (result.status === 'SUCCEEDED') {
      return { status: 'SUCCEEDED', providerRefundId: tid };
    }
    return { status: 'FAILED', errorCode: result.errorCode, errorMessage: result.errorMessage };
  }

  private async cancelByTid(tid: string, amount: number | undefined, chargeId: string): Promise<ChargeResult> {
    const orderId = chargeId.replace(/-/g, '');
    const result = await this.nicepayBillingApi.cancelPayment(tid, orderId, amount);
    if (result.ok) return { status: 'SUCCEEDED' };
    this.logger.error(`NicePay billing cancel failed: ${result.statusCode} ${result.resultCode} ${result.resultMsg}`);
    return { status: 'FAILED', errorCode: result.resultCode, errorMessage: result.resultMsg };
  }

  private async getProviderTransactionId(chargeId: string): Promise<string | undefined> {
    const rows = await this.dbService.db
      .select({ providerTransactionId: charges.providerTransactionId })
      .from(charges)
      .where(eq(charges.id, chargeId))
      .limit(1);
    return rows[0]?.providerTransactionId ?? undefined;
  }
}
