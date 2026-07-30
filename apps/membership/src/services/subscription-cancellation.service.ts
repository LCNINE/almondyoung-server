import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@app/shared';
import { SubscriptionContractReader } from './subscription/subscription-contract.reader';
import {
  SubscriptionCancellationManager,
  ImmediateCancellationResult,
  RecurringCancellationResult,
  UndoCancellationResult,
} from './subscription/subscription-cancellation.manager';
import { CancellationReasonReader } from './subscription/cancellation-reason.reader';
import { MembershipEventPublisher } from './membership-event.publisher';
import { PaymentClientService, RefundOutcome } from './billing/payment-client.service';
import { InvoiceBillingManager } from './billing/invoice-billing.manager';
import { PauseReader } from './pause/pause.reader';
import { PauseManager } from './pause/pause.manager';
import { CancellationContext, CancellationContextReader } from './subscription/cancellation-context.reader';
import { MEMBERSHIP_SCOPE } from '../shared/auth/membership-scopes';
import {
  CancellationMode,
  CancellationOption,
  REFUND_PROCESSING_BUSINESS_DAYS,
  WITHDRAWAL_WINDOW_DAYS,
} from './subscription/refund-policy.service';

type RefundReceiveAccount = { bank: string; accountNumber: string; holderName: string };

export type {
  ImmediateCancellationResult,
  RecurringCancellationResult,
  UndoCancellationResult,
} from './subscription/subscription-cancellation.manager';
export type { CancellationReason } from './subscription/cancellation-reason.reader';

export interface CancellationResult {
  contractId: string;
  status: 'CANCELLED';
  cancelledAt: Date;
  refundEligible: boolean;
  refundAmount: number;
  refundStatus: 'COMPLETED' | 'FAILED' | 'PENDING' | 'NOT_APPLICABLE';
}

/** 고객·관리자에게 보여줄 해지 선택지 미리보기 */
export interface CancellationPreview {
  contractId: string;
  planName: { durationDays: number; price: number };
  isRecurring: boolean;
  alreadyScheduledForCancellation: boolean;
  recurringCancelledAt: string | null;
  currentPeriodEndsAt: string;
  nextBillingDate: string | null;
  recommendedMode: CancellationMode;
  withdrawalDaysRemaining: number;
  withdrawalWindowDays: number;
  refundProcessingBusinessDays: number;
  /** 해지 예약을 철회해 자동결제를 재개할 수 있는지. 1회 결제는 되살릴 정기결제가 없어 false. */
  canUndoCancellation: boolean;
  options: CancellationOption[];
}

/**
 * 구독 해지 서비스 (Business Layer)
 *
 * 흐름만 표현한다. 환불 정책 판단은 RefundPolicyService, 사실 수집은 CancellationContextReader,
 * 쓰기는 SubscriptionCancellationManager 가 담당한다.
 */
@Injectable()
export class SubscriptionCancellationService {
  private readonly logger = new Logger(SubscriptionCancellationService.name);

  constructor(
    private readonly contractReader: SubscriptionContractReader,
    private readonly contextReader: CancellationContextReader,
    private readonly cancellationManager: SubscriptionCancellationManager,
    private readonly reasonReader: CancellationReasonReader,
    private readonly membershipEventPublisher: MembershipEventPublisher,
    private readonly paymentClientService: PaymentClientService,
    private readonly invoiceBillingManager: InvoiceBillingManager,
    private readonly pauseReader: PauseReader,
    private readonly pauseManager: PauseManager,
  ) {}

  /**
   * 해지 미리보기 — 고객이 무엇을 고를 수 있고 얼마가 환불되는지.
   *
   * 실제 해지와 같은 컨텍스트/정책을 쓰므로 화면에 보인 금액과 실행 금액이 어긋나지 않는다.
   */
  async previewCancellation(userId: string): Promise<CancellationPreview> {
    const context = await this.loadContextForUser(userId);
    return this.toPreview(context);
  }

