import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { and, eq } from 'drizzle-orm';
import { ContractEventManager } from './contract-event.manager';
import { DrizzleTransaction } from '../../shared/schemas/types';

type Contract = typeof schema.subscriptionContracts.$inferSelect;
type Plan = typeof schema.plan.$inferSelect;

export interface RefundEligibility {
  eligible: boolean;
  reason: string;
  amount: number;
}

export interface ImmediateCancellationResult {
  type: 'IMMEDIATE_CANCELLATION';
  contractId: string;
  status: 'CANCELLED';
  cancelledAt: Date;
  refundEligible: boolean;
  refundAmount: number;
  refundStatus: 'PENDING' | 'NOT_APPLICABLE';
  message: string;
}

export interface RecurringCancellationResult {
  type: 'RECURRING_CANCELLATION';
  contractId: string;
  status: 'RECURRING_CANCELLED';
  recurringCancelledAt: Date;
  nextBillingDate: null;
  currentPeriodEndsAt: string;
  autoRenewal: false;
  refundEligible: false;
  message: string;
}

@Injectable()
export class SubscriptionCancellationManager {
  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly contractEventManager: ContractEventManager,
  ) {}

  /**
   * 환불 가능 여부 판단 (정책 기반)
   */
  checkRefundEligibility(contract: Contract, plan: Plan): RefundEligibility {
    // 검증: 계약과 플랜 존재 확인
    if (!contract) {
      throw new Error('Contract not found');
    }
    if (!plan) {
      throw new Error('Plan not found');
    }

    // 고객 셀프 해지는 자동 환불을 만들지 않는다.
    // 서비스 장애/기술 오류 예외 환불은 어드민 강제 취소 경로에서 금액을 산정해 처리한다.
    return {
      eligible: false,
      reason: '이용 시작 후 환불 불가',
      amount: 0,
    };
  }

  /**
   * 즉시 취소 처리 (환불 가능 시점)
   */
  async cancelImmediately(
    userId: string,
    contract: Contract,
    plan: Plan,
    reasonCode: string,
    reasonText: string | undefined,
    eligibility: RefundEligibility,
  ): Promise<ImmediateCancellationResult> {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 이벤트 배치 생성
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_CANCELLED',
          effectiveDate: new Date().toISOString().split('T')[0],
        })
        .returning();

      // 2. CANCELLED 이벤트 추가
      const cancelEvent = await this.contractEventManager.addEvent(
        tx,
        contract.id,
        'CANCELLED',
        {
          reason: reasonCode,
          reasonText: reasonText || null,
          isForced: false,
          cancellationType: 'IMMEDIATE',
        },
        'USER',
        userId,
        batch.id,
        userId,
      );

      // 3. 환불 요청 이벤트 추가
      if (eligibility.eligible) {
        await this.contractEventManager.addEvent(
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

      // 4. 계약 상태 업데이트
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

      // 5. Entitlement 종료
      await this.terminateEntitlement(tx, userId, batch.id);

      return {
        type: 'IMMEDIATE_CANCELLATION',
        contractId: contract.id,
        status: 'CANCELLED',
        cancelledAt: new Date(),
        refundEligible: eligibility.eligible,
        refundAmount: eligibility.amount,
        refundStatus: eligibility.eligible ? 'PENDING' : 'NOT_APPLICABLE',
        message: '구독이 즉시 취소되었습니다.',
      };
    });
  }

  /**
   * 정기결제 중단 처리 (환불 불가능 시점)
   */
  async cancelRecurringPayment(
    userId: string,
    contract: Contract,
    reasonCode: string,
    reasonText: string | undefined,
  ): Promise<RecurringCancellationResult> {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 현재 권한 조회 (만료일 확인)
      const [entitlement] = await tx
        .select({ endsAt: schema.subscriptionEntitlement.endsAt })
        .from(schema.subscriptionEntitlement)
        .where(
          and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)),
        )
        .limit(1);

      if (!entitlement) {
        throw new Error('Active entitlement not found');
      }

      // 2. 이벤트 배치 생성
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'RECURRING_CANCELLED',
          effectiveDate: new Date().toISOString().split('T')[0],
        })
        .returning();

      // 3. RECURRING_CANCELLED 이벤트 추가
      const cancelEvent = await this.contractEventManager.addEvent(
        tx,
        contract.id,
        'RECURRING_CANCELLED',
        {
          reason: reasonCode,
          reasonText: reasonText || null,
          nextBillingDateBefore: contract.nextBillingDate,
          nextBillingDateAfter: null,
          currentPeriodEndsAt: entitlement.endsAt,
        },
        'USER',
        userId,
        batch.id,
        userId,
      );

      // 4. 계약 상태 업데이트 (정기결제 중단)
      await tx
        .update(schema.subscriptionContracts)
        .set({
          recurringCancelledAt: new Date(),
          recurringCancellationReasonCode: reasonCode,
          autoRenewal: false,
          nextBillingDate: null,
          lastEventId: cancelEvent.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.subscriptionContracts.id, contract.id));

      return {
        type: 'RECURRING_CANCELLATION',
        contractId: contract.id,
        status: 'RECURRING_CANCELLED',
        recurringCancelledAt: new Date(),
        nextBillingDate: null,
        currentPeriodEndsAt: entitlement.endsAt,
        autoRenewal: false,
        refundEligible: false,
        message: `정기결제가 중단되었습니다. 현재 구독은 ${entitlement.endsAt}까지 유효합니다.`,
      };
    });
  }

  /**
   * 강제 구독 취소 (관리자 전용)
   */
  async forceCancelSubscription(
    contract: Contract,
    plan: Plan,
    adminId: string,
    reason: string,
    refundType: 'FULL' | 'PARTIAL' | 'NONE',
    partialRefundAmount?: number,
    refundReason?: string,
  ): Promise<{
    contractId: string;
    status: 'CANCELLED';
    cancelledAt: Date;
    refundEligible: boolean;
    refundAmount: number;
    refundStatus: 'PENDING' | 'NOT_APPLICABLE';
  }> {
    return this.dbService.db.transaction(async (tx: DrizzleTransaction) => {
      // 1. 환불 금액 계산
      let refundAmount = 0;
      if (refundType === 'FULL') {
        refundAmount = plan.price;
      } else if (refundType === 'PARTIAL') {
        if (!partialRefundAmount) {
          throw new Error('Partial refund amount is required');
        }
        if (partialRefundAmount > plan.price) {
          throw new Error('Refund amount exceeds plan price');
        }
        refundAmount = partialRefundAmount;
      }

      // 2. 이벤트 배치 생성
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_CANCELLED',
          adminId,
          effectiveDate: new Date().toISOString().split('T')[0],
        })
        .returning();

      // 3. 취소 이벤트 기록
      const cancelEvent = await this.contractEventManager.addEvent(
        tx,
        contract.id,
        'CANCELLED',
        {
          reason,
          isForced: true,
          adminId,
          refundType,
          refundAmount,
          refundReason: refundReason || null,
        },
        'ADMIN',
        adminId,
        batch.id,
        adminId,
      );

      // 4. 환불 요청 이벤트 기록 (환불이 있는 경우)
      if (refundAmount > 0) {
        await this.contractEventManager.addEvent(
          tx,
          contract.id,
          'REFUND_REQUESTED',
          {
            amount: refundAmount,
            reason: refundReason || reason,
            isForced: true,
            adminId,
          },
          'ADMIN',
          adminId,
          batch.id,
          adminId,
        );
      }

      // 5. 계약 상태 업데이트
      await tx
        .update(schema.subscriptionContracts)
        .set({
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReasonCode: 'ADMIN_FORCED',
          refundRequested: refundAmount > 0,
          refundRequestedAt: refundAmount > 0 ? new Date() : null,
          eligibleRefundAmount: refundAmount,
          lastEventId: cancelEvent.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.subscriptionContracts.id, contract.id));

      // 6. Entitlement 종료
      await this.terminateEntitlement(tx, contract.userId, batch.id);

      return {
        contractId: contract.id,
        status: 'CANCELLED',
        cancelledAt: new Date(),
        refundEligible: refundAmount > 0,
        refundAmount,
        refundStatus: refundAmount > 0 ? 'PENDING' : 'NOT_APPLICABLE',
      };
    });
  }

  /**
   * Entitlement 종료
   */
  private async terminateEntitlement(tx: DrizzleTransaction, userId: string, batchId: string): Promise<void> {
    await tx
      .update(schema.subscriptionEntitlement)
      .set({
        isCurrent: false,
        closedAt: new Date(),
        closedBatchId: batchId,
      })
      .where(
        and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)),
      );
  }
}
