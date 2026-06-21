import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { capturePaymentWorkflow } from '@medusajs/core-flows';
import { completeCartWorkflow } from '@medusajs/medusa/core-flows';

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
  logger: { info: Function; warn: Function; debug: Function },
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

  // updatePayment is a DB-only operation — no provider side effect
  await paymentModule.updatePayment({
    id: payment.id,
    canceled_at: new Date(),
    metadata: {
      ...((payment.metadata as object) ?? {}),
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

export async function handleCaptureProjection(
  scope: any,
  intentId: string,
  messageId: string,
  logger: { info: Function; warn: Function; debug: Function },
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
    logger.debug(`[payment-events] handleCaptureProjection: already captured, skipping. payment_id=${payment.id}`);
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
    fields: ['id', 'cart.id', 'cart.completed_at'],
    filters: { id: paymentCollectionId },
  });

  const cart = (collections[0] as any)?.cart as { id: string; completed_at: string | null } | undefined;

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
