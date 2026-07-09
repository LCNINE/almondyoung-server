import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and } from 'drizzle-orm';
import { addDays, format } from 'date-fns';
import * as schema from '../../shared/schemas/entities/schema';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { PlanService } from '../plan.service';
import { WalletCommandPublisher } from './wallet-command.publisher';
import { ContractEventManager } from '../subscription/contract-event.manager';
import { BillingResult } from './billing.manager';

// 레거시 더닝 정책(72h×3)을 인보이스 재시도 정책으로 그대로 실어준다(ADR-0027 §10-1).
const INVOICE_MAX_ATTEMPTS = 3;
const INVOICE_RETRY_INTERVAL_HOURS = 72;

/**
 * 인보이스(선적용) 경로의 청구 발행(ADR-0027). 레거시와 달리 락/더닝 큐를 쓰지 않는다 —
 * 중복 발행은 주기당 1 멱등키로 wallet 이 흡수하고, 재시도/미수 판정은 인보이스가 소유하며,
 * nextBillingDate 는 invoice.paid 에서만 전진하므로 일일 재발행이 유실 reconcile 을 겸한다.
 */
@Injectable()
export class InvoiceBillingManager {
  private readonly logger = new Logger(InvoiceBillingManager.name);

  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly walletCommandPublisher: WalletCommandPublisher,
    private readonly planService: PlanService,
    private readonly contractEventManager: ContractEventManager,
  ) {}

  /** 현재 주기 인보이스 발행. 선적용: 자격을 periodEnd 까지 먼저 연장, 출금/회수는 인보이스 결과가 담당. */
  async issueInvoiceForContract(
    contract: { id: string; userId: string; planId: string; nextBillingDate: string | null },
    billingMethodId?: string,
  ): Promise<BillingResult> {
    if (!contract.nextBillingDate) {
      return { contractId: contract.id, success: false, errorCode: 'NO_NEXT_BILLING_DATE' };
    }

    const plan = await this.planService.getPlanDetails(contract.planId);
    if (!plan) return { contractId: contract.id, success: false, errorCode: 'PLAN_NOT_FOUND' };
    if (!plan.plan.isActive) return { contractId: contract.id, success: false, errorCode: 'PLAN_NOT_ACTIVE' };
    // 0원 인보이스 금지 — charge 는 amount > 0 이라 wallet 이 집행 불가 상태로 stuck 된다.
    // 선적용(자격 선연장)도 하지 않는다: 청구가 성립하지 않는 계약을 공짜로 연장하면 안 된다.
    if (plan.plan.price <= 0) {
      this.logger.error(`0원 플랜에 인보이스 발행 불가 (contractId=${contract.id}, planId=${contract.planId})`);
      return { contractId: contract.id, success: false, errorCode: 'INVALID_PLAN_PRICE' };
    }

    const periodStart = contract.nextBillingDate;
    const periodEnd = format(addDays(new Date(`${periodStart}T00:00:00`), plan.plan.durationDays), 'yyyy-MM-dd');

    // 1. 선적용 — 자격을 periodEnd 까지 연장(이미 연장돼 있으면 no-op → 일일 재발행에 멱등)
    await this.grantAdvanceEntitlement(contract.id, contract.userId, periodEnd);

    // 2. CreateInvoice 커맨드 발행 (주기당 1 멱등키 — 재발행은 wallet 이 dedupe)
    try {
      await this.walletCommandPublisher.publishCreateInvoice({
        subscriberType: 'MEMBERSHIP',
        subscriberRef: contract.id,
        ...(billingMethodId ? { billingMethodId } : {}),
        amount: plan.plan.price,
        currency: plan.plan.currency ?? 'KRW',
        periodStart,
        periodEnd,
        dueDate: periodStart,
        idempotencyKey: `membership:invoice:${contract.id}:${periodStart}`,
        maxAttempts: INVOICE_MAX_ATTEMPTS,
        retryIntervalHours: INVOICE_RETRY_INTERVAL_HOURS,
        metadata: { planId: contract.planId, contractId: contract.id },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`CreateInvoice 발행 실패 (contractId=${contract.id}): ${msg}`);
      // 자격은 이미 선적용됨 — 다음 일일 스케줄러가 같은 멱등키로 재발행한다.
      return { contractId: contract.id, success: false, errorCode: 'INVOICE_COMMAND_FAILED', errorMessage: msg };
    }

    return { contractId: contract.id, success: true };
  }

  /** 구독 취소/해지 시 열린 인보이스 무효화 (best-effort — 실패해도 취소 흐름은 유지). */
  async voidInvoicesForContract(contractId: string, reason: string): Promise<void> {
    try {
      await this.walletCommandPublisher.publishVoidInvoice({
        subscriberType: 'MEMBERSHIP',
        subscriberRef: contractId,
        reason,
      });
    } catch (err: unknown) {
      this.logger.error(
        `VoidInvoice 발행 실패 (contractId=${contractId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 자격을 periodEnd 까지 선연장. 현재 자격의 endsAt 이 이미 periodEnd 이상이면 no-op.
   * 활성 자격이 없으면(해지 직후 등) 연장하지 않는다 — 인보이스 발행측 가드가 계약 상태를 먼저 거른다.
   */
  private async grantAdvanceEntitlement(contractId: string, userId: string, periodEnd: string): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      const [entitlement] = await tx
        .select()
        .from(schema.subscriptionEntitlement)
        .where(
          and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)),
        )
        .for('update');

      if (!entitlement) {
        this.logger.warn(`선적용 스킵 — 활성 자격 없음 (contractId=${contractId}, userId=${userId})`);
        return;
      }
      if (entitlement.endsAt >= periodEnd) return;

      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({ type: 'BILLING_ADVANCE_GRANT', effectiveDate: format(new Date(), 'yyyy-MM-dd') })
        .returning();

      await tx
        .update(schema.subscriptionEntitlement)
        .set({ isCurrent: false, closedAt: new Date(), closedBatchId: batch.id })
        .where(eq(schema.subscriptionEntitlement.id, entitlement.id));

      await tx.insert(schema.subscriptionEntitlement).values({
        userId,
        tierId: entitlement.tierId,
        startsAt: entitlement.startsAt,
        endsAt: periodEnd,
        isCurrent: true,
        sourceBatchId: batch.id,
        pausedAt: entitlement.pausedAt,
      });

      await this.contractEventManager.addEvent(
        tx,
        contractId,
        'INVOICE_ADVANCE_GRANT',
        { periodEnd },
        'SYSTEM',
        userId,
        batch.id,
      );

      this.logger.log(`선적용 자격 연장: contractId=${contractId}, endsAt ${entitlement.endsAt} → ${periodEnd}`);
    });
  }
}
