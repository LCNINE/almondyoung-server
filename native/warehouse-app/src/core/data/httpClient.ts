import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { authHeader } from './authHeader';

export class ApiError extends Error {
  readonly outcome: 'rejected' | 'uncertain';
  readonly retryable: boolean;
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
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
    this.retryable =
      status >= 500 ||
      status === 408 ||
      status === 429 ||
      code === 'OPERATION_IN_PROGRESS' ||
      code === 'FULFILLMENT_COMMAND_IN_PROGRESS';
  }
}

export class ConflictError extends ApiError {
  constructor(message: string, code?: string) {
    super(message, 409, code);
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
        const body = j as { message?: string; error?: string; code?: string };
        throw new ConflictError(
          body.message ?? 'version conflict',
          body.code ?? body.error
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
