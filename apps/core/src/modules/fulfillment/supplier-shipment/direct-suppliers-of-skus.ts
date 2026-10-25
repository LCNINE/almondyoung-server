import { HttpStatus } from '@nestjs/common';
import { ApplicationException } from '@app/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';

/**
 * 직배 SKU 의 입점사를 정하지 못했다 — 직배 공급사 연결이 0 개이거나 2 개 이상(K3 스펙 §4.2, fail-closed).
 * 백로그는 `failed` 로 남아 정체 보드 «fo» 단계에 뜬다. 고치는 곳은 SKU 의 입점사 연결이다.
 * `ApplicationException` 은 응답에 details 를 싣지 않으므로 SKU id 는 메시지에도 적는다.
 */
export class DropShippedSkuSupplierUnresolvedError extends ApplicationException {
  constructor(readonly skuIds: string[]) {
    super(`직배 SKU 의 입점사를 정할 수 없습니다(직배 공급사 연결이 하나가 아님): ${skuIds.join(', ')}`);
  }
  getErrorCode(): string {
    return 'DROP_SHIPPED_SKU_SUPPLIER_UNRESOLVED';
  }
  getHttpStatus(): number {
    return HttpStatus.BAD_REQUEST;
  }
}

/**
 * SKU id → 직배 공급사(입점사) id. FO 생성이 직배분을 입점사 상자로 묶을 때 쓴다 — PR 2 의 SKU 규칙
 * (`sku-direct-supplier.rule.ts`, «직배 SKU 는 직배 공급사 하나»)이 쓰는 연결의 읽는 쪽이다. 직배가 아닌 공급사 연결은 세지 않는다.
 *
 * 공급사 행을 FOR SHARE 로 잡는다(공급사 id 순) — 공급사를 «직배 아님»으로 바꾸거나 지우는 쪽은 FOR UPDATE 를 먼저 잡고
 * 묶인 직배 SKU 를 세므로(`suppliers.service.ts`), 이 판정과 그 전환이 엇갈리지 않는다.
 * 연결 0 개·2 개 이상인 SKU 가 하나라도 있으면 그 SKU 전부를 담아 던진다.
 */
export async function directSuppliersOfSkus(tx: DbTx, skuIds: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(skuIds)].sort();
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ skuId: wmsTables.skuSuppliers.skuId, supplierId: wmsTables.suppliers.id })
    .from(wmsTables.skuSuppliers)
    .innerJoin(wmsTables.suppliers, eq(wmsTables.suppliers.id, wmsTables.skuSuppliers.supplierId))
    .where(and(inArray(wmsTables.skuSuppliers.skuId, unique), eq(wmsTables.suppliers.isDirectDelivery, true)))
    .orderBy(wmsTables.suppliers.id)
    .for('share', { of: wmsTables.suppliers });

  const suppliersBySku = new Map<string, string[]>();
  for (const row of rows) suppliersBySku.set(row.skuId, [...(suppliersBySku.get(row.skuId) ?? []), row.supplierId]);

  const resolved = new Map<string, string>();
  const unresolved: string[] = [];
  for (const skuId of unique) {
    const supplierIds = suppliersBySku.get(skuId) ?? [];
    if (supplierIds.length === 1) resolved.set(skuId, supplierIds[0]);
    else unresolved.push(skuId);
  }
  if (unresolved.length > 0) throw new DropShippedSkuSupplierUnresolvedError(unresolved);
  return resolved;
}
