export interface EligibilityLine {
  salesOrderId: string | null;
  fulfillmentMode: string | null;
  skuStockType: string;
  skuProfileId: string | null;
}

export function linesAreInHouse(lines: readonly EligibilityLine[], shippingProfileId: string | null): boolean {
  return lines.every(
    (line) =>
      line.salesOrderId !== null &&
      line.fulfillmentMode === 'in_house' &&
      line.skuStockType !== 'drop_shipped' &&
      line.skuProfileId !== null &&
      line.skuProfileId === shippingProfileId,
  );
}

export function supportsInHouse(modes: readonly string[] | null | undefined): boolean {
  return Boolean(modes?.includes('in_house'));
}

export function isEligibleInHouseBox(
  lines: readonly EligibilityLine[],
  shippingProfileId: string | null,
  inHouseProfileIds: ReadonlySet<string>,
): boolean {
  return Boolean(
    shippingProfileId && linesAreInHouse(lines, shippingProfileId) && inHouseProfileIds.has(shippingProfileId),
  );
}
