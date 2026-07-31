import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { capturePaymentWorkflow } from '@medusajs/core-flows';
import type { ExecArgs } from '@medusajs/framework/types';
import { handleCaptureProjection } from '../api/hooks/payment-events/route';

/**
 * 고아결제(돈은 빠졌는데 주문이 없는 결제) 백스톱 리컨실.
 *
 * 정상 흐름에서는 지연 승인(deferred approval)이 고아를 원천 차단한다 — PG 승인이
 * completeCartWorkflow 의 마지막 단계에서 일어나므로 재고예약 실패는 승인 전에 롤백된다.
 * 이 잡은 그 앞뒤로 남는 잔여 케이스를 잡는 그물이다:
 *
 *   1) 주문 없음 + wallet CAPTURED  → 먼저 주문 복구를 시도하고, 그래도 안 되면 자동 환불
 *   2) 주문 없음 + wallet AUTHORIZED → intent 취소 (토스는 취소가 곧 승인취소 = 돈 반환)
 *   3) 주문 있음 + wallet CAPTURED/AUTHORIZED 인데 Medusa payment 미캡처 → 캡처 투영/실행
 *
 * core-flows 의 compensatePaymentIfNeededStep 은 Medusa payment.captured_at 만 보므로
 * (1)(2)를 잡지 못한다 — 주문 생성 실패 시엔 Medusa payment 행 자체가 없기 때문이다.
 *
 * 환경변수:
 *   ORPHAN_RECONCILE_MIN_AGE_MINUTES  기본 30 — 이보다 최근 결제는 진행 중으로 보고 건드리지 않는다
 *   ORPHAN_RECONCILE_LOOKBACK_HOURS   기본 48
 *   ORPHAN_RECONCILE_AUTO_REFUND      'false' 로 두면 탐지·로깅만 하고 환불/취소는 하지 않는다
 */

interface WalletIntent {
  id: string;
  status: string;
  payableAmount: number;
}

interface ReconcileSummary {
  scanned: number;
  recovered: number;
  refunded: number;
  canceled: number;
  captured: number;
  failed: number;
  dryRunFindings: string[];
}

function minAgeMs(): number {
  const raw = Number(process.env.ORPHAN_RECONCILE_MIN_AGE_MINUTES);
  return (Number.isFinite(raw) && raw > 0 ? raw : 30) * 60_000;
}

function lookbackMs(): number {
  const raw = Number(process.env.ORPHAN_RECONCILE_LOOKBACK_HOURS);
  return (Number.isFinite(raw) && raw > 0 ? raw : 48) * 60 * 60_000;
}

/** 한 회차에 훑는 payment_collection 상한. 상한에 걸리면 경고를 남긴다. */
const SCAN_LIMIT = 1000;

function autoRefundEnabled(): boolean {
  return process.env.ORPHAN_RECONCILE_AUTO_REFUND !== 'false';
}

