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
import { WalletSchema, paymentMethods } from '../../schema';

@Injectable()
export class BankTransferPaymentProvider implements PaymentProvider {
  readonly providerType = 'BANK_TRANSFER';
  readonly autoCapture = true;

  constructor(private readonly dbService: DbService<WalletSchema>) {}

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
    return {
      status: 'REQUIRES_ACTION',
      nextAction: {
        type: 'BANK_TRANSFER_PENDING',
        bankName: process.env.BANK_TRANSFER_BANK_NAME ?? '',
        accountNumber: process.env.BANK_TRANSFER_ACCOUNT_NUMBER ?? '',
        accountHolder: process.env.BANK_TRANSFER_ACCOUNT_HOLDER ?? '',
        amount: params.amount,
        currency: params.currency,
      },
    };
  }

  async capture(_params: ChargeParams): Promise<ChargeResult> {
    return { status: 'SUCCEEDED' };
  }

  async cancel(_params: ChargeParams): Promise<ChargeResult> {
    return { status: 'SUCCEEDED' };
  }

  async refund(_params: RefundParams): Promise<RefundResult> {
    // Bank transfer refunds require manual transfer back to the customer — stay PENDING until confirmed
    return { status: 'PENDING' };
  }
}
