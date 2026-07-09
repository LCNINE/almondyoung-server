import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { randomBytes } from 'node:crypto';
import { and, count, desc, eq, inArray, lt, lte } from 'drizzle-orm';
import { addMinutes, addHours, addDays, subHours } from 'date-fns';
import { WalletSchema, invoices, paymentIntents, paymentStateTransitions, InvoiceStatus } from '../schema';
import { Invoice, BillingMethod, PaymentIntent } from '../types';
import { BillingMethodService } from '../billing/billing-method.service';
import { BillingAgreementService } from '../billing/billing-agreement.service';
import { CmsMemberService } from '../cms/cms-member.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { ChargesService } from '../charges/charges.service';
import { AutoCaptureService } from '../payment-intents/auto-capture.service';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import { ChargeResult, PaymentProvider } from '../providers/payment-provider.interface';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
} from '../messaging/gateway-event.builder';
import { InvoiceOutcomeService } from './invoice-outcome.service';

/** 스캔 대상 상태 — Phase 1 CHECK 가 이 상태들의 next_attempt_at NOT NULL 을 강제한다. */
const SCHEDULABLE_STATUSES: InvoiceStatus[] = ['OPEN', 'MANDATE_PENDING', 'PAST_DUE'];
/** 클레임 리스(다중 인스턴스 중복 집행 방지) — 처리 실패 시 이 시간 뒤 자동 재스캔된다. */
const CLAIM_LEASE_MINUTES = 15;
/** CMS 심사(D+1) 대기 중 재확인 주기. member-poller 의 REGISTERED 훅이 이를 즉시로 당겨준다. */
const MANDATE_RECHECK_HOURS = 6;
/** ADR-0027 §10-2. 심사가 영영 안 끝나면 due_date 기준 이 일수 후 MANDATE_REJECTED 로 강등. */
const MANDATE_TIMEOUT_DAYS = 7;
/** 집행 중(ATTEMPTING) 인 채 갱신이 멎은 인보이스의 reconcile 임계. */
const ATTEMPTING_STALE_HOURS = 2;

const BATCH_LIMIT = 20;
const INTENT_EXPIRY_HOURS = 24;

/**
 * ADR-0027 §2/§3. 인보이스 집행기 — OPEN→(MANDATE_PENDING 대기)→ATTEMPTING→정산을 전담한다.
 * 각 출금 시도 = payment_intent 1건(invoice_id 로 연결), CMS D+1 정산은 기존
 * cms-settlement-poller 가 처리하고 invoice 반영은 InvoiceOutcomeService 훅으로 돌아온다.
 */
@Injectable()
export class InvoiceExecutorService {
  private readonly logger = new Logger(InvoiceExecutorService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly billingMethodService: BillingMethodService,
    private readonly billingAgreementService: BillingAgreementService,
    private readonly cmsMemberService: CmsMemberService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly chargesService: ChargesService,
    private readonly autoCaptureService: AutoCaptureService,
    private readonly stateTransitionService: StateTransitionService,
    private readonly invoiceOutcomeService: InvoiceOutcomeService,
  ) {}

