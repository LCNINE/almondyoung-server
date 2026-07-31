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
  refundStatus: 'COMPLETED' | 'PENDING' | 'FAILED' | 'NOT_APPLICABLE';
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

export interface UndoCancellationResult {
  type: 'CANCELLATION_UNDONE';
  contractId: string;
  status: 'ACTIVE';
  autoRenewal: true;
  nextBillingDate: string;
  message: string;
}

/** 환불 실행 결과를 계약에 기록할 때 쓰는 최소 형태 */
export interface RefundRecord {
  status: 'SUCCEEDED' | 'PENDING' | 'FAILED';
  refundedAmount: number;
  errorCode?: string;
  errorMessage?: string;
  /**
   * 계좌 송금으로 돌려줘야 하는 건의 수취 계좌.
   *
   * PG 자동환불이 불가능한 수단(효성 CMS)이나 자동환불이 실패한 건은 관리자가 직접 송금해야 하는데,
   * 그때 **어디로 보낼지**가 남아 있지 않으면 환불 자체를 끝낼 방법이 없다. 고객/관리자가 해지 시점에
   * 입력한 계좌를 이벤트에 그대로 남겨 후속 송금 화면이 읽어간다.
   */
  receiveAccount?: { bank: string; accountNumber: string; holderName: string };
}

