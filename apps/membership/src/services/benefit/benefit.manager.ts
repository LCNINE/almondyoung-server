import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, sql } from 'drizzle-orm';
import * as schema from '../../shared/schemas/entities/schema';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { DrizzleTransaction } from '../../shared/schemas/types';
import {
  calculateCycleStart,
  calculateCycleEnd,
  calculateCycleNumber,
  formatDate,
} from '../../utils/cycle.utils';

export interface RecordDiscountInput {
  orderId: string;
  userId: string;
  membershipDiscountAmount: number;
  tierId: string;
  orderDate: string;
  subscriptionId: string;
  billingDate: Date;
}

/**
 * BenefitManager (Implementation Layer)
 *
 * 역할: 혜택 기록 및 취소 처리
 * - 할인 혜택 기록 (멱등성 보장)
 * - 할인 혜택 취소
 * - 주기별 혜택 집계 업데이트
 */
@Injectable()
export class BenefitManager {
  private readonly logger = new Logger(BenefitManager.name);

  constructor(private readonly db: DbService<typeof membershipSchema>) {}

  /**
   * 할인 혜택 기록
   */
  async recordDiscount(input: RecordDiscountInput): Promise<boolean> {
    return this.db.db.transaction(async (tx: DrizzleTransaction) => {
      const orderDate = new Date(input.orderDate);
      const billingDate = input.billingDate;

      const cycleStartDate = calculateCycleStart(billingDate, orderDate);
      const cycleEndDate = calculateCycleEnd(cycleStartDate);
      const cycleNumber = calculateCycleNumber(billingDate, cycleStartDate);

      // 멱등성 체크: onConflictDoNothing으로 중복 시 무시
      const insertResult = await tx
        .insert(schema.membershipDiscountEvents)
        .values({
          orderId: input.orderId,
          userId: input.userId,
          discountAmount: input.membershipDiscountAmount,
          tierId: input.tierId,
          cycleStartDate: formatDate(cycleStartDate),
          subscriptionId: input.subscriptionId,
          orderDate: new Date(input.orderDate),
          isCancelled: false,
        })
        .onConflictDoNothing()
        .returning();

      // 중복 키로 인해 아무것도 삽입되지 않은 경우
      if (insertResult.length === 0) {
        this.logger.log('Duplicate order, skipping', {
          orderId: input.orderId,
        });
        return false;
      }

      // UPSERT: 첫 주문이면 INSERT, 아니면 UPDATE
      await tx
        .insert(schema.membershipCycleBenefits)
        .values({
          userId: input.userId,
          cycleStartDate: formatDate(cycleStartDate),
          cycleEndDate: formatDate(cycleEndDate),
          totalDiscountAmount: input.membershipDiscountAmount,
          orderCount: 1,
          subscriptionId: input.subscriptionId,
          cycleNumber,
        })
        .onConflictDoUpdate({
          target: [
            schema.membershipCycleBenefits.userId,
            schema.membershipCycleBenefits.cycleStartDate,
          ],
          set: {
            totalDiscountAmount: sql`${schema.membershipCycleBenefits.totalDiscountAmount} + ${input.membershipDiscountAmount}`,
            orderCount: sql`${schema.membershipCycleBenefits.orderCount} + 1`,
            updatedAt: new Date(),
          },
        });

      this.logger.log('Discount recorded', {
        orderId: input.orderId,
        cycleStartDate: formatDate(cycleStartDate),
        amount: input.membershipDiscountAmount,
      });

      return true;
    });
  }

  /**
   * 할인 혜택 취소
   */
  async cancelDiscount(orderId: string, event: any): Promise<void> {
    return this.db.db.transaction(async (tx: DrizzleTransaction) => {
      // 이미 취소된 경우 스킵
      if (event.isCancelled) {
        this.logger.log('Already cancelled', { orderId });
        return;
      }

      // 이벤트 취소 처리
      await tx
        .update(schema.membershipDiscountEvents)
        .set({
          isCancelled: true,
          cancelledAt: new Date(),
        })
        .where(eq(schema.membershipDiscountEvents.orderId, orderId));

      // 주기별 혜택 차감
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

      this.logger.log('Discount cancelled', { orderId });
    });
  }
}
