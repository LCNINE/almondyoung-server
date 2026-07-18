export const CHANNEL_DISPATCH_STATUSES = [
  'pending',
  'succeeded',
  'recovery_required',
  'manual_adjustment_required',
] as const;

export type ChannelDispatchStatus = (typeof CHANNEL_DISPATCH_STATUSES)[number];

export interface ChannelDispatchOperationResponse {
  dispatchAttemptId: string;
  shipmentId: string;
  salesOrderId: string;
  operation: 'dispatch' | 'delivery' | 'recall';
  channel: string;
  externalOrderId: string;
  status: ChannelDispatchStatus;
  attempts: number;
  errorMessage: string | null;
  lastAttemptAt: string | null;
  updatedAt: string;
}

export interface ChannelDispatchResponse {
  dispatchAttemptId: string;
  salesOrderId: string;
  operations: ChannelDispatchOperationResponse[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ROLES = new Set([
  'logistics_worker',
  'logistics_manager',
  'master',
]);
const ALLOWED_OPERATIONS = new Set(['dispatch', 'delivery', 'recall']);
const ALLOWED_STATUSES = new Set<string>(CHANNEL_DISPATCH_STATUSES);

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function canReadChannelDispatch(roles: unknown): boolean {
  return (
    Array.isArray(roles) &&
    roles.some((role) => typeof role === 'string' && ALLOWED_ROLES.has(role))
  );
}

export function buildChannelDispatchUpstreamUrl(
  baseUrl: string,
  dispatchAttemptId: string,
  salesOrderId: string
): string | null {
  if (!isUuid(dispatchAttemptId) || !isUuid(salesOrderId)) return null;

  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const prefix = url.pathname.replace(/\/$/, '');
    url.pathname = `${prefix}/internal/channel-dispatch-operations/attempts/${dispatchAttemptId}/orders/${salesOrderId}`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : undefined;
}

function dateString(
  value: unknown,
  nullable = false
): string | null | undefined {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return undefined;
  }
  return value;
}

export function normalizeChannelDispatchResponse(
  input: unknown,
  expectedDispatchAttemptId: string,
  expectedSalesOrderId: string
): ChannelDispatchResponse | null {
  if (!isRecord(input) || !Array.isArray(input.operations)) return null;
  if (
    input.dispatchAttemptId !== expectedDispatchAttemptId ||
    input.salesOrderId !== expectedSalesOrderId
  ) {
    return null;
  }

  const operations: ChannelDispatchOperationResponse[] = [];
  for (const raw of input.operations) {
    if (!isRecord(raw)) return null;
    const shipmentId = requiredString(raw.shipmentId);
    const channel = requiredString(raw.channel);
    const externalOrderId = requiredString(raw.externalOrderId);
    const errorMessage = nullableString(raw.errorMessage);
    const lastAttemptAt = dateString(raw.lastAttemptAt, true);
    const updatedAt = dateString(raw.updatedAt);
    if (
      raw.dispatchAttemptId !== expectedDispatchAttemptId ||
      raw.salesOrderId !== expectedSalesOrderId ||
      !isUuid(shipmentId) ||
      !channel ||
      !externalOrderId ||
      !ALLOWED_OPERATIONS.has(String(raw.operation)) ||
      !ALLOWED_STATUSES.has(String(raw.status)) ||
      !Number.isInteger(raw.attempts) ||
      Number(raw.attempts) < 0 ||
      errorMessage === undefined ||
      lastAttemptAt === undefined ||
      !updatedAt
    ) {
      return null;
    }

    operations.push({
      dispatchAttemptId: expectedDispatchAttemptId,
      shipmentId,
      salesOrderId: expectedSalesOrderId,
      operation: raw.operation as ChannelDispatchOperationResponse['operation'],
      channel,
      externalOrderId,
      status: raw.status as ChannelDispatchStatus,
      attempts: Number(raw.attempts),
      errorMessage,
      lastAttemptAt,
      updatedAt,
    });
  }

  return {
    dispatchAttemptId: expectedDispatchAttemptId,
    salesOrderId: expectedSalesOrderId,
    operations,
  };
}
