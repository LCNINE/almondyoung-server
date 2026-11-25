import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../schema/inventory.schema';

export interface UsualShelf {
  /** 같은 창고의 사용 중인 일반 로케이션일 때만 채운다. 다른 창고·사용 중지·시스템 자리는 null. */
  usualLocationId: string | null;
  usualLocationCode: string | null;
  /** 평소 선반이 아예 비어 있어 적치가 채울 수 있다. 다른 창고에 정해져 있으면 false. */
  canRememberUsual: boolean;
}

/** 상품의 평소 선반 값과 그 로케이션 행으로 이 창고에서의 평소 선반을 판정한다 — 읽는 곳마다 같은 규칙. */
export interface PrimaryLocationFacts {
  primaryLocationId: string | null;
  code: string | null;
  warehouseId: string | null;
  isActive: boolean | null;
  isSystem: boolean | null;
}

export function usualShelfOf(row: PrimaryLocationFacts, warehouseId: string): UsualShelf {
  const usable =
    row.primaryLocationId !== null &&
    row.warehouseId?.toLowerCase() === warehouseId.toLowerCase() &&
    row.isActive === true &&
    row.isSystem === false;
  return {
    usualLocationId: usable ? row.primaryLocationId : null,
    usualLocationCode: usable ? row.code : null,
    canRememberUsual: row.primaryLocationId === null,
  };
}

export async function readUsualShelves(
  tx: DbTx,
  skuIds: readonly string[],
  warehouseId: string,
): Promise<Map<string, UsualShelf>> {
  const ids = [...new Set(skuIds)];
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      skuId: wmsTables.skus.id,
      primaryLocationId: wmsTables.skus.primaryLocationId,
      code: wmsTables.locations.code,
      warehouseId: wmsTables.locations.warehouseId,
      isActive: wmsTables.locations.isActive,
      isSystem: wmsTables.locations.isSystem,
    })
    .from(wmsTables.skus)
    .leftJoin(wmsTables.locations, eq(wmsTables.locations.id, wmsTables.skus.primaryLocationId))
    .where(inArray(wmsTables.skus.id, ids));
  return new Map(rows.map((row) => [row.skuId, usualShelfOf(row, warehouseId)]));
}

/**
 * 평소 선반이 비어 있는 상품만 이 자리로 정한다 — 이미 정해진 값은 다른 창고 것이라도 덮지 않는다.
 * 같은 창고의 사용 중인 일반 로케이션이 아니면 아무것도 하지 않는다. 정했으면 true.
 */
export async function rememberUsualShelf(
  tx: DbTx,
  skuId: string,
  locationId: string,
  warehouseId: string,
): Promise<boolean> {
  const [location] = await tx
    .select({ id: wmsTables.locations.id })
    .from(wmsTables.locations)
    .where(
      and(
        eq(wmsTables.locations.id, locationId),
        eq(wmsTables.locations.warehouseId, warehouseId),
        eq(wmsTables.locations.isActive, true),
        eq(wmsTables.locations.isSystem, false),
      ),
    )
    .limit(1);
  if (!location) return false;
  const updated = await tx
    .update(wmsTables.skus)
    .set({ primaryLocationId: locationId })
    .where(and(eq(wmsTables.skus.id, skuId), isNull(wmsTables.skus.primaryLocationId)))
    .returning({ id: wmsTables.skus.id });
  return updated.length > 0;
}
