import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { authHeader } from './authHeader';
import { reportServerReach } from './serverStatus';

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
  'BATCH_NOT_STARTED',
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

/**
 * core 가 명령 기록과 처리를 한 저장점 안에서 하는 출고 저장 경로. 여기서 받은 409 는
 * 아무것도 남기지 않은 거절이라, 코드가 목록에 없어도 결과 모름으로 두지 않는다.
 */
export const SAVE_POINT_OUTBOUND_ROUTES = [
  'simple-outbound-scans',
  'simple-outbound-forces',
  'location-outbound-scans',
  'location-outbound-forces',
] as const;
const savePointOutboundPath = new RegExp(
  `^/shipments/[^/]+/(${SAVE_POINT_OUTBOUND_ROUTES.join('|')})$`
);
/** 저장점에 들어가기 전에 나는 409 — 같은 키의 앞 요청이 남긴 것이 있을 수 있다. */
const SAVE_POINT_UNSETTLED_CODES = [
  'FULFILLMENT_COMMAND_IN_PROGRESS',
  'FULFILLMENT_IDEMPOTENCY_MISMATCH',
];

function isSavePointRejection(
  status: number,
  code: string | undefined,
  path: string | undefined
): boolean {
  return (
    status === 409 &&
    !!code &&
    !!path &&
    savePointOutboundPath.test(path) &&
    !SAVE_POINT_UNSETTLED_CODES.includes(code)
  );
}

export function readRequiredPermissions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((key): key is string => typeof key === 'string');
}

