/**
 * 비상 출고 스크립트용 core HTTP 클라이언트 (#1249).
 *
 * core 소스를 import 하지 않는다 — 스크립트가 Nest 데코레이터를 끌어오지 않게
 * 필요한 DTO 필드만 여기 다시 선언한다. 출처:
 * apps/core/src/modules/fulfillment/outbound-preparation/, dto/outbound-batch-v2.dto.ts,
 * picking/allocation/allocation.types.ts·allocation.errors.ts, waybill/waybill-label.manager.ts,
 * dto/location-outbound.dto.ts, dto/shipment-planning.dto.ts.
 *
 * 토큰은 요청마다 `token()` 으로 새로 받고, 오류 메시지·본문 어디에도 싣지 않는다.
 */

export class CoreApiError extends Error {
  /** 응답 본문의 원래 코드(없으면 `HTTP_<상태>`). `code` 가 메시지 접두사에서 나왔을 때 일반 이름이 여기 남는다. */
  readonly httpCode: string;

  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: unknown,
    message: string,
    httpCode?: string,
  ) {
    super(message);
    this.name = 'CoreApiError';
    this.httpCode = httpCode ?? code;
  }
}

/**
 * core 의 `ApplicationException`(ConflictError 등)은 본문 `code` 에 «일반 HTTP 이름»(CONFLICT…)을 싣고
 * 도메인 코드는 메시지 앞(`DOMAIN_CODE: 설명`)에 둔다. `HttpException({ code })` 는 도메인 코드가 `code` 에 바로 있다.
 */
const GENERIC_CODES: ReadonlySet<string> = new Set([
  'CONFLICT',
  'BAD_REQUEST',
  'NOT_FOUND',
  'FORBIDDEN',
  'UNAUTHORIZED',
  'UNPROCESSABLE_ENTITY',
  'INTERNAL_SERVER_ERROR',
]);
const MESSAGE_PREFIX = /^([A-Z][A-Z0-9_]{2,}):/;

/** 실패 응답(상태·본문)에서 `CoreApiError` 를 만든다 — HTTP 호출과 테스트의 FakeCore 가 같은 길을 쓴다. */
export function coreApiErrorFrom(status: number, body: unknown, where: string): CoreApiError {
  const httpCode = isRecord(body) && typeof body.code === 'string' ? body.code : `HTTP_${status}`;
  const code = errorCode(httpCode, isRecord(body) ? body.message : undefined);
  const msg = isRecord(body) && typeof body.message === 'string' ? `: ${body.message}` : '';
  return new CoreApiError(status, code, body, `core ${where} ${status} ${code}${msg}`, httpCode);
}

function errorCode(httpCode: string, message: unknown): string {
  if (!GENERIC_CODES.has(httpCode) && !/^HTTP_\d+$/.test(httpCode)) return httpCode;
  const prefix = typeof message === 'string' ? MESSAGE_PREFIX.exec(message)?.[1] : undefined;
  return prefix ?? httpCode;
}

// ── 타입 ────────────────────────────────────────────────────────────

export interface PreparationShipment {
  shipmentId: string;
  orderNos: string[];
  itemSummary: string;
  totalQty: number;
  single: boolean;
  reason: string | null;
  lines: { name: string; qty: number; reservedQty: number }[];
  split: unknown | null;
}

/** core `PREPARATION_BUCKETS` (outbound-preparation-classify.ts) — 조회의 `bucket` 이 여섯 다 받는다. */
export type PreparationBucketName = 'ready' | 'partial' | 'unavailable' | 'mergeable' | 'resume' | 'needs_info';

export interface PreparationBucket {
  bucket: string;
  count: number;
  singleCount: number;
  multiCount: number;
  shipments: PreparationShipment[];
}

export interface PreparationSummary {
  warehouseId: string;
  buckets: PreparationBucket[];
  awaitingMatchingCount: number;
}

export interface BulkShipmentResult {
  succeeded: string[];
  failed: { shipmentId: string; code: string; message: string; transient: boolean }[];
}