  /** 관리자 환불 견적 — 계약 ID 기준. 강제취소 다이얼로그의 금액 계산기. */
  async previewCancellationByContract(contractId: string): Promise<CancellationPreview> {
    const contract = await this.contractReader.findById(contractId);
    if (!contract) throw new NotFoundError(`구독 계약을 찾을 수 없습니다: ${contractId}`);

    const plan = await this.contractReader.findPlan(contract.planId);
    if (!plan) throw new NotFoundError(`플랜을 찾을 수 없습니다: ${contract.planId}`);

    const context = await this.contextReader.load({ contract, plan });
    if (!context) throw new ConflictError('활성 이용 권한이 없어 해지 견적을 낼 수 없습니다.');

    return this.toPreview(context);
  }

  /**
   * 고객 셀프 해지.
   *
   * 흐름: 계약 조회 → 선택한 방식 검증 → 상태 전이 → 환불 실행 → 자동청구 원천 차단 → 이벤트 발행
   */
  async cancelSubscription(
    userId: string,
    email: string | undefined,
    params: {
      reasonCode: string;
      reasonText?: string;
      /** 고객이 고른 해지 방식. 생략하면 정책 권장값. */
      cancelType?: CancellationMode;
      refundReceiveAccount?: RefundReceiveAccount;
    },
  ): Promise<ImmediateCancellationResult | RecurringCancellationResult> {
    await this.resumeIfPaused(userId);
    const context = await this.loadContextForUser(userId);
    const { contract, plan, decision } = context;

    const mode = params.cancelType ?? decision.recommendedMode;
    const option = mode === 'IMMEDIATE_REFUND' ? decision.immediateRefund : decision.atPeriodEnd;

    if (!option.available) {
      throw new BadRequestError(option.unavailableReason ?? '선택한 해지 방식을 사용할 수 없습니다.');
    }
    if (mode === 'AT_PERIOD_END' && context.alreadyScheduledForCancellation) {
      throw new ConflictError('이미 해지 예약된 구독입니다.');
    }
    if (option.requiresReceiveAccount && mode === 'IMMEDIATE_REFUND' && !params.refundReceiveAccount) {
      throw new BadRequestError('환불받을 계좌 정보가 필요합니다.');
    }

    const result =
      mode === 'IMMEDIATE_REFUND'
        ? await this.cancellationManager.cancelImmediately(userId, contract, plan, params.reasonCode, params.reasonText, {
            eligible: option.refundAmount > 0,
            reason: option.refundKind,
            amount: option.refundAmount,
          })
        : await this.cancellationManager.cancelRecurringPayment(
            userId,
            contract,
            params.reasonCode,
            params.reasonText,
            context.isRecurring,
          );

    if (mode === 'IMMEDIATE_REFUND' && option.refundAmount > 0) {
      const outcome = await this.executeRefund({
        contractId: contract.id,
        userId: contract.userId,
        intentId: contract.lastPaymentIntentId,
        amount: option.refundAmount,
        reasonCode: params.reasonCode,
        reasonText: params.reasonText,
        refundReceiveAccount: params.refundReceiveAccount,
        // 자동환불이 불가능한 수단(효성 CMS)은 애초에 호출하지 않고 수동 처리로 남긴다.
        manualOnly: option.refundExecution === 'MANUAL',
      });
      (result as ImmediateCancellationResult).refundStatus = this.toRefundStatus(outcome);
    }

    // 자동이체 약정 종료(재청구 원천 차단 + 은행에 걸린 효성 약정 정리 + 마감 전 예정 출금 취소).
    //
    // 단, INVOICE 경로의 해지예약은 미뤄야 한다 — 자격을 선지급했고 그 기간의 수금이 아직 남아 있어서,
    // 지금 약정을 지우면 출금이 실패해 무료 이용이 된다. 인보이스가 정산/소멸될 때
    // InvoiceOutcomeHandler 가 약정을 종료한다.
    const deferForInvoiceCollection =
      contract.billingPath === 'INVOICE' && result.type === 'RECURRING_CANCELLATION';
    if (deferForInvoiceCollection) {
      this.logger.log(
        `자동이체 약정 종료 보류 — 남은 인보이스 수금 후 처리 (contractId=${contract.id})`,
      );
    } else {
      await this.revokeBillingAgreementSafely(contract.id, contract.userId);
    }

    // 즉시취소(자격 회수)만 인보이스를 무효화한다 — 해지예약은 자격이 유지되는 기간의 수금이
    // 계속돼야 하므로 void 하면 무료 이용이 된다.
    if (contract.billingPath === 'INVOICE' && result.type === 'IMMEDIATE_CANCELLATION') {
      await this.invoiceBillingManager.voidInvoicesForContract(contract.id, 'SUBSCRIPTION_CANCELLED');
    }

    // 알림(해지 확인 메일)이 "언제까지 이용 가능한지 / 얼마가 환불되는지"를 그대로 안내할 수 있도록
    // 안내에 필요한 값을 이벤트에 함께 싣는다. notification 서비스는 사용자 조회를 하지 않는다.
    const immediate = result.type === 'IMMEDIATE_CANCELLATION';
    await this.membershipEventPublisher.publishStatusChanged({
      userId,
      email,
      status: immediate ? 'CANCELLED' : 'RECURRING_CANCELLED',
      occurredAt: new Date().toISOString(),
      contractId: contract.id,
      planId: plan.id,
      tierId: plan.tierId,
      reasonCode: params.reasonCode,
      reasonText: params.reasonText,
      periodEndsAt: immediate ? undefined : context.entitlement.endsAt,
      refundAmount: immediate ? (result as ImmediateCancellationResult).refundAmount : 0,
      refundStatus: immediate
        ? (result as ImmediateCancellationResult).refundStatus
        : 'NOT_APPLICABLE',
    });

    return result;
  }

