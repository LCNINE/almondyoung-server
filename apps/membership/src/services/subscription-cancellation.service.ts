import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../shared/schemas/entities/schema';
import * as schema from '../shared/schemas/entities/schema';
import { eq, and } from 'drizzle-orm';
import { addDays } from 'date-fns';
import { ContractEventService } from './contract-event.service';
import { DrizzleTransaction } from '../shared/schemas/types';

type Contract = typeof schema.subscriptionContracts.$inferSelect;
type Plan = typeof schema.plan.$inferSelect;

export interface CancellationResult {
  contractId: string;
  status: 'CANCELLED';
  cancelledAt: Date;
  refundEligible: boolean;
  refundAmount: number;
  refundStatus: 'PENDING' | 'NOT_APPLICABLE';
}

export interface RefundEligibility {
  eligible: boolean;
  reason: string;
  amount: number;
}

@Injectable()
export class SubscriptionCancellationService {
  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly contractEventService: ContractEventService,
  ) {}

  /**
   * 일반 구독 취소
   */
  async cancelSubscription(
    userId: string,
    reasonCode: string,
    reasonText?: string,
  ): Promise<CancellationResult> {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 사용자의 최신 계약 조회 (상태 무관)
      const [latestContract] = await tx
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.userId, userId))
        .orderBy(schema.subscriptionContracts.createdAt)
        .limit(1);

      if (!latestContract) {
        throw new Error('Active subscription not found');
      }

      // 중복 취소 체크
      if (latestContract.status === 'CANCELLED') {
        throw new Error('Contract already cancelled');
      }

      // ACTIVE 상태 확인
      if (latestContract.status !== 'ACTIVE') {
        throw new Error('Active subscription not found');
      }

      const contract = latestContract;

      // 2. 플랜 조회
      const [plan] = await tx
        .select()
        .from(schema.plan)
        .where(eq(schema.plan.id, contract.planId))
        .limit(1);

      if (!plan) {
        throw new Error('Plan not found');
      }

      // 3. 환불 자격 확인
      const eligibility = this.checkRefundEligibility(contract, plan);

      // 4. 이벤트 배치 생성
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_CANCELLED',
          effectiveDate: new Date().toISOString().split('T')[0],
        })
        .returning();

      // 5. CANCELLED 이벤트 추가
      const cancelEvent = await this.contractEventService.addEvent(
        tx,
        contract.id,
        'CANCELLED',
        {
          reason: reasonCode,
          reasonText: reasonText || null,
          isForced: false,
        },
        'USER',
        userId,
        batch.id,
        userId,
      );

      // 6. 환불 요청 이벤트 추가 (자격 있을 때만)
      if (eligibility.eligible) {
        await this.contractEventService.addEvent(
          tx,
          contract.id,
          'REFUND_REQUESTED',
          {
            amount: eligibility.amount,
            eligibleAmount: eligibility.amount,
          },
          'SYSTEM',
          userId,
          batch.id,
        );
      }

      // 7. 계약 상태 업데이트
      await tx
        .update(schema.subscriptionContracts)
        .set({
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReasonCode: reasonCode,
          refundRequested: eligibility.eligible,
          refundRequestedAt: eligibility.eligible ? new Date() : null,
          eligibleRefundAmount: eligibility.amount,
          lastEventId: cancelEvent.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.subscriptionContracts.id, contract.id));

      // 8. Entitlement 종료
      await this.terminateEntitlement(tx, userId, batch.id);

      return {
        contractId: contract.id,
        status: 'CANCELLED',
        cancelledAt: new Date(),
        refundEligible: eligibility.eligible,
        refundAmount: eligibility.amount,
        refundStatus: eligibility.eligible ? 'PENDING' : 'NOT_APPLICABLE',
      };
    });
  }

  /**
   * 환불 자격 확인
   */
  checkRefundEligibility(contract: Contract, plan: Plan): RefundEligibility {
    if (this.isInTrialPeriod(contract, plan)) {
      return {
        eligible: true,
        reason: '무료 체험 기간 중 취소',
        amount: plan.price,
      };
    }

    return {
      eligible: false,
      reason: '무료 체험 기간이 지났습니다',
      amount: 0,
    };
  }

  /**
   * 환불 금액 계산
   */
  async calculateRefundAmount(contractId: string): Promise<number> {
    const [contract] = await this.dbService.db
      .select()
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.id, contractId))
      .limit(1);

    if (!contract) {
      throw new Error('Contract not found');
    }

    const [plan] = await this.dbService.db
      .select()
      .from(schema.plan)
      .where(eq(schema.plan.id, contract.planId))
      .limit(1);

    if (!plan) {
      throw new Error('Plan not found');
    }

    const eligibility = this.checkRefundEligibility(contract, plan);
    return eligibility.amount;
  }

  /**
   * 무료 체험 기간 확인
   */
  private isInTrialPeriod(contract: Contract, plan: Plan): boolean {
    if (!plan.trialDays || plan.trialDays === 0) {
      return false;
    }

    const trialEndDate = addDays(
      new Date(contract.billingDate),
      plan.trialDays,
    );
    const now = new Date();

    return now < trialEndDate;
  }

  /**
   * 활성 계약 조회
   */
  private async getActiveContract(
    tx: DrizzleTransaction,
    userId: string,
  ): Promise<Contract | undefined> {
    const [contract] = await tx
      .select()
      .from(schema.subscriptionContracts)
      .where(
        and(
          eq(schema.subscriptionContracts.userId, userId),
          eq(schema.subscriptionContracts.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    return contract;
  }

  /**
   * Entitlement 종료
   */
  private async terminateEntitlement(
    tx: DrizzleTransaction,
    userId: string,
    batchId: string,
  ): Promise<void> {
    await tx
      .update(schema.subscriptionEntitlement)
      .set({
        isCurrent: false,
        closedAt: new Date(),
        closedBatchId: batchId,
      })
      .where(
        and(
          eq(schema.subscriptionEntitlement.userId, userId),
          eq(schema.subscriptionEntitlement.isCurrent, true),
        ),
      );
  }

  /**
   * 강제 구독 취소 (어드민)
   */
  async forceCancelSubscription(
    contractId: string,
    adminId: string,
    reason: string,
    refundType: 'FULL' | 'PARTIAL' | 'NONE',
    refundAmount?: number,
    adminNote?: string,
  ): Promise<CancellationResult> {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 계약 조회
      const [contract] = await tx
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.id, contractId))
        .limit(1);

      if (!contract) {
        throw new Error('Contract not found');
      }

      // 중복 취소 체크
      if (contract.status === 'CANCELLED') {
        throw new Error('Contract already cancelled');
      }

      // 2. 플랜 조회
      const [plan] = await tx
        .select()
        .from(schema.plan)
        .where(eq(schema.plan.id, contract.planId))
        .limit(1);

      if (!plan) {
        throw new Error('Plan not found');
      }

      // 3. 환불 금액 계산
      let finalRefundAmount = 0;
      if (refundType === 'FULL') {
        finalRefundAmount = plan.price;
      } else if (refundType === 'PARTIAL') {
        if (refundAmount === undefined || refundAmount < 0) {
          throw new Error('Invalid refund amount');
        }
        if (refundAmount > plan.price) {
          throw new Error('Refund amount exceeds plan price');
        }
        finalRefundAmount = refundAmount;
      }

      // 4. 이벤트 배치 생성
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_FORCE_CANCELLED',
          adminId,
          effectiveDate: new Date().toISOString().split('T')[0],
        })
        .returning();

      // 5. CANCELLED 이벤트 추가 (강제)
      const cancelEvent = await this.contractEventService.addEvent(
        tx,
        contract.id,
        'CANCELLED',
        {
          reason,
          isForced: true,
          adminId,
          adminNote: adminNote || null,
          refundType,
        },
        'ADMIN',
        contract.userId,
        batch.id,
        adminId,
      );

      // 6. 환불 요청 이벤트 추가 (금액이 있을 때만)
      if (finalRefundAmount > 0) {
        await this.contractEventService.addEvent(
          tx,
          contract.id,
          'REFUND_REQUESTED',
          {
            amount: finalRefundAmount,
            eligibleAmount: finalRefundAmount,
            isForced: true,
          },
          'ADMIN',
          contract.userId,
          batch.id,
          adminId,
        );
      }

      // 7. 계약 상태 업데이트
      await tx
        .update(schema.subscriptionContracts)
        .set({
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReasonCode: 'ADMIN_FORCED',
          refundRequested: finalRefundAmount > 0,
          refundRequestedAt: finalRefundAmount > 0 ? new Date() : null,
          eligibleRefundAmount: finalRefundAmount,
          lastEventId: cancelEvent.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.subscriptionContracts.id, contract.id));

      // 8. Entitlement 종료
      await this.terminateEntitlement(tx, contract.userId, batch.id);

      return {
        contractId: contract.id,
        status: 'CANCELLED',
        cancelledAt: new Date(),
        refundEligible: finalRefundAmount > 0,
        refundAmount: finalRefundAmount,
        refundStatus: finalRefundAmount > 0 ? 'PENDING' : 'NOT_APPLICABLE',
      };
    });
  }
}
