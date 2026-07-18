import { asc, desc } from 'drizzle-orm';
import { productMasters, productMasterVersions } from '../../../schema/catalog.schema';

/**
 * 정렬 키/방향을 Drizzle 컬럼과 방향 함수로 변환한다.
 * - createdAt(기본): product_masters.createdAt — 목록 '등록일' 컬럼과 동일 (product-master.mapper.ts:78)
 * - name/updatedAt: product_master_versions 컬럼
 */
export function resolveMasterSort(sort?: string, order?: string) {
  const column =
    sort === 'name'
      ? productMasterVersions.name
      : sort === 'updatedAt'
        ? productMasterVersions.updatedAt
        : productMasters.createdAt;

  const direction = order === 'asc' ? asc : desc;

  return { column, direction };
}
