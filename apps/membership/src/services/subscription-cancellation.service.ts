import { Injectable } from '@nestjs/common';
import { EntitlementService } from './entitlement.service';
import { SubscriptionContractReader } from './subscription/subscription-contract.reader';
import {
  SubscriptionCancellationManager,
  ImmediateCancellationResult,
  RecurringCancellationResult,
} from './subscription/subscription-cancellation.manager';
import { CancellationReasonReader } from './subscription/cancellation-reason.reader';
import { MembershipEventPublisher } from './membership-event.publisher';

// 하위 호환성을 위한 타입 export
export type {
  ImmediateCancellationResult,
  RecurringCancellationResult,
} from './subscription/subscription-cancellation.manager';
export type { CancellationReason } from './subscription/cancellation-reason.reader';

export interface CancellationResult {
  contractId: string;
  status: 'CANCELLED';
  cancelledAt: Date;
  refundEligible: boolean;
  refundAmount: number;
  refundStatus: 'PENDING' | 'NOT_APPLICABLE';
}

/**
 * 구독 취소 서비스 (Business Layer)
 *
 * 역할: 비즈니스 흐름만 표현 (2-3줄)
 * - 검증 로직 없음 (Manager가 담당)
 * - 상세 구현 없음 (Manager가 담당)
 * - 협력 도구 클래스들을 중계
 */
@Injectable()
export class SubscriptionCancellationService {
  constructor(
    private readonly entitlementService: EntitlementService,
    private readonly contractReader: SubscriptionContractReader,
    private readonly cancellationManager: SubscriptionCancellationManager,
    private readonly reasonReader: CancellationReasonReader,
    private readonly membershipEventPublisher: MembershipEventPublisher,
  ) {}

  /**
   * 통합 구독 취소 (자동 분기)
   *
   * ✅ 흐름만 표현: "권한 체크 → 계약 조회 → 상태 검증 → 환불 판단 → 취소 실행"
   */
  async cancelSubscription(
    userId: string,
    email: string,
    reasonCode: string,
    reasonText?: string,
  ): Promise<ImmediateCancellationResult | RecurringCancellationResult> {
    await this.entitlementService.checkAndUpdateSubscription(userId);

    // 1. ACTIVE 계약 조회
    const data = await this.contractReader.findContractWithPlan(userId);
    if (!data) {
      // ACTIVE 계약이 없으면 취소된 계약이 있는지 확인
      const allContracts = await this.contractReader.findContractsByUserId(userId);
      const hasCancelledContract = allContracts.some((c) => c.status === 'CANCELLED');

      if (hasCancelledContract) {
        throw new Error('Contract already cancelled');
      }

      throw new Error('Active subscription not found');
    }

    const eligibility = await this.cancellationManager.checkRefundEligibility(data.contract, data.plan);

    const result = eligibility.eligible
      ? await this.cancellationManager.cancelImmediately(
          userId,
          data.contract,
          data.plan,
          reasonCode,
          reasonText,
          eligibility,
        )
      : await this.cancellationManager.cancelRecurringPayment(userId, data.contract, reasonCode, reasonText);

    if (result.type === 'IMMEDIATE_CANCELLATION') {
      await this.membershipEventPublisher.publishStatusChanged({
        userId,
        email,
        status: 'CANCELLED',
        occurredAt: new Date().toISOString(),
        contractId: data.contract.id,
        planId: data.plan.id,
        tierId: data.plan.tierId,
        reasonCode,
        reasonText,
      });
    } else {
      await this.membershipEventPublisher.publishStatusChanged({
        userId,
        email,
        status: 'RECURRING_CANCELLED',
        occurredAt: new Date().toISOString(),
        contractId: data.contract.id,
        planId: data.plan.id,
        tierId: data.plan.tierId,
        reasonCode,
        reasonText,
      });
    }

    return result;
  }

  /**
   * 환불 금액 계산
   *
   * ✅ 흐름만 표현: "계약 조회 → 플랜 조회 → 환불 자격 확인"
   */
  async calculateRefundAmount(contractId: string): Promise<number> {
    const contract = await this.contractReader.findById(contractId);
    if (!contract) throw new Error('Contract not found');

    const plan = await this.contractReader.findPlan(contract.planId);
    if (!plan) throw new Error('Plan not found');

    const eligibility = await this.cancellationManager.checkRefundEligibility(contract, plan);
    return eligibility.amount;
  }

  /**
   * 강제 구독 취소 (관리자 전용)
   *
   * ✅ 흐름만 표현: "계약 조회 → 플랜 조회 → 강제 취소 실행"
   */
  async forceCancelSubscription(
    contractId: string,
    adminId: string,
    reason: string,
    refundType: 'FULL' | 'PARTIAL' | 'NONE',
    partialRefundAmount?: number,
    refundReason?: string,
  ): Promise<CancellationResult> {
    const contract = await this.contractReader.findById(contractId);
    if (!contract) throw new Error('Contract not found');

    const plan = await this.contractReader.findPlan(contract.planId);
    if (!plan) throw new Error('Plan not found');

    return this.cancellationManager.forceCancelSubscription(
      contract,
      plan,
      adminId,
      reason,
      refundType,
      partialRefundAmount,
      refundReason,
    );
  }

  /**
   * 취소 이유 목록 조회
   *
   * ✅ 흐름만 표현: "Reader 호출"
   */
  async getCancellationReasons() {
    return this.reasonReader.findActiveReasons();
  }
}