export interface PreparationWaybillResult {
  shipmentId: string;
  status: string;
  trackingNo: string | null;
  reason: string | null;
  nextAttemptAt: string | null;
  transient?: boolean;
  code?: string;
}

export interface StartBlockerView {
  shipmentId: string;
  reason: 'INBOUND_PENDING' | 'STOCK_SHORT' | 'WAYBILL_NOT_READY';
  shipmentLineId: string;
  skuId: string;
  requiredQty: number;
  shortQty: number;
  detail: string;
  trackingNo: string | null;
  skuCode: string;
  skuName: string;
}

export interface BatchStartResult {
  state: 'started';
  operationId: string;
  batchId: string;
  sessionId: string;
  status: string;
}

export interface BatchListItem {
  id: string;
  batchNumber: string;
  name: string;
  warehouseId: string;
  status: string;
  pickingMethod: string;
  cartCapacity: number;
  totalItems: number;
  totalQty: number;
  withdrawingItems: number;
  scheduledPickingAt: string;
  startedAt: string | null;
  createdAt: string;
}

export type WorkItemStatus =
  | 'queued'
  | 'picking'
  | 'ready_to_pack'
  | 'packing'
  | 'completed'
  | 'short_pick_recovery'
  | 'excluded'
  | 'withdrawing';

export interface WorkItem {
  id: string;
  batchId: string;
  shipmentId: string;
  status: WorkItemStatus;
  displayOrderNo?: string | null;
  itemSummary?: string;
}

export interface ShipmentDetail {
  id: string;
  status: string;
  warehouseId: string;
  manifestVersion: number;
  recipientSnapshot: unknown;
  lines: {
    id: string;
    skuId: string;
    skuName: string | null;
    qty: number;
    reservedQty: number;
    inspectedQty: number;
  }[];
  waybills: unknown[];
  workItems: { id: string; status: string }[];
}

export interface WaybillView {
  id: string;
  shipmentId: string;
  source: string;
  carrier: string;
  status: 'pending' | 'allocated' | 'registered' | 'used';
  trackingNo: string | null;
}

export interface LabelView {
  trackingNo: string;
  data: string;
  pages: number;
  fingerprint: string;
}

export interface LocationOutboundState {
  shipmentId: string;
  workItemStatus: string;
  status: 'in_progress' | 'shipped';
  dispatchAttemptId: string | null;
  lines: {
    shipmentLineId: string;
    skuId: string;
    qty: number;
    pickedQty: number;
    inspectedQty: number;
  }[];
  warehouseId: string;
  sources: {
    shipmentLineId: string;
    skuId: string;
    sourceLocationId: string;
    sourceLocationCode: string;
    allocatedQty: number;
    pickedQty: number;
    remainingQty: number;
  }[];
}

export interface ForceItem {
  shipmentLineId: string;
  sourceLocationId: string;
  quantity: number;
}

export interface CoreApi {
  preparation(warehouseId: string, bucket: PreparationBucketName, offset: number): Promise<PreparationSummary>;
  plan(ids: string[], key: string): Promise<BulkShipmentResult>;
  issueWaybills(ids: string[], key: string): Promise<PreparationWaybillResult[]>;
  /** pickingMethod 'individual' 고정 */
  createBatch(warehouseId: string, name: string, key: string): Promise<{ batchId: string }>;
  addToBatch(batchId: string, ids: string[], key: string): Promise<BulkShipmentResult>;
  /** voidWaybill 은 보내지 않는다(송장 유지) */
  excludeFromBatch(batchId: string, shipmentId: string, reason: string, key: string): Promise<void>;
  /** BATCH_START_BLOCKED 는 CoreApiError(code, body.errors: StartBlockerView[]) */
  startBatch(batchId: string, key: string): Promise<BatchStartResult>;
  batches(warehouseId: string, status: 'created' | 'picking'): Promise<BatchListItem[]>;
  workItems(batchId: string): Promise<WorkItem[]>;
  shipment(id: string): Promise<ShipmentDetail>;
  activeWaybill(shipmentId: string): Promise<WaybillView | null>;
  label(shipmentId: string): Promise<LabelView>;
  confirmLabelPrint(shipmentId: string, fingerprint: string): Promise<void>;
  locationState(shipmentId: string, warehouseId: string): Promise<LocationOutboundState>;
  locationForce(
    shipmentId: string,
    warehouseId: string,
    reason: string,
    items: ForceItem[],
    key: string,
  ): Promise<LocationOutboundState>;
  forceDispatch(
    shipmentId: string,
    reason: string,
    key: string,
  ): Promise<{ status: string; dispatchAttemptId: string | null }>;
  warehouse(id: string): Promise<{ id: string; name: string; supportedPickingStrategies: string[] }>;
}

