// core 의 sku-direct-supplier.rule.ts 와 같은 판정이다. 서버가 최종 판정자이고 이건 헛걸음 방지용.

type DirectState = { stockType: string; directSupplierId: string };

/** '' 은 「입점사 없음」. 수정은 재고 유형이나 직배 입점사가 원래와 달라졌을 때만 판정한다. */
export function directSupplierMissing(input: {
  original: DirectState | null;
  stockType: string;
  directSupplierId: string;
}): boolean {
  const { original, stockType, directSupplierId } = input;
  if (
    original &&
    original.stockType === stockType &&
    original.directSupplierId === directSupplierId
  ) {
    return false;
  }
  return stockType === 'drop_shipped' && !directSupplierId;
}

/**
 * 수정의 supplierIds 는 core 가 통째로 갈아 끼운다 — 비직배 연결을 빼고 보내면 지워진다.
 * 그래서 직배 입점사를 실제로 바꿀 때만 보내고, 보낼 때는 기존 연결에서 직배만 빼고 고른 입점사를 더한다.
 */
export function supplierIdsPayload(input: {
  linkedSupplierIds: string[];
  directSupplierIds: ReadonlySet<string>;
  originalDirectSupplierId: string;
  directSupplierId: string;
  stockType: string;
}): { supplierIds: string[] } | Record<string, never> {
  if (
    input.stockType !== 'drop_shipped' ||
    input.directSupplierId === input.originalDirectSupplierId
  ) {
    return {};
  }
  return {
    supplierIds: [
      ...input.linkedSupplierIds.filter(
        (id) => !input.directSupplierIds.has(id)
      ),
      input.directSupplierId,
    ],
  };
}
