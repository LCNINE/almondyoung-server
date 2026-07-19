import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { format, subMinutes } from 'date-fns';
import { SubscriptionException, SubscriptionNotFoundException } from '../../shared/exceptions/subscription.exceptions';
import { BillingReader } from './billing.reader';
import { BillingManager, BillingResult } from './billing.manager';
import { InvoiceBillingManager } from './invoice-billing.manager';
import { BillingOutcomeHandler } from './billing-outcome.handler';
import { InvoiceOutcomeHandler } from './invoice-outcome.handler';
import { PaymentClientService } from './payment-client.service';

/** 결과 이벤트를 이 시간(분) 넘게 못 받은 진행 중 청구는 reconcile 대상으로 본다. */
const RECONCILE_THRESHOLD_MINUTES = 30;

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
    private readonly invoiceBillingManager: InvoiceBillingManager,
    private readonly billingOutcomeHandler: BillingOutcomeHandler,
    private readonly invoiceOutcomeHandler: InvoiceOutcomeHandler,
    private readonly paymentClient: PaymentClientService,
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
   * 정기결제 결과 reconciliation (매 30분)
   *
   * wallet 결과 이벤트가 유실/지연되어 billingInProgress 가 오래 걸려 있는 계약을, 저장된 멱등키로
   * wallet 권위 상태를 되물어 스스로 정합화한다. 이벤트 기반 동기화의 불확실성을 SoT 미보유측(membership)이
   * 해소하는 경로. billing_events 유니크 멱등 마커 덕에 실제 이벤트와 레이스해도 안전하다.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async reconcileStuckBillings(): Promise<void> {
    const threshold = subMinutes(new Date(), RECONCILE_THRESHOLD_MINUTES);
    const stuck = await this.billingReader.findStuckBillingForReconcile(threshold);
    if (stuck.length === 0) return;

    this.logger.log(`[reconcile] 진행 중 청구 정합화 대상 ${stuck.length}건`);
    for (const { contractId, idempotencyKey } of stuck) {
      try {
        await this.reconcileOne(contractId, idempotencyKey);
      } catch (err) {
        this.logger.error(
          `[reconcile] 실패 (contractId=${contractId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * 단건 정합화: 멱등키로 wallet intent 를 조회해 상태별로 결과 핸들러에 위임한다.
   * - CAPTURED/AUTHORIZED/SUCCEEDED → 성공 처리(기간 연장·락 해제)
   * - FAILED → 실패 처리(더닝/해지)
   * - CANCELED → 취소 처리
   * - 진행 중(PENDING_SETTLEMENT 등) → 대기(다음 주기 재확인)
   * - intent 없음(커맨드 유실) → 락 해제 후 다음 스케줄러가 재발행
   */
  private async reconcileOne(contractId: string, idempotencyKey: string): Promise<void> {
    const intent = await this.paymentClient.getWalletIntentByIdempotencyKey(idempotencyKey);

    if (!intent) {
      this.logger.warn(`[reconcile] intent 없음(커맨드 유실 추정) → 락 해제: contractId=${contractId}`);
      await this.billingManager.releaseBillingLock(contractId);
      return;
    }

    const status = String(intent.status);
    switch (status) {
      // AUTHORIZED 를 성공으로 인정하는 근거: 라이브 provider 인 CMS(효성)는 AUTHORIZED = 출금성공(실제 금전 이동)
      // 이고 capture 는 no-op formality 다. 여기서 CAPTURED 로 좁히면 정산 성공 후 auto-capture 누락 시
      // "돈은 빠졌는데 혜택 미연장"이 되어 더 위험하다. 단, 승인≠매출확정인 provider(카드 빌링)를 켜면
      // 그 provider 에 한해 성공 기준을 CAPTURED 로 게이팅해야 한다(wallet 이 providerType/금전확정 여부를 노출해야 함).
      case 'CAPTURED':
      case 'AUTHORIZED':
      case 'SUCCEEDED':
        await this.billingOutcomeHandler.handleSuccess(contractId, intent.payableAmount, intent.id);
        break;
      case 'FAILED':
        await this.billingOutcomeHandler.handleFailure(
          contractId,
          'RECONCILED_FAILED',
          'wallet 조회로 확인된 실패(이벤트 유실 정합화)',
          intent.id,
        );
        break;
      case 'CANCELED':
        await this.billingOutcomeHandler.handleCanceled(contractId, intent.id);
        break;
      default:
        // CREATED/PROCESSING/PENDING/PENDING_SETTLEMENT/REQUIRES_ACTION 등 아직 진행 중 — 다음 주기 재확인
        this.logger.log(`[reconcile] 진행 중 상태 유지(대기): contractId=${contractId}, status=${status}`);
    }
  }

  /**
   * 인보이스(선적용) 경로 reconciliation (매 30분)
   *
   * INVOICE 경로는 wallet 이 재시도/미수를 소유하고 결과를 이벤트로만 통지하는데, 그 이벤트가 유실되면
   * 선적용된 자격이 회수되지 않는다(무료 고착·매출 누수). CHARGE 의 reconcileStuckBillings 와 대칭으로,
   * membership 이 자기 소유 멱등키로 wallet 인보이스 권위 상태를 되물어(이벤트 평면과 독립된 조회 평면)
   * 터미널 결과를 직접 확정한다. 모든 결과 반영은 billing_events 멱등 마커라 실제 이벤트와 레이스해도 안전.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async reconcileStuckInvoices(): Promise<void> {
    const today = format(new Date(), 'yyyy-MM-dd');
    const targets = await this.billingReader.findInvoiceContractsForReconcile(today);
    if (targets.length === 0) return;

    this.logger.log(`[invoice-reconcile] 미확정 인보이스 정합화 대상 ${targets.length}건`);
    for (const { contractId, periodStart } of targets) {
      try {
        await this.reconcileOneInvoice(contractId, periodStart);
      } catch (err) {
        this.logger.error(
          `[invoice-reconcile] 실패 (contractId=${contractId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * 단건 인보이스 정합화: 멤버십 소유 멱등키로 wallet 인보이스를 조회해 터미널 상태를 결과 핸들러에 위임.
   * - PAID → 자격 보장 연장 + 다음 주기 예약
   * - UNCOLLECTIBLE/VOID/MANDATE_REJECTED → 선적용 자격 회수(해지)
   * - 비터미널(OPEN/MANDATE_PENDING/ATTEMPTING/PAST_DUE) → 대기(다음 주기 재확인)
   * - 인보이스 없음(커맨드 유실/미발행) → 대기(다음 일일 스케줄러가 재발행)
   */
  private async reconcileOneInvoice(contractId: string, periodStart: string): Promise<string | null> {
    const idempotencyKey = `membership:invoice:${contractId}:${periodStart}`;
    const invoice = await this.paymentClient.getWalletInvoiceByIdempotencyKey(idempotencyKey);

    if (!invoice) {
      this.logger.log(`[invoice-reconcile] 인보이스 미발행(대기): contractId=${contractId}, key=${idempotencyKey}`);
      return null;
    }

    switch (invoice.status) {
      case 'PAID':
        await this.invoiceOutcomeHandler.handlePaid(
          contractId,
          invoice.invoiceId,
          invoice.periodEnd,
          invoice.amount ?? null,
          invoice.intentId ?? undefined,
        );
        break;
      case 'UNCOLLECTIBLE':
        await this.invoiceOutcomeHandler.handleUncollectible(contractId, invoice.invoiceId, invoice.errorCode);
        break;
      case 'VOID':
        await this.invoiceOutcomeHandler.handleVoided(contractId, invoice.invoiceId, invoice.reason);
        break;
      case 'MANDATE_REJECTED':
        await this.invoiceOutcomeHandler.handleMandateRejected(contractId, invoice.invoiceId, invoice.errorCode);
        break;
      default:
        // DRAFT/OPEN/MANDATE_PENDING/ATTEMPTING/PAST_DUE — 아직 진행 중, 다음 주기 재확인
        this.logger.log(`[invoice-reconcile] 진행 중 상태 유지(대기): contractId=${contractId}, status=${invoice.status}`);
    }
    return invoice.status;
  }

  /**
   * 관리자 수동 트리거: 특정 INVOICE 계약을 즉시 권위 정합화한다(30분 크론을 기다리지 않음).
   * wallet 인보이스 권위 상태를 되물어 터미널이면 자격 반영, 비터미널이면 대기 상태를 그대로 보고한다.
   * 반환된 invoiceStatus 로 admin 이 구독(자격)↔인보이스(결제) 발산의 실제 원인을 확인한다.
   */
  async reconcileInvoiceForContract(
    contractId: string,
  ): Promise<{ contractId: string; periodStart: string; invoiceStatus: string | null }> {
    const contract = await this.billingReader.findContractById(contractId);
    if (!contract) {
      throw new SubscriptionNotFoundException();
    }
    if (contract.billingPath !== 'INVOICE') {
      throw new SubscriptionException(
        'INVOICE 경로 계약만 인보이스 정합화가 가능합니다(레거시 CHARGE 는 수동 재시도 사용).',
        'INVOICE_PATH_ONLY',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!contract.nextBillingDate) {
      throw new SubscriptionException(
        '현재 청구 주기(nextBillingDate)가 없어 정합화 대상이 아닙니다.',
        'NO_BILLING_PERIOD',
        HttpStatus.BAD_REQUEST,
      );
    }
    const invoiceStatus = await this.reconcileOneInvoice(contractId, contract.nextBillingDate);
    this.logger.log(
      `[invoice-reconcile] 관리자 수동 정합화: contractId=${contractId}, periodStart=${contract.nextBillingDate}, invoiceStatus=${invoiceStatus ?? '미발행'}`,
    );
    return { contractId, periodStart: contract.nextBillingDate, invoiceStatus };
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
        // 인보이스 계약은 CreateInvoice 재발행 — paid 가 nextBillingDate 를 전진시키기 전까지의
        // 일일 재발행(멱등)이 유실 reconcile 을 겸한다.
        const result =
          contract.billingPath === 'INVOICE'
            ? await this.invoiceBillingManager.issueInvoiceForContract(contract)
            : await this.billingManager.processSingleBilling(contract);
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
   *
   * 건강한 계약(미래 청구일·dunning 없음)에 발행하면 새 멱등키로 다음 주기 요금이 즉시
   * 실출금되므로, 재시도가 정당한 상태인지 먼저 검증한다.
   */
  async retryContractBilling(contractId: string): Promise<BillingResult> {
    const contract = await this.billingReader.findContractById(contractId);
    if (!contract) throw new SubscriptionNotFoundException();

    if (contract.status !== 'ACTIVE') {
      throw new SubscriptionException(
        `해지/만료된 계약에는 청구를 재시도할 수 없습니다. (status=${contract.status})`,
        'CONTRACT_NOT_ACTIVE',
        HttpStatus.CONFLICT,
      );
    }
    if (!contract.autoRenewal) {
      throw new SubscriptionException(
        '자동갱신이 꺼진 계약에는 청구를 재시도할 수 없습니다.',
        'AUTO_RENEWAL_DISABLED',
        HttpStatus.CONFLICT,
      );
    }
    if (contract.billingInProgress) {
      throw new SubscriptionException(
        '이미 청구가 진행 중입니다. 결과 확인 후 다시 시도하세요.',
        'BILLING_IN_PROGRESS',
        HttpStatus.CONFLICT,
      );
    }

    const dunning = await this.billingReader.findDunningByContractId(contractId);
    const today = format(new Date(), 'yyyy-MM-dd');
    const isDue = contract.nextBillingDate != null && contract.nextBillingDate <= today;
    if (!dunning && !isDue) {
      throw new SubscriptionException(
        `아직 청구 예정일이 아닙니다. (nextBillingDate=${contract.nextBillingDate ?? '-'}) 재시도하면 다음 주기 요금이 즉시 출금됩니다.`,
        'BILLING_NOT_DUE',
        HttpStatus.CONFLICT,
      );
    }

    // 인보이스 계약의 재시도는 wallet 이 소유 — 커맨드 재발행은 dedupe 로 무동작(거짓 성공)이라
    // 실제 동작하는 인보이스 탭 '즉시 집행'으로 안내한다.
    if (contract.billingPath === 'INVOICE') {
      throw new SubscriptionException(
        '인보이스 경로 계약입니다. 재시도는 [정기결제 관리 > 인보이스] 탭에서 해당 인보이스를 즉시 집행하세요.',
        'INVOICE_PATH_CONTRACT',
        HttpStatus.CONFLICT,
      );
    }

    return this.billingManager.processSingleBilling(contract, dunning?.attempts ?? 0);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
