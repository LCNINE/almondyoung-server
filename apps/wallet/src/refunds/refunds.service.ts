import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { WalletSchema, charges as chargesTable, refunds, paymentIntents } from '../schema';
import { Charge, DbTx, Refund } from '../types';
import { ChargesService } from '../charges/charges.service';
import { CashReceiptsService } from '../cash-receipts/cash-receipts.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import { DEFAULT_PAYMENT_PROVIDER_DESCRIPTORS, PaymentProviderDescriptor } from '../providers/provider-descriptors';
import { GatewayEventType, buildRefundEventPayload } from '../messaging/gateway-event.builder';
import { CreateRefundDto } from './dto';
import { splitRefundOverRemaining } from './refund-plan';

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

  async create(dto: CreateRefundDto): Promise<Refund> {
    // 1. Early validation (no lock needed)
    const charge = await this.chargesService.findById(dto.chargeId);
    if (!charge) {
      throw new NotFoundException({ error: 'CHARGE_NOT_FOUND', message: `Charge not found: ${dto.chargeId}` });
    }
    if (dto.intentId && charge.intentId !== dto.intentId) {
      throw new BadRequestException({
        error: 'CHARGE_INTENT_MISMATCH',
        message: `Charge ${dto.chargeId} does not belong to intent ${dto.intentId}`,
      });
    }
    if (charge.status !== 'SUCCEEDED') {
      throw new BadRequestException({
        error: 'CHARGE_NOT_REFUNDABLE',
        message: `Charge is not in a refundable state: ${charge.status}`,
      });
    }
    if (dto.amount > charge.amount) {
      throw new BadRequestException({
        error: 'REFUND_AMOUNT_EXCEEDS_CHARGE',
        message: `Refund amount (${dto.amount}) exceeds charge amount (${charge.amount})`,
      });
    }
    await this.assertRefundable(charge.intentId, dto.allowMembershipRefund);

    const method = await this.paymentMethodsService.findById(charge.paymentMethodId);
    if (!method) {
      throw new NotFoundException({
        error: 'PAYMENT_METHOD_NOT_FOUND',
        message: `Payment method not found: ${charge.paymentMethodId}`,
      });
    }
    const userId = await this.getIntentUserId(charge.intentId);
    if (!userId) {
      throw new NotFoundException({ error: 'INTENT_NOT_FOUND', message: `Intent not found for charge: ${charge.id}` });
    }

    // 2. Lock charge row + re-check available amount + insert refund record atomically
    const refund = await this.dbService.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${chargesTable} WHERE id = ${charge.id} FOR UPDATE`);

      const alreadyRefunded = await this.getRefundedTotalInTx(charge.id, tx);
      const available = charge.amount - alreadyRefunded;
      if (dto.amount > available) {
        throw new BadRequestException({
          error: 'REFUND_AMOUNT_EXCEEDS_AVAILABLE',
          message: `Refund amount (${dto.amount}) exceeds available refundable amount (${available})`,
        });
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
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error('REFUND_INSERT_FAILED');
      return row;
    });

    const correlationId = `refund:${refund.id}:${Date.now()}`;
    const provider = this.providerRegistry.getProviderOrThrow(method.type);
    const idempotencyKey = `wallet:refund:${refund.id}`;

    let providerResult: Awaited<ReturnType<typeof provider.refund>>;
    try {
      providerResult = await provider.refund({
        refundId: refund.id,
        chargeId: charge.id,
        intentId: charge.intentId,
        userId,
        amount: dto.amount,
        currency: charge.currency,
        idempotencyKey,
        correlationId,
        reasonCode: dto.reasonCode,
        providerData: method.providerData,
        refundReceiveAccount: dto.refundReceiveAccount,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Provider refund threw: refundId=${refund.id}, error=${message}`);
      // reasonCode는 관리자가 입력한 환불 사유를 보존. PG 오류는 reasonMessage에 추가하고 state_transitions에 기록
      await this.dbService.db
        .update(refunds)
        .set({ reasonMessage: message.slice(0, 500), updatedAt: new Date() })
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
                amount: dto.amount,
                currency: charge.currency,
                reasonCode: dto.reasonCode ?? null,
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
      await this.cancelCashReceiptBestEffort(charge.id, dto.amount);
    } else if (providerResult.status === 'PENDING') {
      // Refund is processing asynchronously
      await this.dbService.db.update(refunds).set({ updatedAt: new Date() }).where(eq(refunds.id, refund.id));
    } else {
      // FAILED
      const failCode = providerResult.errorCode ?? 'REFUND_FAILED';
      const failMessage = providerResult.errorMessage ?? null;
      // reasonCode는 관리자가 입력한 환불 사유를 보존. PG 오류는 reasonMessage에 기록
      await this.dbService.db
        .update(refunds)
        .set({ reasonMessage: failMessage, updatedAt: new Date() })
        .where(eq(refunds.id, refund.id));
      await this.stateTransitionService.transitionRefund(refund.id, 'FAILED', {
        correlationId,
        reasonCode: failCode,
        reasonMessage: failMessage ?? undefined,
      });
    }

    return this.findByIdOrThrow(refund.id);
  }

  async createByIntent(
    intentId: string,
    dto: {
      amount: number;
      reasonCode?: string;
      reasonMessage?: string;
      allowMembershipRefund?: boolean;
      refundReceiveAccount?: CreateRefundDto['refundReceiveAccount'];
    },
  ): Promise<Refund[]> {
    const refundableCharges = await this.chargesService.findRefundableByIntent(intentId);
    if (refundableCharges.length === 0) {
      const succeededRefunds = await this.findSucceededRefundsByIntent(intentId);
      const succeededTotal = succeededRefunds.reduce((sum, refund) => sum + refund.amount, 0);
      if (succeededTotal >= dto.amount) {
        return succeededRefunds;
      }

      throw new NotFoundException({
        error: 'REFUNDABLE_CHARGE_NOT_FOUND',
        message: `No refundable charge found for intent: ${intentId}`,
      });
    }

    // 계획을 먼저 세우고 검증이 끝난 뒤에만 돈을 움직인다. 집행 도중의 실패는 앞 leg 를 되돌릴 수 없다
    // (포인트 환불엔 역연산이 없고, PG 환불은 재청구가 안 된다).
    const plan = await this.planIntentRefund(intentId, refundableCharges, dto.amount);

    const results: Refund[] = [];
    for (const leg of plan) {
      let refund: Refund;
      try {
        refund = await this.create({
          chargeId: leg.chargeId,
          amount: leg.amount,
          reasonCode: dto.reasonCode,
          reasonMessage: dto.reasonMessage,
          allowMembershipRefund: dto.allowMembershipRefund,
          refundReceiveAccount: dto.refundReceiveAccount,
        });
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
   */
  private async planIntentRefund(
    intentId: string,
    refundableCharges: Charge[],
    amount: number,
  ): Promise<Array<{ chargeId: string; amount: number; methodType: string }>> {
    const refunded = await this.getActiveRefundedTotalsByCharge(refundableCharges.map((c) => c.id));
    const open = refundableCharges
      .map((charge) => ({ charge, remaining: charge.amount - (refunded.get(charge.id) ?? 0) }))
      .filter((leg) => leg.remaining > 0);

    const totalRemaining = open.reduce((sum, leg) => sum + leg.remaining, 0);
    if (amount > totalRemaining) {
      throw new BadRequestException({
        error: 'REFUND_AMOUNT_EXCEEDS_TOTAL',
        message: `Refund amount (${amount}) exceeds remaining refundable amount (${totalRemaining}) for intent ${intentId}`,
      });
    }

    // 분할 순서 = charge 생성 순서(기존과 같다) — 마지막 leg 가 반올림 나머지를 흡수한다.
    const shares = splitRefundOverRemaining(open, amount);
    const planned: Array<{ chargeId: string; amount: number; methodType: string }> = [];
    for (let i = 0; i < open.length; i++) {
      if (shares[i] <= 0) continue;
      const charge = open[i].charge;
      const method = await this.paymentMethodsService.findById(charge.paymentMethodId);
      if (!method) {
        throw new NotFoundException({
          error: 'PAYMENT_METHOD_NOT_FOUND',
          message: `Payment method not found: ${charge.paymentMethodId}`,
        });
      }
      // 효성 CMS 처럼 PG 환불 API 가 없는 수단은 provider 가 반드시 FAILED 를 낸다. 복합결제에서 그 leg 가
      // 뒤에 있으면 앞 leg 만 나가고 멈춘다 — 아무것도 움직이기 전에 거절한다(수동 송금 경로는 호출자 몫).
      if (!supportsAutoRefund(method.type)) {
        throw new BadRequestException({
          error: 'REFUND_NOT_AUTOMATABLE',
          message: `Payment method ${method.type} cannot be refunded automatically (charge ${charge.id}); refund must be handled manually`,
        });
      }
      planned.push({ chargeId: charge.id, amount: shares[i], methodType: method.type });
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
      throw new BadRequestException({
        error: 'MEMBERSHIP_REFUND_NOT_ALLOWED',
        message: '멤버십 결제는 환불할 수 없습니다.',
      });
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
    if (method?.type !== 'BANK_TRANSFER') {
      throw new Error('수동 완료 처리는 무통장 환불(BANK_TRANSFER)만 가능합니다.');
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
