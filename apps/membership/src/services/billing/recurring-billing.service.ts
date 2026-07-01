import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { format } from 'date-fns';
import { BillingReader } from './billing.reader';
import { BillingManager, BillingResult } from './billing.manager';
import { BillingOutcomeHandler } from './billing-outcome.handler';

// 하위 호환성을 위한 타입 export
export type { BillingResult } from './billing.manager';

/**
 * 정기결제 스케줄러 서비스 (Business Layer)
 *
 * 역할: 스케줄러 실행 + 오케스트레이션만
 * - Cron 스케줄러 실행
 * - Reader/Manager 호출
 * - 전체 흐름 조정
 *
 * 참고: 실제 결제 로직은 BillingManager가 담당
 */
@Injectable()
export class RecurringBillingService {
  private readonly logger = new Logger(RecurringBillingService.name);

  constructor(
    private readonly billingReader: BillingReader,
    private readonly billingManager: BillingManager,
    private readonly billingOutcomeHandler: BillingOutcomeHandler,
  ) {}

  /**
   * 매일 09시 정기결제 스케줄러 실행
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async runDailyBillingScheduler(): Promise<void> {
    this.logger.log('Starting daily billing scheduler...');

    try {
      const results = await this.processDueBillings();
      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.filter((r) => !r.success).length;

      this.logger.log(`Daily billing completed - Success: ${successCount}, Failed: ${failureCount}`);
    } catch (error) {
      this.logger.error(`Daily billing scheduler failed: ${error.message}`, error.stack);
    }
  }

  /**
   * 수동 실행용 메서드 (테스트 및 관리자 트리거)
   */
  async processDueBillings(): Promise<BillingResult[]> {
    const today = format(new Date(), 'yyyy-MM-dd');
    this.logger.log(`Processing due billings for date: ${today}`);

    // 1. 오늘 결제 예정인 계약들 조회 (Reader 사용)
    const dueContracts = await this.billingReader.findDueContracts(today);
    this.logger.log(`Found ${dueContracts.length} contracts due for billing`);

    const results: BillingResult[] = [];

    // 2. 각 계약에 대해 결제 처리 (Manager 사용)
    for (const contract of dueContracts) {
      try {
        const result = await this.billingManager.processSingleBilling(contract);
        results.push(result);

        await this.sleep(1000); // API 부하 방지
      } catch (error) {
        this.logger.error(`Failed to process billing for contract ${contract.id}: ${error.message}`, error.stack);

        // 에러 타입별 분류
        let errorCode = 'UNKNOWN_ERROR';
        if (error.message.includes('Cannot connect to Wallet server')) {
          errorCode = 'WALLET_CONNECTION_ERROR';
        } else if (error.message.includes('Payment intent not found')) {
          errorCode = 'PAYMENT_INTENT_ERROR';
        } else if (error.message.includes('No active payment profile')) {
          errorCode = 'NO_PAYMENT_PROFILE';
        } else if (error.message.includes('Plan not found')) {
          errorCode = 'PLAN_NOT_FOUND';
        } else if (error.message.includes('Plan is not active')) {
          errorCode = 'PLAN_NOT_ACTIVE';
        }

        results.push({
          contractId: contract.id,
          success: false,
          errorCode,
          errorMessage: error.message,
        });
      }
    }

    // 3. Dunning 큐 처리 (결제 실패 재시도)
    await this.processDunningQueue();

    return results;
  }

  /**
   * Dunning 큐 처리 (재시도 대상)
   */
  private async processDunningQueue() {
    const now = new Date();

    // Reader로 Dunning 큐 조회
    const dunningItems = await this.billingReader.findDunningItems(now);
    this.logger.log(`Found ${dunningItems.length} items in dunning queue`);

    for (const item of dunningItems) {
      try {
        // Reader로 계약 조회
        const contract = await this.billingReader.findContractById(item.contractId);

        if (contract) {
          // Manager로 결제 처리 — 더닝 attempts를 멱등키 nonce로 넘겨 매 재시도가 새 커맨드가 되게 한다
          await this.billingManager.processSingleBilling(contract, item.attempts);
        }
      } catch (error) {
        this.logger.error(`Failed to process dunning item ${item.id}: ${error.message}`);
      }
    }
  }

  /**
   * 매 시간 정각 만료 처리
   *
   * - autoRenewal=false: endsAt < today -> 일반 만료 (one_time / recurring 해지 후 기간 종료)
   * - autoRenewal=true + dunning 없음: BillingCharge 커맨드 발행 후 wallet 응답 미수신 stuck 상태
   * (dunning 진행 중인 카드거절 케이스는 handleFailure -> dunning -> terminateSubscription으로 처리)
   */
  @Cron('0 * * * *')
  async runExpirationCheck(): Promise<void> {
    this.logger.log('Starting expiration check...');

    try {
      const today = format(new Date(), 'yyyy-MM-dd');

      const [expired, stuck] = await Promise.all([
        this.billingReader.findExpiredEntitlements(today),
        this.billingReader.findStuckEntitlements(today),
      ]);
      this.logger.log(
        `Expiration check: ${expired.length} expired (autoRenewal=false), ${stuck.length} stuck (autoRenewal=true)`,
      );

      await this.expireEntitlements(expired, false);
      await this.expireEntitlements(stuck, true);
    } catch (error) {
      this.logger.error(`Expiration check failed: ${error.message}`, error.stack);
    }
  }

  private async expireEntitlements(
    items: { entitlementId: string; userId: string; contractId: string }[],
    warnOnProcess: boolean,
  ): Promise<void> {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.entitlementId)) continue;
      seen.add(item.entitlementId);
      try {
        if (warnOnProcess) {
          this.logger.warn(`Expiring stuck entitlement: entitlementId=${item.entitlementId}, userId=${item.userId}`);
        }
        await this.billingOutcomeHandler.handleExpiration(item.entitlementId, item.userId, item.contractId);
      } catch (error) {
        this.logger.error(
          `Failed to expire ${warnOnProcess ? 'stuck ' : ''}entitlement ${item.entitlementId}: ${error.message}`,
        );
      }
    }
  }

  /**
   * 특정 계약에 대해 결제 즉시 재시도 (관리자용)
   */
  async retryContractBilling(contractId: string): Promise<BillingResult> {
    const contract = await this.billingReader.findContractById(contractId);
    if (!contract) throw new Error(`Contract not found: ${contractId}`);
    const attempts = await this.billingReader.findDunningAttempts(contractId);
    return this.billingManager.processSingleBilling(contract, attempts);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
