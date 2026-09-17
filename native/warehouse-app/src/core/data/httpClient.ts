import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { authHeader } from './authHeader';

// Keep aligned with outbound-preparation-result.ts and the HTTP exception filter.
const preparationReasons = [
  'SOURCE_STOCK_CHANGED',
  'PLAN_IDENTITY_CHANGED',
  'PLAN_NOT_DRAFT',
  'SHIPMENT_SNAPSHOT_CHANGED',
  'ALLOCATION_INVALID',
  'ELIGIBILITY_CHANGED',
  'SOURCE_INSUFFICIENT',
  'ACTIVE_WORK_REQUIRES_REVIEW',
  'REPLAN_LIMIT_REACHED',
] as const;
export type PreparationBlockReason = (typeof preparationReasons)[number];
export type PreparationRejection = {
  reasonCode: PreparationBlockReason;
  recovery: 'retry_preparation' | 'review_batch';
};
export function parsePreparationRejection(
  value: unknown
): PreparationRejection | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('reasonCode' in value) ||
    !('recovery' in value)
  )
    return undefined;
  const reasonCode = preparationReasons.find(
    (reason) => reason === value.reasonCode
  );
  if (
    !reasonCode ||
    (value.recovery !== 'retry_preparation' &&
      value.recovery !== 'review_batch')
  )
    return undefined;
  return { reasonCode, recovery: value.recovery };
}

export class ApiError extends Error {
  readonly outcome: 'rejected' | 'uncertain';
  readonly retryable: boolean;
  readonly status: number;
  readonly code?: string;
  readonly preparation?: PreparationRejection;
  constructor(
    message: string,
    status: number,
    code?: string,
    preparation?: PreparationRejection
  ) {
    super(message);
    this.status = status;
    this.code = code;
    const rejected =
      !!code &&
      ([
        'Bad Request',
        'Not Found',
        'Conflict',
        'VALIDATION_ERROR',
        'BAD_REQUEST',
        'CONFLICT',
        'NOT_FOUND',
        'INBOUND_ORIGIN_STOCK_PROTECTED',
        'INBOUND_ORIGIN_STOCK_INCONSISTENT',
        'INBOUND_PUTAWAY_DESTINATION_INVALID',
        'MOVEMENT_DESTINATION_INACTIVE',
      ].includes(code) ||
        /^(SIMPLE_OUTBOUND_(BARCODE_UNKNOWN|PLAN_INVALIDATED|SKU_NOT_IN_SHIPMENT|OVERSCAN|WORK_ITEM_MISSING|CLAIMED_BY_OTHER|METHOD_UNSUPPORTED)|STOCKTAKING_(RECOUNT_REQUIRED|REVISION_CONFLICT|PREVIEW_STALE|PREVIEW_CHANGED|COUNT_REQUIRED|INCOMPLETE)|LOCATION_OUTBOUND_(WAREHOUSE_MISMATCH|SOURCE_MISMATCH|OVERSCAN|PROGRESS_CHANGED|FORCE_NOT_APPLIED)|CLIENT_UPDATE_REQUIRED)$/.test(
          code
        ));
    this.outcome =
      status < 500 &&
      status !== 401 &&
      status !== 403 &&
      status !== 408 &&
      status !== 429 &&
      rejected
        ? 'rejected'
        : 'uncertain';
    if (
      this.outcome === 'rejected' &&
      code === 'SIMPLE_OUTBOUND_PLAN_INVALIDATED'
    )
      this.preparation = parsePreparationRejection(preparation);
    this.retryable =
      status >= 500 ||
      status === 408 ||
      status === 429 ||
      code === 'OPERATION_IN_PROGRESS' ||
      code === 'FULFILLMENT_COMMAND_IN_PROGRESS';
  }
}

export class ConflictError extends ApiError {
  constructor(
    message: string,
    code?: string,
    preparation?: PreparationRejection
  ) {
    super(message, 409, code, preparation);
  }
}

export interface ApiClient {
  request<T>(opts: {
    method?: string;
    path: string;
    body?: unknown;
    bodyJson?: string;
    beforeSend?: (token: string) => Promise<void>;
    idempotencyKey?: string;
  }): Promise<T>;
}

export function createApiClient(deps: {
  baseUrl: string;
  getToken: () => Promise<string>;
  authMode: 'bearer' | 'cookie';
  doFetch?: typeof tauriFetch;
}): ApiClient {
  const doFetch = deps.doFetch ?? tauriFetch;

  async function once(opts: {
    method: string;
    path: string;
    body?: unknown;
    bodyJson?: string;
    beforeSend?: (token: string) => Promise<void>;
    idempotencyKey?: string;
  }): Promise<Response> {
    const token = await deps.getToken();
    await opts.beforeSend?.(token);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...authHeader(token, deps.authMode),
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      return await doFetch(`${deps.baseUrl}${opts.path}`, {
        method: opts.method,
        signal: controller.signal,
        headers,
        body:
          opts.bodyJson ??
          (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async request<T>(o: {
      method?: string;
      path: string;
      body?: unknown;
      bodyJson?: string;
      beforeSend?: (token: string) => Promise<void>;
      idempotencyKey?: string;
    }): Promise<T> {
      const method = o.method ?? 'GET';
      const res = await once({ ...o, method });
      if (res.status === 409) {
        const j = await res.json().catch(() => ({}));
        const body = j as {
          message?: string;
          error?: string;
          code?: string;
          details?: unknown;
        };
        throw new ConflictError(
          body.message ?? 'version conflict',
          body.code ?? body.error,
          parsePreparationRejection(body.details)
        );
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
          error?: string;
        };
        throw new ApiError(
          `${method} ${o.path} → ${res.status}`,
          res.status,
          body.code ?? body.error
        );
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    },
  };
}
