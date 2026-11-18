/* eslint-disable @typescript-eslint/require-await -- 메모리 구현이라 기다릴 것이 없지만 CoreApi 는 Promise 를 돌려준다 */
/**
 * 비상 출고 스크립트 테스트용 메모리 core (#1249). `CoreApi` 전체를 구현한다.
 *
 * core 를 다시 구현하지 않는다 — 스크립트가 기대는 관찰 가능한 규칙만 둔다:
 * 출고 준비 목록은 활성 작업 항목이 있는 상자를 빼고 요청한 분류만 200개씩 준다(다른 분류는 개수만),
 * 묶음 명령은 상자마다 성공/실패를 돌려주고, 시작은 막힌 상자가 배치에 남아 있으면 전부 거절한다.
 * 쓰기 호출은 `calls` 에 `write: true` 로 남는다.
 */
import {
  BatchListItem,
  BatchStartResult,
  BulkShipmentResult,
  CoreApi,
  CoreApiError,
  ForceItem,
  LabelView,
  LocationOutboundState,
  PreparationBucket,
  PreparationBucketName,
  PreparationShipment,
  PreparationSummary,
  PreparationWaybillResult,
  ShipmentDetail,
  StartBlockerView,
  WaybillView,
  WorkItem,
  WorkItemStatus,
} from '../core-api';

export interface FakeShipment {
  id: string;
  status: string;
  /** draft 상자의 출고 준비 분류(기본 ready). planned 는 언제나 resume. */
  bucket?: string;
  reason?: string | null;
  orderNos?: string[];
  recipientName?: string;
  lines?: { id: string; skuId: string; skuName: string; qty: number }[];
  sources?: LocationOutboundState['sources'];
}

export interface FakeCall {
  method: keyof CoreApi;
  args: unknown[];
  write: boolean;
}

const WRITES: ReadonlySet<keyof CoreApi> = new Set<keyof CoreApi>([
  'plan',
  'issueWaybills',
  'createBatch',
  'addToBatch',
  'excludeFromBatch',
  'startBatch',
  'confirmLabelPrint',
  'locationForce',
  'forceDispatch',
]);

const BUCKETS: PreparationBucketName[] = ['ready', 'resume', 'partial', 'unavailable', 'mergeable', 'needs_info'];
const PAGE = 200;
const INACTIVE: ReadonlySet<WorkItemStatus> = new Set<WorkItemStatus>(['completed', 'excluded']);
const SHIPPED = new Set(['shipped', 'in_transit', 'delivered']);

export class FakeCore implements CoreApi {
  readonly calls: FakeCall[] = [];
  readonly shipments = new Map<string, FakeShipment>();
  readonly waybills = new Map<string, WaybillView>();
  readonly batchRows = new Map<string, BatchListItem>();
  readonly items: WorkItem[] = [];
  readonly prints: { shipmentId: string; fingerprint: string }[] = [];

  /** 상자 id → 계획 확정 실패 코드 */
  readonly planFailures = new Map<string, string>();
  /** 상자 id → 송장 결과 덮어쓰기(예: {status:'failed', code}) */
  readonly waybillOverrides = new Map<string, Partial<PreparationWaybillResult>>();
  /** 상자 id → 배치 담기 실패 코드 */
  readonly addFailures = new Map<string, string>();
  /** 상자 id → 시작 막힘 사유. 그 상자가 배치에 활성으로 남아 있는 동안 시작이 막힌다. */
  readonly startBlockers = new Map<string, StartBlockerView['reason']>();

  private readonly oneShot = new Map<keyof CoreApi, Error[]>();
  private readonly afterShot = new Map<keyof CoreApi, Error[]>();
  /** 같은 키로 성공한 응답(core 의 멱등 재생). 실패는 남기지 않는다(core 는 실패를 트랜잭션째 되돌린다). */
  private readonly createdByKey = new Map<string, { batchId: string }>();
  private readonly startedByKey = new Map<string, BatchStartResult>();
  /** 묶음 명령(plan·add)이 상자마다 쓰는 `${key}:${상자 id}` 중 성공한 것 — 같은 키면 상태를 안 보고 성공을 재생한다. */
  private readonly bulkDone = new Set<string>();
  /** 배치에서 빼기 키 → 보낸 사유. core 는 사유를 해시에 넣으므로 같은 키·다른 사유는 불일치. */
  private readonly excludedByKey = new Map<string, string>();
  /** 발송(위치 강제·강제 발송) 키 → 보낸 본문. 같은 키·다른 본문은 불일치. */
  private readonly dispatchedByKey = new Map<string, string>();
  private seq = 0;

