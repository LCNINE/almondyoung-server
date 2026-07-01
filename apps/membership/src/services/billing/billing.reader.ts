import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, lte, lt, notInArray, isNull, not, exists } from 'drizzle-orm';
import { subDays, parseISO, format } from 'date-fns';
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
          eq(schema.subscriptionContracts.billingInProgress, false),
          isNull(schema.subscriptionEntitlement.pausedAt),
          lte(schema.subscriptionContracts.nextBillingDate, date),
          // dunning 처리 중인 계약은 dunning 스케줄러가 담당 — 메인 스케줄러 제외
          not(
            exists(
              this.dbService.db
                .select()
                .from(schema.membershipDunningQueue)
                .where(eq(schema.membershipDunningQueue.contractId, schema.subscriptionContracts.id)),
            ),
          ),
        ),
      );
  }

  /**
   * Dunning 큐 조회 (재시도 대상)
   * billingInProgress=true인 계약은 제외 — 이전 커맨드 결과 이벤트 대기 중
   */
  async findDunningItems(now: Date): Promise<DunningItem[]> {
    return this.dbService.db
      .select({
        id: schema.membershipDunningQueue.id,
        contractId: schema.membershipDunningQueue.contractId,
        nextRetryAt: schema.membershipDunningQueue.nextRetryAt,
        attempts: schema.membershipDunningQueue.attempts,
        maxAttempts: schema.membershipDunningQueue.maxAttempts,
        lastErrorCode: schema.membershipDunningQueue.lastErrorCode,
        lastErrorMessage: schema.membershipDunningQueue.lastErrorMessage,
        createdAt: schema.membershipDunningQueue.createdAt,
        updatedAt: schema.membershipDunningQueue.updatedAt,
      })
      .from(schema.membershipDunningQueue)
      .innerJoin(
        schema.subscriptionContracts,
        eq(schema.subscriptionContracts.id, schema.membershipDunningQueue.contractId),
      )
      .where(
        and(
          lte(schema.membershipDunningQueue.nextRetryAt, now),
          eq(schema.subscriptionContracts.billingInProgress, false),
        ),
      );
  }

  /**
   * 만료된 권한 조회 (autoRenewal=false, endsAt < today, isCurrent=true)
   */
  async findExpiredEntitlements(
    today: string,
  ): Promise<{ entitlementId: string; userId: string; contractId: string }[]> {
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
   * autoRenewal=true인데 endsAt이 지나고 dunning 항목도 없는 "stuck" 권한 조회
   *
   * BillingCharge Kafka 커맨드 발행 후 wallet이 결제 결과 이벤트를 발행하지 못한 경우(wallet 장애, Kafka 단절 등)
   * billingInProgress=true는 제외 — CMS처럼 결과가 다음 영업일에 오는 경우 만료 처리하면 안 됨
   */
  async findStuckEntitlements(today: string): Promise<{ entitlementId: string; userId: string; contractId: string }[]> {
    // 갱신일 당일 publish 실패나 가입 직후 미결제를 다음 결제 시도 전에 만료시키지 않도록 하루 유예.
    const graceDate = format(subDays(parseISO(today), 1), 'yyyy-MM-dd');
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
      .leftJoin(
        schema.membershipDunningQueue,
        eq(schema.membershipDunningQueue.contractId, schema.subscriptionContracts.id),
      )
      .where(
        and(
          eq(schema.subscriptionEntitlement.isCurrent, true),
          eq(schema.subscriptionContracts.autoRenewal, true),
          eq(schema.subscriptionContracts.isVoided, false),
          eq(schema.subscriptionContracts.billingInProgress, false),
          isNull(schema.subscriptionEntitlement.pausedAt),
          lt(schema.subscriptionEntitlement.endsAt, graceDate),
          notInArray(schema.subscriptionContracts.status, ['EXPIRED', 'CANCELLED']),
          isNull(schema.membershipDunningQueue.id),
        ),
      );
  }

  /**
   * 계약의 현재 더닝 재시도 횟수 조회 (없으면 0).
   * 결제 멱등키 nonce로 사용해 재시도마다 새 커맨드가 되도록 한다.
   */
  async findDunningAttempts(contractId: string): Promise<number> {
    const [row] = await this.dbService.db
      .select({ attempts: schema.membershipDunningQueue.attempts })
      .from(schema.membershipDunningQueue)
      .where(eq(schema.membershipDunningQueue.contractId, contractId))
      .limit(1);
    return row?.attempts ?? 0;
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
