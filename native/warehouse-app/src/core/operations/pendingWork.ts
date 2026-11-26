import type { StoredOperation } from './operationStore';

/** 남은 작업이 있는 화면(앱 라우트). 스테이션에서는 이 경로가 속한 탭으로 읽는다 */
export type PendingWorkPath =
  | '/inbound'
  | '/inbound/quick'
  | '/inbound/history'
  | '/inbound/boxes'
  | `/inbound/purchase-orders/${string}`
  | '/putaway'
  | '/movement'
  | '/inventory'
  | '/stocktaking'
  | `/stocktaking/${string}`
  | '/outbound';

interface WorkKind {
  name: string;
  /** 같은 일을 다시 하지 말라는 말 */
  dontRepeat: string;
  match(path: string): boolean;
  screen(path: string, body: Record<string, unknown>): PendingWorkPath;
}

const starts =
  (...prefixes: string[]) =>
  (path: string) =>
    prefixes.some((p) => path.startsWith(p));

const PURCHASE_ORDER_RECEIPT = /^\/purchase-orders\/([^/]+)\/receipts$/;
const STOCKTAKING_SESSION = /^\/stocktaking\/sessions\/([^/]+)\//;

const CANCEL_PATH =
  /^(\/inbound\/cancel|\/purchase-orders\/receipt-lines\/[^/]+\/cancel|\/inventory\/inbound-shipments\/[^/]+\/boxes\/[^/]+\/receive\/cancel)$/;

// 위에서부터 먼저 맞는 것 — 적치(`/inbound/putaway`)·입고 취소가 입고(`/inbound/`)보다 앞이다
const KINDS: WorkKind[] = [
  {
    name: '입고 취소',
    dontRepeat: '이 입고를 다시 취소하지 마세요.',
    match: (path) => CANCEL_PATH.test(path),
    screen: (path) =>
      path.startsWith('/inventory/inbound-shipments/')
        ? '/inbound/boxes'
        : // F3 등록 직후 목록·F4 적치·입고내역 어디서든 취소한다 — 모두 보이는 곳은 입고내역이다
          '/inbound/history',
  },
  {
    name: '적치·이동',
    dontRepeat: '같은 상품을 다시 옮기지 마세요.',
    match: starts('/inbound/putaway', '/movement/'),
    screen: (path) =>
      path.startsWith('/movement/') ? '/movement' : '/putaway',
  },
  {
    name: '입고',
    dontRepeat: '이 입고를 다시 등록하지 마세요.',
    match: starts(
      '/inbound/',
      '/purchase-orders/',
      '/inventory/inbound-shipments/'
    ),
    screen: (path) => {
      if (path === '/inbound/simple') return '/inbound/quick';
      if (path.startsWith('/inventory/inbound-shipments/'))
        return '/inbound/boxes';
      const po = PURCHASE_ORDER_RECEIPT.exec(path)?.[1];
      if (po) return `/inbound/purchase-orders/${po}`;
      return '/inbound';
    },
  },
  {
    name: '재고 조정',
    dontRepeat: '같은 조정을 다시 하지 마세요.',
    match: starts('/inventory/stocks/adjust'),
    screen: () => '/inventory',
  },
  {
    name: '실사',
    dontRepeat: '같은 상품을 다시 세지 마세요.',
    match: starts('/stocktaking/'),
    screen: (path, body) => {
      const session =
        (typeof body.sessionId === 'string' && body.sessionId) ||
        STOCKTAKING_SESSION.exec(path)?.[1];
      return session ? `/stocktaking/${session}` : '/stocktaking';
    },
  },
  {
    name: '출고',
    dontRepeat: '같은 상품을 다시 찍지 마세요.',
    match: starts('/shipments/'),
    screen: () => '/outbound',
  },
];

const kindOf = (path: string) => KINDS.find((k) => k.match(path)) ?? null;

/** 쓰기 경로의 작업 이름. 모르는 경로면 null */
export function workNameOf(path: string): string | null {
  return kindOf(path)?.name ?? null;
}

