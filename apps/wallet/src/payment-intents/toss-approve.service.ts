import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { WalletSchema, charges, paymentIntents } from '../schema';
import { Charge, PaymentIntent } from '../types';
import { ChargesService } from '../charges/charges.service';
import { AutoCaptureService } from './auto-capture.service';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import { GatewayEventType, buildPaymentIntentEventPayload } from '../messaging/gateway-event.builder';
import { TossApiClient, TossConfirmResponse, TossVirtualAccount } from '../providers/toss/toss-api.client';
import { tossBankName } from '../providers/toss/toss-banks';
import { BankTransferPaymentProvider } from '../providers/bank-transfer/bank-transfer.provider';
import { tossBrandPayCustomerKey } from '../providers/toss/toss-brandpay-customer-key';
import { CONFIRM_ATTEMPT, VIRTUAL_ACCOUNT_LEFT_OPEN, usesTossWidget } from '../providers/toss/toss-widget-mode';
import { CashReceiptsService } from '../cash-receipts/cash-receipts.service';
import { StagedApproval, isDeferredApprovalIntent } from './deferred-approval';
import { depositWindowHours } from './deposit-window';

/**
 * 적재된 승인이 확정되기를 기다리는 시간. Medusa 가 cart.complete 로 주문을 만들고 승인을
 * 트리거하기까지의 정상 소요는 수 초이므로 넉넉하다. 지나면 TossActionExpirationJob 이
 * charge 를 회수하고 PG 미승인 결제는 자동 만료된다(= 돈이 빠지지 않는 방향).
 */
const DEFAULT_STAGED_APPROVAL_TTL_MINUTES = 10;

@Injectable()
export class TossApproveService {
  private readonly logger = new Logger(TossApproveService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly chargesService: ChargesService,
    private readonly autoCaptureService: AutoCaptureService,
    private readonly stateTransitionService: StateTransitionService,
    private readonly tossApi: TossApiClient,
    private readonly cashReceiptsService: CashReceiptsService,
    private readonly bankTransferProvider: BankTransferPaymentProvider,
  ) {}

