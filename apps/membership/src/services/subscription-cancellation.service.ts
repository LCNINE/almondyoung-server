import { Injectable } from '@nestjs/common';
import { EntitlementService } from './entitlement.service';
import { SubscriptionContractReader } from './subscription/subscription-contract.reader';
import {
  SubscriptionCancellationManager,
  ImmediateCancellationResult,
  RecurringCancellationResult,
} from './subscription/subscription-cancellation.manager';
import { CancellationReasonReader } from './subscription/cancellation-reason.reader';

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
  ) {}

  /**
   * 통합 구독 취소 (자동 분기)
   *
   * ✅ 흐름만 표현: "권한 체크 → 계약 조회 → 환불 판단 → 취소 실행"
   */
  async cancelSubscription(
    userId: string,
    reasonCode: string,
    reasonText?: string,
  ): Promise<ImmediateCancellationResult | RecurringCancellationResult> {
    await this.entitlementService.checkAndUpdateSubscription(userId);
    const data = await this.contractReader.findContractWithPlan(userId);
    if (!data) throw new Error('Active subscription not found');

    const eligibility = this.cancellationManager.checkRefundEligibility(
      data.contract,
      data.plan,
    );

    return eligibility.eligible
      ? this.cancellationManager.cancelImmediately(
          userId,
          data.contract,
          data.plan,
          reasonCode,
          reasonText,
          eligibility,
        )
      : this.cancellationManager.cancelRecurringPayment(
          userId,
          data.contract,
          reasonCode,
          reasonText,
        );
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

    const eligibility = this.cancellationManager.checkRefundEligibility(
      contract,
      plan,
    );
    return eligibility.amount;
  }
}
