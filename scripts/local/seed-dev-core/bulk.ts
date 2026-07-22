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

// constants.ts 의 SEED_IDS/SEED_RACK_LOCATIONS/SEED_SKUS 는 019d0001~019d0006 을,
// orders.ts/shipments.ts 는 019d0007~019d0008 을 이미 쓴다 — 벌크는 그 다음 두 접두
// (019d0009, 019d000a) 를 쓴다.
const BULK_LOCATION_ID_PREFIX = '019d0009';
const BULK_SKU_ID_PREFIX = '019d000a';

// SEED_SKUS/SEED_RACK_LOCATIONS 와 동일한 이유로 각 세그먼트에 padStart 를 쓴다 —
// 리터럴 템플릿은 seq 자릿수가 늘어나는 순간(여기서는 300건 중 세 자리를 넘는 인덱스)
// 8-4-4-4-12 자릿수가 밀려 깨진다. seq 는 4자리 padStart 라 999건까지 안전하다.
function bulkLocationId(index: number): string {
  const seq = String(index + 1).padStart(4, '0');
  return `${BULK_LOCATION_ID_PREFIX}-${seq}-7000-a000-00000000${seq}`;
}

function bulkSkuId(index: number): string {
  const seq = String(index + 1).padStart(4, '0');
  return `${BULK_SKU_ID_PREFIX}-${seq}-7000-a000-00000000${seq}`;
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
      id: bulkLocationId(index),
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
      id: bulkSkuId(index),
      holderId: index % 2 === 0 ? SEED_IDS.holderPrimary : SEED_IDS.holderSecondary,
      name: `벌크 상품 ${seq}`,
      code: `BULK-SKU-${seq}`,
      safetyStock: 0,
      deliveryProfileId: SEED_IDS.deliveryProfile,
    };
  });
  for (const batch of chunk(skus, INSERT_BATCH_SIZE)) {
    await tx.insert(wmsTables.skus).values(batch);
  }

  // id 를 미리 알고 있으니 더 이상 insert 의 RETURNING 왕복이 필요 없다 — skus 배열에서
  // 바로 바코드를 파생한다. 결과 바코드 값은 이전과 동일하다(code 파생 로직 불변).
  const barcodes = skus.map((sku) => ({
    skuId: sku.id,
    barcode: `881${sku.code.replace('BULK-SKU-', '').padStart(8, '0')}`,
    isPrimary: true,
  }));
  for (const batch of chunk(barcodes, INSERT_BATCH_SIZE)) {
    await tx.insert(wmsTables.skuBarcodes).values(batch);
  }
}
