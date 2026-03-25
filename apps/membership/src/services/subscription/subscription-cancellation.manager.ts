import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq, and } from 'drizzle-orm';
import { addDays, differenceInHours } from 'date-fns';
import { ContractEventManager } from './contract-event.manager';
import { DrizzleTransaction } from '../../shared/schemas/types';
import { MembershipPolicyService } from '../membership-policy.service';
import { SubscriptionContractReader } from './subscription-contract.reader';

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
    private readonly policyService: MembershipPolicyService,
    private readonly contractReader: SubscriptionContractReader,
  ) {}

  /**
   * 환불 가능 여부 판단 (정책 기반)
   */
  async checkRefundEligibility(contract: Contract, plan: Plan): Promise<RefundEligibility> {
    // 검증: 계약과 플랜 존재 확인
    if (!contract) {
      throw new Error('Contract not found');
    }
    if (!plan) {
      throw new Error('Plan not found');
    }

    // 1. 무료 체험 환불 정책 확인
    const trialRefundEnabled = await this.policyService.getBooleanPolicy(
      'TRIAL_REFUND_ENABLED',
      'enabled',
      plan.tierId,
      true, // 기본값: 활성화
    );

    if (trialRefundEnabled && (await this.isInTrialPeriod(contract, plan))) {
      return {
        eligible: true,
        reason: '무료 체험 기간 중 취소',
        amount: plan.price,
      };
    }

    // 2. 재구독 환불 정책 확인
    const refundWindowHours = await this.policyService.getNumberPolicy(
      'RESUBSCRIPTION_REFUND_WINDOW_HOURS',
      'hours',
      plan.tierId,
      24, // 기본값: 24시간
    );

    const hoursSinceCreation = differenceInHours(new Date(), contract.createdAt);

    if (hoursSinceCreation < refundWindowHours) {
      const isResubscription = await this.isRecentResubscription(contract);

      if (isResubscription) {
        // 3. 혜택 사용 영향 정책 확인
        const benefitAffectsRefund = await this.policyService.getBooleanPolicy(
          'BENEFIT_USAGE_AFFECTS_REFUND',
          'enabled',
          plan.tierId,
          true, // 기본값: 혜택 사용 시 환불 영향
        );

        if (benefitAffectsRefund) {
          const hasBenefitUsage = await this.hasBenefitUsage(contract.id);

          if (!hasBenefitUsage) {
            return {
              eligible: true,
              reason: `재구독 후 ${refundWindowHours}시간 이내 + 혜택 미사용`,
              amount: plan.price,
            };
          } else {
            // 부분 환불
            const usedAmount = await this.calculateUsedBenefitAmount(contract.id);
            const refundAmount = Math.max(0, plan.price - usedAmount);

            return {
              eligible: refundAmount > 0,
              reason: '재구독 후 혜택 사용 - 부분 환불',
              amount: refundAmount,
            };
          }
        } else {
          // 혜택 사용 여부 무시
          return {
            eligible: true,
            reason: `재구독 후 ${refundWindowHours}시간 이내`,
            amount: plan.price,
          };
        }
      }
    }

    return {
      eligible: false,
      reason: '환불 가능 기간이 지났습니다',
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
        message: '구독이 즉시 취소되었습니다. 환불이 처리됩니다.',
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
   * 무료 체험 기간 확인 (정책 기반)
   */
  private async isInTrialPeriod(contract: Contract, plan: Plan): Promise<boolean> {
    // 정책에서 체험 기간 조회
    const trialDays = await this.policyService.getNumberPolicy(
      'TRIAL_DURATION_DAYS',
      'days',
      plan.tierId,
      plan.trialDays || 0, // 기본값: 플랜의 체험 기간
    );

    if (!trialDays || trialDays === 0) {
      return false;
    }

    const trialEndDate = addDays(new Date(contract.billingDate), trialDays);
    const now = new Date();

    return now < trialEndDate;
  }

  /**
   * 재구독 여부 확인
   */
  private async isRecentResubscription(contract: Contract): Promise<boolean> {
    // 이전 구독 이력이 있는지 확인
    const allContracts = await this.contractReader.findContractsByUserId(contract.userId);

    // 현재 계약 제외하고 이전 계약이 있으면 재구독
    return allContracts.length > 1;
  }

  /**
   * 혜택 사용 여부 확인
   */
  private async hasBenefitUsage(contractId: string): Promise<boolean> {
    const [usage] = await this.dbService.db
      .select()
      .from(schema.membershipDiscountEvents)
      .where(
        and(
          eq(schema.membershipDiscountEvents.subscriptionId, contractId),
          eq(schema.membershipDiscountEvents.isCancelled, false),
        ),
      )
      .limit(1);

    return !!usage;
  }

  /**
   * 사용한 혜택 금액 계산
   */
  private async calculateUsedBenefitAmount(contractId: string): Promise<number> {
    const usages = await this.dbService.db
      .select()
      .from(schema.membershipDiscountEvents)
      .where(
        and(
          eq(schema.membershipDiscountEvents.subscriptionId, contractId),
          eq(schema.membershipDiscountEvents.isCancelled, false),
        ),
      );

    return usages.reduce((sum, usage) => sum + (usage.discountAmount || 0), 0);
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