  constructor(readonly warehouseId = 'wh-acme') {}

  // ── 심기 ─────────────────────────────────────────────────────────

  addShipment(s: FakeShipment): this {
    this.shipments.set(s.id, s);
    return this;
  }

  addBatch(
    b: Partial<BatchListItem> & { id: string },
    workItems: { shipmentId: string; status: WorkItemStatus }[] = [],
  ): this {
    this.batchRows.set(b.id, batchRow({ warehouseId: this.warehouseId, ...b }));
    for (const w of workItems) this.items.push({ id: `wi-${b.id}-${w.shipmentId}`, batchId: b.id, ...w });
    return this;
  }

  setWaybill(shipmentId: string, trackingNo: string, status: WaybillView['status'] = 'registered'): this {
    this.waybills.set(shipmentId, waybillView(shipmentId, trackingNo, status));
    return this;
  }

  /** 다음 한 번의 `method` 호출이 이 오류로 실패한다(쌓으면 차례로). */
  failNext(method: keyof CoreApi, error: Error): this {
    const list = this.oneShot.get(method) ?? [];
    list.push(error);
    this.oneShot.set(method, list);
    return this;
  }

  /** 다음 한 번의 `method` 호출이 효과를 낸 «뒤에» 이 오류로 실패한다 — 커밋 뒤 응답이 끊긴 경우. 쓰기 메서드만. */
  failAfter(method: keyof CoreApi, error: Error): this {
    const list = this.afterShot.get(method) ?? [];
    list.push(error);
    this.afterShot.set(method, list);
    return this;
  }

  // ── 관찰 ─────────────────────────────────────────────────────────

  writes(): (keyof CoreApi)[] {
    return this.calls.filter((c) => c.write).map((c) => c.method);
  }

