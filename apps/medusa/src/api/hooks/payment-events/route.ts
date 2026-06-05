import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { Modules } from '@medusajs/framework/utils';
import { capturePaymentWorkflow } from '@medusajs/core-flows';

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

  try {
    if (CAPTURE_EVENT_TYPES.has(effectiveEventType)) {
      await handleCaptureProjection(req.scope, intentId, messageId, logger);
    } else if (CANCEL_EVENT_TYPES.has(effectiveEventType)) {
      await handleCancelProjection(req.scope, intentId, messageId, logger);
    } else if (REFUND_EVENT_TYPES.has(effectiveEventType)) {
      await handleRefundProjection(req.scope, intentId, amount, messageId, logger);
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
async function handleCancelProjection(
  scope: any,
  intentId: string,
  messageId: string,
  logger: { info: Function; warn: Function; debug: Function },
) {
  const paymentModule = scope.resolve(Modules.PAYMENT);
  const payments = await paymentModule.listPayments({ payment_session_id: intentId }, {});
  const payment = payments[0];

  if (!payment) {
    // Throw so the outer handler returns 500 and the caller retries.
    // Guards against the race where a Wallet event arrives before the Medusa payment
    // record is linked (e.g., outbox delivery ordering). Dead-lettering is the
    // caller's responsibility after exhausting retries.
    throw new Error(`[payment-events] handleCancelProjection: no Medusa payment found for intentId=${intentId} (messageId=${messageId})`);
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
 * Records a Wallet-issued refund in Medusa's payment metadata (projection only).
 *
 * Core/Wallet already executed the PG refund. This hook does NOT call the payment
 * provider again. Medusa's order refund_total is NOT updated here — that requires
 * order-context which is unavailable in this hook (TODO: order-level projection via
 * Medusa admin API or order event integration).
 *
 * Idempotency: each messageId maps to exactly one metadata update.
 */
async function handleRefundProjection(
  scope: any,
  intentId: string,
  amount: number | undefined,
  messageId: string,
  logger: { info: Function; warn: Function; debug: Function },
) {
  const paymentModule = scope.resolve(Modules.PAYMENT);
  const payments = await paymentModule.listPayments({ payment_session_id: intentId }, {});
  const payment = payments[0];

  if (!payment) {
    throw new Error(`[payment-events] handleRefundProjection: no Medusa payment found for intentId=${intentId} (messageId=${messageId})`);
  }

  const refundAmount = amount ?? 0;
  if (refundAmount <= 0) {
    // Invalid event — throw so the caller gets 500 and routes to DLQ after retries.
    throw new Error(`[payment-events] handleRefundProjection: amount=${amount} is invalid for payment_id=${payment.id} (messageId=${messageId})`);
  }

  // Check idempotency by messageId stored in metadata
  const existingMeta = (payment.metadata as Record<string, unknown>) ?? {};
  const processedRefunds = (existingMeta.walletRefunds as Array<{ messageId: string }>) ?? [];
  if (processedRefunds.some((r) => r.messageId === messageId)) {
    logger.debug(
      `[payment-events] handleRefundProjection: already recorded messageId=${messageId}, skipping. payment_id=${payment.id}`,
    );
    return;
  }

  const updatedRefunds = [
    ...processedRefunds,
    { messageId, amount: refundAmount, recordedAt: new Date().toISOString() },
  ];

  // updatePayment is a DB-only operation — no provider side effect
  await paymentModule.updatePayment({
    id: payment.id,
    metadata: {
      ...existingMeta,
      walletRefunds: updatedRefunds,
      walletTotalRefunded: (typeof existingMeta.walletTotalRefunded === 'number' ? existingMeta.walletTotalRefunded : 0) + refundAmount,
    },
  });

  logger.info(
    `[payment-events] handleRefundProjection: recorded refund payment_id=${payment.id} amount=${refundAmount} messageId=${messageId}`,
  );
}

/**
 * Marks a Medusa payment as captured (projection only).
 *
 * Core/Wallet is the payment SSOT. The provider capture was already executed by
 * Wallet before this event was emitted. We set `payment.data.captured = true` so
 * that the almond-payment provider skips its Wallet API call, then run
 * capturePaymentWorkflow to let Medusa create the capture sub-record, update the
 * payment collection status, and add the order transaction — all DB-only operations.
 */
async function handleCaptureProjection(
  scope: any,
  intentId: string,
  messageId: string,
  logger: { info: Function; warn: Function; debug: Function },
) {
  const paymentModule = scope.resolve(Modules.PAYMENT);
  const payments = await paymentModule.listPayments(
    { payment_session_id: intentId },
    { relations: ['captures'] },
  );
  const payment = payments[0];

  if (!payment) {
    throw new Error(`[payment-events] handleCaptureProjection: no Medusa payment found for intentId=${intentId} (messageId=${messageId})`);
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
