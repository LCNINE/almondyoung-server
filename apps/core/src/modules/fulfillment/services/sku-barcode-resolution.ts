import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';

/** 두 호출부(검수·단순출고)가 공유하는 UUID 형태 판별. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 바코드 → SKU id 해석. 검수(`resolveInspectionLine`)와 단순출고(`SimpleOutboundService.resolveSkuId`)가
 * 같은 물리 라벨을 같은 규칙으로 해석하도록 두 호출부가 공유하는 단일 함수:
 *   1) `sku_barcodes.barcode` 정확 일치
 *   2) `BarcodeService.parseBarcode` 결과가 `type === 'sku'` 이고 id 가 UUID 형태
 *   3) 위 결과가 `type === 'unknown'`(바코드 자체가 순수 UUID) 이고 UUID 형태
 *   4) `skus.code` 정확 일치
 * 아무 것도 맞지 않으면 `null` — 도메인 예외는 호출부가 자기 에러 코드로 던진다.
 */
export async function resolveSkuIdByBarcode(
  barcodes: BarcodeService,
  barcode: string,
  tx: DbTx,
): Promise<string | null> {
  const [registered] = await tx
    .select({ skuId: wmsTables.skuBarcodes.skuId })
    .from(wmsTables.skuBarcodes)
    .where(eq(wmsTables.skuBarcodes.barcode, barcode))
    .limit(1);
  if (registered?.skuId) return registered.skuId;

  const parsed = barcodes.parseBarcode(barcode);
  if (parsed.type === 'sku' && UUID_PATTERN.test(parsed.id)) return parsed.id.toLowerCase();
  if (parsed.type === 'unknown' && UUID_PATTERN.test(parsed.id)) return parsed.id.toLowerCase();

  const [sku] = await tx
    .select({ id: wmsTables.skus.id })
    .from(wmsTables.skus)
    .where(eq(wmsTables.skus.code, barcode))
    .limit(1);
  return sku?.id ?? null;
}
