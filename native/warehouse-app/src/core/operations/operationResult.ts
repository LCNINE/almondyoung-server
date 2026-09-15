/** Check fields used to display confirmed quantities before settling a durable write. */
export function validateOperationResult(path: string, value: unknown): void {
  const row = value as Record<string, unknown> | null;
  const object = !!row && typeof row === 'object' && !Array.isArray(row);
  const integer = (v: unknown) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  let valid = object;
  if (path === '/inbound/simple')
    valid =
      object &&
      typeof row.id === 'string' &&
      Array.isArray(row.lines) &&
      row.lines.length > 0 &&
      row.lines.every(
        (line) =>
          typeof line.id === 'string' &&
          typeof line.skuId === 'string' &&
          integer(line.quantity)
      );
  else if (path === '/inbound/cancel') valid = object && row.success === true;
  else if (/^\/purchase-orders\/receipt-lines\/[^/]+\/cancel$/.test(path))
    valid =
      object &&
      typeof row.receiptLineId === 'string' &&
      typeof row.poId === 'string' &&
      typeof row.skuId === 'string' &&
      integer(row.quantity);
  else if (/^\/purchase-orders\/[^/]+\/receipts$/.test(path))
    valid =
      object &&
      typeof row.receiptId === 'string' &&
      Array.isArray(row.lines) &&
      row.lines.length > 0 &&
      row.lines.every(
        (line) =>
          typeof line.receiptLineId === 'string' && integer(line.quantity)
      );
  else if (path.startsWith('/shipments/'))
    valid =
      object &&
      typeof row.shipmentId === 'string' &&
      ['shipped', 'in_progress'].includes(String(row.status)) &&
      Array.isArray(row.lines) &&
      row.lines.every(
        (line) =>
          typeof line.shipmentLineId === 'string' &&
          integer(line.qty) &&
          integer(line.pickedQty) &&
          integer(line.inspectedQty)
      );
  else if (path === '/stocktaking/scan-location')
    valid =
      object &&
      typeof row.locationId === 'string' &&
      typeof row.locationCode === 'string' &&
      Array.isArray(row.expectedItems) &&
      row.expectedItems.every(
        (line) => typeof line.lineId === 'string' && integer(line.lineRevision)
      );
  else if (
    path === '/stocktaking/count-items' ||
    path === '/stocktaking/scan-product' ||
    /^\/stocktaking\/lines\/[^/]+\/(count|reset-count)$/.test(path)
  )
    valid =
      object &&
      typeof row.lineId === 'string' &&
      (integer(row.countedQuantity) ||
        (path.endsWith('/reset-count') && row.countedQuantity === null)) &&
      integer(row.lineRevision);
  // An endpoint explicitly returning 204 has no quantity projection to decode.
  else if (value === undefined) valid = true;
  if (/\/location-outbound-(starts|scans|forces|state)(\?|$)/.test(path)) {
    const ids = new Set<string>();
    valid =
      valid &&
      object &&
      typeof row.warehouseId === 'string' &&
      row.warehouseId.length > 0 &&
      Array.isArray(row.sources) &&
      (row.status !== 'shipped' || row.sources.length === 0) &&
      row.sources.every((source) => {
        if (!source || typeof source !== 'object') return false;
        const key = `${source.shipmentLineId}:${source.sourceLocationId}`;
        if (ids.has(key)) return false;
        ids.add(key);
        return (
          typeof source.shipmentLineId === 'string' &&
          typeof source.skuId === 'string' &&
          typeof source.sourceLocationId === 'string' &&
          source.sourceLocationId.length > 0 &&
          typeof source.sourceLocationCode === 'string' &&
          integer(source.allocatedQty) &&
          integer(source.pickedQty) &&
          integer(source.remainingQty) &&
          source.allocatedQty - source.pickedQty === source.remainingQty
        );
      });
  }
  if (!valid) throw new TypeError('처리 결과를 확인하지 못했어요.');
}
