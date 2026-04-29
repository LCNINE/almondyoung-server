import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, lte, lt, notInArray, sql } from 'drizzle-orm';
import * as schema from '../../shared/schemas/entities/schema';
import { membershipSchema } from '../../shared/schemas/entities/schema';

export interface DueContract {
  id: string;
  userId: string;
  planId: string;
  nextBillingDate: string | null;
  paymentProfileId: string | null;
  isPastDue: boolean;
  billingRetryCount: number;
}

export interface DunningItem {
  id: string;
  contractId: string;
  nextRetryAt: Date;
  attempts: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * BillingReader (Implementation Layer)
 *
 * 역할: 결제 관련 데이터 조회
 * - 결제 대상 계약 조회
 * - Dunning 큐 조회
 * - 계약 정보 조회
 */
@Injectable()
export class BillingReader {
  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  /**
   * 오늘 결제 예정인 계약들 조회
   *
   * 필터링 조건:
   * - 무효화되지 않음 (isVoided = false)
   * - 일시정지되지 않음 (entitlement.pausedAt IS NULL)
   * - 결제일 도달 (nextBillingDate <= today)
   * - 정상 결제 또는 연체 재시도 대상
   */
  async findDueContracts(date: string): Promise<DueContract[]> {
    return this.dbService.db
      .select({
        id: schema.subscriptionContracts.id,
        userId: schema.subscriptionContracts.userId,
        planId: schema.subscriptionContracts.planId,
        nextBillingDate: schema.subscriptionContracts.nextBillingDate,
        paymentProfileId: schema.subscriptionContracts.paymentProfileId,
        isPastDue: schema.subscriptionContracts.isPastDue,
        billingRetryCount: schema.subscriptionContracts.billingRetryCount,
      })
      .from(schema.subscriptionContracts)
      .innerJoin(
        schema.subscriptionEntitlement,
        and(
          eq(schema.subscriptionEntitlement.userId, schema.subscriptionContracts.userId),
          eq(schema.subscriptionEntitlement.isCurrent, true),
        ),
      )
      .where(
        and(
          eq(schema.subscriptionContracts.isVoided, false),
          eq(schema.subscriptionContracts.autoRenewal, true),
          sql`${schema.subscriptionEntitlement.pausedAt} IS NULL`,
          lte(schema.subscriptionContracts.nextBillingDate, date),
        ),
      );
  }

  /**
   * Dunning 큐 조회 (재시도 대상)
   */
  async findDunningItems(now: Date): Promise<DunningItem[]> {
    return this.dbService.db
      .select()
      .from(schema.membershipDunningQueue)
      .where(lte(schema.membershipDunningQueue.nextRetryAt, now));
  }

  /**
   * 만료된 권한 조회 (autoRenewal=false, endsAt < today, isCurrent=true)
   */
  async findExpiredEntitlements(today: string): Promise<{ entitlementId: string; userId: string; contractId: string }[]> {
    return this.dbService.db
      .select({
        entitlementId: schema.subscriptionEntitlement.id,
        userId: schema.subscriptionEntitlement.userId,
        contractId: schema.subscriptionContracts.id,
      })
      .from(schema.subscriptionEntitlement)
      .innerJoin(
        schema.subscriptionContracts,
        eq(schema.subscriptionContracts.userId, schema.subscriptionEntitlement.userId),
      )
      .where(
        and(
          eq(schema.subscriptionEntitlement.isCurrent, true),
          eq(schema.subscriptionContracts.autoRenewal, false),
          eq(schema.subscriptionContracts.isVoided, false),
          lt(schema.subscriptionEntitlement.endsAt, today),
          notInArray(schema.subscriptionContracts.status, ['EXPIRED', 'CANCELLED']),
        ),
      );
  }

  /**
   * 계약 ID로 계약 조회
   */
  async findContractById(contractId: string): Promise<DueContract | null> {
    const [contract] = await this.dbService.db
      .select({
        id: schema.subscriptionContracts.id,
        userId: schema.subscriptionContracts.userId,
        planId: schema.subscriptionContracts.planId,
        nextBillingDate: schema.subscriptionContracts.nextBillingDate,
        paymentProfileId: schema.subscriptionContracts.paymentProfileId,
        isPastDue: schema.subscriptionContracts.isPastDue,
        billingRetryCount: schema.subscriptionContracts.billingRetryCount,
      })
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.id, contractId))
      .limit(1);

    return contract || null;
  }
}
