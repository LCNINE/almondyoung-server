import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, desc, gte, sum } from 'drizzle-orm';
import * as schema from '../../shared/schemas/entities/schema';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { differenceInDays, addDays } from 'date-fns';
import { calculateCycleStart, calculateCycleEnd, formatDate, isCycleCompleted } from '../../utils/cycle.utils';

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
          eq(schema.membershipCycleBenefits.cycleStartDate, formatDate(cycleStartDate)),
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
  async findCycleBenefitHistory(userId: string, limit: number = 12): Promise<CycleBenefitHistory> {
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

    const totalDiscountAllTime = benefits.reduce((sum, b) => sum + b.totalDiscountAmount, 0);

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
  /**
   * 특정 날짜 이후 실제로 받은 할인 혜택 합계.
   *
   * 연간 중도해지 정산에서 차감할 금액이다. 취소된 주문(is_cancelled)은 혜택을 받지 않았으므로 제외한다.
   * 30일 집계주기 단위인 membership_cycle_benefits 가 아니라 주문 단위 원장을 쓰는 이유는,
   * 연간 계약은 결제 주기(365일)와 집계 주기(30일)가 달라 주기 합산이 기간 경계와 맞지 않기 때문이다.
   */
  async sumBenefitDiscountSince(userId: string, from: Date): Promise<number> {
    const [row] = await this.db.db
      .select({ total: sum(schema.membershipDiscountEvents.discountAmount) })
      .from(schema.membershipDiscountEvents)
      .where(
        and(
          eq(schema.membershipDiscountEvents.userId, userId),
          eq(schema.membershipDiscountEvents.isCancelled, false),
          gte(schema.membershipDiscountEvents.orderDate, from),
        ),
      );

    return Number(row?.total ?? 0);
  }

  async findDiscountEventByOrderId(orderId: string) {
    const [event] = await this.db.db
      .select()
      .from(schema.membershipDiscountEvents)
      .where(eq(schema.membershipDiscountEvents.orderId, orderId))
      .limit(1);

    return event || null;
  }
}
