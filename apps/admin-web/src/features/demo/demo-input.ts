export type RunInput = {
  requestId: string;
  scenario: 'happy_path' | 'inventory_shortage';
  count: number;
  variantId?: string;
  quantity?: number;
  mode?: 'specified' | 'random';
  variantIds?: string[];
  productsPerOrder?: number;
  minQuantity?: number;
  maxQuantity?: number;
};
export type CatalogItem = {
  variantId: string;
  skuId: string;
  productName: string;
  sku: string;
  availableQuantity: number;
  unitPrice: number;
  components: { skuId: string; quantity: number; availableQuantity: number }[];
};
export type PracticeInput = {
  requestId: string;
  items: { skuId: string; quantity: number }[];
  prepareDemand: boolean;
};

export async function runWithActionLock(
  lock: { current: boolean },
  action: () => Promise<void>
): Promise<boolean> {
  if (lock.current) return false;
  lock.current = true;
  try {
    await action();
    return true;
  } finally {
    lock.current = false;
  }
}

export function buildRunInput(input: RunInput): RunInput {
  const integer = (v: number | undefined, min: number, max: number) =>
    v !== undefined && Number.isInteger(v) && v >= min && v <= max;
  if (
    !integer(input.count, 1, 50) ||
    !integer(input.productsPerOrder, 1, 5) ||
    !integer(input.minQuantity, 1, 100) ||
    !integer(input.maxQuantity, 1, 100) ||
    input.minQuantity! > input.maxQuantity!
  ) {
    throw new Error('주문 수·상품 종류·최소/최대 수량을 확인해 주세요.');
  }
  const ids = [...new Set(input.variantIds ?? [])];
  if (
    (input.mode === 'specified' || ids.length > 0) &&
    ids.length < input.productsPerOrder!
  ) {
    throw new Error('주문당 상품 종류만큼 서로 다른 상품을 선택해 주세요.');
  }
  return { ...input, variantIds: ids };
}

export function retryRunInput(run: {
  requestId: string;
  scenario: RunInput['scenario'];
  count: number;
  variantId: string;
  quantity: number;
  input?: Pick<
    RunInput,
    'mode' | 'variantIds' | 'productsPerOrder' | 'minQuantity' | 'maxQuantity'
  > | null;
}): RunInput {
  const common = {
    requestId: run.requestId,
    scenario: run.scenario,
    count: run.count,
  };
  return run.input?.mode
    ? { ...common, ...run.input }
    : { ...common, variantId: run.variantId, quantity: run.quantity };
}

export function buildPracticeItems(
  products: { components: { skuId: string; quantity: number }[] }[],
  quantity: number
) {
  const quantities = new Map<string, number>();
  for (const product of products)
    for (const part of product.components) {
      quantities.set(
        part.skuId,
        (quantities.get(part.skuId) ?? 0) + part.quantity * quantity
      );
    }
  const items = [...quantities]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([skuId, quantity]) => ({ skuId, quantity }));
  if (
    !items.length ||
    items.length > 50 ||
    items.some(
      (item) =>
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 1000
    )
  ) {
    throw new Error(
      '보충할 상품을 선택해 주세요. 구성 SKU마다 한 번에 1~1,000개까지 준비할 수 있습니다.'
    );
  }
  return items;
}

export type ReplenishmentInput =
  | { requestId: string; mode: 'random'; count: number }
  | { requestId: string; mode: 'specified'; skuIds: string[] };

export type ReplenishmentResult = {
  requestId: string;
  synthetic: boolean;
  createdAt: string;
  historyDays: number;
  items: {
    skuId: string;
    skuCode: string;
    skuName: string;
    pattern: string;
    dailyMean: number;
    onHand: number;
    onOrder: number;
    reorderPoint: number;
    purchaseQuantity: number;
    supplierName: string;
  }[];
};

export function buildReplenishmentInput(
  requestId: string,
  mode: 'random' | 'specified',
  count: number,
  products: { components: { skuId: string }[] }[]
): ReplenishmentInput {
  if (mode === 'random') {
    if (!Number.isInteger(count) || count < 1 || count > 20)
      throw new Error('무작위 상품 수는 1~20개로 입력해 주세요.');
    return { requestId, mode, count };
  }
  const skuIds = [
    ...new Set(products.flatMap((p) => p.components.map((c) => c.skuId))),
  ].sort();
  if (!skuIds.length || skuIds.length > 20)
    throw new Error(
      '직접 선택은 중복을 제외한 구성 SKU 1~20개까지 가능합니다.'
    );
  return { requestId, mode, skuIds };
}
