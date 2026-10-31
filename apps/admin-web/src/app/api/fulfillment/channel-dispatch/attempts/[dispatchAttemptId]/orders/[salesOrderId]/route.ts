import { NextResponse } from 'next/server';
import { getMyPermissions } from '@/lib/auth/my-permissions.server';
import { admitServerCredentialTenant } from '@/lib/auth/server-credential-tenant.server';
import {
  buildChannelDispatchUpstreamUrl,
  canReadChannelDispatch,
  isUuid,
  normalizeChannelDispatchResponse,
} from '../../../../channel-dispatch-route';

type Params = {
  params: Promise<{ dispatchAttemptId: string; salesOrderId: string }>;
};

const RESPONSE_HEADERS = { 'Cache-Control': 'no-store' };
const UPSTREAM_TIMEOUT_MS = 5_000;

export const dynamic = 'force-dynamic';

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: RESPONSE_HEADERS });
}

export async function GET(_request: Request, { params }: Params) {
  const { dispatchAttemptId, salesOrderId } = await params;
  if (!isUuid(dispatchAttemptId) || !isUuid(salesOrderId)) {
    return errorResponse('Invalid identifier', 400);
  }

  let state;
  try {
    state = await getMyPermissions();
  } catch {
    return errorResponse('Authentication unavailable', 503);
  }
  if (state.state === 'unauthenticated') return errorResponse('Unauthorized', 401);
  if (state.state === 'unavailable') return errorResponse('Permission data is not loaded yet', 503);
  if (!canReadChannelDispatch(state.permissions)) {
    return NextResponse.json(
      { error: 'Forbidden', requiredPermissions: ['fulfillment.shipment.read'] },
      { status: 403, headers: RESPONSE_HEADERS }
    );
  }

  // channel-adapter 는 한 테넌트 T 만 섬기고, 내부 키 입구는 테넌트 헤더가 T 여야 한다.
  const tenant = await admitServerCredentialTenant('channel-adapter', RESPONSE_HEADERS);
  if (tenant.rejection) return tenant.rejection;

  const serviceUrl = process.env.CHANNEL_ADAPTER_SERVICE_URL;
  const internalKey = process.env.CHANNEL_ADAPTER_INTERNAL_KEY?.trim();
  if (!serviceUrl || !internalKey) {
    return errorResponse('Channel projection unavailable', 503);
  }
  const upstreamUrl = buildChannelDispatchUpstreamUrl(
    serviceUrl,
    dispatchAttemptId,
    salesOrderId
  );
  if (!upstreamUrl) {
    return errorResponse('Channel projection unavailable', 503);
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${internalKey}`, ...tenant.tenantHeaders },
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!upstream.ok) {
      return errorResponse('Channel projection unavailable', 502);
    }

    const normalized = normalizeChannelDispatchResponse(
      await upstream.json(),
      dispatchAttemptId,
      salesOrderId
    );
    if (!normalized) {
      return errorResponse('Channel projection unavailable', 502);
    }
    return NextResponse.json(normalized, { headers: RESPONSE_HEADERS });
  } catch {
    return errorResponse('Channel projection unavailable', 504);
  }
}