// ── 구현 ────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function httpCoreApi(coreUrl: string, token: () => Promise<string>): CoreApi {
  const base = coreUrl.replace(/\/+$/, '');

  async function call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    opts: { body?: unknown; key?: string } = {},
  ): Promise<T | null> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await token()}`,
      accept: 'application/json',
    };
    if (opts.key) headers['idempotency-key'] = opts.key;
    let payload: string | undefined;
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(opts.body);
    }
    const res = await fetch(`${base}/${path}`, { method, headers, body: payload });
    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      throw coreApiErrorFrom(res.status, parsed, `${method} /${path.split('?')[0]}`);
    }
    return parsed === null ? null : (parsed as T);
  }

  async function need<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    opts: { body?: unknown; key?: string } = {},
  ): Promise<T> {
    const r = await call<T>(method, path, opts);
    if (r === null) {
      throw new CoreApiError(200, 'EMPTY_BODY', null, `core ${method} /${path.split('?')[0]} 빈 응답`);
    }
    return r;
  }

  const q = encodeURIComponent;

  return {
    preparation: (warehouseId, bucket, offset) =>
      need('GET', `outbound-preparation?warehouseId=${q(warehouseId)}&bucket=${bucket}&offset=${offset}`),
    plan: (ids, key) => need('POST', 'outbound-preparation/plans', { body: { shipmentIds: ids }, key }),
    issueWaybills: (ids, key) => need('POST', 'outbound-preparation/waybills', { body: { shipmentIds: ids }, key }),
    createBatch: (warehouseId, name, key) =>
      need('POST', 'outbound-batches/v2', {
        body: { warehouseId, pickingMethod: 'individual', name },
        key,
      }),
    addToBatch: (batchId, ids, key) =>
      need('POST', `outbound-preparation/batches/${q(batchId)}/shipments`, {
        body: { shipmentIds: ids },
        key,
      }),
    excludeFromBatch: async (batchId, shipmentId, reason, key) => {
      await call('DELETE', `outbound-batches/${q(batchId)}/shipments/${q(shipmentId)}`, {
        body: { reason },
        key,
      });
    },
    startBatch: (batchId, key) => need('POST', 'picking/v2/starts', { body: { batchId }, key }),
    batches: (warehouseId, status) => need('GET', `outbound-batches/v2?warehouseId=${q(warehouseId)}&status=${status}`),
    workItems: (batchId) => need('GET', `outbound-batches/${q(batchId)}/work-items`),
    shipment: (id) => need('GET', `shipments/${q(id)}`),
    activeWaybill: (shipmentId) => call('GET', `shipments/${q(shipmentId)}/waybill`),
    label: (shipmentId) => need('GET', `shipments/${q(shipmentId)}/waybill/label`),
    confirmLabelPrint: async (shipmentId, fingerprint) => {
      await call('POST', `shipments/${q(shipmentId)}/waybill/label-prints`, { body: { fingerprint } });
    },
    locationState: (shipmentId, warehouseId) =>
      need('GET', `shipments/${q(shipmentId)}/location-outbound-state?warehouseId=${q(warehouseId)}`),
    locationForce: (shipmentId, warehouseId, reason, items, key) =>
      need('POST', `shipments/${q(shipmentId)}/location-outbound-forces`, {
        body: { warehouseId, reason, items },
        key,
      }),
    forceDispatch: (shipmentId, reason, key) =>
      need('POST', `shipments/${q(shipmentId)}/force-dispatch`, { body: { reason }, key }),
    warehouse: (id) => need('GET', `inventory/warehouses/${q(id)}`),
  };
}
