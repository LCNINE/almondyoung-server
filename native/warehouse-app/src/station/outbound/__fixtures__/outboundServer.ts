/* 스테이션 출고 화면 테스트의 가짜 core — 엔드포인트 모양은 실제와 같고 상태는 메모리에 둔다. 테스트 전용 */
import 'fake-indexeddb/auto';
import { ApiError, ConflictError, type ApiClient } from '../../../core/data/httpClient';
import type { WorkPermissions, WorkRuntime } from '../../../core/operations/OperationContext';
import { createOperationRunner } from '../../../core/operations/operationRunner';
import { createOperationStore } from '../../../core/operations/operationStore';
import type {
  OutboundBatchSummary,
  ShipmentByWaybill,
  SimpleOutboundState,
  WithdrawalRemoval,
} from '../../../domains/outbound/types';
import type { LabelState } from '../../../domains/outbound/waybillLabel';

type Req = Parameters<ApiClient['request']>[0];

export const WAREHOUSE_ID = 'w-1';

export interface FakeLine {
  id: string;
  skuId: string;
  name: string;
  qty: number;
  barcode: string;
  /** 송장 순서 배정. 박스가 legacy 면 싣지 않는다 */
  locations?: Array<{ code: string; qty: number }>;
}

export interface FakeBox {
  shipmentId: string;
  trackingNo: string;
  batchId: string;
  recipient?: string;
  deliveryNote?: string | null;
  labelState?: LabelState;
  workItemStatus?: string;
  shipped?: boolean;
  /** PR A 이전 core — 배송메모·줄 버전·배정·결품 버전을 싣지 않는다 */
  legacy?: boolean;
  removals?: WithdrawalRemoval[];
  /** 되돌림 응답에 removedSkuName 을 싣지 않는 옛 core */
  omitRemovedName?: boolean;
  lines: FakeLine[];
}

interface LiveBox extends FakeBox {
  picked: Map<string, number>;
  labelState: LabelState;
  workItemStatus: string;
  shipped: boolean;
  withdrawn: boolean;
  removals: WithdrawalRemoval[];
  lineVersion: number;
}

export interface OutboundServerConfig {
  shortPickOutcome: 'refilled' | 'withdrawing' | 'exited';
  /** fail — 박스 빼기를 거절한다(409) */
  excludeOutcome: 'withdrawing' | 'removed' | 'fail';
  refills: unknown[];
  refillsFail: boolean;
  batches: { picking: OutboundBatchSummary[]; created: OutboundBatchSummary[] };
  /** 배치 박스 목록에 작업 상태·송장번호·받는 분을 싣지 않는 옛 core */
  legacyBatchStates: boolean;
}

export function batchSummary(
  patch: Partial<OutboundBatchSummary> & Pick<OutboundBatchSummary, 'id' | 'batchNumber'>
): OutboundBatchSummary {
  return {
    name: '오전',
    status: 'picking',
    totalItems: 2,
    totalQty: 5,
    startedAt: '2026-10-02T00:00:00.000Z',
    withdrawingItems: 0,
    ...patch,
  };
}

