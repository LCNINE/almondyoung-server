/* 스테이션 반품 화면 테스트의 가짜 core — 엔드포인트 모양과 거절 규칙은 실제(customer-return-receiving.manager.ts·
 * customer-return.reader.ts listForReceiving)와 같고 상태는 메모리에 둔다. 테스트 전용 */
import { ApiError, ConflictError, type ApiClient } from '../../../core/data/httpClient';
import type { ReceivingItem, ReturnView } from '../../../domains/customer-returns/types';
import { WAREHOUSE_ID } from '../../outbound/__fixtures__/outboundServer';

type Req = Parameters<ApiClient['request']>[0];

export { WAREHOUSE_ID };

export type FakeReturnStatus = 'expected' | 'arrived' | 'cancelled' | 'inspected' | 'held' | 'refund_pending' | 'settled';

export interface FakeReturnItem {
  id: string;
  skuName: string;
  expectedQty: number;
  arrivedQty?: number;
  barcodes?: string[];
  shelfCode?: string | null;
  skuId?: string;
  skuCode?: string;
  qtyPerUnit?: number;
}

export interface FakeReturnLine {
  id: string;
  productName: string;
  items: FakeReturnItem[];
  /** 기본은 항목 기대 수량의 합 */
  quantity?: number;
}

export interface FakeReturn {
  id: string;
  orderNo: string;
  /** 원문 — 목록은 가려서 싣고 검색은 원문 부분 일치로 된다(N4) */
  customerName: string;
  channelOrderId?: string;
  status: FakeReturnStatus;
  reason?: string;
  feeBearer?: string;
  note?: string | null;
  /** 그 판매주문을 배송완료한 창고들 — `expected` 반품이 보이는 창고이자 받을 수 있는 창고(N3·N5) */
  deliveredBy?: string[];
  /** 받는 창고 — 첫 도착이 정한다 */
  warehouseId?: string | null;
  /** CS 가 «미도착으로 닫기» 를 했다(csResolution.missing) */
  missingClosed?: boolean;
  requestedAt: string;
  lines: FakeReturnLine[];
}

interface LiveItem extends Required<FakeReturnItem> {
  acceptedQty: number;
  rejectedQty: number;
  heldQty: number;
}

interface LiveReturn extends Omit<FakeReturn, 'lines'> {
  deliveredBy: string[];
  warehouseId: string | null;
  missingClosed: boolean;
  lines: Array<{ id: string; productName: string; quantity: number; items: LiveItem[] }>;
}

export interface ArrivalBody {
  warehouseId: string;
  items: Array<{ customerReturnItemId: string; quantity: number }>;
  idempotencyKey: string;
}

export interface InspectionBody {
  items: Array<{ customerReturnItemId: string; accepted: number; rejected: number; held: number }>;
}

/** 다음 요청을 실패시킨다. status 가 없으면 네트워크 오류(응답 없음), applied 면 서버는 반영하고 응답만 잃는다 */
export interface Failure {
  status?: number;
  code?: string;
  applied?: boolean;
  /** 이 메서드의 요청만 실패시킨다 — 목록 재조회(GET)가 먼저 가져가지 않게 */
  method?: 'GET' | 'POST';
}

/** core maskName(recipient-snapshot.ts) — 뒤 절반을 가린다 */
export function maskName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 1) return trimmed;
  const keep = Math.ceil(trimmed.length / 2);
  return `${trimmed.slice(0, keep)}${'*'.repeat(trimmed.length - keep)}`;
}

const STAGE_ORDER: Record<ReceivingItem['stage'], number> = { ready: 0, partial: 1, awaiting: 2 };
const INSPECTED: readonly FakeReturnStatus[] = ['inspected', 'held', 'refund_pending', 'settled'];

const conflict = (message: string) => new ConflictError(message, 'CONFLICT');
const badRequest = (path: string, message: string) => {
  const error = new ApiError(`POST ${path} → 400`, 400, 'BAD_REQUEST');
  // 화면은 errorMessage 로 한 줄을 만든다 — 사유는 테스트가 보게 남긴다
  return Object.assign(error, { reason: message });
};

