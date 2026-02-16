import { Injectable, Logger } from '@nestjs/common';
import { NewBnplAccount, BnplAccount } from '../../shared/database/types';
import { getTsid } from 'tsid-ts';
import { WalletExecutor } from '../../shared/database';
import { BnplRepository } from './bnpl.repository';

/**
 * BnplAccountCreator - BNPL 계정 생성 (Implementation Layer)
 */
@Injectable()
export class BnplAccountCreator {
  private readonly logger = new Logger(BnplAccountCreator.name);

  constructor(private readonly repo: BnplRepository) {}

  async create(
    userId: string,
    creditLimit: number,
    tx?: WalletExecutor,
  ): Promise<BnplAccount> {
    try {
      const nextBillingDate = this.calculateNextBillingDate(new Date());
      const billingCycleStart = new Date().toISOString().split('T')[0];
      const billingCycleEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      const newAccount: NewBnplAccount = {
        id: getTsid().toString(),
        userId,
        creditLimit,
        availableLimit: creditLimit,
        status: 'ACTIVE',
        billingCycleStart,
        billingCycleEnd,
        nextBillingDate,
      };

      const createdAccount = await this.repo.createAccount(newAccount, tx);

      this.logger.log(
        `Account created: ${createdAccount.id} for user ${userId}, limit: ${creditLimit}`,
      );

      return createdAccount;
    } catch (error: any) {
      this.logger.error(`Failed to create account: ${error.message}`);
      throw new Error('Account creation failed');
    }
  }

  private calculateNextBillingDate(baseDate: Date): string {
    const nextDate = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const dayOfWeek = nextDate.getDay();
    if (dayOfWeek === 0) nextDate.setDate(nextDate.getDate() + 1);
    else if (dayOfWeek === 6) nextDate.setDate(nextDate.getDate() + 2);
    return nextDate.toISOString().split('T')[0];
  }
}
