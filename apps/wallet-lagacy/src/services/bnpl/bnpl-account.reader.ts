import { Injectable } from '@nestjs/common';
import { BnplAccount } from '../../shared/database/types';
import { WalletExecutor } from '../../shared/database';
import { BnplRepository } from './bnpl.repository';

/**
 * BnplAccountReader - BNPL 계정 조회 (Implementation Layer)
 *
 * 책임: Service와 Repository 사이의 레이어 (규칙 3 준수)
 */
@Injectable()
export class BnplAccountReader {
  constructor(private readonly repo: BnplRepository) {}

  async findByUserId(
    userId: string,
    tx?: WalletExecutor,
  ): Promise<BnplAccount | null> {
    return await this.repo.findAccountByUserId(userId, tx);
  }

  async findById(
    accountId: string,
    tx?: WalletExecutor,
  ): Promise<BnplAccount | null> {
    return await this.repo.findAccountById(accountId, tx);
  }

  async findAccountsForBilling(): Promise<BnplAccount[]> {
    return await this.repo.findAccountsForBilling();
  }

  async getUnbilledAmount(accountId: string): Promise<number> {
    return await this.repo.getUnbilledAmount(accountId);
  }
}
