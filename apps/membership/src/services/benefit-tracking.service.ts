import { Injectable, Logger } from '@nestjs/common';
import { eq, and, sql, desc } from 'drizzle-orm';
import { DbService } from '@app/db';
import { SubscriptionService } from './subscription.service';
import * as schema from '../shared/schemas/entities/schema';
import { membershipSchema } from '../shared/schemas/entities/schema';
import {
  calculateCycleStart,
  calculateCycleEnd,
  calculateCycleNumber,
  formatDate,
  isCycleCompleted,
} from '../utils/cycle.utils';
import { differenceInDays, addDays } from 'date-fns';
import { RecordDiscountDto } from '../shared/dto/benefit-tracking.dto';

@Injectable()
export class BenefitTrackingService {
  private readonly logger = new Logger(BenefitTrackingService.name);

  constructor(
    private readonly db: DbService<typeof membershipSchema>,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  /**
   * 주문 완료 시 혜택 기록 (외부 시스템에서 호출)
   */
  async recordDiscount(dto: RecordDiscountDto): Promise<void> {
    const subscription = await this.subscriptionService.getActiveSubscription(
      dto.userId,
    );

    if (!subscription) {
      this.logger.warn('No active subscription', {
        userId: dto.userId,
        orderId: dto.orderId,
      });
      return;
    }

    const orderDate = new Date(dto.orderDate);
    const billingDate = subscription.billingDate;

    const cycleStartDate = calculateCycleStart(billingDate, orderDate);
    const cycleEndDate = calculateCycleEnd(cycleStartDate);
    const cycleNumber = calculateCycleNumber(billingDate, cycleStartDate);

    await this.db.db.transaction(async (tx) => {
      // 멱등성 체크: onConflictDoNothing으로 중복 시 무시
      const insertResult = await tx
        .insert(schema.membershipDiscountEvents)
        .values({
          orderId: dto.orderId,
          userId: dto.userId,
          discountAmount: dto.membershipDiscountAmount,
          tierId: dto.tierId,
          cycleStartDate: formatDate(cycleStartDate),
          subscriptionId: subscription.id,
          orderDate: new Date(dto.orderDate),
          isCancelled: false,
        })
        .onConflictDoNothing()
        .returning();

      // 중복 키로 인해 아무것도 삽입되지 않은 경우
      if (insertResult.length === 0) {
        this.logger.log('Duplicate order, skipping', {
          orderId: dto.orderId,
        });
        return;
      }

      // UPSERT: 첫 주문이면 INSERT, 아니면 UPDATE
      await tx
        .insert(schema.membershipCycleBenefits)
        .values({
          userId: dto.userId,
          cycleStartDate: formatDate(cycleStartDate),
          cycleEndDate: formatDate(cycleEndDate),
          totalDiscountAmount: dto.membershipDiscountAmount,
          orderCount: 1,
          subscriptionId: subscription.id,
          cycleNumber,
        })
        .onConflictDoUpdate({
          target: [
            schema.membershipCycleBenefits.userId,
            schema.membershipCycleBenefits.cycleStartDate,
          ],
          set: {
            totalDiscountAmount: sql`${schema.membershipCycleBenefits.totalDiscountAmount} + ${dto.membershipDiscountAmount}`,
            orderCount: sql`${schema.membershipCycleBenefits.orderCount} + 1`,
            updatedAt: new Date(),
          },
        });
    });

    this.logger.log('Discount recorded', {
      orderId: dto.orderId,
      cycleStartDate: formatDate(cycleStartDate),
      amount: dto.membershipDiscountAmount,
    });
  }

  /**
   * 주문 취소 시 혜택 차감 (외부 시스템에서 호출)
   */
  async cancelDiscount(orderId: string): Promise<void> {
    await this.db.db.transaction(async (tx) => {
      const events = await tx
        .select()
        .from(schema.membershipDiscountEvents)
        .where(eq(schema.membershipDiscountEvents.orderId, orderId))
        .limit(1);

      if (!events.length) {
        this.logger.error('Event not found', { orderId });
        throw new Error('DISCOUNT_EVENT_NOT_FOUND');
      }

      const event = events[0];

      if (event.isCancelled) {
        this.logger.log('Already cancelled', { orderId });
        return;
      }

      await tx
        .update(schema.membershipDiscountEvents)
        .set({
          isCancelled: true,
          cancelledAt: new Date(),
        })
        .where(eq(schema.membershipDiscountEvents.orderId, orderId));

      await tx
        .update(schema.membershipCycleBenefits)
        .set({
          totalDiscountAmount: sql`${schema.membershipCycleBenefits.totalDiscountAmount} - ${event.discountAmount}`,
          orderCount: sql`${schema.membershipCycleBenefits.orderCount} - 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.membershipCycleBenefits.userId, event.userId),
            eq(
              schema.membershipCycleBenefits.cycleStartDate,
              event.cycleStartDate,
            ),
          ),
        );
    });

    this.logger.log('Discount cancelled', { orderId });
  }

  /**
   * 현재 주기 혜택 조회
   */
  async getCurrentCycleBenefit(userId: string) {
    const subscription =
      await this.subscriptionService.getActiveSubscription(userId);

    if (!subscription) {
      throw new Error('NO_ACTIVE_SUBSCRIPTION');
    }

    const now = new Date();
    const billingDate = subscription.billingDate;
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

    // row 없으면 0원 반환
    if (!benefits.length) {
      return {
        userId,
        cycleStartDate: formatDate(cycleStartDate),
        cycleEndDate: formatDate(cycleEndDate),
        totalDiscountAmount: 0,
        orderCount: 0,
        daysRemaining: differenceInDays(cycleEndDate, now),
        daysElapsed: differenceInDays(now, cycleStartDate),
        subscriptionType: subscription.type,
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
      subscriptionType: subscription.type,
      nextCycleStartDate: formatDate(addDays(cycleStartDate, 30)),
    };
  }

  /**
   * 주기별 혜택 이력 조회
   */
  async getCycleBenefitHistory(userId: string, limit: number = 12) {
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
}
