type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
const quantity = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const revision = (value: unknown) => quantity(value) && value > 0;
const nullableQuantity = (value: unknown) => value === null || quantity(value);

/** A successful transport response must identify the confirmed economic result before local work is cleared. */
export function isStocktakingOperationResult(
  url: string,
  body: RecordValue,
  value: unknown
): boolean {
  if (!record(value)) return false;
  if (url.endsWith('/scan-location')) {
    return (
      identifier(value.locationId) &&
      identifier(value.locationCode) &&
      revision(value.sessionRevision) &&
      Array.isArray(value.expectedItems) &&
      value.expectedItems.every(
        (item) =>
          record(item) &&
          identifier(item.lineId) &&
          identifier(item.skuId) &&
          identifier(item.skuName) &&
          identifier(item.skuCode) &&
          revision(item.lineRevision) &&
          nullableQuantity(item.countBaselineVersion) &&
          nullableQuantity(item.countedQuantity) &&
          quantity(item.expectedQuantity)
      )
    );
  }
  const complete = url.match(/\/sessions\/([^/]+)\/complete$/);
  if (complete) {
    return (
      value.sessionId === decodeURIComponent(complete[1]) &&
      value.status === 'completed' &&
      typeof value.completedAt === 'string' &&
      Number.isFinite(Date.parse(value.completedAt)) &&
      record(value.summary) &&
      quantity(value.summary.totalLines) &&
      quantity(value.summary.discrepanciesFound) &&
      quantity(value.summary.adjustmentsApplied)
    );
  }
  const line = url.match(/\/lines\/([^/]+)\/(count|reset-count)$/);
  if (!line && !url.endsWith('/scan-product')) return false;
  if (
    !identifier(value.lineId) ||
    !identifier(value.skuId) ||
    !revision(value.lineRevision) ||
    !revision(value.sessionRevision) ||
    !quantity(value.countBaselineVersion) ||
    !quantity(value.expectedQuantity)
  )
    return false;
  if (line && value.lineId !== decodeURIComponent(line[1])) return false;
  if (line?.[2] === 'reset-count')
    return value.countedQuantity === null && value.variance === null;
  if (
    !quantity(value.countedQuantity) ||
    !Number.isSafeInteger(value.variance) ||
    value.variance !== value.countedQuantity - value.expectedQuantity
  )
    return false;
  return line
    ? value.countedQuantity === body.countedQuantity
    : value.countedQuantity > 0;
}