export function createOutboundServer(init: { boxes: FakeBox[] }) {
  const boxes: LiveBox[] = init.boxes.map((box) => ({
    ...box,
    picked: new Map<string, number>(),
    labelState: box.labelState ?? 'current',
    workItemStatus: box.workItemStatus ?? 'queued',
    shipped: box.shipped ?? false,
    withdrawn: false,
    removals: (box.removals ?? []).map((removal) => ({ ...removal })),
    lineVersion: 1,
  }));
  const config: OutboundServerConfig = {
    shortPickOutcome: 'refilled',
    excludeOutcome: 'withdrawing',
    refills: [],
    refillsFail: false,
    batches: { picking: [], created: [] },
    legacyBatchStates: false,
  };
  const requests: Req[] = [];
  const scanCalls: string[] = [];
  const scans: Array<{ key: string; shipmentId: string; barcode: string; quantity: number }> = [];
  const forces: Array<{ shipmentId: string; reason: string }> = [];
  /** 반영된 결품(멱등 키당 한 번) */
  const shortPicks: Array<{ shipmentId: string; key: string; body: unknown }> = [];
  /** 받은 결품 요청 전부(같은 키로 다시 온 것 포함) */
  const shortPickCalls: Array<{ key: string; body: unknown }> = [];
  const shortPickReplies = new Map<string, unknown>();
  let loseShortPick = false;
  let lookupGate: Promise<void> | null = null;
  let shortPickGate: Promise<void> | null = null;
  const excludes: Array<{ batchId: string; shipmentId: string; reason: string }> = [];
  const confirmedPrints: string[] = [];
  const applied = new Map<string, SimpleOutboundState>();
  let sendGate: Promise<void> | null = null;
  let writeGate: Promise<void> | null = null;
  let losing = false;

  const byTracking = (trackingNo: string) => boxes.find((b) => b.trackingNo === trackingNo);
  const byId = (shipmentId: string) => {
    const box = boxes.find((b) => b.shipmentId === shipmentId);
    if (!box) throw new Error(`unknown shipment ${shipmentId}`);
    return box;
  };
  const pickedOf = (box: LiveBox, lineId: string) => box.picked.get(lineId) ?? 0;
  const active = (box: LiveBox) => !box.shipped && !box.withdrawn;
  const workItemStatusOf = (box: LiveBox) =>
    box.shipped ? 'completed' : box.withdrawn ? 'excluded' : box.labelState === 'withdrawing' ? 'withdrawing' : box.workItemStatus;

  function outState(box: LiveBox): SimpleOutboundState {
    return {
      shipmentId: box.shipmentId,
      workItemStatus: workItemStatusOf(box),
      status: box.shipped ? 'shipped' : 'in_progress',
      dispatchAttemptId: box.shipped ? `d-${box.shipmentId}` : null,
      lines: box.lines.map((l) => ({
        shipmentLineId: l.id,
        skuId: l.skuId,
        qty: l.qty,
        pickedQty: pickedOf(box, l.id),
        inspectedQty: box.shipped ? l.qty : 0,
      })),
    };
  }

  function removalsOf(box: LiveBox): WithdrawalRemoval[] {
    return box.lines
      .filter((l) => pickedOf(box, l.id) > 0)
      .map((l) => {
        const code = l.locations?.[0]?.code ?? 'A-01-1';
        return {
          shipmentLineId: l.id,
          skuId: l.skuId,
          skuCode: l.skuId,
          skuName: l.name,
          sourceLocationId: `loc-${code}`,
          locationCode: code,
          boxQty: pickedOf(box, l.id),
          cartQty: 0,
        };
      });
  }

  function found(box: LiveBox): ShipmentByWaybill {
    return {
      warehouseId: WAREHOUSE_ID,
      shipmentId: box.shipmentId,
      trackingNo: box.trackingNo,
      carrier: 'HANJIN',
      waybillStatus: 'registered',
      shipmentStatus: box.shipped ? 'shipped' : 'planned',
      batchId: active(box) ? box.batchId : null,
      workItemId: active(box) ? `wi-${box.shipmentId}` : null,
      workItemStatus: active(box) ? workItemStatusOf(box) : null,
      recipientMasked: box.recipient ?? '김*영',
      lines: box.lines.map((l) => ({
        shipmentLineId: l.id,
        skuId: l.skuId,
        skuCode: l.skuId,
        skuName: l.name,
        qty: l.qty,
        pickedQty: pickedOf(box, l.id),
        inspectedQty: 0,
        ...(box.legacy
          ? {}
          : {
              lineVersion: box.lineVersion,
              allocations: (l.locations ?? []).map((loc) => ({
                sourceLocationId: `loc-${loc.code}`,
                locationCode: loc.code,
                qty: loc.qty,
              })),
            }),
      })),
      labelState: box.withdrawn ? 'withdrawn' : box.shipped ? null : box.labelState,
      labelChanges:
        box.labelState === 'reprint_required'
          ? [{ locationCode: 'B-11-1', skuId: box.lines[0].skuId, name: box.lines[0].name, printedQty: 3, currentQty: 2 }]
          : [],
      labelIssue: null,
      removals: active(box) && box.labelState === 'withdrawing' ? box.removals : [],
      exitTo: box.withdrawn ? 'draft' : null,
      ...(box.legacy
        ? {}
        : {
            deliveryNote: box.deliveryNote ?? null,
            shortPickContext: active(box)
              ? { workItemLeaseVersion: 3, sessionId: `ses-${box.batchId}`, sessionVersion: 5, manifestVersion: 2 }
              : null,
          }),
    };
  }

  async function scanBox(o: Req, shipmentId: string) {
    const key = o.idempotencyKey ?? '';
    const body = o.body as { barcode: string; quantity: number };
    scanCalls.push(key);
    if (sendGate) await sendGate;
    if (!applied.has(key)) {
      const box = byId(shipmentId);
      const line = box.lines.find((l) => l.barcode === body.barcode);
      if (!line) throw new ConflictError('not in shipment', 'SIMPLE_OUTBOUND_SKU_NOT_IN_SHIPMENT');
      if (pickedOf(box, line.id) + body.quantity > line.qty) throw new ConflictError('overscan', 'SIMPLE_OUTBOUND_OVERSCAN');
      box.picked.set(line.id, pickedOf(box, line.id) + body.quantity);
      box.workItemStatus = 'picking';
      box.lineVersion += 1;
      if (box.lines.every((l) => pickedOf(box, l.id) >= l.qty)) box.shipped = true;
      scans.push({ key, shipmentId, barcode: body.barcode, quantity: body.quantity });
      applied.set(key, outState(box));
    }
    // 서버는 반영했는데 응답을 잃었다 — 403 은 재시도하지 않는 불확실 결과다
    if (losing) throw new ApiError('응답 유실', 403);
    return applied.get(key);
  }

  function forceBox(o: Req, shipmentId: string) {
    const key = o.idempotencyKey ?? '';
    if (!applied.has(key)) {
      const box = byId(shipmentId);
      for (const l of box.lines) box.picked.set(l.id, l.qty);
      box.shipped = true;
      forces.push({ shipmentId, reason: (o.body as { reason: string }).reason });
      applied.set(key, outState(box));
    }
    return applied.get(key);
  }

  /** 멱등 키 — core 처럼 같은 키면 저장한 응답을 돌려준다(fulfillment-command.service.ts) */
  async function shortPick(o: Req, shipmentId: string) {
    const key = o.idempotencyKey ?? '';
    shortPickCalls.push({ key, body: o.body });
    if (shortPickGate) await shortPickGate;
    if (!shortPickReplies.has(key)) shortPickReplies.set(key, applyShortPick(o, shipmentId, key));
    // 서버는 반영했는데 응답을 잃었다
    if (loseShortPick) {
      loseShortPick = false;
      throw new TypeError('Failed to fetch');
    }
    return shortPickReplies.get(key);
  }

  function applyShortPick(o: Req, shipmentId: string, key: string) {
    const box = byId(shipmentId);
    shortPicks.push({ shipmentId, key, body: o.body });
    const outcome = config.shortPickOutcome;
    const lines = (o.body as { lines: Array<{ shipmentLineId: string; shortQty: number }> }).lines;
    box.lineVersion += 1;
    if (outcome === 'refilled') box.labelState = 'reprint_required';
    if (outcome === 'withdrawing') {
      box.labelState = 'withdrawing';
      box.removals = removalsOf(box);
    }
    if (outcome === 'exited') box.withdrawn = true;
    return {
      operationId: 'op-short',
      shipmentId,
      workItemId: `wi-${shipmentId}`,
      operationStatus: outcome === 'withdrawing' ? 'pending' : 'completed',
      invoiceOperationId: null,
      outcome,
      refills:
        outcome === 'refilled'
          ? lines.map((l) => ({
              shipmentLineId: l.shipmentLineId,
              skuId: box.lines.find((x) => x.id === l.shipmentLineId)?.skuId ?? '',
              sourceLocationId: 'loc-C-07-1',
              locationCode: 'C-07-1',
              qty: l.shortQty,
            }))
          : [],
      shortages: [],
    };
  }

  function excludeBox(o: Req, batchId: string, shipmentId: string) {
    const box = byId(shipmentId);
    if (config.excludeOutcome === 'fail') throw new ConflictError('cannot exclude', 'OUTBOUND_BATCH_SHIPMENT_NOT_REMOVABLE');
    excludes.push({ batchId, shipmentId, reason: (o.body as { reason: string }).reason });
    if (config.excludeOutcome === 'withdrawing') {
      box.labelState = 'withdrawing';
      box.removals = removalsOf(box);
      return { operationId: 'op-exclude', workItem: { status: 'withdrawing' } };
    }
    box.withdrawn = true;
    return { operationId: 'op-exclude', workItem: { status: 'excluded' } };
  }

  function removeToBin(o: Req, shipmentId: string) {
    const box = byId(shipmentId);
    const line = box.lines.find((l) => l.barcode === (o.body as { barcode: string }).barcode);
    const removal = line && box.removals.find((r) => r.shipmentLineId === line.id && r.boxQty > 0);
    if (!removal) throw new ConflictError('not pending', 'REMOVAL_NOT_PENDING');
    removal.boxQty -= 1;
    box.removals = box.removals.filter((r) => r.boxQty > 0 || r.cartQty > 0);
    const exited = box.removals.length === 0;
    if (exited) box.withdrawn = true;
    return {
      removedQty: 1,
      ...(box.omitRemovedName ? {} : { removedSkuName: removal.skuName }),
      exited,
      exitTo: exited ? 'draft' : null,
      removals: box.removals,
    };
  }

  async function request<T>(o: Req): Promise<T> {
    requests.push(o);
    const method = o.method ?? 'GET';
    const [path, query = ''] = o.path.split('?');
    const params = new URLSearchParams(query);
    const reply = (value: unknown) => value as T;
    if (method === 'GET' && path === '/shipments/by-waybill') {
      if (lookupGate) await lookupGate;
      const box = byTracking(params.get('trackingNo') ?? '');
      if (!box) throw new ApiError(`GET ${o.path} → 404`, 404, 'NOT_FOUND');
      return reply(found(box));
    }
    const scan = /^\/shipments\/([^/]+)\/simple-outbound-scans$/.exec(path);
    if (scan) return reply(await scanBox(o, scan[1]));
    const force = /^\/shipments\/([^/]+)\/simple-outbound-forces$/.exec(path);
    if (force) {
      if (writeGate) await writeGate;
      return reply(forceBox(o, force[1]));
    }
    const short = /^\/shipments\/([^/]+)\/short-picks$/.exec(path);
    if (short) return reply(await shortPick(o, short[1]));
    const exclude = /^\/outbound-batches\/([^/]+)\/shipments\/([^/]+)$/.exec(path);
    if (exclude && method === 'DELETE') {
      if (writeGate) await writeGate;
      return reply(excludeBox(o, exclude[1], exclude[2]));
    }
    const label = /^\/shipments\/([^/]+)\/waybill\/label$/.exec(path);
    if (label) {
      const box = byId(label[1]);
      return reply({
        waybillId: `wb-${box.shipmentId}`,
        trackingNo: box.trackingNo,
        format: 'zpl',
        data: `^XA${box.trackingNo}^XZ`,
        pages: 1,
        fingerprint: `fp-${box.lineVersion}`,
        revision: 2,
      });
    }
    const labelPrint = /^\/shipments\/([^/]+)\/waybill\/label-prints$/.exec(path);
    if (labelPrint) {
      const box = byId(labelPrint[1]);
      box.labelState = 'current';
      confirmedPrints.push(box.shipmentId);
      return reply({ printedAt: '2026-10-02T05:00:00.000Z' });
    }
    const removal = /^\/shipments\/([^/]+)\/return-bin-removals$/.exec(path);
    if (removal) return reply(removeToBin(o, removal[1]));
    if (path === '/outbound-refills/pending') {
      if (config.refillsFail) throw new ApiError(`GET ${o.path} → 404`, 404, 'NOT_FOUND');
      return reply(config.refills);
    }
    if (path === '/outbound-batches/v2')
      return reply(params.get('status') === 'created' ? config.batches.created : config.batches.picking);
    const items = /^\/outbound-batches\/([^/]+)\/work-items$/.exec(path);
    if (items)
      return reply(
        boxes
          .filter((b) => b.batchId === items[1])
          .map((b) => ({ id: `wi-${b.shipmentId}`, shipmentId: b.shipmentId, status: workItemStatusOf(b) }))
      );
    const states = /^\/outbound-batches\/([^/]+)\/waybill-label-states$/.exec(path);
    if (states)
      return reply(
        boxes
          .filter((b) => b.batchId === states[1] && active(b))
          .map((b) => ({
            shipmentId: b.shipmentId,
            workItemId: `wi-${b.shipmentId}`,
            state: b.labelState,
            changes: [],
            issue: null,
            ...(config.legacyBatchStates
              ? {}
              : { workItemStatus: workItemStatusOf(b), trackingNo: b.trackingNo, recipientMasked: b.recipient ?? '김*영' }),
          }))
      );
    throw new Error(`Unexpected request ${method} ${o.path}`);
  }

  return {
    request,
    config,
    requests,
    scanCalls,
    scans,
    forces,
    shortPicks,
    shortPickCalls,
    excludes,
    confirmedPrints,
    /** 다음 스캔 응답을 붙잡는다 — 돌려받은 함수를 부르면 놓는다 */
    holdSends(): () => void {
      let release!: () => void;
      sendGate = new Promise<void>((resolve) => {
        release = () => {
          sendGate = null;
          resolve();
        };
      });
      return release;
    },
    /** 강제출고·박스 빼기 응답을 붙잡는다 — 돌려받은 함수를 부르면 놓는다 */
    holdWrites(): () => void {
      let release!: () => void;
      writeGate = new Promise<void>((resolve) => {
        release = () => {
          writeGate = null;
          resolve();
        };
      });
      return release;
    },
    /** 송장 조회 응답을 붙잡는다 — 돌려받은 함수를 부르면 놓는다 */
    holdLookups(): () => void {
      let release!: () => void;
      lookupGate = new Promise<void>((resolve) => {
        release = () => {
          lookupGate = null;
          resolve();
        };
      });
      return release;
    },
    /** 결품 응답을 붙잡는다 — 돌려받은 함수를 부르면 놓는다 */
    holdShortPicks(): () => void {
      let release!: () => void;
      shortPickGate = new Promise<void>((resolve) => {
        release = () => {
          shortPickGate = null;
          resolve();
        };
      });
      return release;
    },
    /** 다음 결품은 반영하고 응답만 잃는다 */
    loseNextShortPick() {
      loseShortPick = true;
    },
    loseResponses(value: boolean) {
      losing = value;
    },
    /** 다른 스테이션이 같은 박스를 찍은 것처럼 */
    pick(trackingNo: string, lineId: string, qty: number) {
      const box = byTracking(trackingNo);
      if (!box) throw new Error(`unknown tracking ${trackingNo}`);
      box.picked.set(lineId, pickedOf(box, lineId) + qty);
      box.lineVersion += 1;
    },
    box: byTracking,
  };
}

export type OutboundServer = ReturnType<typeof createOutboundServer>;

export function createTestRuntime(
  server: Pick<OutboundServer, 'request'>,
  permissions: WorkPermissions = { shortPick: true, stationForceDispatch: true },
  store = createOperationStore(crypto.randomUUID())
): WorkRuntime {
  const runner = createOperationRunner({
    api: { request: server.request },
    store,
    getScope: async () => 'scope',
    wait: async () => {},
  });
  return {
    store,
    runner,
    getScope: async () => 'scope',
    getCapabilities: async () => ({}),
    getPermissions: async () => permissions,
  };
}