  async approve(
    intentId: string,
    paymentKey: string,
    orderId: string,
    amount: number,
    correlationId: string,
    paymentType: 'NORMAL' | 'BRANDPAY' = 'NORMAL',
    method?: 'VIRTUAL_ACCOUNT',
  ): Promise<void> {
    this.logger.log(`approve called: intentId=${intentId} orderId=${orderId} amount=${amount}`);

    // 1. Find the REQUIRES_ACTION AUTHORIZE charge
    const charge = await this.chargesService.findActiveByIntentAndOperation(intentId, 'AUTHORIZE');
    this.logger.log(`charge found: ${JSON.stringify({ id: charge?.id, status: charge?.status })}`);
    if (!charge || charge.status !== 'REQUIRES_ACTION') {
      throw new UnprocessableEntityException({
        error: 'NO_REQUIRES_ACTION_CHARGE',
        message: 'No pending Toss action found for this intent',
      });
    }

    // 2. 지연 승인 모드(Medusa 체크아웃): 여기서 승인하지 않고 파라미터만 적재한다.
    //    실제 승인은 주문 생성 + 재고예약이 끝난 뒤 Medusa 가 finalize-approval 로 트리거한다.
    const intent = await this.loadIntent(intentId);
    if (paymentType === 'BRANDPAY' && !intent.userId) {
      throw new UnprocessableEntityException({ error: 'BRANDPAY_CUSTOMER_REQUIRED' });
    }
    const customerKey = paymentType === 'BRANDPAY' ? tossBrandPayCustomerKey(intent.userId!) : undefined;
    // 다른 결제의 paymentKey 로 이 charge 를 승인시키지 못하게, 승인 경로와 무관하게 먼저 대조한다.
    this.assertMatchesCharge(charge, orderId, amount);
    // 가상계좌는 승인해도 돈이 빠지지 않고 계좌만 발급된다. 지연 승인으로 미루면 카트 완료 안에서
    // 승인돼 입금대기 marker 없는 주문이 생기므로, 바로 승인해 기존 무통장 입금대기 흐름에 태운다.
    // method 는 클라이언트 신호라 믿지 않는다 — 실제 분기는 아래 승인 응답의 status 로 한다.
    if (isDeferredApprovalIntent(intent.metadata) && method !== 'VIRTUAL_ACCOUNT') {
      await this.stageApproval(charge, paymentKey, orderId, amount, paymentType, customerKey);
      this.logger.log(`approve staged (deferred approval): intentId=${intentId} chargeId=${charge.id}`);
      return;
    }

    // 3. Call Toss API confirm
    await this.markConfirmAttempt(charge, paymentKey);
    const result = customerKey
      ? await this.tossApi.confirmBrandPayPayment(paymentKey, amount, orderId, customerKey)
      : await this.tossApi.confirmPayment(paymentKey, amount, orderId, usesTossWidget(charge.responsePayload));
    this.logger.log(`Toss API confirm response: ok=${result.ok}`);

    if (!result.ok) {
      this.logger.error(`Toss API confirm failed: ${JSON.stringify(result.error)}`);
      await this.finalizeFailure(charge, result.error.code ?? 'TOSS_CONFIRM_FAILED', correlationId);
      throw new UnprocessableEntityException({
        error: result.error.code ?? 'TOSS_CONFIRM_FAILED',
        message: result.error.message,
      });
    }

    if (result.data.status === 'WAITING_FOR_DEPOSIT') {
      await this.enterAwaitingDeposit(charge, intent, result.data, correlationId);
      return;
    }

    // 가상계좌 신호로 지연 승인을 건너뛰었는데 실제론 카드 등이 승인됐다 — 재고예약 전에 돈이 빠진 상태다.
    // 승인을 되돌려 고객이 정상 흐름으로 다시 결제하게 한다. 되돌리지 못하면 승인을 그대로 확정한다
    // (돈은 이미 빠졌으므로 실패로 두면 결제가 원장에서 사라진다).
    if (method === 'VIRTUAL_ACCOUNT' && isDeferredApprovalIntent(intent.metadata)) {
      const revert = await this.revertApproval(charge, result.data.paymentKey, orderId);
      if (revert === 'REVERTED') {
        await this.finalizeFailure(charge, 'PAYMENT_METHOD_MISMATCH', correlationId);
        throw new UnprocessableEntityException({
          error: 'PAYMENT_METHOD_MISMATCH',
          message: '결제를 처리하지 못했어요. 다시 시도해 주세요.',
        });
      }
      if (revert === 'UNKNOWN') {
        // 취소됐을 수도 있는 결제를 확정·매입하지 않는다. charge 는 승인 시도 표식을 단 채 REQUIRES_ACTION 에
        // 남아, abandon·만료가 토스 상태를 다시 물어 환불하거나 닫힌 것으로 정리한다.
        throw new UnprocessableEntityException({
          error: 'PAYMENT_STATUS_UNKNOWN',
          message: '결제 결과를 확인하지 못했어요. 잠시 후 주문 내역을 확인해 주세요.',
        });
      }
      this.logger.error(`method mismatch approval kept: chargeId=${charge.id}`);
    }

    await this.finalizeApproval(charge, result.data.paymentKey, correlationId);
  }