  @Cron('0 */10 * * * *')
  async run(): Promise<void> {
    try {
      await this.processDueInvoices();
    } catch (err) {
      this.logger.error(`processDueInvoices failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      await this.reconcileStaleAttempting();
    } catch (err) {
      this.logger.error(`reconcileStaleAttempting failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 단건 즉시 집행 (admin trigger / 테스트). */
  async executeInvoiceById(invoiceId: string): Promise<void> {
    const [invoice] = await this.dbService.db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!invoice) throw new Error('Invoice not found: ' + invoiceId);
    if (!SCHEDULABLE_STATUSES.includes(invoice.status)) {
      throw new Error(`Invoice not schedulable (status=${invoice.status}): ` + invoiceId);
    }
    await this.processOne(invoice);
  }

  async processDueInvoices(): Promise<void> {
    const claimed = await this.claimBatch();
    if (claimed.length === 0) return;

    this.logger.log(`Processing ${claimed.length} due invoice(s)`);
    for (const invoice of claimed) {
      try {
        await this.processOne(invoice);
      } catch (err) {
        this.logger.error(
          `Invoice ${invoice.id} processing failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * FOR UPDATE SKIP LOCKED 로 due 인보이스를 확보하고 next_attempt_at 을 리스만큼 미뤄
   * 다른 인스턴스/다음 주기의 중복 집행을 막는다. 처리 로직이 죽어도 리스 만료 후 재스캔된다.
   */
  private async claimBatch(): Promise<Invoice[]> {
    return this.dbService.db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(invoices)
        .where(and(inArray(invoices.status, SCHEDULABLE_STATUSES), lte(invoices.nextAttemptAt, new Date())))
        .orderBy(invoices.nextAttemptAt)
        .limit(BATCH_LIMIT)
        .for('update', { skipLocked: true });

      if (due.length === 0) return [];

      const lease = addMinutes(new Date(), CLAIM_LEASE_MINUTES);
      await tx
        .update(invoices)
        .set({ nextAttemptAt: lease, updatedAt: new Date() })
        .where(
          inArray(
            invoices.id,
            due.map((r) => r.id),
          ),
        );
      return due;
    });
  }

  private async processOne(invoice: Invoice): Promise<void> {
    let billingMethod = await this.billingMethodService.findById(invoice.billingMethodId);
    let verdict = await this.evaluateBillingMethod(billingMethod);

    // 수단이 죽었어도 활성 agreement 가 다른 살아있는 수단을 가리키면 재지정 — 계좌 변경이 자격 회수로 번지지 않게.
    if (verdict.kind === 'REJECT') {
      const rerouted = await this.reResolveBillingMethod(invoice);
      if (rerouted) {
        billingMethod = rerouted;
        verdict = await this.evaluateBillingMethod(rerouted);
      }
    }

    switch (verdict.kind) {
      case 'REJECT':
        await this.invoiceOutcomeService.rejectMandate(invoice.id, verdict.code, verdict.message);
        return;
      case 'WAIT':
        await this.waitForMandate(invoice);
        return;
      case 'CHARGE':
        await this.attemptCharge(invoice, billingMethod!);
        return;
    }
  }

  private async evaluateBillingMethod(
    billingMethod: BillingMethod | undefined,
  ): Promise<{ kind: 'CHARGE' } | { kind: 'WAIT' } | { kind: 'REJECT'; code: string; message: string }> {
    if (!billingMethod || billingMethod.status !== 'ACTIVE') {
      return {
        kind: 'REJECT',
        code: 'BILLING_METHOD_NOT_ACTIVE',
        message: '결제수단이 삭제/해지되어 청구할 수 없습니다',
      };
    }
    if (billingMethod.providerType !== 'CMS_BATCH') {
      return { kind: 'CHARGE' };
    }
    const member = await this.cmsMemberService.findByBillingMethodId(billingMethod.id);
    if (!member || member.status === 'DELETED') {
      return { kind: 'REJECT', code: 'CMS_MEMBER_NOT_FOUND', message: 'CMS 회원등록 정보가 없습니다' };
    }
    if (member.status === 'FAILED') {
      return {
        kind: 'REJECT',
        code: member.resultCode ?? 'CMS_MEMBER_FAILED',
        message: member.resultMessage ?? 'CMS 계좌 심사 거절',
      };
    }
    if (member.status === 'PENDING') {
      return { kind: 'WAIT' };
    }
    // REGISTERED — 동의자료 상태는 provider authorize 가 재검증한다(미비 시 4xx 실패로 귀결).
    return { kind: 'CHARGE' };
  }

  /** 활성 agreement 가 다른 ACTIVE 수단을 가리키면 인보이스를 그 수단으로 재지정. */
  private async reResolveBillingMethod(invoice: Invoice): Promise<BillingMethod | null> {
    const agreement = await this.billingAgreementService.findBySubscriberRef(
      invoice.subscriberType,
      invoice.subscriberRef,
    );
    if (!agreement || agreement.billingMethodId === invoice.billingMethodId) return null;

    const method = await this.billingMethodService.findById(agreement.billingMethodId);
    if (!method || method.status !== 'ACTIVE') return null;

    const updated = await this.dbService.db
      .update(invoices)
      .set({ billingMethodId: method.id, updatedAt: new Date() })
      .where(and(eq(invoices.id, invoice.id), inArray(invoices.status, [...SCHEDULABLE_STATUSES, 'ATTEMPTING'])))
      .returning({ id: invoices.id });
    if (updated.length === 0) return null;

    this.logger.log(
      `Invoice ${invoice.id} billing method rerouted ${invoice.billingMethodId} → ${method.id} (계좌 변경 반영)`,
    );
    invoice.billingMethodId = method.id;
    return method;
  }

  /**
   * 결제수단 심사 대기(MANDATE_PENDING). 이 상태의 대기는 더닝이 아니다 —
   * attempt_count 를 올리지 않고 next_attempt_at 만 뒤로 민다(ADR §3-1).
   */
  private async waitForMandate(invoice: Invoice): Promise<void> {
    const mandateDeadline = addDays(new Date(`${invoice.dueDate}T00:00:00+09:00`), MANDATE_TIMEOUT_DAYS);
    if (new Date() > mandateDeadline) {
      await this.invoiceOutcomeService.rejectMandate(
        invoice.id,
        'MANDATE_TIMEOUT',
        `계좌 심사가 ${MANDATE_TIMEOUT_DAYS}일 내 완료되지 않았습니다`,
      );
      return;
    }

    await this.dbService.db
      .update(invoices)
      .set({
        status: 'MANDATE_PENDING',
        nextAttemptAt: addHours(new Date(), MANDATE_RECHECK_HOURS),
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, invoice.id), inArray(invoices.status, SCHEDULABLE_STATUSES)));

    this.logger.log(`Invoice ${invoice.id} MANDATE_PENDING — CMS 심사 대기 (recheck +${MANDATE_RECHECK_HOURS}h)`);
  }

  private async attemptCharge(invoice: Invoice, billingMethod: BillingMethod): Promise<void> {
    // 크래시/취소 복구: 이 인보이스의 최신 intent 가 아직 살아있으면 새 시도를 만들지 않는다.
    const latest = await this.findLatestIntent(invoice.id);
    if (latest) {
      if (latest.status === 'AUTHORIZED' || latest.status === 'CAPTURED' || latest.status === 'SUCCEEDED') {
        await this.invoiceOutcomeService.markPaid(invoice.id, latest.id);
        return;
      }
      if (latest.status !== 'FAILED' && latest.status !== 'CANCELED') {
        // CREATED/PROCESSING/PENDING_SETTLEMENT 등 진행 중 — 정산 폴러/다음 reconcile 이 처리
        await this.transitionToAttempting(invoice.id);
        this.logger.log(`Invoice ${invoice.id} has in-flight intent ${latest.id} (${latest.status}) — adopt & wait`);
        return;
      }
    }

    let provider: PaymentProvider;
    try {
      provider = this.providerRegistry.getProviderOrThrow(billingMethod.providerType);
    } catch {
      await this.invoiceOutcomeService.rejectMandate(
        invoice.id,
        'PROVIDER_NOT_FOUND',
        `Payment provider not supported: ${billingMethod.providerType}`,
      );
      return;
    }

    const claimed = await this.transitionToAttempting(invoice.id);
    if (!claimed) {
      this.logger.log(`Invoice ${invoice.id} no longer schedulable — skip charge`);
      return;
    }

    const paymentMethod = await this.billingMethodService.findOrCreateForBilling(
      billingMethod.userId,
      billingMethod.providerType,
      billingMethod.id,
    );

    // 시도 시퀀스 = 기존 intent 수 + 1. 멱등키(unique index)가 동시 중복 생성을 차단한다(ADR §3-2).
    const [seqRow] = await this.dbService.db
      .select({ value: count() })
      .from(paymentIntents)
      .where(eq(paymentIntents.invoiceId, invoice.id));
    const attemptSeq = Number(seqRow?.value ?? 0) + 1;
    const intentIdempotencyKey = `${invoice.idempotencyKey}:attempt:${attemptSeq}`;

    let intentId: string;
    try {
      const [created] = await this.dbService.db
        .insert(paymentIntents)
        .values({
          payableAmount: invoice.amountDue,
          currency: invoice.currency,
          status: 'CREATED',
          purpose: 'SUBSCRIPTION',
          userId: billingMethod.userId,
          paymentMethodId: paymentMethod.id,
          invoiceId: invoice.id,
          clientSecret: randomBytes(32).toString('hex'),
          returnUrl: null,
          // subscriberRef/Type 을 의도적으로 싣지 않는다 — 인보이스 경로의 결과 라우팅은
          // invoice.* 이벤트가 전담하고, 레거시 intent 이벤트 컨슈머가 이중 처리하면 안 된다.
          metadata: { invoiceId: invoice.id, idempotencyKey: intentIdempotencyKey },
          expiresAt: addHours(new Date(), INTENT_EXPIRY_HOURS),
          version: 0,
        })
        .returning();
      if (!created) throw new Error('PAYMENT_INTENT_INSERT_FAILED');
      intentId = created.id;
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') {
        this.logger.warn(`Invoice ${invoice.id} concurrent attempt blocked (key=${intentIdempotencyKey}) — skip`);
        return;
      }
      // intent 생성 실패 — 인보이스를 재스캔 가능 상태로 되돌린다(시도 미집계).
      await this.revertToSchedulable(invoice, addMinutes(new Date(), 30));
      throw err;
    }

    const correlationId = `invoice-executor:${intentIdempotencyKey}`;

    try {
      await this.stateTransitionService.transitionIntent(intentId, 'PROCESSING', {
        correlationId,
        triggeredByType: 'SYSTEM',
      });

      const charge = await this.chargesService.create({
        intentId,
        paymentMethodId: paymentMethod.id,
        amount: invoice.amountDue,
        currency: invoice.currency,
        operation: 'AUTHORIZE',
        status: 'CREATED',
        providerIdempotencyKey: `wallet:authorize:${intentId}:${paymentMethod.id}`,
        requestPayload: {
          intentId,
          paymentMethodId: paymentMethod.id,
          billingMethodId: billingMethod.id,
          invoiceId: invoice.id,
        },
      });

      let result: ChargeResult;
      try {
        result = await provider.authorize({
          chargeId: charge.id,
          intentId,
          paymentMethodId: paymentMethod.id,
          userId: billingMethod.userId,
          amount: invoice.amountDue,
          currency: invoice.currency,
          idempotencyKey: this.chargesService.generateIdempotencyKey(charge.id, 'AUTHORIZE'),
          correlationId,
          providerData: { billingMethodId: billingMethod.id },
          metadata: { invoiceId: invoice.id },
        });
      } catch (err) {
        // 5xx/네트워크 — 진짜 실패로 세지 않는다. intent 를 CANCELED 로 닫아야
        // revert 전 크래시 시 reconcile 이 미집계 재스케줄 분기를 탄다(FAILED 는 attempt 집계).
        const msg = err instanceof Error ? err.message : String(err);
        await this.chargesService.updateStatus(charge.id, 'FAILED', {
          errorCode: 'PROVIDER_EXCEPTION',
          errorMessage: msg,
        });
        await this.stateTransitionService.transitionIntent(intentId, 'CANCELED', {
          correlationId,
          reasonCode: 'PROVIDER_EXCEPTION',
          reasonMessage: msg,
        });
        await this.revertToSchedulable(invoice, addMinutes(new Date(), 30));
        this.logger.error(`Invoice ${invoice.id} provider exception — retry in 30m: ${msg}`);
        return;
      }

      await this.handleAuthorizeResult(invoice, intentId, charge.id, billingMethod.userId, result, correlationId);
    } catch (err) {
      // 예기치 못한 내부 오류 — 인보이스를 재스캔 가능 상태로 복구해 stuck 을 막는다.
      await this.revertToSchedulable(invoice, addMinutes(new Date(), 30));
      throw err;
    }
  }

  private async handleAuthorizeResult(
    invoice: Invoice,
    intentId: string,
    chargeId: string,
    userId: string,
    result: ChargeResult,
    correlationId: string,
  ): Promise<void> {
    const now = new Date().toISOString();

    switch (result.status) {
      case 'SUCCEEDED': {
        await this.dbService.db.transaction(async (tx) => {
          await this.chargesService.updateStatus(
            chargeId,
            'SUCCEEDED',
            { providerTransactionId: result.providerTransactionId, responsePayload: result.raw },
            tx,
          );
          await this.stateTransitionService.transitionIntent(
            intentId,
            'AUTHORIZED',
            {
              correlationId,
              reasonCode: 'AUTHORIZE_SUCCEEDED',
              outboxEvent: {
                eventType: GatewayEventType.INTENT_AUTHORIZED,
                aggregateType: GATEWAY_AGGREGATE_TYPE,
                aggregateId: intentId,
                payload: buildPaymentIntentEventPayload({
                  intentId,
                  userId,
                  status: 'AUTHORIZED',
                  payableAmount: invoice.amountDue,
                  currency: invoice.currency,
                  occurredAt: now,
                  extra: { invoiceId: invoice.id },
                }),
              },
            },
            undefined,
            tx,
          );
        });
        await this.autoCaptureService.attemptAutoCapture(intentId, correlationId);
        await this.invoiceOutcomeService.markPaid(invoice.id, intentId);
        return;
      }

      case 'PENDING': {
        // CMS 배치: D+1 정산 대기. 인보이스는 ATTEMPTING 을 유지하고
        // cms-settlement-poller 의 invoice 훅이 결과를 반영한다.
        await this.dbService.db.transaction(async (tx) => {
          await this.chargesService.updateStatus(
            chargeId,
            'PENDING',
            { providerTransactionId: result.providerTransactionId, responsePayload: result.raw },
            tx,
          );
          await this.stateTransitionService.transitionIntent(
            intentId,
            'PENDING_SETTLEMENT',
            {
              correlationId,
              reasonCode: 'PENDING_SETTLEMENT',
              reasonMessage: 'Awaiting external settlement result (CMS batch)',
            },
            undefined,
            tx,
          );
        });
        this.logger.log(`Invoice ${invoice.id} attempt pending settlement (intentId=${intentId})`);
        return;
      }

      default: {
        // FAILED — 4xx/비즈니스 오류: 진짜 실패로 집계(PAST_DUE/UNCOLLECTIBLE 전이 + 이벤트).
        await this.dbService.db.transaction(async (tx) => {
          await this.chargesService.updateStatus(
            chargeId,
            'FAILED',
            {
              errorCode: result.errorCode ?? 'PROVIDER_FAILED',
              errorMessage: result.errorMessage ?? 'Provider authorization failed',
              responsePayload: result.raw,
            },
            tx,
          );
          await this.stateTransitionService.transitionIntent(
            intentId,
            'FAILED',
            {
              correlationId,
              reasonCode: result.errorCode ?? 'INVOICE_CHARGE_FAILED',
              reasonMessage: result.errorMessage ?? 'Invoice charge authorization failed',
              outboxEvent: {
                eventType: GatewayEventType.INTENT_FAILED,
                aggregateType: GATEWAY_AGGREGATE_TYPE,
                aggregateId: intentId,
                payload: buildPaymentIntentEventPayload({
                  intentId,
                  userId,
                  status: 'FAILED',
                  payableAmount: invoice.amountDue,
                  currency: invoice.currency,
                  occurredAt: now,
                  extra: { invoiceId: invoice.id, errorCode: result.errorCode, errorMessage: result.errorMessage },
                }),
              },
            },
            undefined,
            tx,
          );
        });
        await this.invoiceOutcomeService.registerAttemptFailure(
          invoice.id,
          intentId,
          result.errorCode ?? 'PROVIDER_FAILED',
          result.errorMessage ?? 'Provider authorization failed',
        );
        return;
      }
    }
  }

  /** ATTEMPTING 고착 인보이스를 최신 intent 권위 상태로 정합화 — 훅/크래시 간극의 안전망. */
  async reconcileStaleAttempting(): Promise<void> {
    const stale = await this.dbService.db
      .select()
      .from(invoices)
      .where(
        and(eq(invoices.status, 'ATTEMPTING'), lt(invoices.updatedAt, subHours(new Date(), ATTEMPTING_STALE_HOURS))),
      )
      .limit(BATCH_LIMIT);

    for (const invoice of stale) {
      try {
        const latest = await this.findLatestIntent(invoice.id);
        if (!latest) {
          this.logger.warn(`[reconcile] Invoice ${invoice.id} ATTEMPTING without intent — revert to schedulable`);
          await this.revertToSchedulable(invoice, new Date());
          continue;
        }
        switch (latest.status) {
          case 'AUTHORIZED':
          case 'CAPTURED':
          case 'SUCCEEDED':
            await this.invoiceOutcomeService.markPaid(invoice.id, latest.id);
            break;
          case 'FAILED':
            await this.invoiceOutcomeService.registerAttemptFailure(
              invoice.id,
              latest.id,
              'RECONCILED_FAILED',
              'intent 권위 상태로 확인된 실패(집행 훅 유실 정합화)',
            );
            break;
          case 'CANCELED': {
            // 집행기 내부의 일시 오류 취소는 미집계 재스케줄, 관리자/사용자의 명시 취소는 VOID 종결 —
            // 전이 기록의 reasonCode 로 구분한다.
            const transient = await this.isTransientCancel(latest.id);
            if (transient) {
              this.logger.warn(
                `[reconcile] Invoice ${invoice.id} intent ${latest.id} CANCELED(transient) — reschedule`,
              );
              await this.revertToSchedulable(invoice, new Date());
            } else {
              this.logger.warn(
                `[reconcile] Invoice ${invoice.id} intent ${latest.id} CANCELED(explicit) — void invoice (관리자/사용자 취소 존중)`,
              );
              await this.invoiceOutcomeService.voidAfterExplicitCancel(invoice.id, latest.id);
            }
            break;
          }
          case 'CREATED':
          case 'PROCESSING':
            // provider 호출 전후 크래시로 영영 안 끝나는 in-flight — 닫지 않으면 인보이스가
            // ATTEMPTING 에 영구 고착된다. 미집계 터미널(CANCELED)로 닫고 재스케줄.
            this.logger.warn(
              `[reconcile] Invoice ${invoice.id} stuck in-flight intent ${latest.id} (${latest.status}) — cancel & reschedule`,
            );
            await this.stateTransitionService.transitionIntent(latest.id, 'CANCELED', {
              correlationId: `invoice-reconcile:${invoice.id}`,
              reasonCode: 'INVOICE_ATTEMPT_STUCK',
              reasonMessage: `Intent stuck in ${latest.status} beyond ${ATTEMPTING_STALE_HOURS}h`,
              triggeredByType: 'SYSTEM',
            });
            await this.revertToSchedulable(invoice, new Date());
            break;
          default:
            // PENDING_SETTLEMENT 등 정산 대기 — cms-settlement-poller 가 소유, 대기
            break;
        }
      } catch (err) {
        this.logger.error(
          `[reconcile] Invoice ${invoice.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** intent CANCELED 가 집행기 내부의 일시 오류 취소인지(재스케줄 대상) 전이 기록으로 판정. */
  private async isTransientCancel(intentId: string): Promise<boolean> {
    const [transition] = await this.dbService.db
      .select({ reasonCode: paymentStateTransitions.reasonCode })
      .from(paymentStateTransitions)
      .where(
        and(
          eq(paymentStateTransitions.entityType, 'INTENT'),
          eq(paymentStateTransitions.entityId, intentId),
          eq(paymentStateTransitions.newStatus, 'CANCELED'),
        ),
      )
      .orderBy(desc(paymentStateTransitions.occurredAt))
      .limit(1);
    return transition?.reasonCode === 'PROVIDER_EXCEPTION' || transition?.reasonCode === 'INVOICE_ATTEMPT_STUCK';
  }

  private async findLatestIntent(invoiceId: string): Promise<PaymentIntent | undefined> {
    const rows = await this.dbService.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.invoiceId, invoiceId))
      .orderBy(desc(paymentIntents.createdAt))
      .limit(1);
    return rows[0];
  }

  /** 스케줄 상태 → ATTEMPTING (집행 클레임). 이미 벗어났으면 false. */
  private async transitionToAttempting(invoiceId: string): Promise<boolean> {
    const rows = await this.dbService.db
      .update(invoices)
      .set({ status: 'ATTEMPTING', nextAttemptAt: null, updatedAt: new Date() })
      .where(and(eq(invoices.id, invoiceId), inArray(invoices.status, [...SCHEDULABLE_STATUSES, 'ATTEMPTING'])))
      .returning({ id: invoices.id });
    return rows.length > 0;
  }

  /** 집행 중 오류 시 재스캔 가능 상태로 복구 — attempt_count 는 확정 실패에서만 증가한다. */
  private async revertToSchedulable(invoice: Invoice, nextAttemptAt: Date): Promise<void> {
    const fallbackStatus: InvoiceStatus = invoice.attemptCount > 0 ? 'PAST_DUE' : 'OPEN';
    await this.dbService.db
      .update(invoices)
      .set({ status: fallbackStatus, nextAttemptAt, updatedAt: new Date() })
      .where(and(eq(invoices.id, invoice.id), inArray(invoices.status, ['ATTEMPTING', ...SCHEDULABLE_STATUSES])));
  }
}
