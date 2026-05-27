import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import * as schema from '../../shared/schemas/entities/schema';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { PlanService } from '../plan.service';
import { WalletCommandPublisher } from './wallet-command.publisher';
import { addDays, format } from 'date-fns';

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

  async processSingleBilling(contract: any): Promise<BillingResult> {
    try {
      this.logger.log(`Processing billing for contract: ${contract.id}`);

      const plan = await this.planService.getPlanDetails(contract.planId);
      if (!plan) throw new Error(`Plan not found: ${contract.planId}`);
      if (!plan.plan.isActive) throw new Error(`Plan is not active: ${contract.planId}`);

      // idempotencyKey를 today 기반이 아닌 nextBillingDate 기반으로 고정:
      // wallet의 idempotency_keys가 같은 billing 주기(nextBillingDate)의 중복 커맨드를 막는다.
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

      // BillingCharge 커맨드 발행 즉시 nextBillingDate를 다음 주기로 진행시켜
      // 스케줄러 재실행 시 동일 계약에 대해 중복 발행되는 것을 방지.
      // TODO: nextBillingDate는 wallet 결제 성공 이벤트 수신 후 이동하는 것이 정확하다.
      //       현재는 커맨드 발행 시 이동하므로 결제 실패 시 운영 화면에서 날짜가 틀릴 수 있다.
      const nextBillingDate = format(addDays(new Date(), plan.plan.durationDays), 'yyyy-MM-dd');
      await this.dbService.db
        .update(schema.subscriptionContracts)
        .set({ nextBillingDate })
        .where(eq(schema.subscriptionContracts.id, contract.id));

      this.logger.log(`BillingCharge published for contract: ${contract.id}, nextBillingDate advanced to ${nextBillingDate}`);

      return { contractId: contract.id, success: true };
    } catch (error) {
      this.logger.error(`Error processing billing for contract ${contract.id}: ${error.message}`);
      return {
        contractId: contract.id,
        success: false,
        errorCode: 'BILLING_COMMAND_FAILED',
        errorMessage: error.message,
      };
    }
  }
}
