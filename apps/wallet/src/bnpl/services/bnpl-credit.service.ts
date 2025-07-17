import { Injectable, Logger } from '@nestjs/common';

/**
 * BNPL 신용 관리 서비스
 * 기본적인 신용 한도 관리 기능만 구현
 */
@Injectable()
export class BnplCreditService {
  private readonly logger = new Logger(BnplCreditService.name);

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
   * 사용 가능한 신용 한도 조회
   */
  async getAvailableCredit(accountId: string): Promise<{
    totalLimit: number;
    usedAmount: number;
    availableCredit: number;
  }> {
    // TODO: 실제 DB에서 계정 정보와 사용 내역 조회

    // 임시 데이터
    const totalLimit = 500000;
    const usedAmount = 0; // TODO: 실제 사용 금액 계산

    return {
      totalLimit,
      usedAmount,
      availableCredit: totalLimit - usedAmount,
    };
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
