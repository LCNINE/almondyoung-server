import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils';
import { capturePaymentWorkflow } from '@medusajs/core-flows';
import { completeCartWorkflow, cancelOrderWorkflow, deleteLineItemsWorkflow } from '@medusajs/medusa/core-flows';

// Process-level idempotency store (in-memory, resets on restart).
// DB-backed persistence is a follow-up (idempotency_keys table or payment_events table).
const processedMessageIds = new Set<string>();
const MAX_IDEMPOTENCY_STORE_SIZE = 10_000;

const CAPTURE_EVENT_TYPES = new Set([
  'gateway.charge.captured',
  'payment.intent.captured',
  'payment.intent.succeeded',
  'PaymentCaptured',
]);

// 무통장입금 입금 대기 진입 — 주문을 '입금확인중' 으로 선생성
const AWAITING_DEPOSIT_EVENT_TYPES = new Set([
  'payment.intent.awaiting_deposit',
]);

const CANCEL_EVENT_TYPES = new Set([
  'PaymentCancelled',
  'payment.intent.cancelled',
  'payment.intent.canceled', // wallet GatewayEventType.INTENT_CANCELED (single-l)
  'gateway.charge.voided',
]);

const REFUND_EVENT_TYPES = new Set([
  'PaymentRefundCompleted',
  'RefundApproved',
  'payment.intent.refunded',
  'gateway.charge.refunded',
]);

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.body as Record<string, unknown>;

  const messageId = body?.messageId as string | undefined;
  const messageType = body?.messageType as string | undefined;
  const payload = body?.payload as Record<string, unknown> | undefined;

  if (!messageId || !messageType || !payload) {
    return res.status(400).json({
      error: 'INVALID_WEBHOOK_PAYLOAD',
      message: 'messageId, messageType, and payload are required',
    });
  }

  if (processedMessageIds.has(messageId)) {
    return res.status(200).json({ status: 'ALREADY_PROCESSED', messageId });
  }

  const effectiveEventType: string = (payload?.eventType as string | undefined) ?? messageType;
  const intentId = payload?.intentId as string | undefined;

  const logger = (req.scope.resolve('logger') as { info: Function; warn: Function; error: Function; debug: Function });

  if (!intentId) {
    logger.debug(`[payment-events] No intentId in payload, skipping. messageType=${messageType}, messageId=${messageId}`);
    return res.status(200).json({ status: 'SKIPPED', reason: 'no_intent_id', messageId });
  }

  // Mark as processing only after validation; remove on failure so transient errors can be retried
  processedMessageIds.add(messageId);
  if (processedMessageIds.size > MAX_IDEMPOTENCY_STORE_SIZE) {
    const oldest = processedMessageIds.values().next().value as string;
    processedMessageIds.delete(oldest);
  }

  const amount = typeof payload?.amount === 'number' ? (payload.amount as number) : undefined;
  const channelOrderId = payload?.channelOrderId as string | undefined;

  try {
    if (CAPTURE_EVENT_TYPES.has(effectiveEventType)) {
      await handleCaptureProjection(req.scope, intentId, messageId, logger);
    } else if (AWAITING_DEPOSIT_EVENT_TYPES.has(effectiveEventType)) {
      await handleAwaitingDepositProjection(req.scope, intentId, messageId, logger);
    } else if (CANCEL_EVENT_TYPES.has(effectiveEventType)) {
      await handleCancelProjection(req.scope, intentId, messageId, logger);
    } else if (REFUND_EVENT_TYPES.has(effectiveEventType)) {
      await handleRefundProjection(req.scope, intentId, amount, messageId, channelOrderId, logger);
    } else {
      logger.debug(`[payment-events] Unhandled eventType=${effectiveEventType}, intentId=${intentId}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      `[payment-events] Projection update failed: eventType=${effectiveEventType}, intentId=${intentId}, error=${msg}`,
    );
    // Remove so the next delivery of this messageId can retry
    processedMessageIds.delete(messageId);
    return res.status(500).json({ status: 'ERROR', messageId, error: msg });
  }

  return res.status(200).json({ status: 'OK', messageId, eventType: effectiveEventType });
};

/**
 * Marks a Medusa payment as cancelled (projection only).
 *
 * Core/Wallet is the payment SSOT. The provider cancel was already executed by
 * Wallet before this event was emitted. We update Medusa's DB record directly via
 * paymentModule.updatePayment() — a pure-DB operation that does NOT call the
 * payment provider (confirmed from source: "currently there is no update with the provider").
 */
export async function handleCancelProjection(
  scope: any,
  intentId: string,
  messageId: string,
  logger: { info: Function; warn: Function; debug: Function; error: Function },
) {
  const paymentModule = scope.resolve(Modules.PAYMENT);
  const sessionId = await resolvePaymentSessionId(paymentModule, intentId);
  const payments = sessionId
    ? await paymentModule.listPayments({ payment_session_id: sessionId }, {})
    : [];
  const payment = payments[0];

  if (!payment) {
    // No Medusa payment to cancel — terminal no-op, not a retryable failure.
    // Either the intent never originated from a Medusa checkout (membership/billing
    // intents have no Medusa session, ever), or it was an abandoned bank-transfer
    // order that was never completed. We don't create an order just to cancel it.
    // Returning (not throwing) makes the hook respond 200 so the event is not retried.
    logger.info(
      `[payment-events] handleCancelProjection: no Medusa payment for intentId=${intentId}, skipping (messageId=${messageId})`,
    );
    return;
  }

  if (payment.canceled_at) {
    logger.debug(`[payment-events] handleCancelProjection: already cancelled, skipping. payment_id=${payment.id}`);
    return;
  }

  // 무통장 선생성 주문 정리. 미입금 취소/만료(payment.intent.canceled) 시 아직 입금
  // 확정(capture)되지 않은 주문이면 주문을 취소하고 예약재고를 해제한다. cancelOrderWorkflow 가
  // 주문 상태 변경 + 재고 예약 해제 + 결제 취소를 함께 처리한다(almond-payment.cancelPayment 는
  // 이미 취소된 wallet intent 에 대해 no-op 이므로 충돌 없음). 입금 확정된 주문은 취소하지 않음.
  //
  // 중요: payment.canceled_at 표시보다 '먼저' 주문을 취소하고, 취소 실패 시 throw. payment 를
  // 먼저 취소해버리면 위 가드(payment.canceled_at)에 걸려 재배달 시 주문 취소를 다시 시도하지 못해
  // 고아 주문 + 예약재고 누수가 영구화됨. throw → outer handler 500 → 재배달 시 재시도됨.
  if (!payment.captured_at) {
    const orderId = await resolveOrderIdForIntent(scope, intentId);
    if (orderId) {
      const orderModule = scope.resolve(Modules.ORDER);
      // 일시적 lookup 오류를 null 로 삼키면 안 됨: cancelOrderWorkflow 를 건너뛴 채 아래에서
      // payment.canceled_at 을 찍어버려 위 가드(payment.canceled_at)에 걸리고, 재배달 시 주문 취소를
      // 다시 시도하지 못해 고아 주문 + 예약재고 누수가 영구화된다(위 워크플로 실패 경로와 동일한 불변식).
      // 따라서 NotFound(이미 하드삭제돼 취소 대상이 없는 주문)만 no-op 로 통과시키고, 그 외 오류는
      // throw → outer handler 500 → 재배달 시 재시도되게 한다.
      let order: { id: string; status: string } | null = null;
      try {
        order = await orderModule.retrieveOrder(orderId, { select: ['id', 'status'] });
      } catch (lookupErr) {
        if (lookupErr instanceof MedusaError && lookupErr.type === MedusaError.Types.NOT_FOUND) {
          logger.info(
            `[payment-events] handleCancelProjection: order ${orderId} not found (already deleted), skipping order cancel. intentId=${intentId}`,
          );
        } else {
          throw lookupErr;
        }
      }
      if (order && order.status !== 'canceled') {
        const { errors } = await cancelOrderWorkflow(scope).run({
          input: { order_id: orderId, no_notification: true },
          throwOnError: false,
        });
        if (errors?.length) {
          const emsg = (errors[0]?.error as any)?.message ?? String(errors[0]?.error);
          // retryable failure — payment 는 아직 canceled 로 표시하지 않은 상태이므로 안전하게 재시도됨.
          throw new Error(
            `[payment-events] handleCancelProjection: cancelOrderWorkflow failed for order ${orderId} intentId=${intentId}: ${emsg}`,
          );
        }
        logger.info(
          `[payment-events] handleCancelProjection: canceled order ${orderId} for unpaid intentId=${intentId}`,
        );
      }
    }
  }

  // 주문 취소 성공(또는 주문 없음/카드/이미 취소) 후에만 payment projection 을 취소로 표시.
  // cancelOrderWorkflow 가 결제까지 취소해 canceled_at 이 이미 찍혔으면 중복 표시를 피함.
  const latest = (await paymentModule.listPayments({ id: payment.id }, {}))[0] ?? payment;
  if (latest.canceled_at) {
    logger.info(
      `[payment-events] handleCancelProjection: payment_id=${payment.id} already canceled by workflow for intentId=${intentId}`,
    );
    return;
  }

  // updatePayment is a DB-only operation — no provider side effect
  await paymentModule.updatePayment({
    id: payment.id,
    canceled_at: new Date(),
    metadata: {
      ...((latest.metadata as object) ?? {}),
      walletCancelMessageId: messageId,
    },
  });

  logger.info(`[payment-events] handleCancelProjection: marked payment_id=${payment.id} as cancelled for intentId=${intentId}`);
}

/**
 * Records a Wallet-issued refund in Medusa's payment metadata and order metadata (projection only).
 *
 * Core/Wallet already executed the PG refund. This hook does NOT call the payment
 * provider again. Steps:
 *   1. payment.metadata: append to walletRefunds[], increment walletTotalRefunded
 *   2. order.metadata: update walletTotalRefunded/walletLastRefundAt (best-effort, non-fatal)
 *
 * channelOrderId (Medusa order ID) is supplied by channel-adapter via wms_order_mappings lookup.
 * If absent, order-level projection is skipped — payment metadata is always updated.
 *
 * Idempotency:
 *   - Payment metadata: messageId 기반. walletRefunds[]에 있으면 재가산 안 함.
 *   - Order metadata: order.metadata.walletRefundMessageIds[] 기반으로 payment idempotency와 독립 관리.
 *     Step 1 성공 + Step 2 실패 이후 재처리 시 order에 정확하게 반영한다.
 *   - Failure marker clear: payment의 모든 walletRefunds messageId가 order의
 *     walletRefundMessageIds에 포함된 경우에만 clear해 부분 실패분 누락을 방지한다.
 */
export async function handleRefundProjection(
  scope: any,
  intentId: string,
  amount: number | undefined,
  messageId: string,
  channelOrderId: string | undefined,
  logger: { info: Function; warn: Function; debug: Function; error: Function },
) {
  const paymentModule = scope.resolve(Modules.PAYMENT);
  const sessionId = await resolvePaymentSessionId(paymentModule, intentId);
  const payments = sessionId
    ? await paymentModule.listPayments({ payment_session_id: sessionId }, {})
    : [];
  const payment = payments[0];

  if (!payment) {
    // No Medusa payment to record the refund against — the intent never originated
    // from a Medusa checkout. Terminal no-op → respond 200, no retry.
    logger.info(
      `[payment-events] handleRefundProjection: no Medusa payment for intentId=${intentId}, skipping (messageId=${messageId})`,
    );
    return;
  }

  const refundAmount = amount ?? 0;
  if (refundAmount <= 0) {
    throw new Error(`[payment-events] handleRefundProjection: amount=${amount} is invalid for payment_id=${payment.id} (messageId=${messageId})`);
  }

  // ── Step 1: payment.metadata 업데이트 (멱등성: messageId 기반) ──────────
  const existingMeta = (payment.metadata as Record<string, unknown>) ?? {};
  const processedRefunds = (existingMeta.walletRefunds as Array<{ messageId: string }>) ?? [];
  const alreadyProcessed = processedRefunds.some((r) => r.messageId === messageId);

  // Step 2에서 실패 마커 write/clear 시 Step 1 이후 최신 상태를 기준으로 써야
  // 오래된 metadata로 덮어쓰는 문제를 막는다.
  let metaAfterStep1: Record<string, unknown>;

  if (!alreadyProcessed) {
    const updatedRefunds = [
      ...processedRefunds,
      { messageId, amount: refundAmount, recordedAt: new Date().toISOString() },
    ];
    metaAfterStep1 = {
      ...existingMeta,
      walletRefunds: updatedRefunds,
      walletTotalRefunded: (typeof existingMeta.walletTotalRefunded === 'number' ? existingMeta.walletTotalRefunded : 0) + refundAmount,
    };

    // updatePayment is a DB-only operation — no provider side effect
    await paymentModule.updatePayment({ id: payment.id, metadata: metaAfterStep1 });

    logger.info(
      `[payment-events] handleRefundProjection: recorded refund payment_id=${payment.id} amount=${refundAmount} messageId=${messageId}`,
    );
  } else {
    metaAfterStep1 = existingMeta;
    logger.debug(
      `[payment-events] handleRefundProjection: already recorded messageId=${messageId}, skipping payment update. payment_id=${payment.id}`,
    );
  }

  // ── Step 2: order.metadata 업데이트 (best-effort, non-fatal) ────────────
  // channelOrderId는 channel-adapter가 wms_order_mappings에서 조회해 payload에 실어 보냄
  if (!channelOrderId) {
    logger.warn(
      `[payment-events] handleRefundProjection: channelOrderId missing, skipping order projection. payment_id=${payment.id} messageId=${messageId}`,
    );
    await paymentModule.updatePayment({
      id: payment.id,
      metadata: {
        ...metaAfterStep1,
        walletOrderProjectionStatus: 'skipped_missing_channel_order_id',
      },
    });
    return;
  }

  try {
    const orderModule = scope.resolve(Modules.ORDER);
    const order = await orderModule.retrieveOrder(channelOrderId, { select: ['id', 'metadata'] });
    const orderMeta = (order?.metadata as Record<string, unknown>) ?? {};
    const prevTotal = typeof orderMeta.walletTotalRefunded === 'number' ? orderMeta.walletTotalRefunded : 0;

    // Order-level idempotency: payment.metadata의 alreadyProcessed와 독립적으로 관리한다.
    // Step 1(payment 기록)은 성공했지만 Step 2(order 반영)가 실패한 경우,
    // 재처리 시 alreadyProcessed=true여도 order에는 금액이 반영되지 않았을 수 있다.
    const orderRefundMessageIds = (orderMeta.walletRefundMessageIds as string[]) ?? [];
    const orderAlreadyProjected = orderRefundMessageIds.includes(messageId);
    const updatedOrderRefundMessageIds = orderAlreadyProjected
      ? orderRefundMessageIds
      : [...orderRefundMessageIds, messageId];

    await orderModule.updateOrders([{
      id: channelOrderId,
      metadata: {
        ...orderMeta,
        walletTotalRefunded: orderAlreadyProjected ? prevTotal : prevTotal + refundAmount,
        walletRefundMessageIds: updatedOrderRefundMessageIds,
        walletRefundStatus: 'succeeded',
        walletLastRefundAt: new Date().toISOString(),
      },
    }]);

    logger.info(
      `[payment-events] handleRefundProjection: updated order metadata orderId=${channelOrderId} walletTotalRefunded=${orderAlreadyProjected ? prevTotal : prevTotal + refundAmount}`,
    );

    // 실패 마커 clear 조건: payment에 기록된 모든 messageId가 order에도 반영된 경우에만.
    // 이전 이벤트 A가 order projection에 실패한 상태에서 이벤트 B가 성공해도,
    // A가 아직 order에 반영되지 않았다면 마커를 clear하지 않는다.
    const projectionStatus = metaAfterStep1.walletOrderProjectionStatus;
    if (projectionStatus === 'failed' || projectionStatus === 'skipped_missing_channel_order_id') {
      const allPaymentMessageIds = ((metaAfterStep1.walletRefunds as Array<{ messageId: string }>) ?? []).map((r) => r.messageId);
      const allProjected = allPaymentMessageIds.every((id) => updatedOrderRefundMessageIds.includes(id));
      if (allProjected) {
        await paymentModule.updatePayment({
          id: payment.id,
          metadata: {
            ...metaAfterStep1,
            walletOrderProjectionStatus: 'succeeded',
            walletOrderProjectionError: null,
            walletOrderProjectionFailedAt: null,
          },
        });
      }
    }
  } catch (orderErr) {
    const msg = orderErr instanceof Error ? orderErr.message : String(orderErr);
    logger.error(
      `[payment-events] handleRefundProjection: order metadata update failed orderId=${channelOrderId}, error=${msg}`,
    );
    // payment.metadata에 projection 실패 상태를 기록. metaAfterStep1 기준으로 써서 Step 1 데이터를 보존한다.
    try {
      await paymentModule.updatePayment({
        id: payment.id,
        metadata: {
          ...metaAfterStep1,
          walletOrderProjectionStatus: 'failed',
          walletOrderProjectionError: msg,
          walletOrderProjectionFailedAt: new Date().toISOString(),
        },
      });
    } catch (metaErr) {
      logger.error(
        `[payment-events] handleRefundProjection: failed to record projection failure in payment metadata, paymentId=${payment.id}`,
      );
    }
  }
}

/**
 * Marks a Medusa payment as captured (projection only).
 *
 * Core/Wallet is the payment SSOT. The provider capture was already executed by
 * Wallet before this event was emitted. We set `payment.data.captured = true` so
 * that the almond-payment provider skips its Wallet API call, then run
 * capturePaymentWorkflow to let Medusa create the capture sub-record, update the
 * payment collection status, and add the order transaction — all DB-only operations.
 *
 * Payment session lookup: Medusa auto-generates payses_* IDs — the intentId is stored
 * in data.intentId (JSONB). We resolve the session ID via JSON containment filter, then
 * look up the payment by payment_session_id = session.id.
 *
 * Bank transfer path (무통장입금): cart.complete() is never called before capture
 * because the storefront waits for the bank transfer confirmation page without
 * completing the cart. When the admin confirms the payment in Wallet/admin, the
 * intent becomes CAPTURED and this event fires — but no Medusa payment row exists yet.
 * In that case we recover by running completeCartWorkflow first to create the order,
 * then proceed with the normal capture projection.
 */
async function resolvePaymentSessionId(
  paymentModule: any,
  intentId: string,
): Promise<string | null> {
  // Medusa auto-generates payment session IDs (payses_*) — the intentId is stored in
  // data.intentId, not used as the session ID. We filter by JSON containment on the
  // data column (PostgreSQL JSONB @> operator, supported by MikroORM v6).
  const sessions = await paymentModule.listPaymentSessions(
    { data: { intentId } } as any,
    { select: ['id'] },
  );
  return (sessions[0] as any)?.id ?? null;
}

/**
 * 무통장입금 입금 대기 진입(payment.intent.awaiting_deposit) 시 주문을 '입금확인중' 으로 선생성.
 *
 * recoverBankTransferOrder 가 completeCartWorkflow 로 주문을 만든다 — almond-payment 가
 * AWAITING_DEPOSIT 을 'authorized' 로 매핑하므로 cart 완료가 가능하다(결제는 authorized 상태,
 * 실제 capture 는 관리자 입금확인 INTENT_CAPTURED 시점). 생성된 주문에는 metadata.bank_transfer_status='awaiting_deposit' 를 달아 storefront 주문내역에서 '입금확인중' 으로 표시.
 *
 * 멱등성: recoverBankTransferOrder 가 cart.completed_at / order_cart link 로 중복 생성을 막고, 이벤트가 유실돼도 입금확인(capture) 시 동일 복구 경로가 주문을 만든다(graceful degradation).
 */
export async function handleAwaitingDepositProjection(
  scope: any,
  intentId: string,
  messageId: string,
  logger: { info: Function; warn: Function; debug: Function; error: Function },
) {
  // 주문을 '입금확인중'(awaiting_deposit) marker 와 함께 원자적으로 선생성.
  // marker 는 recoverBankTransferOrder 가 cart.metadata 에 심고 completeCartWorkflow 가 order.metadata
  // 로 복사하므로(=주문 생성과 marker 가 분리되지 않음), marker 없는 authorized 주문이 WMS 수집 게이트를 통과하는 창이 존재하지 않음.
  //
  // 이벤트 순서 역전(관리자 즉시 입금확인 → capture 가 먼저 처리되어 주문이 이미 완료)인 경우, recoverBankTransferOrder 가 cart.completed_at 으로 멱등 skip 하여 marker 를 심지 않음(그 주문은 captured 라 게이트가 payment_status 로 정상 수집한다). 따라서 별도의 captured 가드 불필요.
  await recoverBankTransferOrder(scope, intentId, messageId, logger, /* markAwaitingDeposit */ true);

  // 원본 장바구니에서 구매한 아이템 제거. 무통장은 callback 을 안 타므로 서버사이드에서 정리
  // 실패해도 주문엔 이미 marker 가 있어 WMS 수집은 막힌 채 재시도됨.
  await cleanupSourceCartItems(scope, intentId, logger);
}

/**
 * intentId 로 선생성된 Medusa 주문 ID 를 역추적.
 * intent → payment_session(data.intentId) → payment_collection → cart → order_cart link
 * 주문이 아직 없으면 null.
 */
async function resolveOrderIdForIntent(scope: any, intentId: string): Promise<string | null> {
  const paymentModule = scope.resolve(Modules.PAYMENT);
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  const sessions = await paymentModule.listPaymentSessions(
    { data: { intentId } } as any,
    { select: ['id', 'payment_collection_id'] },
  );
  const session = sessions[0];
  if (!session) return null;

  const { data: collections } = await query.graph({
    entity: 'payment_collection',
    fields: ['id', 'cart.id'],
    filters: { id: (session as any).payment_collection_id },
  });
  const cartId = (collections[0] as any)?.cart?.id as string | undefined;
  if (!cartId) return null;

  const { data: orderCartLinks } = await query.graph({
    entity: 'order_cart',
    fields: ['cart_id', 'order_id'],
    filters: { cart_id: cartId },
  });
  return ((orderCartLinks[0] as any)?.order_id as string | undefined) ?? null;
}

/**
 * intentId 로 결제용 checkout cart ID 를 역추적.
 * intent → payment_session(data.intentId) → payment_collection → cart.
 */
async function resolveCheckoutCartIdForIntent(scope: any, intentId: string): Promise<string | null> {
  const paymentModule = scope.resolve(Modules.PAYMENT);
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  const sessions = await paymentModule.listPaymentSessions(
    { data: { intentId } } as any,
    { select: ['id', 'payment_collection_id'] },
  );
  const session = sessions[0];
  if (!session) return null;

  const { data: collections } = await query.graph({
    entity: 'payment_collection',
    fields: ['id', 'cart.id'],
    filters: { id: (session as any).payment_collection_id },
  });
  return ((collections[0] as any)?.cart?.id as string | undefined) ?? null;
}

/**
 * 무통장입금 주문 선생성 직후, 고객이 보던 원본 장바구니에서 구매한 아이템을 제거.
 *
 * 카드 결제는 브라우저 callback(processPaymentCallback)에서 source cart 를 정리하지만, 무통장은
 * wallet-web 입금대기 화면에서 멈춰 callback 을 타지 않으므로 원본 장바구니가 그대로 남는다.
 * checkout cart 의 metadata.source_cart_id / source_line_item_ids 를 기준으로 서버사이드에서 제거.
 *
 * 멱등성: 원본 카트에 현재 존재하는 라인만 골라 삭제하므로 재시도해도 안전(이미 지워졌으면 no-op).
 * 원본 카트 자체가 완료(주문 전환)됐으면 건드리지 않음.
 * 실패 시 throw → hook 이 재시도(주문은 이미 생성됐고 recover 가 멱등이라 정리만 다시 시도됨).
 */
async function cleanupSourceCartItems(scope: any, intentId: string, logger: { info: Function; warn: Function; error: Function }): Promise<void> {
  const checkoutCartId = await resolveCheckoutCartIdForIntent(scope, intentId);
  if (!checkoutCartId) return;

  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: checkoutCarts } = await query.graph({
    entity: 'cart',
    fields: ['id', 'metadata'],
    filters: { id: checkoutCartId },
  });
  const meta = ((checkoutCarts[0] as any)?.metadata as Record<string, unknown> | null) ?? {};
  const sourceCartId = typeof meta.source_cart_id === 'string' ? meta.source_cart_id : null;
  const sourceLineItemIds = Array.isArray(meta.source_line_item_ids)
    ? (meta.source_line_item_ids as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];

  if (!sourceCartId || sourceCartId === checkoutCartId || sourceLineItemIds.length === 0) {
    return;
  }

  // 원본 카트가 완료됐으면(자기 자신이 주문이 된 경우 등) 건드리지 않음. 현재 존재하는 라인만 삭제.
  const { data: sourceCarts } = await query.graph({
    entity: 'cart',
    fields: ['id', 'completed_at', 'items.id'],
    filters: { id: sourceCartId },
  });
  const sourceCart = sourceCarts[0] as { completed_at?: string | null; items?: Array<{ id: string }> } | undefined;
  if (!sourceCart || sourceCart.completed_at) {
    return;
  }

  const existingIds = new Set((sourceCart.items ?? []).map((it) => it.id));
  const idsToDelete = sourceLineItemIds.filter((id) => existingIds.has(id));
  if (idsToDelete.length === 0) {
    return;
  }

  await deleteLineItemsWorkflow(scope).run({
    input: { cart_id: sourceCartId, ids: idsToDelete },
  });

  logger.info(
    `[payment-events] cleanupSourceCartItems: removed ${idsToDelete.length} purchased item(s) from source cart ${sourceCartId} (intentId=${intentId})`,
  );
}

/**
 * 무통장 선생성 주문의 입금 상태 메타데이터(bank_transfer_status)를 갱신.
 * - 'awaiting_deposit' (선생성 시): 무조건 설정.
 * - 'confirmed' (입금확인 capture 시): onlyIfAwaiting 으로, 기존이 'awaiting_deposit' 인 무통장 주문에만 설정(카드 주문/복구 폴백 주문은 건드리지 않음).
 * best-effort — 실패해도 결제 projection 자체를 막지 않음.
 */
async function updateBankTransferOrderStatus(
  scope: any,
  intentId: string,
  status: 'awaiting_deposit' | 'confirmed',
  logger: { info: Function; warn: Function; debug: Function; error: Function },
  opts: { onlyIfAwaiting?: boolean } = {},
): Promise<void> {
  try {
    const orderId = await resolveOrderIdForIntent(scope, intentId);
    if (!orderId) {
      logger.warn(
        `[payment-events] updateBankTransferOrderStatus: no order for intentId=${intentId}, skipping (status=${status})`,
      );
      return;
    }
    const orderModule = scope.resolve(Modules.ORDER);
    const order = await orderModule.retrieveOrder(orderId, { select: ['id', 'metadata'] });
    const meta = (order?.metadata as Record<string, unknown>) ?? {};
    if (opts.onlyIfAwaiting && meta.bank_transfer_status !== 'awaiting_deposit') {
      return;
    }
    // 방어: 이미 입금확정(confirmed)된 주문을 다시 '입금확인중' 으로 되돌리지 않음.
    if (status === 'awaiting_deposit' && meta.bank_transfer_status === 'confirmed') {
      return;
    }
    await orderModule.updateOrders([
      { id: orderId, metadata: { ...meta, bank_transfer_status: status } },
    ]);
    logger.info(
      `[payment-events] updateBankTransferOrderStatus: order ${orderId} bank_transfer_status=${status} (intentId=${intentId})`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      `[payment-events] updateBankTransferOrderStatus failed intentId=${intentId} status=${status}: ${msg}`,
    );
  }
}

export async function handleCaptureProjection(
  scope: any,
  intentId: string,
  messageId: string,
  logger: { info: Function; warn: Function; debug: Function; error: Function },
) {
  const paymentModule = scope.resolve(Modules.PAYMENT);

  const sessionId = await resolvePaymentSessionId(paymentModule, intentId);

  if (!sessionId) {
    // No Medusa payment session for this intent — it never originated from a Medusa
    // checkout (membership/billing intents have no session, ever). Bank-transfer
    // recovery only applies when a session exists but the cart was not completed, so
    // there is nothing to recover here. Terminal no-op → respond 200, no retry.
    logger.info(
      `[payment-events] handleCaptureProjection: no Medusa payment session for intentId=${intentId}, skipping (messageId=${messageId})`,
    );
    return;
  }

  let payments = await paymentModule.listPayments(
    { payment_session_id: sessionId },
    { relations: ['captures'] },
  );
  let payment = payments[0];

  if (!payment) {
    // Bank transfer recovery path: cart was never completed.
    // completeCartWorkflow creates the order + payment row; after that the normal
    // capture projection below handles the rest.
    logger.info(
      `[payment-events] handleCaptureProjection: no payment found for intentId=${intentId}, attempting bank transfer cart recovery (messageId=${messageId})`,
    );
    await recoverBankTransferOrder(scope, intentId, messageId, logger);

    // Re-query after recovery using the already-resolved sessionId (guaranteed non-null
    // by the guard above — recovery completes the cart, it does not change the session).
    payments = await paymentModule.listPayments(
      { payment_session_id: sessionId },
      { relations: ['captures'] },
    );
    payment = payments[0];

    if (!payment) {
      // Recovery completed idempotently (cart was already completed via another path
      // or the order already existed). No payment row to update — log and exit cleanly.
      logger.warn(
        `[payment-events] handleCaptureProjection: no payment row after recovery for intentId=${intentId}, skipping capture projection (messageId=${messageId})`,
      );
      return;
    }
  }

  if (payment.captured_at) {
    logger.debug(`[payment-events] handleCaptureProjection: already captured, skipping capture. payment_id=${payment.id}`);
    // 이전 시도에서 원본 카트 정리/상태 갱신이 실패했을 수 있으므로 다시 보장.
    await cleanupSourceCartItems(scope, intentId, logger);
    await updateBankTransferOrderStatus(scope, intentId, 'confirmed', logger, { onlyIfAwaiting: true });
    return;
  }

  // Set the captured flag in payment.data before running the workflow so the
  // almond-payment provider skips the Wallet API call. capturePaymentWorkflow then
  // creates the capture sub-record, updates the payment collection status, and adds
  // the order transaction — all DB-only, no PG side effect.
  //
  // Intermediate-state safety: if capturePaymentWorkflow throws after this updatePayment
  // succeeds, payment.data.captured=true but captured_at/capture sub-record are absent.
  // On retry the outer handler returns 500 (processedMessageIds is cleared), the caller
  // redelivers, and the workflow re-runs from the same consistent starting point:
  // captured_at is still null so capturePayment_ creates a fresh capture record;
  // the provider sees captured:true and skips the Wallet call. Recovery is automatic.
  await paymentModule.updatePayment({
    id: payment.id,
    data: {
      ...((payment.data as object) ?? {}),
      captured: true,
      walletCaptureMessageId: messageId,
    },
  });

  await capturePaymentWorkflow(scope).run({
    input: { payment_id: payment.id },
  });

  // 입금확인(capture)으로 주문이 처음 확정된 폴백 경로(입금대기 이벤트 유실)에서도 원본 카트 정리 보장.
  await cleanupSourceCartItems(scope, intentId, logger);

  // 무통장 선생성 주문이라면 '입금확인중' → '입금확정' 으로 메타데이터를 갱신.
  // onlyIfAwaiting 으로 무통장 주문에만 적용 (카드/복구 폴백 주문은 무시).
  await updateBankTransferOrderStatus(scope, intentId, 'confirmed', logger, {
    onlyIfAwaiting: true,
  });

  logger.info(`[payment-events] handleCaptureProjection: projected capture for payment_id=${payment.id} intentId=${intentId}`);
}

/**
 * Bank transfer recovery: finds the cart for the given intentId and runs
 * completeCartWorkflow if the order has not been created yet.
 *
 * Lookup path: intentId → payment_session (filter by data.intentId, JSONB containment)
 *   → payment_session.payment_collection_id
 *   → payment_collection.cart (via CartPaymentCollection link, bidirectional)
 *   → completeCartWorkflow
 *
 * Idempotency:
 *   - cart.completed_at: set by completeCartWorkflow on success → skip
 *   - order_cart link: exists if order was created by any path → skip
 *
 * After completeCartWorkflow the almond-payment provider's authorizePayment
 * calls Wallet, receives CAPTURED status, and Medusa's payment module maps
 * 'captured' → 'authorized' internally (payment-module.js line 242-243),
 * so the authorization succeeds and the order is created with an authorized
 * (not yet captured) payment row. The caller then runs capturePaymentWorkflow
 * to record the capture sub-record.
 */
async function recoverBankTransferOrder(
  scope: any,
  intentId: string,
  messageId: string,
  logger: { info: Function; warn: Function; debug: Function },
  // 입금대기 경로: 주문 생성 전에 cart.metadata 에 bank_transfer_status='awaiting_deposit' 를
  // 심어 order 가 marker 와 함께 원자적으로 생성되게 함. capture 폴백 경로는 false(=marker 없음).
  markAwaitingDeposit = false,
): Promise<void> {
  const paymentModule = scope.resolve(Modules.PAYMENT);
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  // Step 1: find payment session by intentId stored in data.intentId.
  // Medusa generates payses_* IDs — the intentId is in data, not the primary key.
  // PostgreSQL JSONB containment (@>) is used via MikroORM v6's JSON filter.
  const paymentSessions = await paymentModule.listPaymentSessions(
    { data: { intentId } } as any,
    { select: ['id', 'payment_collection_id'] },
  );
  const paymentSession = paymentSessions[0];

  if (!paymentSession) {
    throw new Error(
      `[payment-events] recoverBankTransferOrder: no payment session found for intentId=${intentId} (messageId=${messageId})`,
    );
  }

  const paymentCollectionId = paymentSession.payment_collection_id;

  // Step 2: reverse-traverse the CartPaymentCollection link to find the cart.
  // The link extends PaymentCollection with a 'cart' field alias — bidirectional.
  const { data: collections } = await query.graph({
    entity: 'payment_collection',
    fields: ['id', 'cart.id', 'cart.completed_at', 'cart.metadata'],
    filters: { id: paymentCollectionId },
  });

  const cart = (collections[0] as any)?.cart as
    | { id: string; completed_at: string | null; metadata?: Record<string, unknown> | null }
    | undefined;

  if (!cart?.id) {
    throw new Error(
      `[payment-events] recoverBankTransferOrder: no cart found for payment_collection_id=${paymentCollectionId} intentId=${intentId}`,
    );
  }

  const cartId = cart.id;

  // Step 3: idempotency — cart.completed_at is set by completeCartWorkflow
  if (cart.completed_at) {
    logger.info(
      `[payment-events] recoverBankTransferOrder: cart ${cartId} already completed (completed_at=${cart.completed_at}), skipping. intentId=${intentId}`,
    );
    return;
  }

  // Step 4: idempotency — order_cart link exists if order was created by any path
  const { data: orderCartLinks } = await query.graph({
    entity: 'order_cart',
    fields: ['cart_id', 'order_id'],
    filters: { cart_id: cartId },
  });

  if (orderCartLinks.length > 0) {
    logger.info(
      `[payment-events] recoverBankTransferOrder: order already exists for cart ${cartId} (order_id=${(orderCartLinks[0] as any)?.order_id}), skipping. intentId=${intentId}`,
    );
    return;
  }

  // 무통장 입금대기 주문은 완료 '전에' cart.metadata 에 입금확인중 marker 를 심음.
  // completeCartWorkflow 가 cart.metadata 를 order.metadata 로 복사하므로(core-flows complete-cart), 주문은 marker 와 함께 원자적으로 생성됨 → marker 없는 authorized 주문이 WMS 수집 게이트를 통과하는 창이 존재하지 않음. marker set 이 실패하면 throw → 재시도(주문 미생성 상태 유지).
  if (markAwaitingDeposit) {
    const cartModule = scope.resolve(Modules.CART);
    await cartModule.updateCarts(cartId, {
      metadata: {
        ...((cart.metadata as object) ?? {}),
        bank_transfer_status: 'awaiting_deposit',
      },
    });
    logger.info(
      `[payment-events] recoverBankTransferOrder: stamped awaiting_deposit on cart ${cartId} before completion intentId=${intentId}`,
    );
  }

  // Step 5: complete the cart to create the order
  logger.info(
    `[payment-events] recoverBankTransferOrder: running completeCartWorkflow for cart ${cartId} intentId=${intentId}`,
  );

  const { errors } = await completeCartWorkflow(scope).run({
    input: { id: cartId },
    context: { transactionId: `bank-transfer-recovery:${cartId}` },
    throwOnError: false,
  });

  if (errors?.length) {
    const error = errors[0]?.error;
    throw new Error(
      `[payment-events] recoverBankTransferOrder: completeCartWorkflow failed for cart ${cartId} intentId=${intentId}: ${(error as any)?.message ?? String(error)}`,
    );
  }

  logger.info(
    `[payment-events] recoverBankTransferOrder: order created successfully for cart ${cartId} intentId=${intentId}`,
  );
}
