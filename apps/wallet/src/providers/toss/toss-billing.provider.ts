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
import { TossApiClient } from './toss-api.client';
import { BillingMethodService } from '../../billing/billing-method.service';

@Injectable()
export class TossBillingProvider implements PaymentProvider {
  readonly providerType = 'TOSS_BILLING';
  readonly autoCapture = true;

  private readonly logger = new Logger(TossBillingProvider.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly tossApi: TossApiClient,
    private readonly billingMethodService: BillingMethodService,
  ) {}

  async getUserMethods(_userId: string): Promise<PaymentMethod[]> {
    // Toss billing methods are managed through BillingMethodService, not here
    return [];
  }

  async validateMethod(_params: ValidateMethodParams): Promise<void> {
    // Validation is done during billing key issuance
  }

  async deleteMethod(_params: DeleteMethodParams): Promise<void> {
    // Deletion handled via BillingMethodService.revoke()
  }

  async authorize(params: ChargeParams): Promise<ChargeResult> {
    if (params.currency.toUpperCase() !== 'KRW') {
      return {
        status: 'FAILED',
        errorCode: 'TOSS_BILLING_CURRENCY_NOT_SUPPORTED',
        errorMessage: `TOSS_BILLING provider supports KRW only: ${params.currency}`,
      };
    }

    const billingMethodId = params.providerData?.billingMethodId as string | undefined;
    if (!billingMethodId) {
      return {
        status: 'FAILED',
        errorCode: 'TOSS_BILLING_METHOD_ID_REQUIRED',
        errorMessage: 'billingMethodId is required in providerData',
      };
    }

    let billingKey: string;
    let customerKey: string;
    try {
      billingKey = await this.billingMethodService.getBillingKey(billingMethodId);
      customerKey = await this.billingMethodService.getCustomerKey(billingMethodId);
    } catch {
      return {
        status: 'FAILED',
        errorCode: 'TOSS_BILLING_KEY_NOT_FOUND',
        errorMessage: 'Billing key or customer key not found for the given billing method',
      };
    }

    const orderId = params.chargeId.replace(/-/g, '');
    const orderName = (params.metadata?.orderName as string) ?? '정기결제';

    const result = await this.tossApi.confirmBilling(billingKey, params.amount, orderId, customerKey, orderName);

    if (result.ok) {
      return {
        status: 'SUCCEEDED',
        providerTransactionId: result.data.paymentKey,
        raw: result.data as unknown as Record<string, unknown>,
      };
    }

    // 5xx: throw to trigger DLQ retry
    if (result.statusCode >= 500) {
      throw new Error(`Toss billing API 5xx: ${result.error.code} ${result.error.message}`);
    }

    // 4xx / business error: immediate failure
    return {
      status: 'FAILED',
      errorCode: result.error.code,
      errorMessage: result.error.message,
    };
  }

  async capture(_params: ChargeParams): Promise<ChargeResult> {
    // Toss billing is auto-capture (즉시 승인)
    return { status: 'SUCCEEDED' };
  }

  async cancel(params: ChargeParams): Promise<ChargeResult> {
    const paymentKey = await this.getPaymentKey(params.chargeId);
    if (!paymentKey) {
      return { status: 'FAILED', errorCode: 'TOSS_BILLING_PAYMENT_KEY_NOT_FOUND' };
    }

    const result = await this.tossApi.cancelPayment(paymentKey, '정기결제 취소', params.amount, params.idempotencyKey);
    if (result.ok) return { status: 'SUCCEEDED' };
    return { status: 'FAILED', errorCode: result.error.code, errorMessage: result.error.message };
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    const paymentKey = await this.getPaymentKey(params.chargeId);
    if (!paymentKey) {
      return { status: 'FAILED', errorCode: 'TOSS_BILLING_PAYMENT_KEY_NOT_FOUND' };
    }

    const result = await this.tossApi.cancelPayment(
      paymentKey,
      params.reasonCode ?? '환불',
      params.amount,
      params.idempotencyKey,
    );
    if (result.ok) {
      return { status: 'SUCCEEDED', providerRefundId: paymentKey };
    }
    return { status: 'FAILED', errorCode: result.error.code, errorMessage: result.error.message };
  }

  private async getPaymentKey(chargeId: string): Promise<string | undefined> {
    const rows = await this.dbService.db
      .select({ providerTransactionId: charges.providerTransactionId })
      .from(charges)
      .where(eq(charges.id, chargeId))
      .limit(1);
    return rows[0]?.providerTransactionId ?? undefined;
  }
}