  /**
   * 해지 예약 철회 (고객).
   *
   * 잔여기간이 남아있는 정기해지만 되돌릴 수 있다. 자동갱신을 되살리기 전에 wallet 자동이체 약정을
   * 먼저 복구해야 한다 — 해지 때 REVOKE 했으므로, 순서를 뒤집으면 다음 청구가
   * BILLING_AGREEMENT_NOT_FOUND 로 실패하고 즉시 해지로 이어진다.
   */
  async undoCancellation(userId: string, email: string | undefined): Promise<UndoCancellationResult> {
    const data = await this.contractReader.findContractWithPlan(userId);
    if (!data) throw new NotFoundError('활성 구독이 없습니다.');
    if (!data.contract.recurringCancelledAt) {
      throw new ConflictError('해지 예약된 구독이 아닙니다.');
    }

    // 1회 결제 계약은 되살릴 정기결제가 없다. 여기서 막지 않으면 아래 createBillingAgreement 가
    // 자동이체 약정을 새로 만들어, 정기결제에 동의한 적 없는 고객이 다음 달부터 청구된다.
    if (!(await this.contractReader.canResumeRecurring(data.contract))) {
      throw new ConflictError('1회 결제 건이라 되돌릴 자동결제가 없습니다. 멤버십은 종료일까지 그대로 이용하실 수 있습니다.');
    }

    const entitlement = await this.contractReader.findCurrentEntitlement(userId);
    if (!entitlement) {
      throw new ConflictError('이용 기간이 만료돼 해지 철회로 복구할 수 없습니다. 재가입이 필요합니다.');
    }

    // 약정 복구가 실패하면 상태를 되살리지 않는다(청구 불가 상태로 되살아나는 좀비 계약 방지).
    await this.paymentClientService.createBillingAgreement(userId, data.contract.id);

    const result = await this.cancellationManager.undoRecurringCancellation(
      userId,
      data.contract,
      entitlement.endsAt,
    );

    await this.membershipEventPublisher.publishStatusChanged({
      userId,
      email,
      status: 'ACTIVE',
      occurredAt: new Date().toISOString(),
      contractId: data.contract.id,
      planId: data.plan.id,
      tierId: data.plan.tierId,
    });

    return result;
  }

