import { Injectable, Logger } from '@nestjs/common';
import { PlanService } from '../plan.service';
import { WalletCommandPublisher } from './wallet-command.publisher';

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
 * 역할: Kafka BillingCharge 커맨드를 wallet으로 발행.
 * wallet의 BillingChargeConsumer가 실제 결제(authorize → capture)를 처리
 */
@Injectable()
export class BillingManager {
  private readonly logger = new Logger(BillingManager.name);

  constructor(
    private readonly walletCommandPublisher: WalletCommandPublisher,
    private readonly planService: PlanService,
  ) {}

  /**
   * 개별 계약 결제 처리 — wallet.commands.v1 Kafka BillingCharge 커맨드 발행
   */
  async processSingleBilling(contract: any): Promise<BillingResult> {
    try {
      this.logger.log(`Processing billing for contract: ${contract.id}`);

      const plan = await this.planService.getPlanDetails(contract.planId);
      if (!plan) throw new Error(`Plan not found: ${contract.planId}`);
      if (!plan.plan.isActive) throw new Error(`Plan is not active: ${contract.planId}`);

      const idempotencyKey = `membership:billing:${contract.id}:${new Date().toISOString().split('T')[0]}`;

      await this.walletCommandPublisher.publishBillingCharge({
        subscriberRef: contract.id,
        subscriberType: 'MEMBERSHIP',
        amount: plan.plan.price,
        currency: plan.plan.currency ?? 'KRW',
        purpose: 'SUBSCRIPTION',
        idempotencyKey,
        metadata: { planId: contract.planId, contractId: contract.id },
      });

      this.logger.log(`BillingCharge command published for contract: ${contract.id}`);

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
