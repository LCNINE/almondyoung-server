import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

import type { StorePurchaseSatisfactionWriteType } from './validators';

const UGC_REQUEST_TIMEOUT_MS = 5_000;

type OwnedOrder = { displayId: number; almondUserId: string };

type UgcResult =
  | { kind: 'ok'; body: Record<string, unknown> }
  | { kind: 'not_found' }
  | { kind: 'invalid'; message: string }
  | { kind: 'unavailable' };

const notFound = (res: MedusaResponse) => res.status(404).json({ type: 'not_found', message: '주문을 찾을 수 없습니다' });

async function loadOwnedOrder(req: AuthenticatedMedusaRequest): Promise<OwnedOrder | undefined> {
  const actorId = req.auth_context?.actor_id;
  if (!actorId) return undefined;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order',
    fields: ['id', 'display_id', 'customer_id', 'customer.metadata'],
    filters: { id: req.params.id },
  });
  const order = data?.[0] as
    | { display_id?: number; customer_id?: string; customer?: { metadata?: Record<string, unknown> | null } }
    | undefined;
  if (!order || order.customer_id !== actorId) return undefined;
  const almondUserId = order.customer?.metadata?.almond_user_id;
  if (typeof almondUserId !== 'string' || !almondUserId || typeof order.display_id !== 'number') return undefined;
  return { displayId: order.display_id, almondUserId };
}

async function callUgc(orderId: string, method: 'GET' | 'PUT', body?: unknown): Promise<UgcResult> {
  const baseUrl = process.env.UGC_SERVICE_URL;
  const key = process.env.UGC_INTERNAL_KEY;
  if (!baseUrl || !key) return { kind: 'unavailable' };
  try {
    const response = await fetch(`${baseUrl}/purchase-satisfactions/internal/orders/${encodeURIComponent(orderId)}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(UGC_REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404) return { kind: 'not_found' };
    if (response.status === 400) {
      const payload = (await response.json().catch(() => ({}))) as { message?: unknown };
      const message = Array.isArray(payload.message) ? payload.message.join(', ') : payload.message;
      return { kind: 'invalid', message: typeof message === 'string' ? message : '입력값이 올바르지 않습니다' };
    }
    if (!response.ok) return { kind: 'unavailable' };
    return { kind: 'ok', body: (await response.json()) as Record<string, unknown> };
  } catch {
    return { kind: 'unavailable' };
  }
}

function send(res: MedusaResponse, result: UgcResult) {
  switch (result.kind) {
    case 'ok':
      return res.status(200).json({
        satisfaction: {
          rating: result.body.rating,
          reasons: result.body.reasons ?? [],
          memo: result.body.memo ?? null,
        },
      });
    case 'not_found':
      return notFound(res);
    case 'invalid':
      return res.status(400).json({ type: 'invalid_data', message: result.message });
    default:
      return res.status(502).json({ type: 'ugc_unavailable', message: '잠시 후 다시 시도해 주세요' });
  }
}

export async function handleGetSatisfaction(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const order = await loadOwnedOrder(req);
  if (!order) return notFound(res);
  return send(res, await callUgc(req.params.id, 'GET'));
}

export async function handlePutSatisfaction(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const order = await loadOwnedOrder(req);
  if (!order) return notFound(res);
  const { rating, reasons, memo } = req.body as StorePurchaseSatisfactionWriteType;
  return send(
    res,
    await callUgc(req.params.id, 'PUT', {
      userId: order.almondUserId,
      orderDisplayId: order.displayId,
      rating,
      reasons,
      memo,
    }),
  );
}