  /**
   * 해지 예약 (관리자 대행).
   *
   * 고객 셀프해지의 AT_PERIOD_END 와 **완전히 같은 일**을 한다. 이전에는 어드민이 '자동 연장 끄기'
   * (autoRenewal=false) 만 호출해서, 청구는 멈추지만 (1) recurringCancelledAt 이 없어 화면상 1회 결제로
   * 보이고 (2) 해지 사유가 남지 않으며 (3) 은행에 걸린 효성 자동이체 약정과 예정 출금이 그대로 살아
   * 있었다. CMS 는 환불이 불가하므로 예정 출금이 남는 것은 곧 돌려주기 어려운 출금이다.
   */
  async scheduleCancellationByAdmin(
    contractId: string,
    adminId: string,
    reason: string,
    customerEmail?: string,
  ): Promise<RecurringCancellationResult> {
    const contract = await this.contractReader.findById(contractId);
    if (!contract) throw new NotFoundError(`구독 계약을 찾을 수 없습니다: ${contractId}`);
    if (contract.status !== 'ACTIVE') {
      throw new ConflictError('활성 상태인 구독만 해지 예약할 수 있습니다.');
    }
    if (contract.recurringCancelledAt) {
      throw new ConflictError('이미 해지 예약된 구독입니다.');
    }
    if (!contract.autoRenewal) {
      throw new BadRequestError('자동결제가 없는 1회 결제 계약입니다. 즉시 해지 + 환불을 사용하세요.');
    }

    const plan = await this.contractReader.findPlan(contract.planId);
    if (!plan) throw new NotFoundError(`플랜을 찾을 수 없습니다: ${contract.planId}`);

    await this.resumeIfPaused(contract.userId);

    const result = await this.cancellationManager.cancelRecurringPayment(
      contract.userId,
      contract,
      'ADMIN_REQUESTED',
      reason,
      true,
      { causedBy: 'ADMIN', causedByUserId: adminId },
    );

    // 셀프해지와 같은 이유로 INVOICE 경로 해지예약은 약정 종료를 보류한다(남은 수금이 실패하면 무료 이용).
    if (contract.billingPath !== 'INVOICE') {
      await this.revokeBillingAgreementSafely(contract.id, contract.userId);
    }

    await this.membershipEventPublisher.publishStatusChanged({
      userId: contract.userId,
      email: customerEmail,
      status: 'RECURRING_CANCELLED',
      occurredAt: new Date().toISOString(),
      contractId: contract.id,
      planId: plan.id,
      tierId: plan.tierId,
      reasonCode: 'ADMIN_REQUESTED',
      reasonText: reason,
      periodEndsAt: result.currentPeriodEndsAt,
      refundAmount: 0,
      refundStatus: 'NOT_APPLICABLE',
    });

    return result;
  }

  /**
   * 강제 구독 취소 (관리자 전용).
   *
   * 관리자는 정책 계산과 무관하게 금액을 정할 수 있다(장애 보상 등). 대신 실제 환불 결과를
   * 그대로 돌려준다 — 자동환불이 불가능한 수단이면 FAILED/PENDING 으로 표시돼야 한다.
   */
  async forceCancelSubscription(
    contractId: string,
    adminId: string,
    reason: string,
    refundType: 'FULL' | 'PARTIAL' | 'NONE',
    partialRefundAmount?: number,
    refundReason?: string,
    refundReceiveAccount?: RefundReceiveAccount,
    /** 정책 산정액 초과 환불 권한(membership.billing.refund_override) 보유 여부 */
    canOverridePolicyAmount = false,
    /** 해지 안내 메일 수신 주소. 없으면 알림이 발송되지 않는다(membership 은 사용자 조회를 하지 않는다). */
    customerEmail?: string,
  ): Promise<CancellationResult> {
    const contract = await this.contractReader.findById(contractId);
    if (!contract) throw new NotFoundError(`구독 계약을 찾을 수 없습니다: ${contractId}`);

    // 이미 취소된 계약을 다시 취소하면 환불이 한 번 더 나간다(Idempotency-Key 는 같은 요청의 재전송만
    // 막지, 두 번째 클릭·두 번째 CS 처리는 새 키로 통과한다). 자격은 이미 회수됐으므로 취소할 것도 없다.
    // 추가 환불이 필요하면 결제관리(wallet)에서 환불한다.
    if (contract.status === 'CANCELLED') {
      throw new ConflictError('이미 해지된 구독입니다. 추가 환불이 필요하면 결제관리에서 처리하세요.');
    }

    const plan = await this.contractReader.findPlan(contract.planId);
    if (!plan) throw new NotFoundError(`플랜을 찾을 수 없습니다: ${contract.planId}`);

    await this.assertRefundAmountAllowed({
      contract,
      plan,
      refundType,
      partialRefundAmount,
      canOverridePolicyAmount,
    });

    const result = await this.cancellationManager.forceCancelSubscription(
      contract,
      plan,
      adminId,
      reason,
      refundType,
      partialRefundAmount,
      refundReason,
    );

    await this.revokeBillingAgreementSafely(contract.id, contract.userId);

    // 인보이스 경로(ADR-0027) 계약이면 열린 인보이스도 무효화 — 취소 뒤 출금 방지.
    if (contract.billingPath === 'INVOICE') {
      await this.invoiceBillingManager.voidInvoicesForContract(contract.id, 'SUBSCRIPTION_FORCE_CANCELLED');
    }

    // 환불을 먼저 실행한 뒤 이벤트를 발행한다 — 안내 메일이 실제 환불 결과(PENDING=계좌 송금 대기 등)를
    // 담아야 하므로, 확정 전 상태를 실어 보내면 고객에게 잘못된 안내가 간다.
    // executeRefund 는 예외를 삼키므로 환불 실패가 그룹 제거 이벤트를 막지는 않는다.
    const finalResult =
      result.refundAmount > 0
        ? {
            ...result,
            refundStatus: this.toRefundStatus(
              await this.executeRefund({
                contractId: contract.id,
                userId: contract.userId,
                intentId: contract.lastPaymentIntentId,
                amount: result.refundAmount,
                reasonCode: 'ADMIN_CANCEL',
                reasonText: refundReason ?? reason,
                refundReceiveAccount,
                manualOnly: false,
              }),
            ),
          }
        : result;

    // 취소 이벤트 발행 (Medusa 고객 그룹 제거 + 해지 안내 알림)
    await this.membershipEventPublisher.publishStatusChanged({
      userId: contract.userId,
      email: customerEmail,
      status: 'CANCELLED',
      occurredAt: new Date().toISOString(),
      contractId: contract.id,
      planId: plan.id,
      tierId: plan.tierId,
      reasonCode: 'ADMIN_FORCED',
      reasonText: reason,
      refundAmount: finalResult.refundAmount,
      refundStatus: finalResult.refundStatus,
    });

    return finalResult;
  }

