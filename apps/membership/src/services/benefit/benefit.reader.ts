import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, desc, gte, lt, sql } from 'drizzle-orm';
import * as schema from '../../shared/schemas/entities/schema';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { differenceInDays, addDays } from 'date-fns';
import { calculateCycleStart, calculateCycleEnd, formatDate, isCycleCompleted } from '../../utils/cycle.utils';
import { MembershipBenefitUsage } from './benefit-usage';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 어떤 기간에 실제로 받은 멤버십 할인.
 *
 * 원천은 주문 단위 원장(`membership_discount_events`)이다. 집계 테이블
 * (`membership_cycle_benefits`)은 30일 고정 주기라 결제 주기와 경계가 어긋나고, 기록/취소 경로에서만
 * 갱신돼 원장과 벌어질 수 있다. 돈이 걸린 판정(환불 가능 여부·연간 정산)과 고객 화면은 모두 원장을 본다.
 */
export interface BenefitUsage {
  /** 해당 기간에 받은 멤버십 할인 합계 (취소된 주문 제외) */
  totalDiscountAmount: number;
  /** 할인을 받은 주문 수. 표시용이며 혜택 사용 판정에는 쓰지 않는다. */
  orderCount: number;
}

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
   * 한 기간에 실제로 받은 할인 혜택.
   *
   * `from` 이상 `to` 미만(주면)의 주문을 센다. 취소된 주문(is_cancelled)은 혜택을 받지 않았으므로 제외.
   *
   * 이 하나가 청약철회 판정·연간 정산 차감·고객 화면 절약액의 공통 정의다. 예전에는 판정이 30일
   * 집계 테이블을, 정산이 원장을, 화면이 달력 월을 각각 봐서 같은 할인을 서로 다르게 셌다.
   */
  async findBenefitUsageBetween(userId: string, from: Date, to?: Date): Promise<BenefitUsage> {
    const conditions = [
      eq(schema.membershipDiscountEvents.userId, userId),
      eq(schema.membershipDiscountEvents.isCancelled, false),
      gte(schema.membershipDiscountEvents.orderDate, from),
    ];
    if (to) conditions.push(lt(schema.membershipDiscountEvents.orderDate, to));

    const [row] = await this.db.db
      .select({
        total: sql<string>`COALESCE(SUM(${schema.membershipDiscountEvents.discountAmount}), 0)`,
        count: sql<string>`COUNT(*)`,
      })
      .from(schema.membershipDiscountEvents)
      .where(and(...conditions));

    return {
      totalDiscountAmount: Number(row?.total ?? 0),
      orderCount: Number(row?.count ?? 0),
    };
  }

  /**
   * 기간 안에 쓴 멤버십 혜택 전부(판정은 `hasUsedMembershipBenefit`).
   *
   * 웰컴딜은 사용자당 한 줄이고 취소되면 지워진다 — 「지금 산 상태이고 그 시각이 기간 안」이면 쓴 것이다.
   * 구매확정 때 시각이 다시 찍혀 뒤로 밀릴 수 있지만, 판정은 «기간 시작 이후인가»만 보므로 영향이 없다.
   */
  async findMembershipBenefitUsageSince(userId: string, from: Date): Promise<MembershipBenefitUsage> {
    const [discount, welcomeDeal] = await Promise.all([
      this.findBenefitUsageBetween(userId, from),
      this.hasWelcomeDealSince(userId, from),
    ]);
    return { ...discount, welcomeDeal };
  }

  /**
   * 웰컴딜 표만 `user_id` 가 uuid 칸이다(다른 표는 문자열). uuid 가 아닌 id 로 물으면 DB 가 형 변환
   * 오류를 던져 해지 화면·미납 기록까지 같이 죽는다 — 그런 id 는 이 표에 행이 있을 수도 없으니 묻지 않는다.
   */
  private async hasWelcomeDealSince(userId: string, from: Date): Promise<boolean> {
    if (!UUID_PATTERN.test(userId)) return false;
    const [row] = await this.db.db
      .select({ purchasedAt: schema.welcomeMembershipEligibility.purchasedAt })
      .from(schema.welcomeMembershipEligibility)
      .where(
        and(
          eq(schema.welcomeMembershipEligibility.userId, userId),
          eq(schema.welcomeMembershipEligibility.hasPurchased, true),
          gte(schema.welcomeMembershipEligibility.purchasedAt, from),
        ),
      )
      .limit(1);
    return !!row;
  }

  /** 기간 내 할인 주문 목록. 고객이 "어느 주문에서 얼마 아꼈는지" 를 확인하는 용도다. */
  async findDiscountEventsBetween(
    userId: string,
    from: Date,
    to?: Date,
  ): Promise<Array<{ orderId: string; orderDate: Date; discountAmount: number }>> {
    const conditions = [
      eq(schema.membershipDiscountEvents.userId, userId),
      eq(schema.membershipDiscountEvents.isCancelled, false),
      gte(schema.membershipDiscountEvents.orderDate, from),
    ];
    if (to) conditions.push(lt(schema.membershipDiscountEvents.orderDate, to));

    const rows = await this.db.db
      .select({
        orderId: schema.membershipDiscountEvents.orderId,
        orderDate: schema.membershipDiscountEvents.orderDate,
        discountAmount: schema.membershipDiscountEvents.discountAmount,
      })
      .from(schema.membershipDiscountEvents)
      .where(and(...conditions))
      .orderBy(desc(schema.membershipDiscountEvents.orderDate));

    return rows;
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