async function walletFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = process.env.WALLET_BASE_URL || 'http://localhost:3100';
  const apiKey = process.env.WALLET_API_KEY || 'dev-secret';
  const method = (options.method ?? 'GET').toUpperCase();

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    ...(method !== 'GET' && options.body == null ? { body: JSON.stringify({}) } : {}),
  });

  if (!res.ok) {
    const body: any = await res.json().catch(() => ({}));
    throw new Error(body?.error ? `${body.error}: ${body?.message ?? ''}` : `Wallet API ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

/** cart_id → order_id (링크가 없으면 미포함) */
async function loadOrderLinks(scope: any, cartIds: string[]): Promise<Map<string, string>> {
  if (!cartIds.length) return new Map();
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: links } = await query.graph({
    entity: 'order_cart',
    fields: ['cart_id', 'order_id'],
    filters: { cart_id: cartIds },
  });
  return new Map(
    (links as Array<{ cart_id: string; order_id: string }>).map((l) => [l.cart_id, l.order_id]),
  );
}

export default async function orphanPaymentReconcile({ container }: ExecArgs): Promise<ReconcileSummary> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const paymentModule = container.resolve(Modules.PAYMENT);

  const now = Date.now();
  const since = new Date(now - lookbackMs());
  const cutoff = now - minAgeMs();

  const summary: ReconcileSummary = {
    scanned: 0,
    recovered: 0,
    refunded: 0,
    canceled: 0,
    captured: 0,
    failed: 0,
    dryRunFindings: [],
  };

  const { data: collections } = await query.graph({
    entity: 'payment_collection',
    fields: [
      'id',
      'created_at',
      'cart.id',
      'cart.completed_at',
      'payment_sessions.id',
      'payment_sessions.data',
      'payment_sessions.created_at',
    ],
    filters: { created_at: { $gte: since.toISOString() } },
    pagination: { take: SCAN_LIMIT, skip: 0, order: { created_at: 'ASC' } },
  });

  if ((collections as any[]).length >= SCAN_LIMIT) {
    // 조용한 절단 금지: 스캔 상한에 걸리면 뒤쪽 결제는 이번 회차에서 안 본 것이다.
    logger.warn(
      `[orphan-reconcile] scan hit the ${SCAN_LIMIT} cap — older collections in this window were not scanned this run`,
    );
  }

  const cartIds = (collections as any[])
    .map((c) => c?.cart?.id)
    .filter((id): id is string => Boolean(id));
  const orderByCart = await loadOrderLinks(container, cartIds);

  for (const collection of collections as any[]) {
    const cartId: string | undefined = collection?.cart?.id;
    const session = (collection?.payment_sessions ?? [])[0];
    const intentId: string | undefined = session?.data?.intentId;
    if (!cartId || !intentId) continue;

    const createdAt = new Date(session?.created_at ?? collection?.created_at ?? 0).getTime();
    if (createdAt > cutoff) continue; // 진행 중일 수 있음 — 건드리지 않는다

    summary.scanned++;

    try {
      const intent = await walletFetch<WalletIntent>(`/v1/payment-intents/${intentId}`);
      const orderId = orderByCart.get(cartId);

      if (orderId) {
        await reconcileCapturedOrder(container, paymentModule, intentId, session.id, intent, logger, summary);
        continue;
      }

      // 주문 없음 — 돈이 움직인 상태인지에 따라 복구/환불/취소.
      if (intent.status === 'CAPTURED' || intent.status === 'PARTIALLY_CAPTURED') {
        // 먼저 주문 복구를 시도한다(재고가 회복됐다면 주문이 살아난다).
        try {
          await handleCaptureProjection(container, intentId, `orphan-reconcile:${intentId}`, logger);
          const refreshed = await loadOrderLinks(container, [cartId]);
          if (refreshed.get(cartId)) {
            summary.recovered++;
            logger.info(`[orphan-reconcile] recovered order for intentId=${intentId} cart=${cartId}`);
            continue;
          }
        } catch (recoveryErr) {
          const msg = recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr);
          logger.warn(`[orphan-reconcile] recovery failed for intentId=${intentId}: ${msg}`);
        }

        if (!autoRefundEnabled()) {
          summary.dryRunFindings.push(`ORPHAN_CAPTURED intentId=${intentId} cart=${cartId} amount=${intent.payableAmount}`);
          logger.warn(`[orphan-reconcile] ORPHAN (report-only) intentId=${intentId} cart=${cartId}`);
          continue;
        }

        await walletFetch(`/v1/payment-intents/${intentId}/refund`, {
          method: 'POST',
          body: JSON.stringify({ amount: intent.payableAmount, reasonCode: 'ORPHAN_PAYMENT_RECONCILE' }),
        });
        summary.refunded++;
        logger.error(
          `[orphan-reconcile] refunded orphan payment intentId=${intentId} cart=${cartId} amount=${intent.payableAmount}`,
        );
        continue;
      }

      if (intent.status === 'AUTHORIZED') {
        // 승인만 되고 주문이 안 만들어진 상태. 토스는 승인이 곧 출금이므로 취소로 되돌린다.
        if (!autoRefundEnabled()) {
          summary.dryRunFindings.push(`ORPHAN_AUTHORIZED intentId=${intentId} cart=${cartId}`);
          continue;
        }
        await walletFetch(`/v1/payment-intents/${intentId}/cancel`, { method: 'POST' });
        summary.canceled++;
        logger.error(`[orphan-reconcile] canceled stranded authorization intentId=${intentId} cart=${cartId}`);
      }
    } catch (err) {
      summary.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[orphan-reconcile] failed for intentId=${intentId} cart=${cartId}: ${msg}`);
    }
  }

  logger.info(
    `[orphan-reconcile] done scanned=${summary.scanned} recovered=${summary.recovered} refunded=${summary.refunded} canceled=${summary.canceled} captured=${summary.captured} failed=${summary.failed}`,
  );
  return summary;
}

/**
 * 주문은 있는데 Medusa 결제가 미캡처인 경우를 맞춘다.
 * - wallet CAPTURED  → 캡처 투영(handleCaptureProjection: DB-only, PG 재호출 없음)
 * - wallet AUTHORIZED → 실제 캡처 실행(capturePaymentWorkflow → wallet /capture)
 */
async function reconcileCapturedOrder(
  scope: any,
  paymentModule: any,
  intentId: string,
  sessionId: string,
  intent: WalletIntent,
  logger: any,
  summary: ReconcileSummary,
): Promise<void> {
  const payments = await paymentModule.listPayments({ payment_session_id: sessionId }, {});
  const payment = payments[0];
  if (!payment || payment.captured_at || payment.canceled_at) return;

  if (intent.status === 'CAPTURED') {
    await handleCaptureProjection(scope, intentId, `orphan-reconcile:${intentId}`, logger);
    summary.captured++;
    logger.info(`[orphan-reconcile] projected missing capture for intentId=${intentId} payment=${payment.id}`);
    return;
  }

  if (intent.status === 'AUTHORIZED') {
    await capturePaymentWorkflow(scope).run({ input: { payment_id: payment.id } });
    summary.captured++;
    logger.info(`[orphan-reconcile] captured authorized payment intentId=${intentId} payment=${payment.id}`);
  }
}
