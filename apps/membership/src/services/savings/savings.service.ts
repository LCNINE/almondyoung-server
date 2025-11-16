import { Injectable, Logger } from '@nestjs/common';
import { SavingsReader } from './savings.reader';
import { startOfMonth, format } from 'date-fns';

export interface MonthlySavingsDto {
  userId: string;
  yearMonth: string;
  totalSavings: number;
  orderCount: number;
  period: {
    startDate: Date;
    endDate: Date;
  };
}

export interface RangeSavingsDto {
  userId: string;
  totalSavings: number;
  orderCount: number;
  period: {
    startDate: Date;
    endDate: Date;
  };
  monthlyBreakdown: Array<{
    yearMonth: string;
    savings: number;
    orderCount: number;
  }>;
}

/**
 * SavingsService (Business Layer)
 *
 * 역할: 월별 절약액 비즈니스 로직
 * - 이번달 절약액 조회
 * - 특정 월 절약액 조회
 * - 기간별 절약액 조회
 */
@Injectable()
export class SavingsService {
  private readonly logger = new Logger(SavingsService.name);

  constructor(private readonly savingsReader: SavingsReader) {}

  /**
   * 이번달 절약액 조회
   *
   * @param userId - 사용자 ID
   * @returns 이번달 절약액 정보
   */
  async getCurrentMonthSavings(userId: string): Promise<MonthlySavingsDto> {
    const now = new Date();
    const yearMonth = format(now, 'yyyy-MM');

    const result = await this.savingsReader.getMonthSavings(userId, yearMonth);

    return {
      userId,
      yearMonth,
      totalSavings: result.totalSavings,
      orderCount: result.orderCount,
      period: result.period,
    };
  }

  /**
   * 특정 월 절약액 조회
   *
   * @param userId - 사용자 ID
   * @param yearMonth - 조회할 년월 (YYYY-MM 형식)
   * @returns 특정 월 절약액 정보
   */
  async getMonthSavings(
    userId: string,
    yearMonth: string,
  ): Promise<MonthlySavingsDto> {
    // YYYY-MM 형식 검증
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      throw new Error('Invalid yearMonth format. Use YYYY-MM');
    }

    const result = await this.savingsReader.getMonthSavings(userId, yearMonth);

    return {
      userId,
      yearMonth,
      totalSavings: result.totalSavings,
      orderCount: result.orderCount,
      period: result.period,
    };
  }

  /**
   * 기간별 절약액 조회
   *
   * @param userId - 사용자 ID
   * @param startDate - 시작일
   * @param endDate - 종료일
   * @returns 기간별 절약액 정보 (월별 breakdown 포함)
   */
  async getRangeSavings(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<RangeSavingsDto> {
    if (startDate > endDate) {
      throw new Error('startDate must be before or equal to endDate');
    }

    const result = await this.savingsReader.getRangeSavings(
      userId,
      startDate,
      endDate,
    );

    return {
      userId,
      totalSavings: result.totalSavings,
      orderCount: result.orderCount,
      period: result.period,
      monthlyBreakdown: result.monthlyBreakdown,
    };
  }
}