function bodyOf(op: StoredOperation): Record<string, unknown> {
  try {
    const body = JSON.parse(op.bodyJson);
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

/**
 * 화면이 이름을 남기지 않은 기록(옛 기록 포함)은 본문으로만 말한다 — 찍은 바코드와 수량은 보이고 id 는 보이지 않는다.
 * 실사 스캔은 찍는 순간 상품 이름을 모르므로(응답에서 안다) 바코드로 말한다.
 */
function fallbackSummary(body: Record<string, unknown>): string | null {
  const counted =
    typeof body.countedQuantity === 'number' ? body.countedQuantity : null;
  if (typeof body.productBarcode === 'string') {
    const quantity =
      typeof body.quantity === 'number' ? ` ×${body.quantity}` : '';
    return `상품 바코드 ${body.productBarcode}${quantity}`;
  }
  if (typeof body.locationBarcode === 'string')
    return `위치 ${body.locationBarcode}`;
  if (counted !== null) return `${counted}개로 셈`;
  const rows = [body.items, body.lines].find(Array.isArray) as
    unknown[] | undefined;
  const quantityOf = (v: unknown) =>
    v &&
    typeof v === 'object' &&
    typeof (v as { quantity?: unknown }).quantity === 'number'
      ? (v as { quantity: number }).quantity
      : null;
  if (rows?.length) {
    const quantities = rows.map(quantityOf);
    if (quantities.every((q) => q !== null))
      return `상품 ${rows.length}종 ${quantities.reduce((a, b) => a! + b!, 0)}개`;
    return `상품 ${rows.length}종`;
  }
  const quantity =
    quantityOf(body) ??
    (typeof body.delta === 'number' ? Math.abs(body.delta) : null);
  return quantity === null ? null : `${quantity}개`;
}

const summaryOf = (op: StoredOperation) =>
  op.summary ?? fallbackSummary(bodyOf(op));

export interface PendingWorkDescription {
  /** 예: «입고 1건(데모 상품 11 ×1)», «입고 2건(데모 상품 11 ×1 외 1건)·실사 1건» */
  what: string;
  dontRepeat: string;
  /** 가장 먼저 남은 작업의 화면 */
  screen: PendingWorkPath | null;
}

/** 기기에 남은 작업(상자에 묶이지 않은 것)을 종류·대상 이름으로 말한다. 없으면 null */
export function describePendingWork(
  operations: StoredOperation[]
): PendingWorkDescription | null {
  if (!operations.length) return null;
  const ordered = [...operations].sort((a, b) => a.createdAt - b.createdAt);
  const groups = new Map<string, StoredOperation[]>();
  for (const op of ordered) {
    const name = workNameOf(op.path) ?? '작업';
    groups.set(name, [...(groups.get(name) ?? []), op]);
  }
  const what = [...groups]
    .map(([name, ops]) => {
      const first = summaryOf(ops[0]);
      const more = ops.length > 1 ? ` 외 ${ops.length - 1}건` : '';
      return `${name} ${ops.length}건${first ? `(${first}${more})` : ''}`;
    })
    .join('·');
  const oldest = ordered[0];
  const kind = kindOf(oldest.path);
  return {
    what,
    dontRepeat:
      groups.size === 1 && kind
        ? kind.dontRepeat
        : '같은 작업을 다시 하지 마세요.',
    // 같은 경로를 여러 화면이 쓰면(이동 ↔ 반품 적치) 화면이 남긴 곳이 맞다
    screen:
      oldest.screen ?? (kind ? kind.screen(oldest.path, bodyOf(oldest)) : null),
  };
}

/** 화면이 작업 기록에 남길 표시 이름 — «데모 상품 11 ×3», 여럿이면 «데모 상품 11 ×3 외 2종» */
export function workSummary(
  items: ReadonlyArray<{ name: string; quantity: number }>
): string | undefined {
  const [first, ...rest] = items;
  if (!first) return undefined;
  return `${first.name} ×${first.quantity}${rest.length ? ` 외 ${rest.length}종` : ''}`;
}

/** 쓰기 훅 입력에 표시 이름을 더한다 — 훅이 꺼내 요청 옵션으로만 넘기고 본문에는 싣지 않는다 */
export type WithSummary<T> = T & { summary?: string; screen?: PendingWorkPath };