function live(init: FakeReturn): LiveReturn {
  return {
    ...init,
    deliveredBy: init.deliveredBy ?? [WAREHOUSE_ID],
    warehouseId: init.warehouseId ?? (init.status === 'expected' ? null : WAREHOUSE_ID),
    missingClosed: init.missingClosed ?? false,
    lines: init.lines.map((line) => ({
      id: line.id,
      productName: line.productName,
      quantity: line.quantity ?? line.items.reduce((sum, item) => sum + item.expectedQty, 0),
      items: line.items.map((item) => ({
        id: item.id,
        skuName: item.skuName,
        expectedQty: item.expectedQty,
        arrivedQty: item.arrivedQty ?? 0,
        barcodes: item.barcodes ?? [],
        shelfCode: item.shelfCode ?? null,
        skuId: item.skuId ?? `sku-${item.id}`,
        skuCode: item.skuCode ?? `C-${item.id}`,
        qtyPerUnit: item.qtyPerUnit ?? 1,
        acceptedQty: 0,
        rejectedQty: 0,
        heldQty: 0,
      })),
    })),
  };
}

export function createReturnsServer(init: { returns: FakeReturn[] }) {
  const returns: LiveReturn[] = init.returns.map(live);
  const config = {
    /** core 목록 limit(기본 100) — «외 N건» 을 보려면 줄인다 */
    limit: 100,
    warehouses: [{ id: WAREHOUSE_ID, name: '부천 창고' }],
  };
  const requests: Req[] = [];
  /** 반영된 도착(키·항목당 한 번) */
  const arrivals: Array<{ returnId: string; key: string; itemId: string; quantity: number }> = [];
  /** 받은 도착 요청 전부(같은 키 재요청 포함) */
  const arrivalCalls: Array<{ returnId: string; body: ArrivalBody }> = [];
  /** 반영된 검수(처음 한 번) */
  const inspections: Array<{ returnId: string; body: InspectionBody }> = [];
  const inspectionCalls: Array<{ returnId: string; body: InspectionBody }> = [];
  /** `<key>:<itemId>` → 수량 — core customer_return_arrivals.idempotency_key */
  const arrivalKeys = new Map<string, { itemId: string; quantity: number }>();
  let failure: Failure | null = null;
  let writeGate: Promise<void> | null = null;

  const find = (id: string) => returns.find((r) => r.id === id);
  const byId = (id: string) => {
    const found = find(id);
    if (!found) throw new Error(`unknown customer return ${id}`);
    return found;
  };
  const itemsOf = (r: LiveReturn) => r.lines.flatMap((line) => line.items);

  function view(r: LiveReturn): ReturnView {
    return {
      id: r.id,
      status: r.status,
      reason: r.reason ?? 'change_of_mind',
      feeBearer: r.feeBearer ?? 'customer',
      note: r.note ?? null,
      order: { orderNo: r.orderNo },
      warehouseId: r.warehouseId,
      csResolution: r.missingClosed ? { missing: { at: '2026-10-27T00:00:00.000Z' } } : null,
      lines: r.lines.map((line) => ({
        id: line.id,
        productName: line.productName,
        quantity: line.quantity,
        missingQty: r.missingClosed
          ? line.items.reduce((sum, item) => sum + item.expectedQty - item.arrivedQty, 0)
          : 0,
        items: line.items.map((item) => ({ ...item, barcodes: [...item.barcodes] })),
      })),
    };
  }

  function listItem(r: LiveReturn): ReceivingItem {
    const expectedQty = itemsOf(r).reduce((sum, item) => sum + item.expectedQty, 0);
    const arrivedQty = itemsOf(r).reduce((sum, item) => sum + item.arrivedQty, 0);
    const first = r.lines[0]?.productName ?? '';
    return {
      id: r.id,
      orderNo: r.orderNo,
      customerMasked: maskName(r.customerName),
      reason: r.reason ?? 'change_of_mind',
      productSummary: r.lines.length > 1 ? `${first} 외 ${r.lines.length - 1}건` : first,
      expectedQty,
      arrivedQty,
      stage:
        r.status === 'expected' ? 'awaiting' : arrivedQty >= expectedQty || r.missingClosed ? 'ready' : 'partial',
      requestedAt: r.requestedAt,
    };
  }

  function list(params: URLSearchParams) {
    const warehouseId = params.get('warehouseId') ?? '';
    if (!warehouseId) throw new ApiError('GET /admin/customer-return-receiving → 400', 400, 'BAD_REQUEST');
    const q = params.get('q')?.trim() ?? '';
    const barcode = params.get('barcode')?.trim() ?? '';
    const items = returns
      .filter((r) =>
        r.status === 'arrived' ? r.warehouseId === warehouseId : r.status === 'expected' && r.deliveredBy.includes(warehouseId)
      )
      .filter((r) => !q || r.orderNo === q || r.channelOrderId === q || r.customerName.includes(q))
      .filter((r) => !barcode || itemsOf(r).some((item) => item.barcodes.includes(barcode)))
      .map(listItem)
      .sort(
        (x, y) =>
          STAGE_ORDER[x.stage] - STAGE_ORDER[y.stage] ||
          Date.parse(x.requestedAt) - Date.parse(y.requestedAt) ||
          (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)
      );
    return { items: items.slice(0, config.limit), total: items.length };
  }

  function assertItems(path: string, r: LiveReturn, ids: string[]) {
    if (ids.length === 0) throw badRequest(path, 'items must not be empty');
    if (new Set(ids).size !== ids.length) throw badRequest(path, 'Duplicate customer return item');
    const own = new Set(itemsOf(r).map((item) => item.id));
    if (ids.some((id) => !own.has(id))) throw badRequest(path, 'Item does not belong to customer return');
  }

  /** customer-return-receiving.manager.ts recordArrival */
  function recordArrival(path: string, r: LiveReturn, body: ArrivalBody): ReturnView {
    if (r.status !== 'expected' && r.status !== 'arrived') throw conflict(`cannot receive arrivals: status is ${r.status}`);
    if (!body.idempotencyKey.trim()) throw badRequest(path, 'idempotencyKey is required');
    assertItems(
      path,
      r,
      body.items.map((item) => item.customerReturnItemId)
    );
    if (body.items.some((item) => !Number.isInteger(item.quantity) || item.quantity <= 0))
      throw badRequest(path, 'Arrival quantity must be a positive integer');
    if (r.warehouseId && r.warehouseId !== body.warehouseId) throw badRequest(path, 'received at another warehouse');
    if (!r.deliveredBy.includes(body.warehouseId)) throw badRequest(path, 'Warehouse did not deliver sales order');
    const fresh: ArrivalBody['items'] = [];
    for (const item of body.items) {
      const prior = arrivalKeys.get(`${body.idempotencyKey}:${item.customerReturnItemId}`);
      if (prior) {
        if (prior.quantity !== item.quantity) throw conflict('idempotencyKey already recorded a different arrival');
        continue;
      }
      if (r.missingClosed) throw conflict('미도착으로 닫은 반품입니다');
      const target = itemsOf(r).find((x) => x.id === item.customerReturnItemId);
      if (target && target.arrivedQty + item.quantity > target.expectedQty)
        throw badRequest(path, 'Arrival exceeds expected quantity');
      fresh.push(item);
    }
    for (const item of fresh) {
      const target = itemsOf(r).find((x) => x.id === item.customerReturnItemId);
      if (!target) continue;
      target.arrivedQty += item.quantity;
      arrivalKeys.set(`${body.idempotencyKey}:${item.customerReturnItemId}`, {
        itemId: item.customerReturnItemId,
        quantity: item.quantity,
      });
      arrivals.push({ returnId: r.id, key: body.idempotencyKey, itemId: item.customerReturnItemId, quantity: item.quantity });
    }
    if (fresh.length > 0) {
      r.warehouseId = body.warehouseId;
      if (r.status === 'expected') r.status = 'arrived';
    }
    return view(r);
  }

  /** customer-return-receiving.manager.ts recordInspection */
  function recordInspection(path: string, r: LiveReturn, body: InspectionBody): ReturnView {
    const items = itemsOf(r);
    assertItems(
      path,
      r,
      body.items.map((item) => item.customerReturnItemId)
    );
    if (body.items.length !== items.length) throw badRequest(path, 'Inspection must cover every item exactly once');
    if (body.items.some((item) => [item.accepted, item.rejected, item.held].some((q) => !Number.isInteger(q) || q < 0)))
      throw badRequest(path, 'Inspection quantities must be non-negative integers');
    const resultOf = (id: string) => body.items.find((item) => item.customerReturnItemId === id);
    if (INSPECTED.includes(r.status)) {
      const same = items.every((item) => {
        const result = resultOf(item.id);
        return (
          result !== undefined &&
          item.acceptedQty === result.accepted &&
          item.rejectedQty === result.rejected &&
          item.heldQty === result.held
        );
      });
      if (!same) throw conflict('already inspected with a different result');
      return view(r);
    }
    if (r.status !== 'expected' && r.status !== 'arrived') throw conflict(`cannot be inspected: status is ${r.status}`);
    if (!r.missingClosed && items.some((item) => item.arrivedQty < item.expectedQty))
      throw badRequest(path, '아직 도착하지 않은 수량이 있습니다');
    const mismatch = items.some((item) => {
      const result = resultOf(item.id);
      return !result || result.accepted + result.rejected + result.held !== item.arrivedQty;
    });
    if (mismatch) throw badRequest(path, 'Inspection total must equal arrived quantity');
    for (const item of items) {
      const result = resultOf(item.id);
      if (!result) continue;
      item.acceptedQty = result.accepted;
      item.rejectedQty = result.rejected;
      item.heldQty = result.held;
    }
    r.status = body.items.some((item) => item.held > 0) ? 'held' : 'inspected';
    inspections.push({ returnId: r.id, body });
    return view(r);
  }

  function handle(o: Req): unknown {
    const method = o.method ?? 'GET';
    const [path, query = ''] = o.path.split('?');
    if (method === 'GET' && path === '/inventory/warehouses') return config.warehouses;
    if (method === 'GET' && path === '/admin/customer-return-receiving') return list(new URLSearchParams(query));
    const detail = /^\/admin\/customer-return-receiving\/([^/]+)$/.exec(path);
    if (method === 'GET' && detail) {
      const r = find(decodeURIComponent(detail[1]));
      if (!r) throw new ApiError(`GET ${o.path} → 404`, 404, 'NOT_FOUND');
      return view(r);
    }
    const write = /^\/admin\/customer-returns\/([^/]+)\/(arrivals|inspection)$/.exec(path);
    if (method === 'POST' && write) {
      const r = find(decodeURIComponent(write[1]));
      if (!r) throw new ApiError(`POST ${o.path} → 404`, 404, 'NOT_FOUND');
      if (write[2] === 'arrivals') {
        const body = o.body as ArrivalBody;
        arrivalCalls.push({ returnId: r.id, body });
        return recordArrival(path, r, body);
      }
      const body = o.body as InspectionBody;
      inspectionCalls.push({ returnId: r.id, body });
      return recordInspection(path, r, body);
    }
    throw new Error(`Unexpected request ${method} ${o.path}`);
  }

  async function request<T>(o: Req): Promise<T> {
    requests.push(o);
    const method = o.method ?? 'GET';
    if (method !== 'GET' && writeGate) await writeGate;
    const fail = failure && (failure.method === undefined || failure.method === method) ? failure : null;
    if (fail) failure = null;
    if (fail && !fail.applied) throw failureError(fail, o);
    const value = handle(o);
    if (fail) throw failureError(fail, o);
    return value as T;
  }

  function failureError(fail: Failure, o: Req): Error {
    if (fail.status === undefined) return new TypeError('Failed to fetch');
    if (fail.status === 409) return new ConflictError('conflict', fail.code ?? 'CONFLICT');
    return new ApiError(`${o.method ?? 'GET'} ${o.path} → ${fail.status}`, fail.status, fail.code);
  }

  return {
    request,
    config,
    requests,
    arrivals,
    arrivalCalls,
    inspections,
    inspectionCalls,
    /** 목록 조회 요청의 쿼리들 — 화면이 무엇으로 찾았는지 본다 */
    listQueries(): URLSearchParams[] {
      return requests
        .filter((r) => (r.method ?? 'GET') === 'GET' && r.path.startsWith('/admin/customer-return-receiving?'))
        .map((r) => new URLSearchParams(r.path.split('?')[1]));
    },
    /** 다음 요청 하나를 실패시킨다(Failure 참고) */
    failNext(next: Failure = {}) {
      failure = next;
    },
    /** 도착·검수 응답을 붙잡는다 — 돌려받은 함수를 부르면 놓는다 */
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
    /** 열어 둔 사이 CS·다른 스테이션이 바꾼 것처럼 */
    setStatus(id: string, status: FakeReturnStatus) {
      byId(id).status = status;
    },
    /** CS 가 «미도착으로 닫기» 를 한 것처럼 */
    closeMissing(id: string) {
      byId(id).missingClosed = true;
    },
    /** 다른 스테이션이 먼저 받은 것처럼 — 키 없이 수량만 더한다 */
    arrive(id: string, itemId: string, quantity: number, warehouseId = WAREHOUSE_ID) {
      const r = byId(id);
      const target = itemsOf(r).find((item) => item.id === itemId);
      if (!target) throw new Error(`unknown item ${itemId}`);
      target.arrivedQty += quantity;
      r.warehouseId = warehouseId;
      if (r.status === 'expected') r.status = 'arrived';
    },
    view: (id: string) => view(byId(id)),
  };
}

export type ReturnsServer = ReturnType<typeof createReturnsServer>;
