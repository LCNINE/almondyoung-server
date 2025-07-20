import { Injectable, Logger } from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import * as schema from '../../shared/schemas/schema';
import { eq } from 'drizzle-orm';

/**
 * BNPL 계정 서비스 (최소 구현)
 * 
 * 핵심 결제 로직에 필요한 기본 기능만 구현
 */
@Injectable()
export class BnplAccountService {
  private readonly logger = new Logger(BnplAccountService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  /**
   * BNPL 계정 ID로 조회
   */
  async getAccountById(accountId: string) {
    try {
      const account = await this.dbService.db.query.bnplAccount.findFirst({
        where: eq(schema.bnplAccount.id, accountId),
      });

      return account;
    } catch (error) {
      this.logger.error(`BNPL 계정 조회 실패: ${accountId}`, error);
      throw error;
    }
  }

  /**
   * 사용자 ID로 BNPL 계정 조회
   */
  async getAccountByUserId(userId: string) {
    try {
      const account = await this.dbService.db.query.bnplAccount.findFirst({
        where: eq(schema.bnplAccount.userId, userId),
      });

      return account;
    } catch (error) {
      this.logger.error(`사용자 BNPL 계정 조회 실패: ${userId}`, error);
      throw error;
    }
  }

  /**
   * 사용자의 모든 BNPL 계정 조회
   */
  async getAllAccountsByUserId(userId: string) {
    try {
      const accounts = await this.dbService.db.query.bnplAccount.findMany({
        where: eq(schema.bnplAccount.userId, userId),
      });

      return accounts;
    } catch (error) {
      this.logger.error(`사용자 모든 BNPL 계정 조회 실패: ${userId}`, error);
      throw error;
    }
  }

  /**
   * BNPL 계정 비활성화
   */
  async deactivateAccount(dto: { bnplAccountId: string }) {
    try {
      const [updated] = await this.dbService.db
        .update(schema.bnplAccount)
        .set({
          status: 'INACTIVE',
          updatedAt: new Date(),
        })
        .where(eq(schema.bnplAccount.id, dto.bnplAccountId))
        .returning();

      this.logger.log(`BNPL 계정 비활성화 완료: ${dto.bnplAccountId}`);
      return updated;
    } catch (error) {
      this.logger.error(`BNPL 계정 비활성화 실패: ${dto.bnplAccountId}`, error);
      throw error;
    }
  }

  /**
   * 이벤트 히스토리 조회 (임시 구현)
   */
  async getEventHistory(userId: string) {
    // TODO: 실제 이벤트 히스토리 구현
    this.logger.log(`이벤트 히스토리 조회: ${userId}`);
    return [];
  }

  /**
   * 거래 히스토리 조회 (임시 구현)
   */
  async getTransactionHistory(accountId: string, limit: number) {
    try {
      const transactions = await this.dbService.db.query.bnplTransaction.findMany({
        where: eq(schema.bnplTransaction.bnplAccountId, accountId),
        limit,
        orderBy: (bnplTransaction, { desc }) => [desc(bnplTransaction.createdAt)],
      });

      return transactions;
    } catch (error) {
      this.logger.error(`거래 히스토리 조회 실패: ${accountId}`, error);
      throw error;
    }
  }

  /**
   * 계정 통계 조회 (임시 구현)
   */
  async getAccountStatistics(accountId: string) {
    // TODO: 실제 통계 구현
    this.logger.log(`계정 통계 조회: ${accountId}`);
    return {
      totalTransactions: 0,
      totalAmount: 0,
      lastTransactionDate: null,
    };
  }
}