  /**
   * 수동 송금 환불 완료 처리 (관리자).
   *
   * 효성 CMS 는 PG 환불 API 가 없어 wallet 에 환불 행 자체가 만들어지지 않는다. 그래서 wallet 의
   * 수동 완료(`POST /v1/admin/refunds/:id/confirm`)로는 이 건을 닫을 수 없고(그 경로는 무통장 전용),
   * 완료 처리 창구가 없으면 `refundCompleted` 가 영구히 false 로 남아 "미완료 — N원 처리 필요" 가
   * 계속 떠 있게 된다. 계좌 송금을 끝낸 관리자가 여기서 사실을 확정한다.
   */
  async markManualRefundCompleted(
    contractId: string,
    adminId: string,
    params: { amount?: number; memo?: string },
  ): Promise<{ contractId: string; refundedAmount: number; refundCompletedAt: string }> {
    const contract = await this.contractReader.findById(contractId);
    if (!contract) throw new NotFoundError(`구독 계약을 찾을 수 없습니다: ${contractId}`);
    if (!contract.refundRequested) {
      throw new ConflictError('환불 요청이 없는 계약입니다.');
    }
    if (contract.refundCompleted) {
      throw new ConflictError('이미 환불 완료 처리된 계약입니다.');
    }

    // wallet 이 환불 행을 들고 있는 건(무통장 수동 송금 확정 대기 등)은 wallet 이 닫아야 한다.
    // 여기서 완료로 찍으면 관리자가 계좌로 한 번 보내고, 나중에 결제관리에서 확정될 때 또 한 번
    // 나간다. 이 창구는 wallet 에 환불 행 자체가 없는 효성 CMS 를 위한 것이다.
    if (contract.lastPaymentIntentId) {
      const pending = await this.findPendingWalletRefundAmount(contract.lastPaymentIntentId);
      if (pending > 0) {
        throw new ConflictError(
          `결제관리에 확정 대기 중인 환불(${pending.toLocaleString()}원)이 있습니다. ` +
            `이중 송금을 막기 위해 그 건은 결제관리에서 완료 처리해야 합니다.`,
        );
      }
    }

    const requested = contract.eligibleRefundAmount ?? 0;
    const refundedAmount = params.amount ?? requested;
    if (refundedAmount <= 0) throw new BadRequestError('환불 금액이 0원입니다.');
    // 실제로 보낸 금액이 요청액과 다르면 그대로 기록한다(추정하지 않는다). 다만 요청액 초과는 막는다.
    if (requested > 0 && refundedAmount > requested) {
      throw new BadRequestError(`환불 요청액(${requested.toLocaleString()}원)을 초과할 수 없습니다.`);
    }

    await this.cancellationManager.recordRefundOutcome(
      contractId,
      contract.userId,
      requested,
      {
        status: 'SUCCEEDED',
        refundedAmount,
        errorCode: 'MANUAL_TRANSFER_CONFIRMED',
        errorMessage: params.memo,
      },
      { causedBy: 'ADMIN', causedByUserId: adminId },
    );

    return { contractId, refundedAmount, refundCompletedAt: new Date().toISOString() };
  }

