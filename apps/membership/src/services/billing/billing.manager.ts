import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import * as schema from '../../shared/schemas/entities/schema';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { DrizzleTransaction } from '../../shared/schemas/types';
import { PaymentClientService } from './payment-client.service';
import { EntitlementService } from '../entitlement.service';
import { PlanService } from '../plan.service';
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
 * 역할: 결제 처리 로직
 * - 개별 결제 처리
 * - 결제 성공/실패 처리
 * - Dunning 큐 관리
 * - 트랜잭션 처리
 */
@Injectable()
export class BillingManager {
  private readonly logger = new Logger(BillingManager.name);

  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly paymentClient: PaymentClientService,
    private readonly entitlementService: EntitlementService,
    private readonly planService: PlanService,
  ) {}

  /**
   * 개별 계약 결제 처리
   */
  async processSingleBilling(contract: any): Promise<BillingResult> {
    return this.dbService.db.transaction(async (tx: DrizzleTransaction) => {
      try {
        this.logger.log(`Processing billing for contract: ${contract.id}`);

        // 1. 플랜 정보 조회 및 검증
        const plan = await this.planService.getPlanDetails(contract.planId);
        if (!plan) {
          throw new Error(`Plan not found: ${contract.planId}`);
        }
        if (!plan.plan.isActive) {
          throw new Error(`Plan is not active: ${contract.planId}`);
        }

        // 2. 결제 프로필 확인/조회
        let paymentProfileId = contract.paymentProfileId;
        if (!paymentProfileId) {
          const defaultProfile = await this.paymentClient.getDefaultPaymentProfile(contract.userId);
          paymentProfileId = defaultProfile.id;

          // 계약에 프로필 ID 저장
          await tx
            .update(schema.subscriptionContracts)
            .set({ paymentProfileId: defaultProfile.id })
            .where(eq(schema.subscriptionContracts.id, contract.id));
        }

        // 3. PaymentIntent 생성
        const paymentIntent = await this.paymentClient.createPaymentIntent({
          customerId: contract.userId,
          type: 'MEMBERSHIP_FEE',
          amount: plan.plan.price,
          metadata: {
            contractId: contract.id,
            planId: contract.planId,
            billingCycle: `${contract.id}-${new Date().toISOString().split('T')[0]}`,
          },
        });

        // 4. 결제 실행
        this.logger.debug(`Payment profile ID type and value: ${typeof paymentProfileId}, ${paymentProfileId}`);

        const paymentResult = await this.paymentClient.processPayment(paymentIntent.id, {
          providerType: 'HMS_CARD',
          profileId: paymentProfileId,
        });

        // 5. 결제 결과 처리
        if (paymentResult.success) {
          await this.handleSuccessfulBilling(tx, contract, paymentIntent, paymentResult, plan);
          return {
            contractId: contract.id,
            success: true,
            paymentIntentId: paymentIntent.id,
            paymentAttemptId: paymentResult.transactionId,
          };
        } else {
          await this.handleFailedBilling(tx, contract, paymentIntent, paymentResult);
          return {
            contractId: contract.id,
            success: false,
            paymentIntentId: paymentIntent.id,
            paymentAttemptId: paymentResult.transactionId,
            errorCode: paymentResult.code,
            errorMessage: paymentResult.message,
          };
        }
      } catch (error) {
        this.logger.error(`Error processing billing for contract ${contract.id}: ${error.message}`);
        throw error;
      }
    });
  }

  /**
   * 결제 성공 처리
   */
  private async handleSuccessfulBilling(
    tx: DrizzleTransaction,
    contract: any,
    paymentIntent: any,
    paymentResult: any,
    plan: any,
  ) {
    const now = new Date();
    const nextBillingDate = addDays(now, plan.plan.durationDays);

    // 1. 계약 정보 업데이트
    await tx
      .update(schema.subscriptionContracts)
      .set({
        nextBillingDate: format(nextBillingDate, 'yyyy-MM-dd'),
        lastPaymentIntentId: paymentIntent.id,
        lastPaymentAttemptId: paymentResult.transactionId,
        isPastDue: false,
        billingRetryCount: 0,
      })
      .where(eq(schema.subscriptionContracts.id, contract.id));

    // 2. 구독 권한 연장
    await this.entitlementService.extendEntitlement(
      contract.userId,
      plan.plan.durationDays,
      `정기결제 성공 - Intent: ${paymentIntent.id}`,
    );

    // 3. Dunning 큐에서 제거
    await tx.delete(schema.membershipDunningQueue).where(eq(schema.membershipDunningQueue.contractId, contract.id));

    this.logger.log(
      `Billing successful for contract ${contract.id}, next billing: ${format(nextBillingDate, 'yyyy-MM-dd')}`,
    );
  }

  /**
   * 결제 실패 처리
   */
  private async handleFailedBilling(tx: DrizzleTransaction, contract: any, paymentIntent: any, paymentResult: any) {
    const retryCount = (contract.billingRetryCount || 0) + 1;
    const maxRetries = 3;

    // 1. 계약 상태 업데이트
    await tx
      .update(schema.subscriptionContracts)
      .set({
        lastPaymentIntentId: paymentIntent.id,
        lastPaymentAttemptId: paymentResult.transactionId,
        isPastDue: true,
        billingRetryCount: retryCount,
      })
      .where(eq(schema.subscriptionContracts.id, contract.id));

    // 2. 재시도 가능한 경우 Dunning 큐에 추가
    if (retryCount < maxRetries) {
      const nextRetryAt = addDays(new Date(), retryCount);

      await tx
        .insert(schema.membershipDunningQueue)
        .values({
          contractId: contract.id,
          nextRetryAt,
          attempts: retryCount,
          maxAttempts: maxRetries,
          lastErrorCode: paymentResult.errorCode,
          lastErrorMessage: paymentResult.errorMessage,
        })
        .onConflictDoUpdate({
          target: schema.membershipDunningQueue.contractId,
          set: {
            nextRetryAt,
            attempts: retryCount,
            lastErrorCode: paymentResult.errorCode,
            lastErrorMessage: paymentResult.errorMessage,
            updatedAt: new Date(),
          },
        });

      this.logger.warn(
        `Billing failed for contract ${contract.id}, scheduled retry ${retryCount}/${maxRetries} at ${format(nextRetryAt, 'yyyy-MM-dd')}`,
      );
    } else {
      this.logger.error(`Billing failed for contract ${contract.id}, max retries exceeded`);

      // TODO: 구독 일시정지 또는 취소 처리
      // TODO: 사용자 알림 발송
    }
  }
}
