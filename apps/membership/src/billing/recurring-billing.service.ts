import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { eq, and, lte, isNull, or } from 'drizzle-orm';
import * as schema from '../shared/schemas/entities/schema';
import { PaymentClientService } from './payment-client.service';
import { EntitlementService } from '../subscription/entitlement.service';
import { PlanService } from '../plan/plan.service';
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
 * 정기결제 스케줄러 서비스
 * CTO 지침에 따른 PaymentIntent/PaymentAttempt 중심의 정기결제 처리
 */
@Injectable()
export class RecurringBillingService {
  private readonly logger = new Logger(RecurringBillingService.name);

  constructor(
    private readonly dbService: DbService<typeof schema>,
    private readonly paymentClient: PaymentClientService,
    private readonly entitlementService: EntitlementService,
    private readonly planService: PlanService,
  ) {}

  /**
   * 매 5분마다 정기결제 스케줄러 실행 (테스트용)
   * 프로덕션에서는 EVERY_DAY_AT_9AM으로 변경
   */
  @Cron('*/1 * * * *') // 매 1분마다 실행
  async runDailyBillingScheduler(): Promise<void> {
    this.logger.log('Starting daily billing scheduler...');

    try {
      const results = await this.processDueBillings();
      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.filter((r) => !r.success).length;

      this.logger.log(
        `Daily billing completed - Success: ${successCount}, Failed: ${failureCount}`,
      );
    } catch (error) {
      this.logger.error(
        `Daily billing scheduler failed: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * 수동 실행용 메서드 (테스트 및 관리자 트리거)
   */
  async processDueBillings(): Promise<BillingResult[]> {
    const today = format(new Date(), 'yyyy-MM-dd');
    this.logger.log(`Processing due billings for date: ${today}`);

    // 1. 오늘 결제 예정인 계약들 조회
    const dueContracts = await this.getDueContracts(today);
    this.logger.log(`Found ${dueContracts.length} contracts due for billing`);

    const results: BillingResult[] = [];

    // 2. 각 계약에 대해 결제 처리
    for (const contract of dueContracts) {
      try {
        const result = await this.processSingleBilling(contract);
        results.push(result);

        // 결제 간격 조절 (API 부하 방지)
        await this.sleep(1000); // 1초 대기
      } catch (error) {
        this.logger.error(
          `Failed to process billing for contract ${contract.id}: ${error.message}`,
        );
        results.push({
          contractId: contract.id,
          success: false,
          errorMessage: error.message,
        });
      }
    }

    // 3. Dunning 큐 처리 (결제 실패 재시도)
    await this.processDunningQueue();

    return results;
  }

  /**
   * 오늘 결제 예정인 계약들 조회
   */
  private async getDueContracts(date: string) {
    return await this.dbService.db
      .select({
        id: schema.subscriptionContracts.id,
        userId: schema.subscriptionContracts.userId,
        planId: schema.subscriptionContracts.planId,
        nextBillingDate: schema.subscriptionContracts.nextBillingDate,
        paymentProfileId: schema.subscriptionContracts.paymentProfileId,
        isPastDue: schema.subscriptionContracts.isPastDue,
        billingRetryCount: schema.subscriptionContracts.billingRetryCount,
      })
      .from(schema.subscriptionContracts)
      .where(
        and(
          eq(schema.subscriptionContracts.isVoided, false),
          lte(schema.subscriptionContracts.nextBillingDate, date),
          or(
            eq(schema.subscriptionContracts.isPastDue, false), // 정상 결제일
            eq(schema.subscriptionContracts.isPastDue, true), // 연체 상태 재시도
          ),
        ),
      );
  }

  /**
   * 개별 계약 결제 처리
   */
  private async processSingleBilling(contract: any): Promise<BillingResult> {
    return await this.dbService.db.transaction(async (tx) => {
      try {
        this.logger.log(`Processing billing for contract: ${contract.id}`);

        // 1. 플랜 정보 조회
        const plan = await this.planService.getPlanDetails(contract.planId);
        if (!plan) {
          throw new Error(`Plan not found: ${contract.planId}`);
        }

        // 2. 결제 프로필 확인/조회
        let paymentProfileId = contract.paymentProfileId;
        if (!paymentProfileId) {
          const defaultProfile =
            await this.paymentClient.getDefaultPaymentProfile(contract.userId);
          paymentProfileId = defaultProfile.id;

          // 계약에 프로필 ID 저장
          await tx
            .update(schema.subscriptionContracts)
            .set({ paymentProfileId: defaultProfile.id })
            .where(eq(schema.subscriptionContracts.id, contract.id));
        }

        // 3. PaymentIntent 생성
        const paymentIntent = await this.paymentClient.createPaymentIntent({
          userId: contract.userId, // 최상위 필드로 이동
          type: 'MEMBERSHIP_FEE',
          amount: plan.price,
          currency: plan.currency,
          description: `멤버십 정기결제 - ${plan.tier.code}`,
          metadata: {
            contractId: contract.id,
            planId: contract.planId,
          },
        });

        // 4. PaymentAttempt 실행
        const paymentAttempt = await this.paymentClient.createPaymentAttempt(
          paymentIntent.intentId, // 필드명 수정: id → intentId
          {
            provider: 'CMS', // MEMBERSHIP_FEE 타입에 허용된 provider 사용
            profileId: paymentProfileId,
          },
        );

        // 5. 결제 결과 처리
        if (paymentAttempt.status === 'CAPTURED') {
          await this.handleSuccessfulBilling(
            tx,
            contract,
            paymentIntent,
            paymentAttempt,
            plan,
          );
          return {
            contractId: contract.id,
            success: true,
            paymentIntentId: paymentIntent.intentId,
            paymentAttemptId: paymentAttempt.attemptId, // 필드명 수정: id → attemptId
          };
        } else {
          await this.handleFailedBilling(
            tx,
            contract,
            paymentIntent,
            paymentAttempt,
          );
          return {
            contractId: contract.id,
            success: false,
            paymentIntentId: paymentIntent.intentId,
            paymentAttemptId: paymentAttempt.attemptId, // 필드명 수정: id → attemptId
            errorCode: paymentAttempt.errorMessage, // 실제 응답 필드명: errorMessage
            errorMessage: paymentAttempt.errorMessage,
          };
        }
      } catch (error) {
        this.logger.error(
          `Error processing billing for contract ${contract.id}: ${error.message}`,
        );
        throw error;
      }
    });
  }

  /**
   * 결제 성공 처리
   */
  private async handleSuccessfulBilling(
    tx: any,
    contract: any,
    paymentIntent: any,
    paymentAttempt: any,
    plan: any,
  ) {
    const now = new Date();
    const nextBillingDate = addDays(now, plan.durationDays);

    // 1. 계약 정보 업데이트
    await tx
      .update(schema.subscriptionContracts)
      .set({
        nextBillingDate: format(nextBillingDate, 'yyyy-MM-dd'),
        lastPaymentIntentId: paymentIntent.intentId, // 필드명 수정
        lastPaymentAttemptId: paymentAttempt.attemptId, // 필드명 수정
        isPastDue: false,
        billingRetryCount: 0,
      })
      .where(eq(schema.subscriptionContracts.id, contract.id));

    // 2. 구독 권한 연장
    await this.entitlementService.extendEntitlement(
      contract.userId,
      plan.durationDays,
      `정기결제 성공 - Intent: ${paymentIntent.intentId}`, // 필드명 수정
    );

    // 3. Dunning 큐에서 제거 (있는 경우)
    await tx
      .delete(schema.membershipDunningQueue)
      .where(eq(schema.membershipDunningQueue.contractId, contract.id));

    this.logger.log(
      `Billing successful for contract ${contract.id}, next billing: ${format(nextBillingDate, 'yyyy-MM-dd')}`,
    );
  }

  /**
   * 결제 실패 처리
   */
  private async handleFailedBilling(
    tx: any,
    contract: any,
    paymentIntent: any,
    paymentAttempt: any,
  ) {
    const retryCount = (contract.billingRetryCount || 0) + 1;
    const maxRetries = 3;

    // 1. 계약 상태 업데이트
    await tx
      .update(schema.subscriptionContracts)
      .set({
        lastPaymentIntentId: paymentIntent.id,
        lastPaymentAttemptId: paymentAttempt.id,
        isPastDue: true,
        billingRetryCount: retryCount,
      })
      .where(eq(schema.subscriptionContracts.id, contract.id));

    // 2. 재시도 가능한 경우 Dunning 큐에 추가
    if (retryCount < maxRetries) {
      const nextRetryAt = addDays(new Date(), retryCount); // 1일, 2일, 3일 후 재시도

      await tx
        .insert(schema.membershipDunningQueue)
        .values({
          contractId: contract.id,
          nextRetryAt,
          attempts: retryCount,
          maxAttempts: maxRetries,
          lastErrorCode: paymentAttempt.failureCode,
          lastErrorMessage: paymentAttempt.failureMessage,
        })
        .onConflictDoUpdate({
          target: schema.membershipDunningQueue.contractId,
          set: {
            nextRetryAt,
            attempts: retryCount,
            lastErrorCode: paymentAttempt.failureCode,
            lastErrorMessage: paymentAttempt.failureMessage,
            updatedAt: new Date(),
          },
        });

      this.logger.warn(
        `Billing failed for contract ${contract.id}, scheduled retry ${retryCount}/${maxRetries} at ${format(nextRetryAt, 'yyyy-MM-dd')}`,
      );
    } else {
      this.logger.error(
        `Billing failed for contract ${contract.id}, max retries exceeded`,
      );

      // TODO: 구독 일시정지 또는 취소 처리
      // TODO: 사용자 알림 발송
    }
  }

  /**
   * Dunning 큐 처리 (재시도 대상)
   */
  private async processDunningQueue() {
    const now = new Date();

    const dunningItems = await this.dbService.db
      .select()
      .from(schema.membershipDunningQueue)
      .where(lte(schema.membershipDunningQueue.nextRetryAt, now));

    this.logger.log(`Found ${dunningItems.length} items in dunning queue`);

    for (const item of dunningItems) {
      try {
        // 해당 계약 조회
        const contract = await this.dbService.db
          .select()
          .from(schema.subscriptionContracts)
          .where(eq(schema.subscriptionContracts.id, item.contractId))
          .limit(1);

        if (contract.length > 0) {
          await this.processSingleBilling(contract[0]);
        }
      } catch (error) {
        this.logger.error(
          `Failed to process dunning item ${item.id}: ${error.message}`,
        );
      }
    }
  }

  /**
   * 유틸리티: 비동기 대기
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
