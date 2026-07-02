import { BadRequestException, Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';
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
import { WalletSchema, charges, paymentMethods } from '../../schema';
import { TossApiClient } from '../toss/toss-api.client';

const DEFAULT_DEPOSIT_WINDOW_HOURS = 72;

@Injectable()
export class BankTransferPaymentProvider implements PaymentProvider {
  readonly providerType = 'BANK_TRANSFER';
  readonly autoCapture = true;
  readonly actionMode = 'offline-wait' as const;

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly tossApi: TossApiClient,
  ) {}

  async getUserMethods(userId: string): Promise<PaymentMethod[]> {
    return this.dbService.db.transaction(async (tx) => {
      const db = tx as typeof this.dbService.db;
      const existing = await db
        .select()
        .from(paymentMethods)
        .where(
          and(
            eq(paymentMethods.userId, userId),
            eq(paymentMethods.type, 'BANK_TRANSFER'),
            eq(paymentMethods.isDeleted, false),
          ),
        );

      if (existing.length > 0) return existing;

      return db
        .insert(paymentMethods)
        .values({
          userId,
          type: 'BANK_TRANSFER',
          displayName: '무통장입금',
          isReusable: true,
          isDeleted: false,
          providerData: {},
        })
        .returning();
    });
  }

  async validateMethod(_params: ValidateMethodParams): Promise<void> {
    // BANK_TRANSFER payment method is always valid
  }

  async deleteMethod(_params: DeleteMethodParams): Promise<void> {
    throw new BadRequestException({
      error: 'BANK_TRANSFER_METHOD_NOT_DELETABLE',
      message: 'Bank transfer payment method cannot be deleted',
    });
  }

  async authorize(params: ChargeParams): Promise<ChargeResult> {
    if (params.currency.toUpperCase() !== 'KRW') {
      return {
        status: 'FAILED',
        errorCode: 'BANK_TRANSFER_CURRENCY_NOT_SUPPORTED',
        errorMessage: `BANK_TRANSFER supports KRW only: ${params.currency}`,
      };
    }

    const bank = process.env.TOSS_VIRTUAL_ACCOUNT_BANK;
    if (!bank) {
      return {
        status: 'FAILED',
        errorCode: 'BANK_TRANSFER_BANK_NOT_CONFIGURED',
        errorMessage: 'TOSS_VIRTUAL_ACCOUNT_BANK is not configured',
      };
    }

    const meta = params.metadata ?? {};
    const orderId = params.chargeId.replace(/-/g, '');
    const result = await this.tossApi.issueVirtualAccount({
      amount: params.amount,
      orderId,
      orderName: (meta.orderName as string) ?? '무통장입금',
      customerName: (meta.customerName as string) ?? '주문자',
      bank,
      validHours: this.depositWindowHours(),
      ...(meta.customerEmail ? { customerEmail: meta.customerEmail as string } : {}),
      ...(meta.customerMobilePhone ? { customerMobilePhone: meta.customerMobilePhone as string } : {}),
    });

    if (!result.ok) {
      return { status: 'FAILED', errorCode: result.error.code, errorMessage: result.error.message };
    }

    const va = result.data.virtualAccount;
    return {
      status: 'REQUIRES_ACTION',
      providerTransactionId: result.data.paymentKey,
      nextAction: {
        type: 'BANK_TRANSFER_PENDING',
        bankName: process.env.TOSS_VIRTUAL_ACCOUNT_BANK_NAME ?? va.bankCode,
        accountNumber: va.accountNumber,
        accountHolder: process.env.BANK_TRANSFER_ACCOUNT_HOLDER ?? va.customerName,
        dueDate: va.dueDate,
        amount: params.amount,
        currency: params.currency,
      },
      raw: { paymentKey: result.data.paymentKey, secret: result.data.secret, virtualAccount: va },
    };
  }

  async capture(_params: ChargeParams): Promise<ChargeResult> {
    // 가상계좌는 입금(DONE) 시 토스가 자동 정산한다. 별도 capture API 호출 없음.
    return { status: 'SUCCEEDED' };
  }

  async cancel(_params: ChargeParams): Promise<ChargeResult> {
    return { status: 'SUCCEEDED' };
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    // 환불계좌가 없으면 자동환불 불가 → 수동환불(PENDING) 폴백 (관리자가 외부 처리 후 완료 기록).
    if (!params.refundReceiveAccount) {
      return { status: 'PENDING' };
    }

    // 발급 시 charges.responsePayload 에 스냅샷된 paymentKey 로 토스 가상계좌 환불(계좌로 송금)을 호출한다.
    const paymentKey = await this.getPaymentKey(params.chargeId);
    if (!paymentKey) {
      //  대상 charge 에 paymentKey 스냅샷이 없으면(구건 등) 자동환불 불가 → 수동 폴백.
      return { status: 'PENDING' };
    }

    const result = await this.tossApi.cancelPayment(
      paymentKey,
      params.reasonCode ?? '고객 요청',
      params.amount,
      params.idempotencyKey,
      params.refundReceiveAccount,
    );
    if (result.ok) {
      return { status: 'SUCCEEDED', providerRefundId: paymentKey };
    }
    return { status: 'FAILED', errorCode: result.error.code, errorMessage: result.error.message };
  }

  /** 발급 시 스냅샷된 paymentKey 를 charge 에서 읽는다 (webhook 확정건은 providerTransactionId 에도 있음). */
  private async getPaymentKey(chargeId: string): Promise<string | undefined> {
    const rows = await this.dbService.db
      .select({ providerTransactionId: charges.providerTransactionId, responsePayload: charges.responsePayload })
      .from(charges)
      .where(eq(charges.id, chargeId))
      .limit(1);
    const row = rows[0];
    if (!row) return undefined;
    const fromPayload = (row.responsePayload as { paymentKey?: unknown } | null)?.paymentKey;
    if (typeof fromPayload === 'string' && fromPayload) return fromPayload;
    // 수동확정 placeholder('BANK_TRANSFER_CONFIRMED')는 실제 paymentKey 가 아니므로 제외.
    const ptid = row.providerTransactionId ?? undefined;
    if (ptid && ptid !== 'BANK_TRANSFER_CONFIRMED') return ptid;
    return undefined;
  }

  private depositWindowHours(): number {
    const raw = Number(process.env.WALLET_BANK_TRANSFER_DEPOSIT_WINDOW_HOURS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DEPOSIT_WINDOW_HOURS;
  }
}
