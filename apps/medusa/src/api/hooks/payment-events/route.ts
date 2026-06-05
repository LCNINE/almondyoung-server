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
async function handleRefundProjection(
  scope: any,
  intentId: string,
  amount: number | undefined,
  messageId: string,
  channelOrderId: string | undefined,
  logger: { info: Function; warn: Function; debug: Function; error: Function },
) {
  const paymentModule = scope.resolve(Modules.PAYMENT);
  const payments = await paymentModule.listPayments({ payment_session_id: intentId }, {});
  const payment = payments[0];

  if (!payment) {
    throw new Error(`[payment-events] handleRefundProjection: no Medusa payment found for intentId=${intentId} (messageId=${messageId})`);
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
