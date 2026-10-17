import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, eq, gt, inArray, lt, sql, SQL } from 'drizzle-orm';
import {
  WalletSchema,
  charges as chargesTable,
  refunds,
  paymentIntents,
  paymentStateTransitions,
  paymentMethods as paymentMethodsTable,
  RefundExecution,
  RefundKind,
} from '../schema';
import { pgCancelReason } from './refund-kind';
import { Charge, DbTx, PaymentMethod, Refund } from '../types';
import { ChargesService } from '../charges/charges.service';
import { CashReceiptsService } from '../cash-receipts/cash-receipts.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { refundRefusal } from './refund-refusal';
import { isManuallyConfirmable } from './manual-confirmable';
import { ProviderRegistry } from '../providers/provider.registry';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import { DEFAULT_PAYMENT_PROVIDER_DESCRIPTORS, PaymentProviderDescriptor } from '../providers/provider-descriptors';
import { GatewayEventType, buildRefundEventPayload } from '../messaging/gateway-event.builder';
import { CreateRefundDto } from './dto';
import { splitRefundOverRemaining } from './refund-plan';
import { ledgerLegChargeId } from '../charges/ledger-leg';

/**
 * 이 결제수단을 wallet 이 자동으로 환불할 수 있는가 — provider 기술자에 'refund' capability 가 있는가.
 * 기술자를 모르는 수단은 안전한 쪽(수동 처리)으로 판정한다. getRefundability·createByIntent 가 같은 규칙을 쓴다.
 */
function supportsAutoRefund(methodType: string): boolean {
  const descriptor: PaymentProviderDescriptor | undefined = DEFAULT_PAYMENT_PROVIDER_DESCRIPTORS.find(
    (d) => d.code === methodType,
  );
  return descriptor !== undefined && descriptor.capabilities.includes('refund');
}

/**
 * 결제사 응답이 끊긴 환불(FAILED·PROVIDER_EXCEPTION)을 같은 키로 다시 보낼 수 있는 기간. 토스 멱등 키가 15일이라 하루 여유를 둔다.
 * 이보다 오래된 행은 지금처럼 무시한다 — 기존 결제·환불 건은 처리된 것으로 간주(2026-10-11 결정).
 */
export const AMBIGUOUS_RESEND_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * AUTO PENDING 이 이만큼 갱신이 없으면 멈춘 것으로 본다 — provider 호출 도중 프로세스가 죽었다(배포 교체 등).
 * 토스 호출이 매달릴 수 있는 최장(undici 기본 headers·body 각 300초)의 세 배라, 진행 중인 호출을 집지 않는다.
 */
export const STUCK_PENDING_AFTER_MS = 30 * 60 * 1000;
/** 같은 키로 다시 보낼 때 추가 정보가 필요 없는 수단. 무통장은 고객 계좌가 필요한데 저장하지 않는다 */
const RESENDABLE_METHOD_TYPES = ['TOSS', 'POINTS'] as const;
/** 요청 경로가 «같은 행·같은 키»로 되살릴 수 있는 수단 — 멱등 키를 보내는 provider 만(나이스는 키가 없어 같은 키가 성립하지 않는다) */
const RESUMABLE_METHOD_TYPES = [...RESENDABLE_METHOD_TYPES, 'BANK_TRANSFER'] as const;
/** 토스 409 — 「이전 멱등 요청이 처리중」(토스 문서). 다시 요청해 응답을 확인하라는 뜻이라 결과를 «모르는» 상태로 센다 */
const TOSS_IDEMPOTENT_PROCESSING_CODE = 'IDEMPOTENT_REQUEST_PROCESSING';