export class ApiError extends Error {
  readonly outcome: 'rejected' | 'uncertain';
  readonly retryable: boolean;
  readonly status: number;
  readonly code?: string;
  readonly preparation?: PreparationRejection;
  /** 409 본문의 `errors` 그대로(배치 시작 차단 목록 등). */
  readonly errors?: unknown;
  /** 403 본문이 알려 준 요구 권한 키(어느 하나면 된다). */
  readonly requiredPermissions?: readonly string[];
  /** 400 본문의 `message` 그대로 — 서버가 현장 문구로 쓰라고 만든 거절 사유(범위 표기 등). */
  readonly serverMessage?: string;
  /** 출고 저장 경로의 409 — 서버에 반영된 것이 없다고 말할 수 있다. */
  readonly notApplied: boolean;
  /** 출고 저장 경로가 이 거절을 관리자 화면에 남겼다. */
  readonly rejectionRecorded: boolean;
  /** 출고 저장 경로가 «이 상자에 없는 상품» 으로 거절하며 알려 준 찍은 상품 이름. */
  readonly scannedSkuName?: string;
  constructor(
    message: string,
    status: number,
    code?: string,
    preparation?: PreparationRejection,
    errors?: unknown,
    requiredPermissions?: readonly string[],
    serverMessage?: string,
    path?: string,
    rejectionRecorded?: boolean,
    scannedSkuName?: string
  ) {
    super(message);
    this.notApplied = isSavePointRejection(status, code, path);
    this.rejectionRecorded = this.notApplied && rejectionRecorded === true;
    if (this.notApplied && scannedSkuName) this.scannedSkuName = scannedSkuName;
    this.status = status;
    if (serverMessage) this.serverMessage = serverMessage;
    this.errors = errors;
    this.code = code;
    if (requiredPermissions?.length)
      this.requiredPermissions = [...requiredPermissions];
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
        'BATCH_START_BLOCKED',
        'LABEL_REPRINT_REQUIRED',
        'LABEL_CONTENT_CHANGED',
        'WAYBILL_STALE',
        'WAYBILL_NOT_DISPATCHABLE',
        'WAYBILL_LABEL_NOT_ALLOCATED',
        'BATCH_NOT_JOINABLE',
        'SHIPMENT_ACTIVE_WORK_ITEM',
        'OUTBOUND_BATCH_CART_CAPACITY_EXCEEDED',
        'WORK_ITEM_TOTE_RELEASE_REQUIRED',
        'WORK_ITEM_DISPATCH_EXISTS',
        'WORK_ITEM_ALLOCATED',
        'OUTBOUND_BATCH_STARTED_RETRY',
        'PICKING_SESSION_NOT_ACTIVE',
        'BATCH_JOIN_BLOCKED',
        'SHIPMENT_WITHDRAWN',
        'SHIPMENT_ALREADY_WITHDRAWING',
        'SHIPMENT_NOT_WITHDRAWING',
        'REMOVAL_NOT_PENDING',
        'RETURN_BIN_UNKNOWN',
        'RETURN_BIN_WAREHOUSE_MISMATCH',
        'RETURN_BIN_ITEM_NOT_FOUND',
        'RETURN_BIN_ITEM_SHORT',
        'RETURN_LOCATION_MISMATCH',
        'RETURN_LOCATION_REQUIRED',
        'WITHDRAWAL_WAYBILL_NOT_VOIDABLE',
        'SHIPMENT_LINE_INSPECTION_STALE',
        'WORKER_ACTIVE_CLAIM_EXISTS',
        // 마지막 스캔의 출고 판정 — 스캔과 같은 트랜잭션에서 거절돼 아무것도 남지 않는다
        'SHIPMENT_NOT_DISPATCHABLE',
        'SHIPMENT_NOT_INSPECTION_READY',
        'SHIPMENT_SESSION_NOT_ACTIVE',
        'SHIPMENT_PACKER_LEASE_REQUIRED',
      ].includes(code) ||
        this.notApplied ||
        /^(SIMPLE_OUTBOUND_(BARCODE_UNKNOWN|PLAN_INVALIDATED|SKU_NOT_IN_SHIPMENT|OVERSCAN|WORK_ITEM_MISSING|CLAIMED_BY_OTHER|METHOD_UNSUPPORTED)|STOCKTAKING_(RECOUNT_REQUIRED|REVISION_CONFLICT|PREVIEW_STALE|PREVIEW_CHANGED|COUNT_REQUIRED|INCOMPLETE)|LOCATION_OUTBOUND_(WAREHOUSE_MISMATCH|SOURCE_MISMATCH|OVERSCAN|PROGRESS_CHANGED|FORCE_NOT_APPLIED)|CLIENT_UPDATE_REQUIRED)$/.test(
          code
        ));
    this.outcome =
      status === 403 ||
      (status < 500 &&
        status !== 401 &&
        status !== 408 &&
        status !== 429 &&
        rejected)
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
    preparation?: PreparationRejection,
    errors?: unknown,
    path?: string,
    rejectionRecorded?: boolean,
    scannedSkuName?: string
  ) {
    super(
      message,
      409,
      code,
      preparation,
      errors,
      undefined,
      undefined,
      path,
      rejectionRecorded,
      scannedSkuName
    );
  }
}

/** 응답을 받지 못했다(연결 실패·15초 시간 초과). 서버가 요청을 받았는지는 알 수 없다. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'NetworkError';
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
      const res = await doFetch(`${deps.baseUrl}${opts.path}`, {
        method: opts.method,
        signal: controller.signal,
        headers,
        body:
          opts.bodyJson ??
          (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      });
      reportServerReach('up');
      return res;
    } catch (error) {
      reportServerReach('down');
      throw new NetworkError(error);
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
          errors?: unknown;
          rejectionRecorded?: unknown;
          scannedSkuName?: unknown;
        };
        throw new ConflictError(
          body.message ?? 'version conflict',
          body.code ?? body.error,
          parsePreparationRejection(body.details),
          body.errors,
          o.path,
          body.rejectionRecorded === true,
          typeof body.scannedSkuName === 'string'
            ? body.scannedSkuName
            : undefined
        );
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
          error?: string;
          message?: unknown;
          requiredPermissions?: unknown;
        };
        throw new ApiError(
          `${method} ${o.path} → ${res.status}`,
          res.status,
          body.code ?? body.error,
          undefined,
          undefined,
          res.status === 403
            ? readRequiredPermissions(body.requiredPermissions)
            : undefined,
          res.status === 400 && typeof body.message === 'string'
            ? body.message
            : undefined
        );
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    },
  };
}