  /**
   * 승인 되돌리기 결과. 취소가 성공으로 끝나지 않으면(전송 오류·5xx 포함) 토스에 실제 상태를 물어 판정한다 —
   * 취소됐는데 승인으로 확정하면 돈 없이 출고되고, 이후 취소 웹훅은 REQUIRES_ACTION 이 아닌 charge 를 무시한다.
   * 조회까지 실패하면 UNKNOWN.
   */
  private async revertApproval(
    charge: Charge,
    paymentKey: string,
    orderId: string,
  ): Promise<'REVERTED' | 'KEPT' | 'UNKNOWN'> {
    const useWidgetKey = usesTossWidget(charge.responsePayload);
    const reverted = await this.tossApi
      .cancelPayment(
        paymentKey,
        '결제 취소',
        undefined,
        `cancel:${charge.providerIdempotencyKey}`,
        undefined,
        useWidgetKey,
      )
      .catch(() => null);
    if (reverted?.ok || reverted?.error.code === 'ALREADY_CANCELED_PAYMENT') return 'REVERTED';
    this.logger.error(`approval revert not confirmed: chargeId=${charge.id} error=${JSON.stringify(reverted?.error)}`);
    const query = await this.tossApi.getPaymentByOrderId(orderId, useWidgetKey).catch(() => null);
    if (!query?.ok) return 'UNKNOWN';
    return query.data.status === 'CANCELED' ? 'REVERTED' : 'KEPT';
  }

  /** 토스 승인 호출 직전에 남긴다 — 응답을 잃어도 정리 경로가 토스에 물어볼 근거가 된다. */
  private async markConfirmAttempt(charge: Charge, paymentKey: string): Promise<void> {
    await this.dbService.db
      .update(charges)
      .set({
        responsePayload: {
          ...(charge.responsePayload ?? {}),
          [CONFIRM_ATTEMPT]: { paymentKey, at: new Date().toISOString() },
        },
        updatedAt: new Date(),
      })
      .where(eq(charges.id, charge.id));
  }

  /**
   * 결제위젯 가상계좌 승인을 기존 무통장 입금대기와 같은 상태로 만든다.
   *
   * charge 를 고객의 BANK_TRANSFER 결제수단으로 옮겨, 이후 입금 웹훅·만료 취소·환불 신청·관리자 무통장
   * 목록·현금영수증이 기존 무통장 경로를 그대로 탄다. nextAction 은 ConfirmService 의 offline-wait
   * 분기가 남기는 BANK_TRANSFER_PENDING 과 같은 모양이고, checkoutMode 로 위젯 키를 쓰게 한다.
   */
  private async enterAwaitingDeposit(
    charge: Charge,
    intent: PaymentIntent,
    payment: TossConfirmResponse,
    correlationId: string,
  ): Promise<void> {
    const va = payment.virtualAccount;
    const userId = intent.userId;
    if (!va || !userId) {
      return this.rejectVirtualAccount(charge, intent, payment, 'VIRTUAL_ACCOUNT_INCOMPLETE', correlationId);
    }

    try {
      await this.recordAwaitingDeposit(charge, intent, userId, va, payment.paymentKey, payment.secret, correlationId);
    } catch (error) {
      // 승인을 기다리는 사이 만료·취소로 intent 가 넘어가 전이가 거부된 경우 등. 발급된 계좌만 열린 채
      // 남지 않게 닫는다.
      if (!(await this.closeVirtualAccount(charge, payment.paymentKey))) {
        await this.keepOpenAccountRecoverable(charge, userId, va, payment.paymentKey);
      }
      throw error;
    }
    this.logger.log(`virtual account issued via widget: intentId=${intent.id} chargeId=${charge.id}`);
  }