  /**
   * wallet 에 확정 대기 중인 환불액. 조회가 실패하면 0 으로 본다 — 알 수 없는 값으로 CS 의 유일한
   * 완료 창구를 막아버리면 "미완료" 가 영구히 남는 쪽이 더 나쁘다.
   */
  private async findPendingWalletRefundAmount(intentId: string): Promise<number> {
    try {
      const refundability = await this.paymentClientService.getRefundability(intentId);
      return refundability.pendingRefundAmount ?? 0;
    } catch (err) {
      this.logger.warn(
        `확정 대기 환불 조회 실패 — 수동 완료를 막지 않는다 (intentId=${intentId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 0;
    }
  }

  async getCancellationReasons() {
    return this.reasonReader.findActiveReasons();
  }

  /**
   * 관리자 환불 금액 상한 검사.
   *
   * 해지·환불 자체는 CS 의 일상 업무라 admin 에게 열려 있다. 위험한 건 **큰 금액을 정책 없이**
   * 환불하는 것(연간 회원에게 정산 없이 49,900원 전액 환불 등)이다.
   *
   * 그래서 한도를 `max(정책 산정액, 월 정가 1개월분)` 으로 둔다. 정책 산정액만으로 자르면 "월간
   * 7일 경과 → 정책상 0원" 인 계약에 소액 보상조차 못 하게 되어 CS 가 매번 master 를 불러야 한다.
   * 배송 지연 사과 같은 소액 보상은 admin 재량으로 두고, 그보다 큰 금액만 별도 권한을 요구한다.
   *
   * 견적을 낼 수 없는 상태(활성 권한 없음 등)면 상한을 강제하지 않는다 — 이미 종료된 계약의
   * 사후 보상 환불을 막아버리면 CS 가 손발이 묶인다.
   */
  private async assertRefundAmountAllowed(params: {
    contract: { id: string; planId: string; userId: string };
    plan: { price: number; durationDays: number; tierId: string };
    refundType: 'FULL' | 'PARTIAL' | 'NONE';
    partialRefundAmount?: number;
    canOverridePolicyAmount: boolean;
  }): Promise<void> {
    if (params.refundType === 'NONE' || params.canOverridePolicyAmount) return;

    const requested =
      params.refundType === 'FULL' ? params.plan.price : (params.partialRefundAmount ?? 0);
    if (requested <= 0) return;

    const context = await this.contextReader.load({
      contract: params.contract as Parameters<CancellationContextReader['load']>[0]['contract'],
      plan: params.plan as Parameters<CancellationContextReader['load']>[0]['plan'],
    });
    if (!context) return;

    const policyAmount = context.decision.immediateRefund.refundAmount;
    // admin 재량 소액 보상 한도 = 월 정가 1개월분
    const discretionLimit = await this.contractReader.findMonthlyListPrice(params.plan.tierId, params.plan.price);
    const ceiling = Math.max(policyAmount, discretionLimit);

    if (requested > ceiling) {
      throw new ForbiddenError(
        `환불 한도(${ceiling.toLocaleString()}원 — 정책 산정액 ${policyAmount.toLocaleString()}원, ` +
          `관리자 재량 한도 ${discretionLimit.toLocaleString()}원)를 초과하는 환불입니다. ` +
          `초과 환불에는 별도 권한(${MEMBERSHIP_SCOPE.BILLING_REFUND_OVERRIDE})이 필요합니다.`,
      );
    }
  }

  /**
   * 해지 전에 일시정지를 푼다.
   *
   * 정지 중에는 종료일이 동결돼 있고 재개 시점에 실제 정지 일수만큼 연장된다. 정지 상태 그대로
   * 해지하면 **이미 쌓인 정지 일수를 통째로 잃고, 남은 기간에도 혜택을 못 쓴다** — "잔여 기간을
   * 다 쓰고 끝낸다" 는 해지 예약의 뜻과 정반대다. 즉시해지도 정지 구간이 이용 기간에서 빠지는 건
   * 그대로이므로(정산은 pause_events 로 계산한다) 여기서 함께 풀어도 환불액은 달라지지 않는다.
   */
  private async resumeIfPaused(userId: string): Promise<void> {
    const paused = await this.pauseReader.findPausedEntitlement(userId);
    if (!paused?.pausedAt) return;

    this.logger.log(`해지 전 일시정지 해제 — 정지 일수를 종료일에 반영한다 (userId=${userId})`);
    await this.pauseManager.resumePause(userId, paused);
  }

  private async loadContextForUser(userId: string): Promise<CancellationContext> {
    const data = await this.contractReader.findContractWithPlan(userId);
    if (!data) {
      const allContracts = await this.contractReader.findContractsByUserId(userId);
      if (allContracts.some((c) => c.status === 'CANCELLED')) {
        throw new ConflictError('이미 해지된 구독입니다.');
      }
      throw new NotFoundError('활성 구독이 없습니다.');
    }

    const context = await this.contextReader.load({ contract: data.contract, plan: data.plan });
    if (!context) throw new ConflictError('활성 이용 권한이 없습니다.');
    return context;
  }

  private toPreview(context: CancellationContext): CancellationPreview {
    return {
      contractId: context.contract.id,
      planName: { durationDays: context.plan.durationDays, price: context.plan.price },
      isRecurring: context.isRecurring,
      alreadyScheduledForCancellation: context.alreadyScheduledForCancellation,
      recurringCancelledAt: context.contract.recurringCancelledAt?.toISOString() ?? null,
      currentPeriodEndsAt: context.entitlement.endsAt,
      nextBillingDate: context.contract.nextBillingDate ?? null,
      recommendedMode: context.decision.recommendedMode,
      withdrawalDaysRemaining: context.decision.withdrawalDaysRemaining,
      withdrawalWindowDays: WITHDRAWAL_WINDOW_DAYS,
      refundProcessingBusinessDays: REFUND_PROCESSING_BUSINESS_DAYS,
      canUndoCancellation: context.alreadyScheduledForCancellation && context.isRecurring,
      options: [context.decision.atPeriodEnd, context.decision.immediateRefund],
    };
  }

  /**
   * 환불 실행 + 결과를 계약에 기록.
   *
   * 자동환불이 불가능한 수단(효성 CMS)은 wallet 을 호출해도 반드시 FAILED 로 떨어지므로 호출하지 않고
   * 곧바로 '수동 송금 대기'로 남긴다. 관리자가 계좌 송금 후 완료 처리해야 한다.
   */
  private async executeRefund(params: {
    contractId: string;
    userId: string;
    intentId: string | null;
    amount: number;
    reasonCode: string;
    reasonText?: string;
    refundReceiveAccount?: RefundReceiveAccount;
    manualOnly: boolean;
  }): Promise<RefundOutcome> {
    if (!params.intentId) {
      const outcome: RefundOutcome = { status: 'FAILED', refundedAmount: 0, errorCode: 'NO_PAYMENT_INTENT' };
      await this.cancellationManager.recordRefundOutcome(params.contractId, params.userId, params.amount, {
        ...outcome,
        receiveAccount: params.refundReceiveAccount,
      });
      return outcome;
    }

    if (params.manualOnly) {
      const outcome: RefundOutcome = {
        status: 'PENDING',
        refundedAmount: 0,
        errorCode: 'MANUAL_TRANSFER_REQUIRED',
        errorMessage: '자동이체(효성 CMS) 결제는 PG 환불이 불가해 관리자 계좌 송금으로 처리해야 합니다.',
      };
      this.logger.warn(
        `수동 환불 대기 등록 (contractId=${params.contractId}, intentId=${params.intentId}, amount=${params.amount})`,
      );
      // 송금할 계좌를 남기지 않으면 관리자가 어디로 보낼지 알 수 없어 환불을 끝낼 수 없다.
      await this.cancellationManager.recordRefundOutcome(params.contractId, params.userId, params.amount, {
        ...outcome,
        receiveAccount: params.refundReceiveAccount,
      });
      return outcome;
    }

    try {
      const outcome = await this.paymentClientService.refundByIntent(
        params.intentId,
        params.amount,
        params.reasonCode,
        params.reasonText,
        params.refundReceiveAccount,
      );
      if (outcome.status !== 'SUCCEEDED') {
        this.logger.error(
          `환불 미완료 (contractId=${params.contractId}, intentId=${params.intentId}, amount=${params.amount}, status=${outcome.status}, code=${outcome.errorCode})`,
        );
      }
      // 미완료 건은 결국 사람이 계좌로 보내야 끝난다 — 그때 쓸 계좌를 함께 남긴다.
      await this.cancellationManager.recordRefundOutcome(params.contractId, params.userId, params.amount, {
        ...outcome,
        ...(outcome.status === 'SUCCEEDED' ? {} : { receiveAccount: params.refundReceiveAccount }),
      });
      return outcome;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `환불 요청 실패 (contractId=${params.contractId}, intentId=${params.intentId}, amount=${params.amount}): ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      const outcome: RefundOutcome = { status: 'FAILED', refundedAmount: 0, errorCode: 'REFUND_REQUEST_ERROR', errorMessage: message };
      await this.cancellationManager.recordRefundOutcome(params.contractId, params.userId, params.amount, {
        ...outcome,
        receiveAccount: params.refundReceiveAccount,
      });
      return outcome;
    }
  }

  private toRefundStatus(outcome: RefundOutcome): CancellationResult['refundStatus'] {
    if (outcome.status === 'SUCCEEDED') return 'COMPLETED';
    if (outcome.status === 'PENDING') return 'PENDING';
    return 'FAILED';
  }

  /**
   * 자동이체 약정 종료. 예정 출금 취소 → 약정 REVOKE → 효성 회원삭제까지 이어진다.
   *
   * 효성에는 약정해지 API 가 없고 회원삭제가 유일한 종료 수단이라, wallet 로컬 상태만 REVOKE 하면
   * 고객의 자동이체 약정이 은행에 그대로 남는다. 실패해도 해지 자체는 유지하되 계약 이벤트로
   * 후속 정리 대상을 남긴다(재청구는 DB 의 autoRenewal=false + nextBillingDate=null 로 이미 막혀 있다).
   */
  private async revokeBillingAgreementSafely(contractId: string, userId: string): Promise<void> {
    try {
      const result = await this.paymentClientService.terminateBillingMandate(contractId);
      if (result.cancelledWithdrawals > 0) {
        this.logger.log(
          `해지에 따라 예정 출금 ${result.cancelledWithdrawals}건 취소 (contractId=${contractId}) — 해당 금액은 출금되지 않는다.`,
        );
      }
      // 정리할 게 없는 정상 케이스가 둘 있다.
      //  - agreementFound=false: 애초에 자동이체 약정이 없는 계약(1회 결제). 모든 1회 결제 해지가
      //    허위 '정리 필요' 를 남기면 큐도 감사 로그도 못 믿게 된다.
      //  - 결제수단을 다른 활성 구독과 공유: 남은 구독이 그 수단을 계속 써야 하므로 더 할 일이 없다.
      const nothingToClean =
        !result.agreementFound || result.skipReason === 'BILLING_METHOD_IN_USE_BY_OTHER_AGREEMENT';
      if (!result.mandateTerminated && !nothingToClean) {
        this.logger.warn(
          `자동이체 약정 미종료 (contractId=${contractId}, reason=${result.skipReason ?? 'UNKNOWN'})`,
        );
        await this.cancellationManager.markAgreementRevokePending(contractId, userId);
      }
    } catch (err) {
      this.logger.error(
        `자동이체 약정 종료 실패 — 자동청구는 DB 플래그로 차단됨, 약정 정리는 재시도 필요 (contractId=${contractId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
      await this.cancellationManager.markAgreementRevokePending(contractId, userId);
    }
  }
}
