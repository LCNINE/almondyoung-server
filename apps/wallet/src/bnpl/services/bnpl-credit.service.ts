import { Injectable, Logger } from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import { eq } from 'drizzle-orm';
import * as schema from '../../shared/schemas/schema';

/**
 * BNPL 신용 관리 서비스
 * 기본적인 신용 한도 관리 기능만 구현
 */
@Injectable()
export class BnplCreditService {
  private readonly logger = new Logger(BnplCreditService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {
    this.logger.log('💳 BNPL 신용 관리 서비스 초기화 완료');
  }

  /**
   * 초기 신용 한도 평가
   * TODO: 실제 신용평가 로직 구현 필요
   */
  async evaluateInitialCreditLimit(userId: string): Promise<number> {
    this.logger.log(`초기 신용 한도 평가 시작. userId: ${userId}`);

    // 기본 신용 한도 (임시)
    const defaultCreditLimit = 500000; // 50만원

    // TODO: 실제 신용평가 API 연동
    // TODO: 사용자 소득, 신용점수, 거래내역 등을 고려한 평가

    return defaultCreditLimit;
  }

  /**
   * 사용 가능한 신용 한도 조회 (Event Sourcing)
   */
  async getAvailableCredit(accountId: string): Promise<{
    totalLimit: number;
    usedAmount: number;
    availableCredit: number;
  }> {
    // 1. BNPL 계정 정보 조회
    const account = await this.dbService.db.query.bnplAccount.findFirst({
      where: eq(schema.bnplAccount.id, accountId),
    });

    if (!account) {
      throw new Error(`BNPL 계정을 찾을 수 없습니다: ${accountId}`);
    }

    const totalLimit = Number(account.approvedLimit);

    // 2. Event Sourcing: Transaction 이벤트들을 기반으로 사용 금액 실시간 계산
    const usedAmount = await this.calculateUsedAmount(accountId);

    return {
      totalLimit,
      usedAmount,
      availableCredit: Math.max(0, totalLimit - usedAmount),
    };
  }

  /**
   * Event Sourcing: BNPL Transaction 이벤트들을 기반으로 사용 금액 계산
   */
  private async calculateUsedAmount(accountId: string): Promise<number> {
    const transactions = await this.dbService.db.query.bnplTransaction.findMany({
      where: eq(schema.bnplTransaction.bnplAccountId, accountId),
      orderBy: (transactions, { asc }) => [asc(transactions.createdAt)],
    });

    let usedAmount = 0;
    for (const transaction of transactions) {
      const amount = Number(transaction.amount);
      if (transaction.transactionType === 'DEBIT') {
        usedAmount += amount; // 사용 금액 증가
      } else if (transaction.transactionType === 'CREDIT') {
        usedAmount -= amount; // 상환 금액 차감
      }
    }

    return Math.max(0, usedAmount); // 음수 방지
  }

  /**
   * 위험도 평가
   * TODO: 실제 위험도 평가 로직 구현 필요
   */
  async evaluateRisk(accountId: string): Promise<{
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    riskScore: number;
    factors: string[];
  }> {
    // TODO: 실제 위험도 평가 로직
    // - 연체 이력
    // - 사용 패턴
    // - 결제 이력 등

    return {
      riskLevel: 'LOW',
      riskScore: 85,
      factors: ['정상 결제 이력', '안정적인 사용 패턴'],
    };
  }
}