type DispatchContext = {
  charge: Charge;
  method: PaymentMethod;
  userId: string;
  refundReceiveAccount?: CreateRefundDto['refundReceiveAccount'];
};

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly chargesService: ChargesService,
    private readonly cashReceiptsService: CashReceiptsService,
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

  /** 환불 성공 시 발급된 현금영수증을 환불금액만큼 취소. best-effort — 실패해도 환불은 유지. */
  private async cancelCashReceiptBestEffort(chargeId: string, amount: number): Promise<void> {
    try {
      await this.cashReceiptsService.cancelForRefund(chargeId, amount);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Cash receipt cancel-on-refund failed (refund kept): charge=${chargeId}, error=${message}`);
    }
  }

  /**
   * 결제분 하나를 환불한다. execution = MANUAL 이면 provider 를 부르지 않고 «송금 대기»(PENDING) 행만 남긴다 —
   * 운영자가 고객 계좌로 송금한 뒤 confirmManual 로 닫는다. PENDING 은 남은 금액에서 이미 빠지므로 같은 돈이 두 번 나가지 않는다.
   */
  async create(dto: CreateRefundDto, options: { execution?: RefundExecution } = {}): Promise<Refund> {
    const execution: RefundExecution = options.execution ?? 'AUTO';
    // 1. Early validation (no lock needed)
    const charge = await this.chargesService.findById(dto.chargeId);
    if (!charge) {
      throw new NotFoundException(refundRefusal('CHARGE_NOT_FOUND', `Charge not found: ${dto.chargeId}`));
    }
    if (dto.intentId && charge.intentId !== dto.intentId) {
      throw new BadRequestException(
        refundRefusal('CHARGE_INTENT_MISMATCH', `Charge ${dto.chargeId} does not belong to intent ${dto.intentId}`),
      );
    }
    if (charge.status !== 'SUCCEEDED') {
      throw new BadRequestException(
        refundRefusal('CHARGE_NOT_REFUNDABLE', `Charge is not in a refundable state: ${charge.status}`),
      );
    }
    if (dto.amount > charge.amount) {
      throw new BadRequestException(
        refundRefusal(
          'REFUND_AMOUNT_EXCEEDS_CHARGE',
          `Refund amount (${dto.amount}) exceeds charge amount (${charge.amount})`,
        ),
      );
    }
    await this.assertRefundable(charge.intentId, dto.allowMembershipRefund);

    const method = await this.paymentMethodsService.findById(charge.paymentMethodId);
    if (!method) {
      throw new NotFoundException(
        refundRefusal('PAYMENT_METHOD_NOT_FOUND', `Payment method not found: ${charge.paymentMethodId}`),
      );
    }
    // 내부 불변식 — 포인트 leg 는 항상 AUTO(원장 REDEEM_CANCEL). MANUAL 로 만들면 confirmManual 이
    // 원장 환불 없이 SUCCEEDED 로 닫아 고객이 포인트를 돌려받지 못한다. 클라이언트 거절이 아니라 500.
    if (execution === 'MANUAL' && method.type === 'POINTS') {
      throw new Error(`포인트 결제분은 수동 실행할 수 없다 — 포인트는 원장으로 자동 환불한다 (charge ${charge.id})`);
    }
    const userId = await this.getIntentUserId(charge.intentId);
    if (!userId) {
      throw new NotFoundException(refundRefusal('INTENT_NOT_FOUND', `Intent not found for charge: ${charge.id}`));
    }

    // 2. Lock charge row → (응답 끊긴 이전 환불이 있으면 그 행을 되살린다) → 아니면 re-check available + insert
    const { refund, resumed } = await this.dbService.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${chargesTable} WHERE id = ${charge.id} FOR UPDATE`);

      // 돈이 나갔는지 모르는 행이 있으면 새 환불을 만들지 않는다 — 새 행은 새 멱등 키라 토스가 같은 돈을 또 보낸다.
      // 그 행을 PENDING 으로 되살려(남은 금액에서 빠진다) 같은 키로 다시 보낸다. MANUAL 요청은 PG 를 안 부르니 해당 없다
      if (execution === 'AUTO') {
        const ambiguous = await this.oldestAmbiguousInTx(charge.id, tx);
        if (ambiguous) {
          const pending = await this.resumeAmbiguousInTx(ambiguous, method, !!dto.refundReceiveAccount, tx);
          return { refund: pending, resumed: true };
        }
      }

      const alreadyRefunded = await this.getRefundedTotalInTx(charge.id, tx);
      const available = charge.amount - alreadyRefunded;
      if (dto.amount > available) {
        throw new BadRequestException(
          refundRefusal(
            'REFUND_AMOUNT_EXCEEDS_AVAILABLE',
            `Refund amount (${dto.amount}) exceeds available refundable amount (${available})`,
          ),
        );
      }

      const inserted = await tx
        .insert(refunds)
        .values({
          chargeId: charge.id,
          intentId: charge.intentId,
          amount: dto.amount,
          currency: charge.currency,
          status: 'PENDING',
          reasonCode: dto.reasonCode ?? null,
          reasonMessage: dto.reasonMessage ?? null,
          providerRefundId: null,
          execution,
          kind: dto.kind ?? null,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error('REFUND_INSERT_FAILED');
      return { refund: row, resumed: false };
    });

    if (resumed) {
      const resolved = await this.dispatch(refund, {
        charge,
        method,
        userId,
        refundReceiveAccount: dto.refundReceiveAccount,
      });
      // 같은 금액 = 같은 정산의 재시도(리컨실러 재발행이 거의 전부). 그 행의 결과가 이번 요청의 결과다
      if (resolved.amount === dto.amount) return resolved;
      // 금액이 다르면 이번 요청은 옛 행의 결과를 모른 채 계산됐다 — 합쳐 보내면 이중 환불. 장부를 다시 맞춘 다음 시도에 맡긴다
      throw new BadRequestException(
        this.ambiguousOutcomeRefusal(
          [resolved],
          `charge ${charge.id}: resent ambiguous refund ${resolved.id} (${resolved.amount}) → ${resolved.status}; requested ${dto.amount} not sent`,
        ),
      );
    }

    if (execution === 'MANUAL') {
      this.logger.log(
        `Manual refund awaiting transfer: refundId=${refund.id} charge=${charge.id} amount=${dto.amount}`,
      );
      return refund;
    }

    return this.dispatch(refund, { charge, method, userId, refundReceiveAccount: dto.refundReceiveAccount });
  }

  /**
   * 환불 행 하나를 provider 에 보내고 결과를 그 행에 적는다. 멱등 키는 행 id 에서 나온다(`wallet:refund:<id>`) — 같은 행을 다시 보내면
   * 토스는 첫 요청이 처리됐으면 그 응답을, 아니면 이제 처리한다(멱등키 15일). 포인트 원장도 같은 키로 멱등이다.
   * 그래서 «돈이 나갔는지 모르는» 행은 새 행이 아니라 이 함수로 같은 행을 다시 보낸다(#1016 36번 마무리 ①③).
   */
  private async dispatch(refund: Refund, ctx: DispatchContext): Promise<Refund> {
    const { charge, method, userId } = ctx;
    const correlationId = `refund:${refund.id}:${Date.now()}`;
    const provider = this.providerRegistry.getProviderOrThrow(method.type);
    const idempotencyKey = `wallet:refund:${refund.id}`;

    let providerResult: Awaited<ReturnType<typeof provider.refund>>;
    try {
      providerResult = await provider.refund({
        refundId: refund.id,
        chargeId: charge.id,
        authorizeChargeId: ledgerLegChargeId(charge),
        intentId: charge.intentId,
        userId,
        amount: refund.amount,
        currency: charge.currency,
        idempotencyKey,
        correlationId,
        cancelReason: pgCancelReason(refund),
        providerData: method.providerData,
        refundReceiveAccount: ctx.refundReceiveAccount,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Provider refund threw: refundId=${refund.id}, error=${message}`);
      // reasonCode는 관리자가 입력한 환불 사유를 보존. PG 오류는 reasonMessage에 추가하고 state_transitions에 기록
      await this.dbService.db
        .update(refunds)
        .set({
          reasonMessage: message.slice(0, 500),
          // 응답이 안 왔다 — 돈이 나갔는지 모른다. 일시로 두면 정산이 장부를 다시 맞춘 뒤 이어 간다(스펙 §6.2)
          failureCode: 'PROVIDER_EXCEPTION',
          failureRetryable: true,
          updatedAt: new Date(),
        })
        .where(eq(refunds.id, refund.id));
      await this.stateTransitionService.transitionRefund(refund.id, 'FAILED', {
        correlationId,
        reasonCode: 'PROVIDER_EXCEPTION',
        reasonMessage: message,
      });
      return this.findByIdOrThrow(refund.id);
    }

    const now = new Date().toISOString();

    if (providerResult.status === 'SUCCEEDED') {
      const notifyExtra = await this.getRefundNotifyExtra(charge.intentId);
      await this.dbService.db.transaction(async (tx) => {
        // Keep provider metadata, then let the state machine perform PENDING -> SUCCEEDED.
        await tx
          .update(refunds)
          .set({
            providerRefundId: providerResult.providerRefundId ?? null,
            // 되살린 «응답 끊긴» 행이 성공으로 끝났다 — 실패 표시를 지운다(되살리기 대상에서도 빠진다)
            failureCode: null,
            failureRetryable: null,
            updatedAt: new Date(),
          })
          .where(eq(refunds.id, refund.id));

        // Record the transition with outbox event
        await this.stateTransitionService.transitionRefund(
          refund.id,
          'SUCCEEDED',
          {
            correlationId,
            reasonCode: 'REFUND_SUCCEEDED',
            outboxEvent: {
              eventType: GatewayEventType.REFUND_SUCCEEDED,
              aggregateId: refund.id,
              payload: buildRefundEventPayload({
                refundId: refund.id,
                chargeId: charge.id,
                intentId: charge.intentId,
                userId,
                status: 'SUCCEEDED',
                amount: refund.amount,
                currency: charge.currency,
                reasonCode: refund.reasonCode ?? null,
                occurredAt: now,
                extra: notifyExtra,
              }),
            },
          },
          'PENDING',
          tx,
        );

        // If all charge amount is now covered by SUCCEEDED refunds, mark charge as REFUNDED.
        const succeededTotal = await this.getSucceededRefundedTotalInTx(charge.id, tx);
        if (succeededTotal >= charge.amount) {
          await this.stateTransitionService.transitionCharge(
            charge.id,
            'REFUNDED',
            { correlationId, reasonCode: 'FULLY_REFUNDED' },
            'SUCCEEDED',
            tx,
          );
        }
      });
      await this.cancelCashReceiptBestEffort(charge.id, refund.amount);
    } else if (providerResult.status === 'PENDING') {
      // PG 를 안 부른 수동 폴백(무통장 계좌 없음 등)은 MANUAL 송금 대기다 — Medusa 장부 맞추기가 넣고, 환불 내역이 [완료 처리]를 띄운다.
      // AUTO 로 두면 «진행 중»으로 읽혀 정산이 멈추고(D8) 고객에겐 «환불 완료»로 보인다(#1016 36번 마무리 ②)
      await this.dbService.db
        .update(refunds)
        .set({ ...(providerResult.manualTransfer ? { execution: 'MANUAL' as const } : {}), updatedAt: new Date() })
        .where(eq(refunds.id, refund.id));
    } else {
      // FAILED
      // 토스가 «이전 요청 처리중»이라 답했다 — 첫 요청의 결과를 아직 모른다. 응답 끊김과 같이 취급해야 새 행(새 키)이 안 생긴다
      const stillProcessing = providerResult.errorCode === TOSS_IDEMPOTENT_PROCESSING_CODE;
      const failCode = stillProcessing ? 'PROVIDER_EXCEPTION' : (providerResult.errorCode ?? 'REFUND_FAILED');
      const failMessage = stillProcessing
        ? `${TOSS_IDEMPOTENT_PROCESSING_CODE}: ${providerResult.errorMessage ?? ''}`.trim()
        : (providerResult.errorMessage ?? null);
      // reasonCode는 관리자가 입력한 환불 사유를 보존. PG 오류는 reasonMessage에 기록
      await this.dbService.db
        .update(refunds)
        .set({
          reasonMessage: failMessage,
          failureCode: failCode,
          // provider 가 영구/일시를 정한다(토스 코드표 등). 모르면 일시 — 스펙 §6.5
          failureRetryable: stillProcessing ? true : (providerResult.retryable ?? true),
          updatedAt: new Date(),
        })
        .where(eq(refunds.id, refund.id));
      await this.stateTransitionService.transitionRefund(refund.id, 'FAILED', {
        correlationId,
        reasonCode: failCode,
        reasonMessage: failMessage ?? undefined,
      });
    }

    return this.findByIdOrThrow(refund.id);
  }

  /**
   * «응답 끊긴» 환불의 조건 — FAILED·PROVIDER_EXCEPTION·AUTO, 14일 안(MANUAL 은 PG 를 부르지 않는다), 멱등 키를 보내는 수단.
   * 한 곳에서만 정한다
   */
  private ambiguousWhere(scope: SQL) {
    // 서브쿼리는 sql 로 쓴다 — 빌더를 부르면 DbService 를 목으로 쓰는 유닛 스펙이 깨진다(바인딩은 문자열뿐, Date 없음)
    const resumableCharges = sql`(SELECT ${chargesTable.id} FROM ${chargesTable} INNER JOIN ${paymentMethodsTable} ON ${paymentMethodsTable.id} = ${chargesTable.paymentMethodId} WHERE ${inArray(paymentMethodsTable.type, [...RESUMABLE_METHOD_TYPES])})`;
    return and(
      scope,
      sql`${refunds.chargeId} IN ${resumableCharges}`,
      eq(refunds.status, 'FAILED'),
      eq(refunds.failureCode, 'PROVIDER_EXCEPTION'),
      eq(refunds.execution, 'AUTO'),
      gt(refunds.createdAt, new Date(Date.now() - AMBIGUOUS_RESEND_WINDOW_MS)),
    );
  }

  /** 이 결제분의 «응답 끊긴» 환불 중 가장 오래된 것 */
  private async oldestAmbiguousInTx(chargeId: string, tx: DbTx): Promise<Refund | null> {
    const rows = await tx
      .select()
      .from(refunds)
      .where(this.ambiguousWhere(eq(refunds.chargeId, chargeId)))
      .orderBy(asc(refunds.createdAt), asc(refunds.id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 응답 끊긴 행을 PENDING 으로 되살린다(결제분 잠금 안에서 부를 것). 무통장은 다시 보낼 계좌가 있어야 한다 */
  private async resumeAmbiguousInTx(
    ambiguous: Refund,
    method: PaymentMethod,
    hasAccount: boolean,
    tx: DbTx,
  ): Promise<Refund> {
    if (method.type === 'BANK_TRANSFER' && !hasAccount) {
      throw new BadRequestException(
        refundRefusal(
          'AMBIGUOUS_REFUND_NEEDS_ACCOUNT',
          `refund ${ambiguous.id} on charge ${ambiguous.chargeId} needs refundReceiveAccount to resend`,
        ),
      );
    }
    await this.stateTransitionService.transitionRefund(
      ambiguous.id,
      'PENDING',
      { correlationId: `ambiguous-resend:${ambiguous.id}`, reasonCode: 'AMBIGUOUS_RESEND' },
      'FAILED',
      tx,
    );
    return { ...ambiguous, status: 'PENDING' as const };
  }

  /** 다시 보낸 행이 또 끊겼으면 아직 모른다(UNRESOLVED), 아니면 결과를 확인했다(RESOLVED) */
  private ambiguousOutcomeRefusal(resent: Refund[], detail: string) {
    const stillUnknown = resent.some((r) => r.status === 'FAILED' && r.failureCode === 'PROVIDER_EXCEPTION');
    return refundRefusal(stillUnknown ? 'AMBIGUOUS_REFUND_UNRESOLVED' : 'AMBIGUOUS_REFUND_RESOLVED', detail);
  }

  /**
   * 계획이 검증된 뒤, 첫 leg 로 돈을 움직이기 «전에» 응답 끊긴 이전 환불을 정리한다. leg 단위(create)에서 하면 앞 leg 가 이미 나간 뒤
   * 거절이 나서 요청 금액보다 더 환불된다. 흔한 경우(끊긴 행 1개 = 이번 계획 1 leg 와 같은 결제분·금액)만 create 가 되살리게 둔다.
   * 그 밖에는 끊긴 행을 전부 같은 키로 다시 보내고(새 leg 없이) 거절한다 — 장부를 다시 맞춘 다음 시도에 맡긴다.
   */
  private async settleAmbiguousBeforePlan(
    intentId: string,
    plan: { chargeId: string; amount: number; execution: RefundExecution }[],
    refundReceiveAccount: CreateRefundDto['refundReceiveAccount'] | undefined,
  ): Promise<void> {
    if (plan.every((leg) => leg.execution === 'MANUAL')) return;
    const rows = await this.dbService.db
      .select()
      .from(refunds)
      .where(this.ambiguousWhere(eq(refunds.intentId, intentId)))
      .orderBy(asc(refunds.createdAt), asc(refunds.id));
    if (rows.length === 0) return;
    const only = rows[0];
    if (
      rows.length === 1 &&
      plan.length === 1 &&
      plan[0].chargeId === only.chargeId &&
      plan[0].amount === only.amount
    ) {
      return;
    }

    const targets: { row: Refund; charge: Charge; method: PaymentMethod; userId: string }[] = [];
    for (const row of rows) {
      const charge = await this.chargesService.findById(row.chargeId);
      const method = charge ? await this.paymentMethodsService.findById(charge.paymentMethodId) : null;
      const userId = charge ? await this.getIntentUserId(charge.intentId) : null;
      if (!charge || !method || !userId) {
        // 못 읽은 행은 다시 보내지 못한다 — 조용히 넘기면 이 행이 «없는 것»처럼 계획이 나간다
        this.logger.error(
          `[settleAmbiguousBeforePlan] 끊긴 환불을 다시 보낼 수 없다 — refund=${row.id} charge=${charge ? 'ok' : '없음'} method=${method ? 'ok' : '없음'} user=${userId ? 'ok' : '없음'}`,
        );
        continue;
      }
      if (method.type === 'BANK_TRANSFER' && !refundReceiveAccount) {
        throw new BadRequestException(
          refundRefusal(
            'AMBIGUOUS_REFUND_NEEDS_ACCOUNT',
            `refund ${row.id} on charge ${row.chargeId} needs refundReceiveAccount to resend`,
          ),
        );
      }
      targets.push({ row, charge, method, userId });
    }

    const resent: Refund[] = [];
    for (const { row, charge, method, userId } of targets) {
      const pending = await this.dbService.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM ${chargesTable} WHERE id = ${charge.id} FOR UPDATE`);
        return this.resumeAmbiguousInTx(row, method, !!refundReceiveAccount, tx);
      });
      resent.push(await this.dispatch(pending, { charge, method, userId, refundReceiveAccount }));
    }
    throw new BadRequestException(
      this.ambiguousOutcomeRefusal(
        resent,
        `intent ${intentId}: resent ${resent.map((r) => `${r.id}(${r.amount})→${r.status}`).join(', ')}; requested plan not sent`,
      ),
    );
  }

  async createByIntent(
    intentId: string,
    dto: {
      amount: number;
      reasonCode?: string;
      reasonMessage?: string;
      kind?: RefundKind;
      allowMembershipRefund?: boolean;
      refundReceiveAccount?: CreateRefundDto['refundReceiveAccount'];
      execution?: RefundExecution;
    },
  ): Promise<Refund[]> {
    const refundableCharges = await this.chargesService.findRefundableByIntent(intentId);
    if (refundableCharges.length === 0) {
      const succeededRefunds = await this.findSucceededRefundsByIntent(intentId);
      const succeededTotal = succeededRefunds.reduce((sum, refund) => sum + refund.amount, 0);
      if (succeededTotal >= dto.amount) {
        return succeededRefunds;
      }

      throw new NotFoundException(
        refundRefusal('REFUNDABLE_CHARGE_NOT_FOUND', `No refundable charge found for intent: ${intentId}`),
      );
    }

    // 계획을 먼저 세우고 검증이 끝난 뒤에만 돈을 움직인다. 집행 도중의 실패는 앞 leg 를 되돌릴 수 없다
    // (포인트 환불엔 역연산이 없고, PG 환불은 재청구가 안 된다).
    const plan = await this.planIntentRefund(intentId, refundableCharges, dto.amount, dto.execution ?? 'AUTO');

    await this.settleAmbiguousBeforePlan(intentId, plan, dto.refundReceiveAccount);

    const results: Refund[] = [];
    for (const leg of plan) {
      let refund: Refund;
      try {
        refund = await this.create(
          {
            chargeId: leg.chargeId,
            amount: leg.amount,
            reasonCode: dto.reasonCode,
            reasonMessage: dto.reasonMessage,
            kind: dto.kind,
            allowMembershipRefund: dto.allowMembershipRefund,
            refundReceiveAccount: dto.refundReceiveAccount,
          },
          { execution: leg.execution },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logPartialIntentRefund(
          intentId,
          dto.amount,
          results,
          `${leg.methodType}:${leg.chargeId} threw: ${message}`,
        );
        throw error;
      }
      results.push(refund);
      // 첫 FAILED 에서 멈춘다 — 호출자는 FAILED 행 하나만 있어도 실패로 본다. 뒤 leg 를 부르면 돈만 더 나간다.
      if (refund.status === 'FAILED') {
        this.logPartialIntentRefund(
          intentId,
          dto.amount,
          results.slice(0, -1),
          `${leg.methodType}:${leg.chargeId} FAILED refund=${refund.id} reason=${refund.reasonMessage ?? '-'}`,
        );
        break;
      }
    }
    return results;
  }

  /**
   * intent 환불 계획: charge 별 남은 금액(원금 − SUCCEEDED·PENDING 환불)을 구해 그 비례로 나누고,
   * 돈을 움직이기 전에 총량·자동환불 가능 여부를 검사한 뒤 실행 순서(외부 결제 먼저, 포인트 마지막)로 돌려준다.
   *
   * 포인트가 마지막인 이유: 포인트 환불은 되돌릴 수단이 없는데(REDEEM_CANCEL 의 역연산 없음) 원장 안에서
   * 끝나 실패할 일이 거의 없다. 실패 가능성이 큰 외부 PG 를 먼저 해서, 그게 실패하면 아무 돈도 안 나간 채로 멈춘다.
   *
   * execution = MANUAL 이면 외부 결제 leg 는 PG 를 부르지 않으므로 «자동 환불 가능» 검사를 건너뛴다(효성 CMS 도 받는다).
   * 포인트 leg 는 MANUAL 이어도 원장으로 자동 환불한다(스펙 §6.3).
   */
  private async planIntentRefund(
    intentId: string,
    refundableCharges: Charge[],
    amount: number,
    execution: RefundExecution,
  ): Promise<Array<{ chargeId: string; amount: number; methodType: string; execution: RefundExecution }>> {
    const refunded = await this.getActiveRefundedTotalsByCharge(refundableCharges.map((c) => c.id));
    const open = refundableCharges
      .map((charge) => ({ charge, remaining: charge.amount - (refunded.get(charge.id) ?? 0) }))
      .filter((leg) => leg.remaining > 0);

    const totalRemaining = open.reduce((sum, leg) => sum + leg.remaining, 0);
    if (amount > totalRemaining) {
      throw new BadRequestException(
        refundRefusal(
          'REFUND_AMOUNT_EXCEEDS_TOTAL',
          `Refund amount (${amount}) exceeds remaining refundable amount (${totalRemaining}) for intent ${intentId}`,
        ),
      );
    }

    // 분할 순서 = charge 생성 순서(기존과 같다) — 마지막 leg 가 반올림 나머지를 흡수한다.
    const shares = splitRefundOverRemaining(open, amount);
    const planned: Array<{ chargeId: string; amount: number; methodType: string; execution: RefundExecution }> = [];
    for (let i = 0; i < open.length; i++) {
      if (shares[i] <= 0) continue;
      const charge = open[i].charge;
      const method = await this.paymentMethodsService.findById(charge.paymentMethodId);
      if (!method) {
        throw new NotFoundException(
          refundRefusal('PAYMENT_METHOD_NOT_FOUND', `Payment method not found: ${charge.paymentMethodId}`),
        );
      }
      const legExecution: RefundExecution = execution === 'MANUAL' && method.type !== 'POINTS' ? 'MANUAL' : 'AUTO';
      // 효성 CMS 처럼 PG 환불 API 가 없는 수단은 provider 가 반드시 FAILED 를 낸다. 복합결제에서 그 leg 가
      // 뒤에 있으면 앞 leg 만 나가고 멈춘다 — 아무것도 움직이기 전에 거절한다. 수동 집행 leg 는 PG 를 안 부르므로 검사하지 않는다.
      if (legExecution === 'AUTO' && !supportsAutoRefund(method.type)) {
        throw new BadRequestException(
          refundRefusal(
            'REFUND_NOT_AUTOMATABLE',
            `Payment method ${method.type} cannot be refunded automatically (charge ${charge.id}); refund must be handled manually`,
          ),
        );
      }
      planned.push({ chargeId: charge.id, amount: shares[i], methodType: method.type, execution: legExecution });
    }

    return [
      ...planned.filter((leg) => leg.methodType !== 'POINTS'),
      ...planned.filter((leg) => leg.methodType === 'POINTS'),
    ];
  }

  /**
   * 앞 leg 가 이미 돈을 움직인 뒤 뒤 leg 가 실패했다. 자동 보상은 없다(포인트는 되돌릴 수 없고 PG 는 재청구가
   * 안 된다) — 사람이 대사해야 한다. 아무 돈도 안 나갔으면 남기지 않는다(호출자가 실패로 처리한다).
   */
  private logPartialIntentRefund(intentId: string, requested: number, earlier: Refund[], failure: string): void {
    const moved = earlier.filter((r) => r.status === 'SUCCEEDED' || r.status === 'PENDING');
    if (moved.length === 0) return;
    this.logger.error(
      `[createByIntent] 복합결제 환불 부분 실패 — 수동 대사 필요. intentId=${intentId} requested=${requested} ` +
        `moved=${moved.map((r) => `${r.id}:${r.amount}:${r.status}`).join(',')} failed=${failure}`,
    );
  }

  /**
   * 멈춘 AUTO PENDING 을 같은 키로 마저 보낸다(#1016 36번 마무리 ③). Medusa 장부 맞추기는 장부에 없는 AUTO PENDING 을 «진행 중»으로 보고
   * 정산을 멈추므로(D8), 이 크론이 끝내 주지 않으면 그 주문의 정산은 리컨실러 «자동 멈춤»까지 간다.
   * 한 행은 한 주체만 — 조건부 UPDATE(updated_at 이 아직 오래됨)로 집는다. 먼저 집은 쪽이 updated_at 을 now 로 올리므로
   * 크론 태스크가 둘이어도, 늦게 끝난 create() 와 겹쳐도 나중 쪽은 0행이다. (updated_at 동등 비교는 쓰지 않는다 —
   * DB 는 마이크로초, JS Date 는 밀리초라 영영 안 맞는다.)
   */
  async resendStuckAutoPending(now: Date, limit = 50): Promise<{ scanned: number; resent: number }> {
    const stuckBefore = new Date(now.getTime() - STUCK_PENDING_AFTER_MS);
    const candidates = await this.dbService.db
      .select({ refund: refunds, charge: chargesTable, method: paymentMethodsTable })
      .from(refunds)
      .innerJoin(chargesTable, eq(chargesTable.id, refunds.chargeId))
      .innerJoin(paymentMethodsTable, eq(paymentMethodsTable.id, chargesTable.paymentMethodId))
      .where(
        and(
          eq(refunds.status, 'PENDING'),
          eq(refunds.execution, 'AUTO'),
          lt(refunds.updatedAt, stuckBefore),
          gt(refunds.createdAt, new Date(now.getTime() - AMBIGUOUS_RESEND_WINDOW_MS)),
          inArray(paymentMethodsTable.type, [...RESENDABLE_METHOD_TYPES]),
        ),
      )
      .orderBy(asc(refunds.updatedAt))
      .limit(limit);

    let resent = 0;
    for (const { refund, charge, method } of candidates) {
      const claimed = await this.dbService.db
        .update(refunds)
        // 집은 «그 시각»을 적는다 — 실행 시작 시각(now)을 쓰면 오래 걸린 실행의 뒤쪽 행이 이미 낡아 보인다
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(refunds.id, refund.id),
            eq(refunds.status, 'PENDING'),
            eq(refunds.execution, 'AUTO'),
            lt(refunds.updatedAt, stuckBefore),
          ),
        )
        .returning({ id: refunds.id });
      if (claimed.length === 0) continue;
      const userId = await this.getIntentUserId(refund.intentId);
      if (!userId) {
        this.logger.error(`[resendStuckAutoPending] intent 없음 — refund=${refund.id}`);
        continue;
      }
      const result = await this.dispatch(refund, { charge, method, userId });
      // FAILED 면 Medusa 가 옛 규칙으로 이미 «환불됨»으로 적었을 수 있다 — 운영자가 봐야 한다
      const line = `[resendStuckAutoPending] refund=${refund.id} amount=${refund.amount} → ${result.status}`;
      if (result.status === 'FAILED') this.logger.error(line);
      else this.logger.warn(line);
      resent++;
    }
    return { scanned: candidates.length, resent };
  }

  /** intent 의 환불 전부(상태 무관), 만든 순서. 거르는 건 호출자 몫이다(스펙 §6.2·§8.2). */
  async listByIntent(intentId: string): Promise<Refund[]> {
    return this.dbService.db
      .select()
      .from(refunds)
      .where(eq(refunds.intentId, intentId))
      .orderBy(asc(refunds.createdAt), asc(refunds.id));
  }

  async findByIdOrThrow(id: string): Promise<Refund> {
    const rows = await this.dbService.db.select().from(refunds).where(eq(refunds.id, id)).limit(1);

    const refund = rows[0];
    if (!refund) {
      throw new NotFoundException({
        error: 'REFUND_NOT_FOUND',
        message: `Refund not found: ${id}`,
      });
    }
    return refund;
  }

  /**
   * 관리자가 환불 종류를 고친다 (스펙 §6.1). 종류는 돈을 바꾸지 않으니 대개 허용한다 — 이미 PG 로 나간 취소 사유는 바뀌지 않는다.
   * 단 같은 행·같은 토스 키(`wallet:refund:<id>`)로 PG 에 다시 나갈 수 있는 행은 409 로 거절한다: 멈춘 AUTO PENDING
   * (`refund-stuck-resend`)과 응답 끊긴 FAILED(`ambiguousWhere` — 요청 경로가 되살린다). 재전송 사유는 종류에서 나오므로(§5.1)
   * 그 사이 종류가 바뀌면 같은 키의 사유가 첫 전송과 달라진다.
   * 같은 값이면 (거절할 행이어도) 아무것도 쓰지 않고, 다르면 누가 무엇에서 무엇으로 바꿨는지 `payment_state_transitions` 에
   * 남긴다(기계가 붙인 값과 사람이 고친 값을 거기서 가른다).
   */
  async changeKind(refundId: string, kind: RefundKind | null, actorId: string): Promise<Refund> {
    return this.dbService.db.transaction(async (tx) => {
      const [current] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update').limit(1);
      if (!current) {
        throw new NotFoundException({ error: 'REFUND_NOT_FOUND', message: `Refund not found: ${refundId}` });
      }
      if (current.kind === kind) return current;
      const resendable =
        (current.execution === 'AUTO' && current.status === 'PENDING') ||
        (
          await tx
            .select({ id: refunds.id })
            .from(refunds)
            .where(this.ambiguousWhere(eq(refunds.id, refundId)))
            .limit(1)
        ).length > 0;
      if (resendable) {
        throw new ConflictException({
          error: 'REFUND_KIND_LOCKED_UNTIL_SETTLED',
          message: `PG 결과가 확정된 뒤 종류를 고칠 수 있습니다 — 이 환불은 아직 PG 로 다시 나갈 수 있습니다(${current.status}): ${refundId}`,
        });
      }

      const [updated] = await tx
        .update(refunds)
        .set({ kind, updatedAt: new Date() })
        .where(eq(refunds.id, refundId))
        .returning();
      await tx.insert(paymentStateTransitions).values({
        entityType: 'REFUND',
        entityId: refundId,
        previousStatus: current.status,
        newStatus: current.status,
        reasonCode: 'KIND_CHANGED',
        triggeredByType: 'ADMIN',
        triggeredById: actorId,
        correlationId: `kind-change:${refundId}:${Date.now()}`,
        occurredAt: new Date(),
        payload: { fromKind: current.kind, toKind: kind },
      });
      return updated;
    });
  }

  /**
   * 이 결제를 실제로 환불할 수 있는지 판정한다.
   *
   * 호출자(멤버십 해지 화면·관리자 강제취소)가 "환불 됩니다" 라고 안내하기 전에 물어보는 길목이다.
   * 효성 CMS(자동이체)처럼 PG 환불 API 자체가 없는 수단은 `autoRefundSupported=false` 로 내려가고,
   * 이 경우 환불은 관리자가 계좌로 송금하는 수동 처리뿐이다.
   */
  async getRefundability(intentId: string): Promise<{
    intentId: string;
    refundableAmount: number;
    alreadyRefundedAmount: number;
    /**
     * 아직 확정되지 않았지만 **이미 잡혀 있는** 환불액(수동 확정 대기 등).
     *
     * 돈이 나가지 않았을 뿐 이 건은 곧 나갈 예정이므로, 다시 환불 가능한 금액으로 세면 같은 결제를
     * 두 번 돌려주게 된다. 호출자가 "이 건은 wallet 이 닫는다" 를 알아야 자기 쪽에서 수동 완료
     * 처리를 중복으로 하지 않는다.
     */
    pendingRefundAmount: number;
    /** 지금 실제로 더 환불할 수 있는 금액(= 환불 가능 charge 합계 − 성공한 환불 − 대기 중 환불) */
    remainingRefundableAmount: number;
    autoRefundSupported: boolean;
    requiresReceiveAccount: boolean;
    methodTypes: string[];
  }> {
    const refundableCharges = await this.chargesService.findRefundableByIntent(intentId);
    const succeeded = await this.findSucceededRefundsByIntent(intentId);
    const alreadyRefundedAmount = succeeded.reduce((sum, r) => sum + r.amount, 0);
    const pending = await this.findPendingRefundsByIntent(intentId);
    const pendingRefundAmount = pending.reduce((sum, r) => sum + r.amount, 0);

    const methodTypes: string[] = [];
    let autoRefundSupported = refundableCharges.length > 0;
    let requiresReceiveAccount = false;

    for (const charge of refundableCharges) {
      const method = await this.paymentMethodsService.findById(charge.paymentMethodId);
      const type = method?.type ?? 'UNKNOWN';
      if (!methodTypes.includes(type)) methodTypes.push(type);

      if (!supportsAutoRefund(type)) autoRefundSupported = false;
      // 무통장은 송금할 계좌가 없으면 PENDING(수동)으로 떨어진다 — 미리 계좌를 받아야 한다.
      if (type === 'BANK_TRANSFER') requiresReceiveAccount = true;
    }

    const refundableAmount = refundableCharges.reduce((sum, c) => sum + c.amount, 0);

    return {
      intentId,
      refundableAmount,
      alreadyRefundedAmount,
      pendingRefundAmount,
      // 호출자가 gross 에서 이미 환불된 금액을 빼는 것을 잊으면 과환불 요청이 된다 — 여기서 답한다.
      // 확정 대기 중인 건도 빼야 한다: 돈이 아직 안 나갔을 뿐 이미 잡혀 있는 환불이다.
      remainingRefundableAmount: Math.max(0, refundableAmount - alreadyRefundedAmount - pendingRefundAmount),
      autoRefundSupported,
      requiresReceiveAccount,
      methodTypes,
    };
  }

  /** 확정 대기 중(PENDING)인 환불 — 무통장 수동 송금 확정 대기 등. wallet 이 닫아야 하는 건이다. */
  private async findPendingRefundsByIntent(intentId: string): Promise<Refund[]> {
    return this.dbService.db
      .select()
      .from(refunds)
      .where(and(eq(refunds.intentId, intentId), eq(refunds.status, 'PENDING')))
      .orderBy(asc(refunds.createdAt));
  }

  private async findSucceededRefundsByIntent(intentId: string): Promise<Refund[]> {
    return this.dbService.db
      .select()
      .from(refunds)
      .where(and(eq(refunds.intentId, intentId), eq(refunds.status, 'SUCCEEDED')))
      .orderBy(asc(refunds.createdAt));
  }

  private async getRefundNotifyExtra(intentId: string): Promise<Record<string, unknown>> {
    const rows = await this.dbService.db
      .select({ metadata: paymentIntents.metadata, purpose: paymentIntents.purpose })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    const m = rows[0]?.metadata ?? {};
    const email = m.email ?? m.customerEmail;
    return {
      ...(typeof email === 'string' && email.includes('@') ? { email } : {}),
      ...(typeof m.customerName === 'string' ? { customerName: m.customerName } : {}),
      ...(typeof m.orderName === 'string' ? { orderName: m.orderName } : {}),
      ...(typeof m.type === 'string' ? { intentType: m.type } : {}),
      ...(rows[0]?.purpose ? { purpose: rows[0].purpose } : {}),
    };
  }

  private async getIntentUserId(intentId: string): Promise<string | null> {
    const rows = await this.dbService.db
      .select({ userId: paymentIntents.userId })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    return rows[0]?.userId ?? null;
  }

  /**
   * 멤버십 결제(metadata.type === 'MEMBERSHIP_FEE')는 정책상 환불 불가.
   * 멤버십 fee intent 는 일반상품 items 를 절대 포함하지 않는 독립 intent 라
   * (membership → wallet 직접 생성), 이 가드가 일반상품 환불을 막을 일은 없다.
   */
  private async assertRefundable(intentId: string, allowMembershipRefund = false): Promise<void> {
    if (allowMembershipRefund) return; // admin 강제취소 예외 환불 — 정책상 허용된 우회
    const rows = await this.dbService.db
      .select({ metadata: paymentIntents.metadata })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    if (rows[0]?.metadata?.type === 'MEMBERSHIP_FEE') {
      throw new BadRequestException(
        refundRefusal('MEMBERSHIP_REFUND_NOT_ALLOWED', '멤버십 결제는 환불할 수 없습니다.'),
      );
    }
  }

  async confirmManual(refundId: string): Promise<Refund> {
    const refund = await this.findByIdOrThrow(refundId);
    if (refund.status !== 'PENDING') {
      throw new Error(`환불이 PENDING 상태가 아닙니다: ${refund.status}`);
    }

    const charge = await this.chargesService.findById(refund.chargeId);
    if (!charge) throw new Error(`Charge not found: ${refund.chargeId}`);
    const method = await this.paymentMethodsService.findById(charge.paymentMethodId);
    if (
      !isManuallyConfirmable({ status: refund.status, execution: refund.execution, methodType: method?.type ?? null })
    ) {
      throw new BadRequestException({
        error: 'REFUND_NOT_MANUALLY_CONFIRMABLE',
        message: '수동 완료 처리는 무통장 환불(BANK_TRANSFER)이나 수동 실행(MANUAL) 환불만 가능합니다.',
      });
    }

    const userId = await this.getIntentUserId(refund.intentId);
    if (!userId) throw new Error(`Intent not found for refund: ${refundId}`);
    // 멤버십 환불 차단은 create() 단일 길목에서 처리한다. 여기 도달한 PENDING 환불은
    // create() 가 이미 허용한 건(= admin 강제취소 예외)뿐이라 완료를 막지 않는다.
    const now = new Date().toISOString();
    const correlationId = `manual-confirm:${refundId}`;
    const notifyExtra = await this.getRefundNotifyExtra(refund.intentId);

    await this.dbService.db.transaction(async (tx) => {
      // transitionRefund가 status update와 state_transitions 기록을 모두 처리
      await this.stateTransitionService.transitionRefund(
        refundId,
        'SUCCEEDED',
        {
          correlationId,
          reasonCode: 'MANUAL_CONFIRM',
          outboxEvent: {
            eventType: GatewayEventType.REFUND_SUCCEEDED,
            aggregateId: refundId,
            payload: buildRefundEventPayload({
              refundId,
              chargeId: refund.chargeId,
              intentId: refund.intentId,
              userId: userId ?? '',
              status: 'SUCCEEDED',
              amount: refund.amount,
              currency: refund.currency,
              reasonCode: refund.reasonCode ?? null,
              occurredAt: now,
              extra: notifyExtra,
            }),
          },
        },
        'PENDING',
        tx,
      );

      // If all charge amount is now covered by SUCCEEDED refunds, mark charge as REFUNDED.
      const succeededTotal = await this.getSucceededRefundedTotalInTx(refund.chargeId, tx);
      if (succeededTotal >= charge.amount) {
        await this.stateTransitionService.transitionCharge(
          charge.id,
          'REFUNDED',
          { correlationId, reasonCode: 'FULLY_REFUNDED' },
          'SUCCEEDED',
          tx,
        );
      }
    });
    await this.cancelCashReceiptBestEffort(refund.chargeId, refund.amount);

    return this.findByIdOrThrow(refundId);
  }

  /**
   * charge 별로 이미 잡힌 환불 합(SUCCEEDED + PENDING) — `getRefundedTotalInTx` 와 같은 규칙.
   * createByIntent 의 계획용 읽기라 잠그지 않는다. 집행 시 create() 가 charge 행을 잠그고 다시 검사한다.
   */
  private async getActiveRefundedTotalsByCharge(chargeIds: string[]): Promise<Map<string, number>> {
    const totals = new Map<string, number>();
    if (chargeIds.length === 0) return totals;
    const rows = await this.dbService.db
      .select({ chargeId: refunds.chargeId, amount: refunds.amount })
      .from(refunds)
      .where(and(inArray(refunds.chargeId, chargeIds), inArray(refunds.status, ['SUCCEEDED', 'PENDING'])));
    for (const row of rows) totals.set(row.chargeId, (totals.get(row.chargeId) ?? 0) + row.amount);
    return totals;
  }

  private async getRefundedTotalInTx(chargeId: string, tx: DbTx): Promise<number> {
    const rows = await tx
      .select({ amount: refunds.amount })
      .from(refunds)
      .where(and(eq(refunds.chargeId, chargeId), inArray(refunds.status, ['SUCCEEDED', 'PENDING'])));
    return rows.reduce((total, r) => total + r.amount, 0);
  }

  private async getSucceededRefundedTotalInTx(chargeId: string, tx: DbTx): Promise<number> {
    const rows = await tx
      .select({ amount: refunds.amount })
      .from(refunds)
      .where(and(eq(refunds.chargeId, chargeId), eq(refunds.status, 'SUCCEEDED')));
    return rows.reduce((total, r) => total + r.amount, 0);
  }
}