  /**
   * 닫지 못한 계좌의 결제 키와 무통장 분류를 charge 에 남긴다. 상태는 건드리지 않는다(동시 취소를 되돌리지 않게).
   * 이게 없으면 트랜잭션 롤백으로 결제 키가 사라져, 이후 정리가 TOSS 결제창 대기로 보고 계좌 폐쇄 없이 취소한다.
   */
  private async keepOpenAccountRecoverable(
    charge: Charge,
    userId: string,
    va: TossVirtualAccount,
    paymentKey: string,
  ): Promise<void> {
    const [bankMethod] = await this.bankTransferProvider.getUserMethods(userId);
    await this.dbService.db
      .update(charges)
      .set({
        paymentMethodId: bankMethod.id,
        providerTransactionId: paymentKey,
        responsePayload: {
          ...(charge.responsePayload ?? {}),
          paymentKey,
          virtualAccount: va,
          [VIRTUAL_ACCOUNT_LEFT_OPEN]: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(charges.id, charge.id));
  }

  private async recordAwaitingDeposit(
    charge: Charge,
    intent: PaymentIntent,
    userId: string,
    va: TossVirtualAccount,
    paymentKey: string,
    secret: string | null | undefined,
    correlationId: string,
  ): Promise<void> {
    const [bankMethod] = await this.bankTransferProvider.getUserMethods(userId);

    const nextAction = {
      type: 'BANK_TRANSFER_PENDING',
      checkoutMode: 'WIDGET',
      bankName: tossBankName(va.bankCode),
      accountNumber: va.accountNumber,
      accountHolder: process.env.BANK_TRANSFER_ACCOUNT_HOLDER ?? va.customerName,
      dueDate: va.dueDate,
      amount: charge.amount,
      currency: charge.currency,
    };
    // 적재된 승인은 지운다. 남겨 두면 finalize 재시도가 이미 발급된 계좌를 다시 승인하려 한다.
    const payload = { ...(charge.responsePayload ?? {}) };
    delete payload.stagedApproval;
    const pointsAmount = intent.payableAmount - charge.amount;
    const metadata = intent.metadata ?? {};
    const email = metadata.email ?? metadata.customerEmail;

    await this.dbService.db.transaction(async (tx) => {
      // intent 를 먼저 잠근다. AbandonService 가 intent → charge 순으로 잠그므로 거꾸로 잡으면 교착한다.
      await this.stateTransitionService.transitionIntent(
        intent.id,
        'AWAITING_DEPOSIT',
        {
          correlationId,
          reasonCode: 'AWAITING_DEPOSIT',
          outboxEvent: {
            eventType: GatewayEventType.INTENT_AWAITING_DEPOSIT,
            aggregateId: intent.id,
            payload: buildPaymentIntentEventPayload({
              intentId: intent.id,
              userId,
              status: 'AWAITING_DEPOSIT',
              payableAmount: intent.payableAmount,
              currency: intent.currency,
              extra: {
                bankName: nextAction.bankName,
                accountNumber: nextAction.accountNumber,
                accountHolder: nextAction.accountHolder,
                dueDate: nextAction.dueDate,
                depositAmount: charge.amount,
                ...(pointsAmount > 0 ? { pointsAmount, paidAmount: charge.amount } : {}),
                ...(typeof email === 'string' && email.includes('@') ? { email } : {}),
                ...(metadata.customerName ? { customerName: metadata.customerName } : {}),
              },
            }),
          },
        },
        undefined,
        tx,
      );

      await this.chargesService.updateStatus(
        charge.id,
        'REQUIRES_ACTION',
        {
          paymentMethodId: bankMethod.id,
          providerTransactionId: paymentKey,
          responsePayload: { ...payload, paymentKey, secret: secret ?? null, virtualAccount: va, nextAction },
        },
        tx,
      );

      // 결제창 대기용 actionExpiresAt 을 지워 TossActionExpirationJob 대상에서 빼고, 입금 윈도우로 바꾼다.
      // 결제수단도 무통장으로 옮겨야 관리자 무통장 목록(intent.paymentMethodId 기준)에 잡힌다.
      await tx
        .update(paymentIntents)
        .set({
          paymentMethodId: bankMethod.id,
          actionExpiresAt: null,
          expiresAt: depositDeadline(va.dueDate),
        })
        .where(eq(paymentIntents.id, intent.id));
    });
  }

  /**
   * 입금대기로 넘길 수 없는 가상계좌를 닫고 결제를 실패시킨다. 항상 throw 한다.
   *
   * 계좌를 못 닫았으면 실패로 확정하지 않는다 — FAILED 면 입금 웹훅이 무시되고, REQUIRES_ACTION 으로
   * 두면 재결제가 charge 를 계좌 폐쇄 없이 취소한다. 대신 기존 무통장 입금대기로 넘긴다. 재결제가 막히고,
   * 입금되면 웹훅이 확정하며, 만료는 계좌를 닫아야만 취소한다. 지연 승인 중이었다면 Medusa 는 이 throw 로
   * 주문을 롤백하고, awaiting_deposit 이벤트가 입금확인중 marker 를 단 주문을 다시 만든다.
   */
  private async rejectVirtualAccount(
    charge: Charge,
    intent: PaymentIntent,
    payment: TossConfirmResponse,
    errorCode: string,
    correlationId: string,
  ): Promise<never> {
    if (await this.closeVirtualAccount(charge, payment.paymentKey)) {
      await this.finalizeFailure(charge, errorCode, correlationId);
    } else if (payment.virtualAccount && intent.userId) {
      const { virtualAccount, paymentKey } = payment;
      const userId = intent.userId;
      await this.recordAwaitingDeposit(
        charge,
        intent,
        userId,
        virtualAccount,
        paymentKey,
        payment.secret,
        correlationId,
      ).catch(async (error: unknown) => {
        // abandon·만료가 먼저 intent 를 넘겨 입금대기 전이가 거부되면 롤백으로 결제 키까지 사라진다.
        await this.keepOpenAccountRecoverable(charge, userId, virtualAccount, paymentKey);
        throw error;
      });
    }
    throw new UnprocessableEntityException({
      error: errorCode,
      message: '가상계좌 결제를 처리하지 못했어요. 다시 시도해 주세요.',
    });
  }

  /** 이미 취소된 계좌도 닫힌 것이다. 닫혔는지 모르면(전송 오류 포함) false — 호출자는 열린 계좌로 다룬다. */
  private async closeVirtualAccount(charge: Charge, paymentKey: string): Promise<boolean> {
    const canceled = await this.tossApi
      .cancelPayment(
        paymentKey,
        '결제 취소',
        undefined,
        `cancel:${charge.providerIdempotencyKey}`,
        undefined,
        usesTossWidget(charge.responsePayload),
      )
      .catch((error: unknown) => ({ ok: false as const, error: { code: undefined, message: String(error) } }));
    if (canceled.ok || canceled.error.code === 'ALREADY_CANCELED_PAYMENT') return true;
    // 취소는 토스에서 끝났는데 응답만 잃었을 수 있다 — 닫힌 계좌를 입금대기로 안내하지 않게 실제 상태를 묻는다.
    const query = await this.tossApi
      .getPaymentByOrderId(charge.id.replace(/-/g, ''), usesTossWidget(charge.responsePayload))
      .catch(() => null);
    if (query?.ok && ['CANCELED', 'EXPIRED', 'ABORTED'].includes(query.data.status)) return true;
    this.logger.error(
      `virtual account left open: chargeId=${charge.id} paymentKey=${paymentKey} error=${JSON.stringify(canceled.error)}`,
    );
    return false;
  }

  /**
   * 결제창 완료 파라미터를 charge 에 적재만 하고 승인 API 는 호출하지 않는다.
   *
   * charge 는 REQUIRES_ACTION 그대로 두어 intent 도 REQUIRES_ACTION 에 머문다
   * (almond-payment 가 'pending' 으로 매핑 → completeCartWorkflow 가 정상 진행).
   * providerTransactionId 는 승인 전이므로 비워 둔다 — 미승인 paymentKey 로 취소/환불이
   * 시도되지 않게 하기 위함이다.
   */
  private async stageApproval(
    charge: Charge,
    paymentKey: string,
    orderId: string,
    amount: number,
    paymentType: 'NORMAL' | 'BRANDPAY',
    customerKey?: string,
  ): Promise<void> {
    const staged: StagedApproval = {
      provider: 'TOSS',
      paymentType,
      customerKey,
      providerToken: paymentKey,
      orderId,
      amount,
      stagedAt: new Date().toISOString(),
    };

    await this.chargesService.updateStatus(charge.id, 'REQUIRES_ACTION', {
      responsePayload: { ...(charge.responsePayload ?? {}), stagedApproval: staged },
    });

    // 확정 대기 창을 다시 연다. 고객이 결제창에서 오래 머물러 원래 actionExpiresAt 이 임박했더라도
    // 주문 생성까지의 몇 초를 확보하기 위함.
    await this.dbService.db
      .update(paymentIntents)
      .set({ actionExpiresAt: new Date(Date.now() + this.stagedApprovalTtlMs()) })
      .where(eq(paymentIntents.id, charge.intentId));
  }

  private assertMatchesCharge(charge: Charge, orderId: string, amount: number): void {
    if (charge.amount !== amount) {
      throw new UnprocessableEntityException({
        error: 'TOSS_AMOUNT_MISMATCH',
        message: `Expected amount ${charge.amount}, received ${amount}`,
      });
    }

    const expectedOrderId = charge.id.replace(/-/g, '');
    if (orderId !== expectedOrderId) {
      throw new UnprocessableEntityException({
        error: 'TOSS_ORDER_ID_MISMATCH',
        message: 'orderId does not match the charge',
      });
    }
  }

  private stagedApprovalTtlMs(): number {
    const raw = Number(process.env.WALLET_STAGED_APPROVAL_TTL_MINUTES);
    const minutes = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STAGED_APPROVAL_TTL_MINUTES;
    return minutes * 60_000;
  }

  /**
   * 적재된 승인을 실제 PG 승인으로 확정한다 (주문 생성 성공 후 Medusa 가 트리거).
   * 승인 실패는 charge/intent 를 실패 처리하고 throw 해, 호출자인 Medusa 워크플로가
   * 주문·재고예약을 롤백하게 한다.
   */
  async confirmStaged(charge: Charge, staged: StagedApproval, correlationId: string): Promise<void> {
    if (staged.paymentType === 'BRANDPAY' && !staged.customerKey) {
      throw new UnprocessableEntityException({ error: 'BRANDPAY_CUSTOMER_REQUIRED' });
    }
    await this.markConfirmAttempt(charge, staged.providerToken);
    const result =
      staged.paymentType === 'BRANDPAY'
        ? await this.tossApi.confirmBrandPayPayment(
            staged.providerToken,
            staged.amount,
            staged.orderId,
            staged.customerKey!,
          )
        : await this.tossApi.confirmPayment(
            staged.providerToken,
            staged.amount,
            staged.orderId,
            usesTossWidget(charge.responsePayload),
          );
    this.logger.log(`staged approval confirm: intentId=${charge.intentId} ok=${result.ok}`);

    if (!result.ok) {
      this.logger.error(`Toss API confirm failed (staged): ${JSON.stringify(result.error)}`);
      await this.finalizeFailure(charge, result.error.code ?? 'TOSS_CONFIRM_FAILED', correlationId);
      throw new UnprocessableEntityException({
        error: result.error.code ?? 'TOSS_CONFIRM_FAILED',
        message: result.error.message,
      });
    }

    // 지연 승인은 카트 완료 안에서 불린다. 여기서 입금대기로 넘기면 Medusa 가 marker 없는 authorized
    // 주문을 만들어 미입금 출고가 될 수 있으므로, 계좌를 닫고 실패시켜 주문을 롤백한다.
    // 정상 흐름에선 wallet-web 이 method=VIRTUAL_ACCOUNT 를 보내 이 경로에 오지 않는다.
    if (result.data.status === 'WAITING_FOR_DEPOSIT') {
      const intent = await this.loadIntent(charge.intentId);
      return this.rejectVirtualAccount(charge, intent, result.data, 'VIRTUAL_ACCOUNT_NOT_DEFERRABLE', correlationId);
    }

    await this.finalizeApproval(charge, result.data.paymentKey, correlationId);
  }

  /**
   * virtualAccount 는 입금 웹훅이 토스 조회값으로 넘긴다. 승인 응답을 잃어 입금대기 기록 없이 입금된 위젯 가상계좌면
   * 여기서 무통장으로 옮긴다 — TOSS 로 남으면 환불 신청이 NOT_BANK_TRANSFER 로 막히고 환불계좌 없이 취소가 나간다.
   */
  async finalizeApproval(
    charge: Charge,
    paymentKey: string,
    correlationId: string,
    virtualAccount?: TossVirtualAccount | null,
  ): Promise<void> {
    const intent = await this.loadIntent(charge.intentId);
    const now = new Date().toISOString();
    const payload = charge.responsePayload ?? {};
    const [bankMethod] =
      virtualAccount && !payload.virtualAccount && intent.userId
        ? await this.bankTransferProvider.getUserMethods(intent.userId)
        : [];

    await this.dbService.db.transaction(async (tx) => {
      if (bankMethod) {
        await tx.update(paymentIntents).set({ paymentMethodId: bankMethod.id }).where(eq(paymentIntents.id, intent.id));
      }
      await this.chargesService.updateStatus(
        charge.id,
        'SUCCEEDED',
        {
          providerTransactionId: paymentKey,
          ...(bankMethod
            ? { paymentMethodId: bankMethod.id, responsePayload: { ...payload, paymentKey, virtualAccount } }
            : {}),
        },
        tx,
      );

      await this.stateTransitionService.transitionIntent(
        intent.id,
        'AUTHORIZED',
        {
          correlationId,
          reasonCode: 'AUTHORIZE_SUCCEEDED',
          outboxEvent: {
            eventType: GatewayEventType.INTENT_AUTHORIZED,
            aggregateId: intent.id,
            payload: buildPaymentIntentEventPayload({
              intentId: intent.id,
              userId: intent.userId ?? '',
              status: 'AUTHORIZED',
              payableAmount: intent.payableAmount,
              currency: intent.currency,
              occurredAt: now,
              extra: { medusa_session_id: intent.metadata?.medusa_session_id },
            }),
          },
        },
        undefined,
        tx,
      );
    });

    await this.autoCaptureService.attemptAutoCapture(charge.intentId, correlationId);

    // 무통장(토스 가상계좌) 입금이 웹훅으로 자동확인된 경우, confirm 단계에서 고객이 신청한
    // 현금영수증을 여기서 발급한다
    // 발급 실패가 결제확정을 되돌리지 않는다.
    const cashReceipt = intent.metadata?.cashReceipt as
      | { type: '소득공제' | '지출증빙'; customerIdentityNumber: string }
      | undefined;
    if (cashReceipt && intent.userId) {
      try {
        await this.cashReceiptsService.issue({ intentId: intent.id, ...cashReceipt }, intent.userId);
        this.logger.log(`cash receipt issued on webhook capture: intentId=${intent.id}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`cash receipt auto-issue failed (webhook capture): intentId=${intent.id}, error=${message}`);
      }
    }
  }

  async finalizeFailure(charge: Charge, errorCode: string, correlationId: string): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      await this.chargesService.updateStatus(
        charge.id,
        'FAILED',
        {
          errorCode,
          errorMessage: `Payment ${errorCode.toLowerCase()} on Toss side`,
        },
        tx,
      );

      await this.stateTransitionService.transitionIntent(
        charge.intentId,
        'CREATED',
        {
          correlationId,
          reasonCode: 'AUTHORIZE_FAILED',
          reasonMessage: errorCode,
        },
        undefined,
        tx,
      );
    });
  }

  private async loadIntent(intentId: string): Promise<PaymentIntent> {
    const intent = await this.dbService.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1)
      .then((r) => r[0]);

    if (!intent) {
      throw new NotFoundException({ error: 'INTENT_NOT_FOUND' });
    }

    return intent;
  }
}

/** 위젯 가상계좌 기한은 토스 상점 설정을 따른다 — 고객이 안내받은 dueDate 로 만료하고, 없을 때만 우리 윈도우를 쓴다. */
function depositDeadline(dueDate: string | null | undefined): Date {
  const due = dueDate ? new Date(dueDate) : null;
  return due && !Number.isNaN(due.getTime()) ? due : new Date(Date.now() + depositWindowHours() * 60 * 60_000);
}
