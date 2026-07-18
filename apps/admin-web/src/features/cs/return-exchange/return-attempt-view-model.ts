export type ReturnAttemptIdentity = {
  shipmentLineId?: string | null;
  dispatchAttemptId?: string | null;
};

export function summarizeReturnAttemptIdentity(
  items: readonly ReturnAttemptIdentity[]
): {
  exactCount: number;
  legacyCount: number;
} {
  const exactCount = items.filter(
    (item) => !!item.shipmentLineId && !!item.dispatchAttemptId
  ).length;
  return { exactCount, legacyCount: items.length - exactCount };
}

export function isReturnAttemptSelectable(item: {
  shipmentLineId: string | null | undefined;
  dispatchAttemptId: string | null | undefined;
  remainingEligibleQty: number;
  salesOrderLineRemainingEligibleQty?: number;
}): boolean {
  return (
    !!item.shipmentLineId &&
    !!item.dispatchAttemptId &&
    maxReturnAttemptSelectableQty(item) > 0
  );
}

export function maxReturnAttemptSelectableQty(item: {
  remainingEligibleQty: number;
  salesOrderLineRemainingEligibleQty?: number;
}): number {
  return Math.max(
    0,
    Math.min(
      item.remainingEligibleQty,
      item.salesOrderLineRemainingEligibleQty ?? item.remainingEligibleQty
    )
  );
}
