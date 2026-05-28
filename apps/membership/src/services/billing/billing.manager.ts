import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../shared/schemas/entities/schema';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { PlanService } from '../plan.service';
import { WalletCommandPublisher } from './wallet-command.publisher';
import { DueContract } from './billing.reader';

export interface BillingResult {
  contractId: string;
  success: boolean;
  paymentIntentId?: string;
  paymentAttemptId?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * BillingManager (Implementation Layer)
 *
 * Kafka BillingCharge 커맨드를 wallet으로 발행.
 * wallet의 BillingChargeConsumer가 실제 결제(authorize → capture)를 처리
 */
@Injectable()
export class BillingManager {
  private readonly logger = new Logger(BillingManager.name);

  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly walletCommandPublisher: WalletCommandPublisher,
    private readonly planService: PlanService,
  ) {}

  async processSingleBilling(contract: DueContract): Promise<BillingResult> {
    // 동시 스케줄러 실행 대비: billingInProgress=false 조건부 선점 업데이트
    // RETURNING id — 다른 인스턴스가 먼저 선점했으면 빈 배열 반환 → 스킵
    const [locked] = await this.dbService.db
      .update(schema.subscriptionContracts)
      .set({ billingInProgress: true, billingStartedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.subscriptionContracts.id, contract.id),
          eq(schema.subscriptionContracts.billingInProgress, false),
        ),
      )
      .returning({ id: schema.subscriptionContracts.id });

    if (!locked) {
      this.logger.warn(`[billing] Contract ${contract.id} already billingInProgress — skipped`);
      return { contractId: contract.id, success: true };
    }

    try {
      this.logger.log(`Processing billing for contract: ${contract.id}`);

      const plan = await this.planService.getPlanDetails(contract.planId);
      if (!plan) throw new Error(`Plan not found: ${contract.planId}`);
      if (!plan.plan.isActive) throw new Error(`Plan is not active: ${contract.planId}`);

      // idempotencyKey를 nextBillingDate 기반으로 고정:
      // wallet의 idempotency_keys가 같은 billing 주기의 중복 커맨드를 막는다.
      const idempotencyKey = `membership:billing:${contract.id}:${contract.nextBillingDate}`;

      await this.walletCommandPublisher.publishBillingCharge({
        subscriberRef: contract.id,
        subscriberType: 'MEMBERSHIP',
        amount: plan.plan.price,
        currency: plan.plan.currency ?? 'KRW',
        purpose: 'SUBSCRIPTION',
        idempotencyKey,
        metadata: { planId: contract.planId, contractId: contract.id },
      });

      this.logger.log(`BillingCharge published for contract: ${contract.id}, billingInProgress=true`);
      return { contractId: contract.id, success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error processing billing for contract ${contract.id}: ${msg}`);
      // Publish 실패 시 플래그 복구 — 다음 스케줄러가 재시도 가능하도록
      await this.dbService.db
        .update(schema.subscriptionContracts)
        .set({ billingInProgress: false, billingStartedAt: null, updatedAt: new Date() })
        .where(eq(schema.subscriptionContracts.id, contract.id));
      return {
        contractId: contract.id,
        success: false,
        errorCode: 'BILLING_COMMAND_FAILED',
        errorMessage: msg,
      };
    }
  }
}