@Injectable()
export class SubscriptionCancellationManager {
  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly contractEventManager: ContractEventManager,
  ) {}

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
    // 저장값과 반환값이 어긋나지 않게 한 시점을 만들어 둘 다에 쓴다.
    const cancelledAt = new Date();

    return await this.dbService.db.transaction(async (tx) => {
      // 1. 이벤트 배치 생성
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_CANCELLED',
          effectiveDate: cancelledAt.toISOString().split('T')[0],
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

      // 4. 계약 상태 업데이트 — 완전 취소이므로 정기결제 축(autoRenewal/nextBillingDate)도 반드시 꺼준다.
      // (안 그러면 status=CANCELLED 라도 findDueContracts 가 다시 청구 대상으로 잡는다)
      await tx
        .update(schema.subscriptionContracts)
        .set({
          status: 'CANCELLED',
          cancelledAt,
          cancellationReasonCode: reasonCode,
          autoRenewal: false,
          nextBillingDate: null,
          refundRequested: eligibility.eligible,
          refundRequestedAt: eligibility.eligible ? cancelledAt : null,
          eligibleRefundAmount: eligibility.amount,
          lastEventId: cancelEvent.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.subscriptionContracts.id, contract.id));

      // 5. Entitlement 종료 + dunning 잔여 제거(해지 후 재청구 방지)
      await this.terminateEntitlement(tx, userId, batch.id);
      await tx
        .delete(schema.membershipDunningQueue)
        .where(eq(schema.membershipDunningQueue.contractId, contract.id));

      return {
        type: 'IMMEDIATE_CANCELLATION',
        contractId: contract.id,
        status: 'CANCELLED',
        cancelledAt,
        refundEligible: eligibility.eligible,
        refundAmount: eligibility.amount,
        refundStatus: eligibility.eligible ? 'PENDING' : 'NOT_APPLICABLE',
        message: '구독이 즉시 취소되었습니다.',
      };
    });
  }

  /**
   * 해지 예약 — 잔여 기간은 그대로 이용하고 이후 자동결제만 끊는다.
   *
   * 1회 결제 계약에도 같은 전이를 쓰지만(추가 청구가 없다는 사실을 기록), 안내 문구는 다르다.
   * "정기결제가 중단되었습니다" 를 1회 결제 고객에게 보여주면 존재하지 않는 정기결제를 끊은 것처럼 읽힌다.
   */
  async cancelRecurringPayment(
    userId: string,
    contract: Contract,
    reasonCode: string,
    reasonText: string | undefined,
    isRecurring = true,
    /** 관리자 대행 해지면 감사 주체를 ADMIN 으로 남긴다(누가 해지했는지가 CS 분쟁의 핵심 기록이다). */
    actor: { causedBy: 'USER' | 'ADMIN'; causedByUserId: string } = { causedBy: 'USER', causedByUserId: userId },
  ): Promise<RecurringCancellationResult> {
    const recurringCancelledAt = new Date();

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
          effectiveDate: recurringCancelledAt.toISOString().split('T')[0],
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
          // 해지 후에는 autoRenewal 이 꺼져 1회 결제와 구분되지 않는다 — 해지 시점의 사실을 남긴다.
          // 해지 철회(자동결제 재개)를 열어줄지 판단하는 근거다.
          wasRecurring: isRecurring,
        },
        actor.causedBy,
        userId,
        batch.id,
        actor.causedByUserId,
      );

      // 4. 계약 상태 업데이트 (정기결제 중단)
      await tx
        .update(schema.subscriptionContracts)
        .set({
          recurringCancelledAt,
          recurringCancellationReasonCode: reasonCode,
          autoRenewal: false,
          nextBillingDate: null,
          lastEventId: cancelEvent.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.subscriptionContracts.id, contract.id));

      // 진행 중이던 dunning 잔여 항목 제거 — 해지 후 재청구 방지
      await tx
        .delete(schema.membershipDunningQueue)
        .where(eq(schema.membershipDunningQueue.contractId, contract.id));

      return {
        type: 'RECURRING_CANCELLATION',
        contractId: contract.id,
        status: 'RECURRING_CANCELLED',
        recurringCancelledAt,
        nextBillingDate: null,
        currentPeriodEndsAt: entitlement.endsAt,
        autoRenewal: false,
        refundEligible: false,
        message: isRecurring
          ? `정기결제가 중단되었습니다. 멤버십은 ${entitlement.endsAt}까지 이용하실 수 있습니다.`
          : `해지 접수되었습니다. 1회 결제 건이므로 추가 결제는 없으며, 멤버십은 ${entitlement.endsAt}까지 이용하실 수 있습니다.`,
      };
    });
  }

  /**
   * 해지 예약 철회 — 자동결제를 되살린다.
   *
   * 호출 전에 wallet 자동이체 약정이 복구돼 있어야 한다(Service 책임). nextBillingDate 는 현재 주기
   * 종료일로 복구해 다음 청구가 정확히 만료일에 잡히게 한다.
   */
  async undoRecurringCancellation(
    userId: string,
    contract: Contract,
    periodEndsAt: string,
  ): Promise<UndoCancellationResult> {
    return await this.dbService.db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'RECURRING_CANCELLATION_UNDONE',
          effectiveDate: new Date().toISOString().split('T')[0],
        })
        .returning();

      const event = await this.contractEventManager.addEvent(
        tx,
        contract.id,
        'RECURRING_CANCELLATION_UNDONE',
        {
          recurringCancelledAtBefore: contract.recurringCancelledAt,
          nextBillingDateAfter: periodEndsAt,
        },
        'USER',
        userId,
        batch.id,
        userId,
      );

      await tx
        .update(schema.subscriptionContracts)
        .set({
          recurringCancelledAt: null,
          recurringCancellationReasonCode: null,
          autoRenewal: true,
          nextBillingDate: periodEndsAt,
          lastEventId: event.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.subscriptionContracts.id, contract.id));

      return {
        type: 'CANCELLATION_UNDONE',
        contractId: contract.id,
        status: 'ACTIVE',
        autoRenewal: true,
        nextBillingDate: periodEndsAt,
        message: `해지 예약이 철회되었습니다. ${periodEndsAt}에 다음 결제가 진행됩니다.`,
      };
    });
  }

  /**
   * 환불 실행 결과 기록.
   *
   * refund_completed 는 돈이 실제로 돌아간 경우에만 true 다. 수동 송금 대기(PENDING)·실패(FAILED)는
   * 계약 이벤트로 남겨 관리자가 후속 처리를 찾을 수 있게 한다.
   */
  async recordRefundOutcome(
    contractId: string,
    userId: string,
    requestedAmount: number,
    outcome: RefundRecord,
    /** 관리자가 수동 송금을 확정한 경우 그 사실을 감사 기록에 남긴다. */
    actor: { causedBy: 'SYSTEM' | 'ADMIN'; causedByUserId?: string } = { causedBy: 'SYSTEM' },
  ): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      const eventType =
        outcome.status === 'SUCCEEDED'
          ? 'REFUND_COMPLETED'
          : outcome.status === 'PENDING'
            ? 'REFUND_PENDING'
            : 'REFUND_FAILED';

      await this.contractEventManager.addEvent(
        tx,
        contractId,
        eventType,
        {
          requestedAmount,
          refundedAmount: outcome.refundedAmount,
          errorCode: outcome.errorCode ?? null,
          errorMessage: outcome.errorMessage ?? null,
          // 돈이 아직 나가지 않은 건(PENDING/FAILED)에만 의미가 있다 — 관리자가 여기로 송금한다.
          ...(outcome.receiveAccount ? { receiveAccount: outcome.receiveAccount } : {}),
        },
        actor.causedBy,
        userId,
        undefined,
        actor.causedByUserId,
      );

      if (outcome.status === 'SUCCEEDED') {
        await tx
          .update(schema.subscriptionContracts)
          .set({ refundCompleted: true, refundCompletedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.subscriptionContracts.id, contractId));
      }
    });
  }

  /**
   * wallet 약정 해지 실패를 계약 이벤트로 남긴다.
   * 재청구는 autoRenewal=false + nextBillingDate=null 로 이미 막혀 있으므로, 이 기록은 정리 작업용이다.
   */
  async markAgreementRevokePending(contractId: string, userId: string): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      await this.contractEventManager.addEvent(tx, contractId, 'AGREEMENT_REVOKE_PENDING', {}, 'SYSTEM', userId);
    });
  }

  /**
   * 약정 종료를 **미룬** 사실을 남긴다 (INVOICE 경로 해지예약: 남은 수금이 끝나야 지울 수 있다).
   *
   * 남기지 않으면 그 주기에 인보이스 이벤트가 더 오지 않는 계약(이미 수금이 끝난 주기에 해지한 경우)
   * 에서 약정 종료가 **영원히 일어나지 않는다** — 해지한 고객의 자동이체가 은행에 남는다.
   * `notBefore`(자격 종료일) 이후에는 AgreementCleanupService 가 이어받아 끝낸다.
   */
  async markAgreementRevokeDeferred(contractId: string, userId: string, notBefore: string): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      await this.contractEventManager.addEvent(
        tx,
        contractId,
        'AGREEMENT_REVOKE_DEFERRED',
        { notBefore },
        'SYSTEM',
        userId,
      );
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
    const cancelledAt = new Date();

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
          effectiveDate: cancelledAt.toISOString().split('T')[0],
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

      // 5. 계약 상태 업데이트 — 강제 취소도 정기결제 축을 반드시 꺼준다(재청구 방지).
      await tx
        .update(schema.subscriptionContracts)
        .set({
          status: 'CANCELLED',
          cancelledAt,
          cancellationReasonCode: 'ADMIN_FORCED',
          autoRenewal: false,
          nextBillingDate: null,
          refundRequested: refundAmount > 0,
          refundRequestedAt: refundAmount > 0 ? cancelledAt : null,
          eligibleRefundAmount: refundAmount,
          lastEventId: cancelEvent.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.subscriptionContracts.id, contract.id));

      // 6. Entitlement 종료 + dunning 잔여 제거(환불 후 재청구 방지)
      await this.terminateEntitlement(tx, contract.userId, batch.id);
      await tx
        .delete(schema.membershipDunningQueue)
        .where(eq(schema.membershipDunningQueue.contractId, contract.id));

      return {
        contractId: contract.id,
        status: 'CANCELLED',
        cancelledAt,
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