  callsOf(method: keyof CoreApi): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }

  // ── CoreApi ──────────────────────────────────────────────────────

  async preparation(warehouseId: string, bucket: PreparationBucketName, offset: number): Promise<PreparationSummary> {
    this.enter('preparation', [warehouseId, bucket, offset]);
    const buckets: PreparationBucket[] = BUCKETS.map((name) => ({
      bucket: name,
      count: 0,
      singleCount: 0,
      multiCount: 0,
      shipments: [],
    }));
    for (const s of this.shipments.values()) {
      if (s.status !== 'draft' && s.status !== 'planned') continue;
      if (this.activeItem(s.id)) continue;
      const name = s.status === 'planned' ? 'resume' : (s.bucket ?? 'ready');
      const entry = buckets.find((b) => b.bucket === name);
      if (!entry) continue;
      entry.count++;
      entry.singleCount++;
      if (name !== bucket || entry.count <= offset || entry.shipments.length >= PAGE) continue;
      entry.shipments.push(prepShipment(s));
    }
    return { warehouseId, buckets, awaitingMatchingCount: 0 };
  }

  async plan(ids: string[], key: string): Promise<BulkShipmentResult> {
    this.enter('plan', [ids, key]);
    const result = this.perShipment(ids, (s) => {
      const code = this.planFailures.get(s.id);
      if (code) return code;
      if (s.status === 'planned') return null;
      if (this.bulkDone.has(`${key}:${s.id}`)) return null;
      if (s.status !== 'draft') return 'SHIPMENT_NOT_DRAFT';
      s.status = 'planned';
      this.bulkDone.add(`${key}:${s.id}`);
      return null;
    });
    return this.leave('plan', result);
  }

  async issueWaybills(ids: string[], key: string): Promise<PreparationWaybillResult[]> {
    this.enter('issueWaybills', [ids, key]);
    // core 의 송장 발급은 활성 송장을 키와 상관없이 이어 가므로(issueOrResume) 키 재생을 따로 두지 않는다.
    const result = ids.map((id) => {
      const override = this.waybillOverrides.get(id);
      if (override) {
        const r: PreparationWaybillResult = { ...waybillResult(id, 'failed', null), ...override };
        if (r.status === 'registered' && r.trackingNo) this.setWaybill(id, r.trackingNo);
        return r;
      }
      const s = this.shipments.get(id);
      if (!s) return { ...waybillResult(id, 'failed', null), code: 'SHIPMENT_NOT_FOUND' };
      if (s.status !== 'planned') return { ...waybillResult(id, 'failed', null), code: 'SHIPMENT_NOT_PLANNED' };
      const existing = this.waybills.get(id);
      if (existing?.trackingNo) return waybillResult(id, existing.status, existing.trackingNo);
      const trackingNo = `TRK-ACME-${String(++this.seq).padStart(4, '0')}`;
      this.setWaybill(id, trackingNo);
      return waybillResult(id, 'registered', trackingNo);
    });
    return this.leave('issueWaybills', result);
  }

  async createBatch(warehouseId: string, name: string, key: string): Promise<{ batchId: string }> {
    this.enter('createBatch', [warehouseId, name, key]);
    const result = replay(this.createdByKey, key, () => {
      const id = this.batchRows.size === 0 ? 'b' : `b${this.batchRows.size + 1}`;
      this.batchRows.set(id, batchRow({ id, name, warehouseId }));
      return { batchId: id };
    });
    return this.leave('createBatch', result);
  }

  async addToBatch(batchId: string, ids: string[], key: string): Promise<BulkShipmentResult> {
    this.enter('addToBatch', [batchId, ids, key]);
    const result = this.perShipment(ids, (s) => {
      const code = this.addFailures.get(s.id);
      if (code) return code;
      const active = this.activeItem(s.id);
      if (active) return active.batchId === batchId ? null : 'SHIPMENT_ACTIVE_WORK_ITEM';
      // core 와 같은 순서: «이미 그 배치에 있음» 확인 뒤 키 명령 — 같은 키면 빠진 상자라도 옛 성공을 재생한다.
      if (this.bulkDone.has(`${key}:${s.id}`)) return null;
      if (s.status !== 'planned') return 'SHIPMENT_NOT_PLANNED';
      this.bulkDone.add(`${key}:${s.id}`);
      this.items.push({
        id: `wi-${batchId}-${s.id}-${this.items.length}`,
        batchId,
        shipmentId: s.id,
        status: 'queued',
      });
      return null;
    });
    return this.leave('addToBatch', result);
  }

  async excludeFromBatch(batchId: string, shipmentId: string, reason: string, key: string): Promise<void> {
    this.enter('excludeFromBatch', [batchId, shipmentId, reason, key]);
    const sent = this.excludedByKey.get(key);
    if (sent !== undefined) {
      if (sent !== reason) throw new CoreApiError(409, 'FULFILLMENT_IDEMPOTENCY_MISMATCH', null, `exclude ${key}`);
      return this.leave('excludeFromBatch', undefined); // 재생 — 효과 없음
    }
    const item = this.activeItem(shipmentId);
    if (item && item.batchId === batchId) item.status = 'excluded';
    this.excludedByKey.set(key, reason);
    return this.leave('excludeFromBatch', undefined);
  }

  async startBatch(batchId: string, key: string): Promise<BatchStartResult> {
    this.enter('startBatch', [batchId, key]);
    const result = replay<BatchStartResult>(this.startedByKey, key, () => {
      const batch = this.batchRows.get(batchId);
      if (!batch) throw new CoreApiError(404, 'OUTBOUND_BATCH_NOT_FOUND', null, `batch ${batchId}`);
      const active = this.items.filter((w) => w.batchId === batchId && !INACTIVE.has(w.status));
      if (active.length === 0) throw new CoreApiError(409, 'PICKING_BATCH_EMPTY', null, 'empty');
      const errors = active.flatMap((w) => {
        const reason = this.startBlockers.get(w.shipmentId);
        return reason ? [blocker(w.shipmentId, reason)] : [];
      });
      if (errors.length > 0) {
        throw new CoreApiError(409, 'BATCH_START_BLOCKED', { code: 'BATCH_START_BLOCKED', errors }, 'blocked');
      }
      batch.status = 'picking';
      batch.startedAt = '2026-11-19T00:00:00Z';
      return { state: 'started', operationId: `op-${batchId}`, batchId, sessionId: `ss-${batchId}`, status: 'picking' };
    });
    return this.leave('startBatch', result);
  }

  async batches(warehouseId: string, status: 'created' | 'picking'): Promise<BatchListItem[]> {
    this.enter('batches', [warehouseId, status]);
    return [...this.batchRows.values()].filter(
      (b) => b.warehouseId === warehouseId && (status === 'created' ? b.startedAt == null : b.startedAt != null),
    );
  }

  async workItems(batchId: string): Promise<WorkItem[]> {
    this.enter('workItems', [batchId]);
    return this.items.filter((w) => w.batchId === batchId);
  }

  async shipment(id: string): Promise<ShipmentDetail> {
    this.enter('shipment', [id]);
    const s = this.need(id);
    return {
      id,
      status: s.status,
      warehouseId: this.warehouseId,
      manifestVersion: 1,
      recipientSnapshot: { name: s.recipientName ?? '김*몬' },
      lines: (s.lines ?? []).map((l) => ({ ...l, reservedQty: l.qty, inspectedQty: 0 })),
      waybills: this.waybills.has(id) ? [this.waybills.get(id)] : [],
      workItems: this.items.filter((w) => w.shipmentId === id).map((w) => ({ id: w.id, status: w.status })),
    };
  }

  async activeWaybill(shipmentId: string): Promise<WaybillView | null> {
    this.enter('activeWaybill', [shipmentId]);
    return this.waybills.get(shipmentId) ?? null;
  }

  async label(shipmentId: string): Promise<LabelView> {
    this.enter('label', [shipmentId]);
    const wb = this.waybills.get(shipmentId);
    if (!wb?.trackingNo) throw new CoreApiError(404, 'WAYBILL_NOT_FOUND', null, shipmentId);
    return {
      trackingNo: wb.trackingNo,
      data: `^XA^FD${wb.trackingNo}^FS^XZ\n`,
      pages: 1,
      fingerprint: `fp-${wb.trackingNo}`,
    };
  }

  async confirmLabelPrint(shipmentId: string, fingerprint: string): Promise<void> {
    this.enter('confirmLabelPrint', [shipmentId, fingerprint]);
    this.prints.push({ shipmentId, fingerprint });
  }

  async locationState(shipmentId: string, warehouseId: string): Promise<LocationOutboundState> {
    this.enter('locationState', [shipmentId, warehouseId]);
    return this.locationView(this.need(shipmentId), warehouseId);
  }

  async locationForce(
    shipmentId: string,
    warehouseId: string,
    reason: string,
    items: ForceItem[],
    key: string,
  ): Promise<LocationOutboundState> {
    this.enter('locationForce', [shipmentId, warehouseId, reason, items, key]);
    const s = this.need(shipmentId);
    // core 는 본문(사유·항목 순서 포함)을 해시에 넣는다 — 같은 키·같은 본문은 재생, 다른 본문은 불일치.
    const body = JSON.stringify({ warehouseId, reason, items });
    const sent = this.dispatchedByKey.get(key);
    if (sent !== undefined) {
      if (sent !== body) throw new CoreApiError(409, 'FULFILLMENT_IDEMPOTENCY_MISMATCH', null, `force ${key}`);
      return this.leave('locationForce', this.locationView(s, warehouseId));
    }
    if (!SHIPPED.has(s.status)) {
      // 남은 원천 전부를 (라인, 위치)마다 남은 수량 그대로 — 하나라도 다르면 진행이 바뀐 것으로 본다.
      const expected = (s.sources ?? [])
        .filter((src) => src.remainingQty > 0)
        .map((src) => `${src.shipmentLineId}|${src.sourceLocationId}|${src.remainingQty}`)
        .sort();
      const got = items.map((i) => `${i.shipmentLineId}|${i.sourceLocationId}|${i.quantity}`).sort();
      if (JSON.stringify(expected) !== JSON.stringify(got)) {
        throw new CoreApiError(409, 'LOCATION_OUTBOUND_PROGRESS_CHANGED', null, `force ${shipmentId}`);
      }
      s.status = 'shipped';
      s.sources = (s.sources ?? []).map((src) => ({ ...src, pickedQty: src.allocatedQty, remainingQty: 0 }));
      this.completeItem(shipmentId);
    }
    this.dispatchedByKey.set(key, body);
    return this.leave('locationForce', this.locationView(s, warehouseId));
  }

  async forceDispatch(
    shipmentId: string,
    reason: string,
    key: string,
  ): Promise<{ status: string; dispatchAttemptId: string | null }> {
    this.enter('forceDispatch', [shipmentId, reason, key]);
    const s = this.need(shipmentId);
    const body = JSON.stringify({ reason });
    const sent = this.dispatchedByKey.get(key);
    if (sent !== undefined) {
      if (sent !== body) throw new CoreApiError(409, 'FULFILLMENT_IDEMPOTENCY_MISMATCH', null, `force ${key}`);
      return this.leave('forceDispatch', { status: 'shipped', dispatchAttemptId: `da-${shipmentId}` });
    }
    // core: 강제 발송은 포장 단계(ready_to_pack·packing) 작업 항목에만.
    const item = this.activeItem(shipmentId);
    if (!item || (item.status !== 'ready_to_pack' && item.status !== 'packing')) {
      throw new CoreApiError(409, 'SHIPMENT_NOT_INSPECTION_READY', null, `force-dispatch ${shipmentId}`);
    }
    s.status = 'shipped';
    this.completeItem(shipmentId);
    this.dispatchedByKey.set(key, body);
    return this.leave('forceDispatch', { status: 'shipped', dispatchAttemptId: `da-${shipmentId}` });
  }

  async warehouse(id: string): Promise<{ id: string; name: string; supportedPickingStrategies: string[] }> {
    this.enter('warehouse', [id]);
    return { id, name: 'acme 창고', supportedPickingStrategies: ['discrete'] };
  }

  // ── 내부 ─────────────────────────────────────────────────────────

  private enter(method: keyof CoreApi, args: unknown[]): void {
    this.calls.push({ method, args, write: WRITES.has(method) });
    const queued = this.oneShot.get(method);
    const error = queued?.shift();
    if (error) throw error;
  }

  private leave<T>(method: keyof CoreApi, result: T): T {
    const error = this.afterShot.get(method)?.shift();
    if (error) throw error;
    return result;
  }

  private perShipment(ids: string[], apply: (s: FakeShipment) => string | null): BulkShipmentResult {
    const out: BulkShipmentResult = { succeeded: [], failed: [] };
    for (const id of ids) {
      const s = this.shipments.get(id);
      const code = s ? apply(s) : 'SHIPMENT_NOT_FOUND';
      if (code) out.failed.push({ shipmentId: id, code, message: code, transient: false });
      else out.succeeded.push(id);
    }
    return out;
  }

  private activeItem(shipmentId: string): WorkItem | undefined {
    return this.items.find((w) => w.shipmentId === shipmentId && !INACTIVE.has(w.status));
  }

  private completeItem(shipmentId: string): void {
    const item = this.activeItem(shipmentId);
    if (item) item.status = 'completed';
  }

  private need(id: string): FakeShipment {
    const s = this.shipments.get(id);
    if (!s) throw new CoreApiError(404, 'SHIPMENT_NOT_FOUND', null, id);
    return s;
  }

  private locationView(s: FakeShipment, warehouseId: string): LocationOutboundState {
    const sources = s.sources ?? [];
    return {
      shipmentId: s.id,
      workItemStatus: this.items.find((w) => w.shipmentId === s.id)?.status ?? 'queued',
      status: SHIPPED.has(s.status) ? 'shipped' : 'in_progress',
      dispatchAttemptId: SHIPPED.has(s.status) ? `da-${s.id}` : null,
      lines: (s.lines ?? []).map((l) => ({
        shipmentLineId: l.id,
        skuId: l.skuId,
        qty: l.qty,
        pickedQty: SHIPPED.has(s.status) ? l.qty : 0,
        inspectedQty: 0,
      })),
      warehouseId,
      sources,
    };
  }
}

