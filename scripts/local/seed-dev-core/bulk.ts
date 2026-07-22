import { DbTx, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { SEED_IDS } from './constants';

const BULK_SKU_COUNT = 300;
const BULK_LOCATION_COUNT = 50;

// postgres.js/드라이버 parameter 한도(65535)에 걸리지 않도록 insert 를 나눠 보낸다 —
// 300건 × 컬럼 수라도 여유가 있지만, 배치 크기를 명시적으로 고정해두면 컬럼이 늘어도
// 안전하다.
const INSERT_BATCH_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * 페이지네이션·검색 체감용. 결정론 규약을 따르되 기본 시드와 코드 공간을 분리한다
 * (`BULK-SKU-` 접두). 재고는 붙이지 않는다 — 목록 규모만 필요하고,
 * 300건에 receive 를 태우면 리셋이 눈에 띄게 느려진다.
 */
export async function seedBulk(tx: DbTx): Promise<void> {
  const locations = Array.from({ length: BULK_LOCATION_COUNT }, (_, index) => {
    const seq = String(index + 1).padStart(3, '0');
    return {
      warehouseId: SEED_IDS.warehouseBucheon,
      code: `B-${seq}`,
      locationType: 'zone' as const,
      displayName: `벌크 로케이션 ${seq}`,
    };
  });
  for (const batch of chunk(locations, INSERT_BATCH_SIZE)) {
    await tx.insert(wmsTables.locations).values(batch);
  }

  const skus = Array.from({ length: BULK_SKU_COUNT }, (_, index) => {
    const seq = String(index + 1).padStart(4, '0');
    return {
      holderId: index % 2 === 0 ? SEED_IDS.holderPrimary : SEED_IDS.holderSecondary,
      name: `벌크 상품 ${seq}`,
      code: `BULK-SKU-${seq}`,
      safetyStock: 0,
      deliveryProfileId: SEED_IDS.deliveryProfile,
    };
  });

  const inserted: Array<{ id: string; code: string }> = [];
  for (const batch of chunk(skus, INSERT_BATCH_SIZE)) {
    const insertedBatch = await tx
      .insert(wmsTables.skus)
      .values(batch)
      .returning({ id: wmsTables.skus.id, code: wmsTables.skus.code });
    inserted.push(...insertedBatch);
  }

  const barcodes = inserted.map((sku) => ({
    skuId: sku.id,
    barcode: `881${sku.code.replace('BULK-SKU-', '').padStart(8, '0')}`,
    isPrimary: true,
  }));
  for (const batch of chunk(barcodes, INSERT_BATCH_SIZE)) {
    await tx.insert(wmsTables.skuBarcodes).values(batch);
  }
}
