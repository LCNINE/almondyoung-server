// 일반 장바구니 주문(cart_kind=shopping 완료)보다 먼저 손댄 카트는 복구하지 않고, 남은 후보는 최신 하나로 합친다.
// 표시 없는 옛 카트·바로구매·부분 결제의 완료는 기준이 되지 않아 담아 둔 장바구니가 숨지 않는다.
export const CART_KIND_SHOPPING = 'shopping';
export const CART_KIND_BUY_NOW = 'buy_now';

// 이보다 오래 손대지 않은 카트는 합치지 않는다. 고객이 잊은 상품이 한꺼번에 튀어나오지 않게.
const MERGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
// 무통장 입금 대기 최대 72시간.
const PENDING_CHECKOUT_MS = 3 * 24 * 60 * 60 * 1000;

export type CartLine = {
  id: string;
  variant_id?: string | null;
  quantity: number;
  metadata?: Record<string, unknown> | null;
};

export type CustomerCartRow = {
  id: string;
  completed_at?: string | Date | null;
  updated_at?: string | Date | null;
  metadata?: Record<string, unknown> | null;
  items?: CartLine[] | null;
};

const time = (value: string | Date | null | undefined) => (value ? new Date(value).getTime() : 0);

const meta = (cart: CustomerCartRow) => (cart.metadata ?? {}) as Record<string, unknown>;

const isDerived = (cart: CustomerCartRow) => Boolean(meta(cart).source_cart_id) || meta(cart).is_shipping_preview === true;

function isShoppingCandidate(cart: CustomerCartRow) {
  const m = meta(cart);

  return !isDerived(cart) && m.cart_kind !== CART_KIND_BUY_NOW && !m.merged_into;
}

export function selectCustomerCart<T extends CustomerCartRow>(
  carts: T[],
  now = Date.now(),
): { target: T | null; mergeSources: T[] } {
  const lastShoppingOrderAt = Math.max(
    0,
    ...carts
      .filter((cart) => cart.completed_at && meta(cart).cart_kind === CART_KIND_SHOPPING && !isDerived(cart))
      .map((cart) => time(cart.completed_at)),
  );

  const candidates = carts
    .filter((cart) => !cart.completed_at && isShoppingCandidate(cart) && time(cart.updated_at) >= lastShoppingOrderAt)
    .sort((a, b) => {
      const byTime = time(b.updated_at) - time(a.updated_at);

      if (byTime !== 0) {
        return byTime;
      }

      return (b.items?.length ?? 0) - (a.items?.length ?? 0);
    });

  const [target = null, ...rest] = candidates;

  // 부분 결제가 진행 중인 카트는 결제 뒤 정리가 원래 라인 id 로 지우므로, 옮기면 산 상품이 본체에 남는다.
  const pendingCheckoutSources = new Set(
    carts
      .filter((cart) => isDerived(cart) && time(cart.updated_at) >= now - PENDING_CHECKOUT_MS)
      .map((cart) => meta(cart).source_cart_id),
  );

  const mergeSources = rest.filter(
    (cart) =>
      (cart.items?.length ?? 0) > 0 && time(cart.updated_at) >= now - MERGE_WINDOW_MS && !pendingCheckoutSources.has(cart.id),
  );

  return { target, mergeSources };
}

const isEmpty = (m: Record<string, unknown> | null | undefined) => !m || Object.keys(m).length === 0;

// 담기와 같은 판정(같은 variant + 같은 metadata). 이미 본체에 있는 라인은 옮기지 않아 수량이 불어나지 않는다.
function sameLine(a: CartLine, b: CartLine) {
  if (a.variant_id !== b.variant_id) {
    return false;
  }

  if (isEmpty(a.metadata) && isEmpty(b.metadata)) {
    return true;
  }

  return JSON.stringify(a.metadata ?? {}) === JSON.stringify(b.metadata ?? {});
}

export function linesToMove(target: CustomerCartRow, source: CustomerCartRow): CartLine[] {
  const moved: CartLine[] = [];

  for (const line of source.items ?? []) {
    if (!line.variant_id) {
      continue;
    }

    const already = [...(target.items ?? []), ...moved].some((existing) => sameLine(existing, line));

    if (!already) {
      moved.push(line);
    }
  }

  return moved;
}
