import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, desc } from 'drizzle-orm';
import * as schema from '../../shared/schemas/entities/schema';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { differenceInDays, addDays } from 'date-fns';
import {
  calculateCycleStart,
  calculateCycleEnd,
  formatDate,
  isCycleCompleted,
} from '../../utils/cycle.utils';

export interface CurrentCycleBenefit {
  userId: string;
  cycleStartDate: string;
  cycleEndDate: string;
  totalDiscountAmount: number;
  orderCount: number;
  daysRemaining: number;
  daysElapsed: number;
  subscriptionType: 'MONTHLY' | 'YEAR';
  nextCycleStartDate: string;
}

export interface CycleBenefitHistory {
  userId: string;
  cycles: Array<{
    cycleStartDate: string;
    cycleEndDate: string;
    totalDiscountAmount: number;
    orderCount: number;
    isCompleted: boolean;
  }>;
  totalCycles: number;
  totalDiscountAllTime: number;
}

/**
 * BenefitReader (Implementation Layer)
 *
 * 역할: 혜택 조회
 * - 현재 주기 혜택 조회
 * - 주기별 혜택 이력 조회
 * - 할인 이벤트 조회
 */
@Injectable()
export class BenefitReader {
  constructor(private readonly db: DbService<typeof membershipSchema>) {}

  /**
   * 현재 주기 혜택 조회
   */
  async findCurrentCycleBenefit(
    userId: string,
    billingDate: Date,
    subscriptionType: 'MONTHLY' | 'YEAR',
  ): Promise<CurrentCycleBenefit> {
    const now = new Date();
    const cycleStartDate = calculateCycleStart(billingDate, now);
    const cycleEndDate = calculateCycleEnd(cycleStartDate);

    const benefits = await this.db.db
      .select()
      .from(schema.membershipCycleBenefits)
      .where(
        and(
          eq(schema.membershipCycleBenefits.userId, userId),
          eq(
            schema.membershipCycleBenefits.cycleStartDate,
            formatDate(cycleStartDate),
          ),
        ),
      )
      .limit(1);

    // 혜택 기록이 없으면 0원 반환
    if (!benefits.length) {
      return {
        userId,
        cycleStartDate: formatDate(cycleStartDate),
        cycleEndDate: formatDate(cycleEndDate),
        totalDiscountAmount: 0,
        orderCount: 0,
        daysRemaining: differenceInDays(cycleEndDate, now),
        daysElapsed: differenceInDays(now, cycleStartDate),
        subscriptionType,
        nextCycleStartDate: formatDate(addDays(cycleStartDate, 30)),
      };
    }

    const benefit = benefits[0];
    const endDate = new Date(benefit.cycleEndDate);

    return {
      userId: benefit.userId,
      cycleStartDate: benefit.cycleStartDate,
      cycleEndDate: benefit.cycleEndDate,
      totalDiscountAmount: benefit.totalDiscountAmount,
      orderCount: benefit.orderCount,
      daysRemaining: differenceInDays(endDate, now),
      daysElapsed: differenceInDays(now, cycleStartDate),
      subscriptionType,
      nextCycleStartDate: formatDate(addDays(cycleStartDate, 30)),
    };
  }

  /**
   * 주기별 혜택 이력 조회
   */
  async findCycleBenefitHistory(
    userId: string,
    limit: number = 12,
  ): Promise<CycleBenefitHistory> {
    const benefits = await this.db.db
      .select()
      .from(schema.membershipCycleBenefits)
      .where(eq(schema.membershipCycleBenefits.userId, userId))
      .orderBy(desc(schema.membershipCycleBenefits.cycleStartDate))
      .limit(limit);

    const cycles = benefits.map((b) => ({
      cycleStartDate: b.cycleStartDate,
      cycleEndDate: b.cycleEndDate,
      totalDiscountAmount: b.totalDiscountAmount,
      orderCount: b.orderCount,
      isCompleted: isCycleCompleted(new Date(b.cycleEndDate)),
    }));

    const totalDiscountAllTime = benefits.reduce(
      (sum, b) => sum + b.totalDiscountAmount,
      0,
    );

    return {
      userId,
      cycles,
      totalCycles: benefits.length,
      totalDiscountAllTime,
    };
  }

  /**
   * 할인 이벤트 조회 (주문 ID로)
   */
  async findDiscountEventByOrderId(orderId: string) {
    const [event] = await this.db.db
      .select()
      .from(schema.membershipDiscountEvents)
      .where(eq(schema.membershipDiscountEvents.orderId, orderId))
      .limit(1);

    return event || null;
  }
}
