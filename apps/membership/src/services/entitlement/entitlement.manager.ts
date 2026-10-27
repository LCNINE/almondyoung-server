import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq, and, inArray, desc, sql } from 'drizzle-orm';
import { addDays, differenceInCalendarDays, parseISO } from 'date-fns';
import { DrizzleTransaction } from '../../shared/schemas/types';
import { MembershipEventPublisher } from '../membership-event.publisher';

type Entitlement = typeof schema.subscriptionEntitlement.$inferSelect;

/**
 * EntitlementManager (Implementation Layer)
 *
 * 역할: 권한 생성/수정/종료 + 검증 + DB 접근
 * - 권한 생성 (기존 권한 종료 포함)
 * - 권한 연장/차감
 * - 권한 만료 처리
 * - 활성 권한 종료
 */
@Injectable()
export class EntitlementManager {
  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly membershipEventPublisher: MembershipEventPublisher,
  ) {}

  /**
   * 권한 생성 (기존 권한 자동 종료)
   */
  async createEntitlement(
    tx: DrizzleTransaction,
    userId: string,
    tierId: string,
    startsAt: Date,
    endsAt: Date,
    sourceBatchId: string,
  ): Promise<Entitlement> {
    // 1. 기존 활성 권한 종료
    await this.terminateActiveEntitlement(tx, userId, sourceBatchId);

    // 2. 새로운 권한 생성
    const [newEntitlement] = await tx
      .insert(schema.subscriptionEntitlement)
      .values({
        userId,
        tierId,
        startsAt: startsAt.toISOString().split('T')[0],
        endsAt: endsAt.toISOString().split('T')[0],
        isCurrent: true,
        sourceBatchId,
      })
      .returning();

    return newEntitlement;
  }

  /**
   * 권한 연장/차감
   */
  async adjustEntitlement(userId: string, days: number, reason: string, adminId: string): Promise<Entitlement> {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 활성 권한 조회
      const [activeEntitlement] = await tx
        .select()
        .from(schema.subscriptionEntitlement)
        .where(
          and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)),
        )
        .for('update')
        .limit(1);

      if (!activeEntitlement) {
        throw new Error('Active entitlement not found');
      }

      // 2. 새 종료일 계산
      const currentEndDate = new Date(activeEntitlement.endsAt);
      const newEndDate = addDays(currentEndDate, days);
      const today = new Date();

      // 3. 검증: 차감으로 인해 종료일이 과거가 되는 경우 방지
      if (newEndDate < today && days < 0) {
        const maxReducibleDays = Math.floor((currentEndDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        throw new Error(`최대 ${maxReducibleDays}일까지만 차감할 수 있습니다. 현재 구독이 즉시 만료됩니다.`);
      }

      const eventType = days > 0 ? 'ENTITLEMENT_EXTENDED' : 'ENTITLEMENT_REDUCED';

      // 4. 이벤트 배치 생성
      const [eventBatch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: eventType,
          effectiveDate: new Date().toISOString().split('T')[0],
          adminId: adminId,
        })
        .returning();

      // 5. 기존 권한 닫기 (이력 보존)
      await tx
        .update(schema.subscriptionEntitlement)
        .set({
          isCurrent: false,
          closedAt: new Date(),
          closedBatchId: eventBatch.id,
        })
        .where(eq(schema.subscriptionEntitlement.id, activeEntitlement.id));

      // 6. 새로운 권한 생성 (조정된 기간으로)
      const [newEntitlement] = await tx
        .insert(schema.subscriptionEntitlement)
        .values({
          userId,
          tierId: activeEntitlement.tierId,
          startsAt: activeEntitlement.startsAt,
          endsAt: newEndDate.toISOString().split('T')[0],
          isCurrent: true,
          sourceBatchId: eventBatch.id,
        })
        .returning();

      // 7. 계약 이벤트 로그 기록
      const [activeContract] = await tx
        .select({ id: schema.subscriptionContracts.id })
        .from(schema.subscriptionContracts)
        .where(and(eq(schema.subscriptionContracts.userId, userId), eq(schema.subscriptionContracts.status, 'ACTIVE')))
        .limit(1);

      if (activeContract) {
        await tx.insert(schema.subscriptionContractEvents).values({
          contractId: activeContract.id,
          eventType,
          userId,
          metadata: {
            days,
            reason,
            previousEndsAt: currentEndDate.toISOString(),
            newEndsAt: newEndDate.toISOString(),
          },
          batchId: eventBatch.id,
          causedBy: 'ADMIN',
          causedByUserId: adminId,
        });
      }

      return newEntitlement;
    });
  }

  /**
   * 관리자 직접 지급 (일수 + 메모)
   *
   * - 활성 권한 없음: 새 계약 + 권한 생성
   * - 이미 활성 권한 있음: 오류 (기간 조정 기능 사용 요구)
   */
  async grantByDays(
    userId: string,
    days: number,
    memo: string | null,
    adminId: string,
    tx?: DrizzleTransaction,
  ): Promise<{ entitlement: Entitlement; contractId: string; planId: string; tierId: string }> {
    return await this.dbService.run((trx) => {
      const today = new Date();
      return this.grantUntil(trx, userId, today, addDays(today, days), days, memo, adminId);
    }, tx);
  }

  /** 기준일(today)과 종료일을 호출자가 정해 지급한다. days 는 이벤트 기록용이다. */
  private async grantUntil(
    tx: DrizzleTransaction,
    userId: string,
    today: Date,
    endsAt: Date,
    days: number,
    memo: string | null,
    adminId: string,
  ): Promise<{ entitlement: Entitlement; contractId: string; planId: string; tierId: string }> {
    {
      const [existing] = await tx
        .select({ id: schema.subscriptionEntitlement.id })
        .from(schema.subscriptionEntitlement)
        .where(
          and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)),
        )
        .for('update')
        .limit(1);

      if (existing) {
        throw new Error('이미 활성 구독이 있습니다. 기간 조정 기능을 사용하세요.');
      }

      const todayStr = today.toISOString().split('T')[0];

      const [lastContractRow] = await tx
        .select({ planId: schema.subscriptionContracts.planId, tierId: schema.plan.tierId })
        .from(schema.subscriptionContracts)
        .innerJoin(schema.plan, eq(schema.subscriptionContracts.planId, schema.plan.id))
        .where(eq(schema.subscriptionContracts.userId, userId))
        .orderBy(desc(schema.subscriptionContracts.createdAt))
        .limit(1);

      let planId: string;
      let tierId: string;

      if (lastContractRow) {
        planId = lastContractRow.planId;
        tierId = lastContractRow.tierId;
      } else {
        const [anyPlan] = await tx
          .select({ id: schema.plan.id, tierId: schema.plan.tierId })
          .from(schema.plan)
          .where(eq(schema.plan.isActive, true))
          .limit(1);

        if (!anyPlan) throw new Error('활성 플랜이 없어 구독을 생성할 수 없습니다.');
        planId = anyPlan.id;
        tierId = anyPlan.tierId;
      }

      const [eventBatch] = await tx
        .insert(schema.eventBatches)
        .values({ type: 'GRANTED_BY_ADMIN', effectiveDate: todayStr, adminId })
        .returning();

      const [newContract] = await tx
        .insert(schema.subscriptionContracts)
        .values({ userId, planId, billingDate: todayStr, autoRenewal: false })
        .returning();

      const [newEntitlement] = await tx
        .insert(schema.subscriptionEntitlement)
        .values({
          userId,
          tierId,
          startsAt: todayStr,
          endsAt: endsAt.toISOString().split('T')[0],
          isCurrent: true,
          sourceBatchId: eventBatch.id,
        })
        .returning();

      await tx.insert(schema.subscriptionContractEvents).values({
        contractId: newContract.id,
        eventType: 'GRANTED_BY_ADMIN',
        userId,
        metadata: { days, reason: memo, previousEndsAt: null, newEndsAt: endsAt.toISOString() },
        batchId: eventBatch.id,
        causedBy: 'ADMIN',
        causedByUserId: adminId,
      });

      // 지급은 이 트랜잭션으로 최종 확정이므로 그룹 동기화 이벤트를 같은 tx 의 아웃박스에
      // 원자적으로 기록한다 (신규가입 one_time 경로와 동일한 이유).
      await this.membershipEventPublisher.saveStatusChanged(
        {
          userId,
          status: 'ACTIVE',
          occurredAt: today.toISOString(),
          contractId: newContract.id,
          planId,
          tierId,
        },
        tx,
      );

      return { entitlement: newEntitlement, contractId: newContract.id, planId, tierId };
    }
  }

  /**
   * 이어받기로 대체된 임시 지급의 남은 일수 복구
   *
   * 유료 시작일(billingDate) 전에 새 계약이 취소되면 오늘부터 billingDate 까지를 다시 지급한다.
   * 이어받기 계약이 아니거나 이미 유료 시작일이 됐으면 아무것도 쓰지 않는다.
   */
  async restoreTakenOverGrant(
    tx: DrizzleTransaction,
    contract: { id: string; userId: string; billingDate: string | null },
    // 해지 시각과 같은 시계를 쓰도록 호출자가 넘긴다 (자정을 사이에 두고 하루가 비지 않게)
    now: Date = new Date(),
  ): Promise<number> {
    if (!contract.billingDate) return 0;

    const days = differenceInCalendarDays(parseISO(contract.billingDate), parseISO(now.toISOString().split('T')[0]));
    if (days <= 0) return 0;

    const [takenOver] = await tx
      .select({ id: schema.subscriptionContractEvents.id })
      .from(schema.subscriptionContractEvents)
      .where(
        and(
          eq(schema.subscriptionContractEvents.userId, contract.userId),
          eq(schema.subscriptionContractEvents.eventType, 'SUPERSEDED_BY_SUBSCRIPTION'),
          sql`${schema.subscriptionContractEvents.metadata}->>'newContractId' = ${contract.id}`,
        ),
      )
      .limit(1);
    if (!takenOver) return 0;

    // 종료일은 시계가 아니라 billingDate 로 못박는다 (자정을 넘겨도 어긋나지 않게)
    await this.grantUntil(
      tx,
      contract.userId,
      now,
      new Date(`${contract.billingDate}T00:00:00Z`),
      days,
      '가입 취소로 임시 지급 복구',
      'SYSTEM',
    );
    return days;
  }

  /**
   * 권한 만료 처리 (Lazy Expiration)
   */
  async expireEntitlement(entitlementId: string, userId: string): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      // 1. 이벤트 배치 생성
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_EXPIRED',
          effectiveDate: new Date().toISOString().split('T')[0],
        })
        .returning();

      // 2. 권한 만료 처리
      await tx
        .update(schema.subscriptionEntitlement)
        .set({
          isCurrent: false,
          closedAt: new Date(),
          closedBatchId: batch.id,
        })
        .where(eq(schema.subscriptionEntitlement.id, entitlementId));

      // 3. 계약 이벤트 기록
      const [contract] = await tx
        .select({ id: schema.subscriptionContracts.id })
        .from(schema.subscriptionContracts)
        .where(and(eq(schema.subscriptionContracts.userId, userId), eq(schema.subscriptionContracts.status, 'ACTIVE')))
        .limit(1);

      if (contract) {
        await tx.insert(schema.subscriptionContractEvents).values({
          contractId: contract.id,
          eventType: 'EXPIRED',
          userId,
          metadata: {
            reason: 'NATURAL_EXPIRATION',
            expiredAt: new Date().toISOString().split('T')[0],
          },
          batchId: batch.id,
          causedBy: 'SYSTEM',
          causedByUserId: null,
        });
      }
    });
  }

  /**
   * 활성 권한 종료 (public - 다른 Manager에서 사용)
   */
  async terminateActiveEntitlement(tx: DrizzleTransaction, userId: string, closedBatchId: string): Promise<void> {
    const activeEntitlements = await tx
      .select({ id: schema.subscriptionEntitlement.id })
      .from(schema.subscriptionEntitlement)
      .where(
        and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)),
      );

    if (activeEntitlements.length > 0) {
      const idsToTerminate = activeEntitlements.map((e) => e.id);
      await tx
        .update(schema.subscriptionEntitlement)
        .set({
          isCurrent: false,
          closedAt: new Date(),
          closedBatchId,
        })
        .where(inArray(schema.subscriptionEntitlement.id, idsToTerminate));
    }
  }
}