function replay<T>(store: Map<string, T>, key: string, run: () => T): T {
  const prior = store.get(key);
  if (prior !== undefined) return prior;
  const result = run();
  store.set(key, result);
  return result;
}

function prepShipment(s: FakeShipment): PreparationShipment {
  return {
    shipmentId: s.id,
    orderNos: s.orderNos ?? [`acme-${s.id}`],
    itemSummary: 'acme 상품',
    totalQty: 1,
    single: true,
    reason: s.reason ?? null,
    lines: [],
    split: null,
  };
}

function waybillResult(shipmentId: string, status: string, trackingNo: string | null): PreparationWaybillResult {
  return { shipmentId, status, trackingNo, reason: null, nextAttemptAt: null };
}

function waybillView(shipmentId: string, trackingNo: string, status: WaybillView['status']): WaybillView {
  return { id: `wb-${shipmentId}`, shipmentId, source: 'carrier_api', carrier: 'HANJIN', status, trackingNo };
}

function blocker(shipmentId: string, reason: StartBlockerView['reason']): StartBlockerView {
  return {
    shipmentId,
    reason,
    shipmentLineId: `line-${shipmentId}`,
    skuId: 'sku-acme',
    requiredQty: 1,
    shortQty: 1,
    detail: reason,
    trackingNo: null,
    skuCode: 'ACME-1',
    skuName: 'acme 상품',
  };
}

export function batchRow(b: Partial<BatchListItem> & { id: string; warehouseId: string }): BatchListItem {
  return {
    batchNumber: b.id,
    name: b.id,
    status: 'created',
    pickingMethod: 'individual',
    cartCapacity: 1,
    totalItems: 0,
    totalQty: 0,
    withdrawingItems: 0,
    scheduledPickingAt: '2026-11-19T00:00:00Z',
    startedAt: null,
    createdAt: '2026-11-19T00:00:00Z',
    ...b,
  };
}
