import { StockSummaryGroupDto, StockSummaryGroupSkuDto } from '../dto/stock-summary-by-group.dto';
import { physicalQuantity } from './physical-quantity';

export interface GroupStockSummaryRow extends Omit<
  StockSummaryGroupSkuDto,
  'currentQuantity' | 'onHandQuantity' | 'shortageQuantity' | 'belowSafetyStock'
> {
  groupId: string | null;
  groupName: string;
  groupCode: string | null;
  onHandQty: number;
  defectiveQty: number;
  inTransferQty: number;
  returnedQty: number;
}

/** DB에서 정렬·페이지 처리한 행의 순서를 유지한다. */
export function groupStockSummaries(
  rows: GroupStockSummaryRow[],
  imageFileIdBySku: ReadonlyMap<string, string> = new Map(),
): StockSummaryGroupDto[] {
  const groups = new Map<string, StockSummaryGroupDto>();

  for (const row of rows) {
    const key = row.groupId === null ? `sku:${row.skuId}` : `group:${row.groupId}`;
    let group = groups.get(key);

    if (!group) {
      group = {
        groupId: row.groupId,
        groupName: row.groupId === null ? row.skuName : row.groupName,
        groupCode: row.groupId === null ? null : row.groupCode,
        imageFileId: null,
        skus: [],
      };
      groups.set(key, group);
    }

    group.imageFileId ??= imageFileIdBySku.get(row.skuId) ?? null;

    const currentQuantity = physicalQuantity(row);

    group.skus.push({
      skuId: row.skuId,
      skuName: row.skuName,
      skuCode: row.skuCode,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      shelfPosition: row.shelfPosition,
      currentQuantity,
      onHandQuantity: row.onHandQty,
      availableQuantity: row.availableQuantity,
      unshippedQuantity: row.unshippedQuantity,
      shortageQuantity: Math.max(row.unshippedQuantity - row.onHandQty, 0),
      safetyStock: row.safetyStock,
      belowSafetyStock: row.safetyStock !== null && row.availableQuantity < row.safetyStock,
    });
  }

  return [...groups.values()];
}
