import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '@app/shared';
import { wmsTables, DbTx } from '../../schema/inventory.schema';
import { planRackBinSync, rackBinLocationCode } from '../location-code';

/** 칸 맞추기 결과 — 로케이션 코드 목록. */
export type RackBinChanges = { created: string[]; deleted: string[]; keptInUse: string[] };

type ForeignKeyColumn = { schema: string; table: string; column: string; columns: number };

/**
 * 주어진 로케이션 중 «사용 중»인 것 — locations.id 를 가리키는 **모든** 외래키 열에 행이 하나라도 있으면 사용 중이다.
 * 지금 재고가 0이어도 이력이 남아 있으면 사용 중이다.
 *
 * 외래키 목록은 손으로 적지 않고 Postgres 카탈로그에서 읽는다. 스키마에 새 참조가 생겨도 저절로 들어온다.
 * «지워 보고 막히면 남기기»를 쓰지 않는 이유: stock_events·inbound_receipts·skus.primary_location_id 등은
 * ON DELETE SET NULL 이라 막지 않고 이력이 가리키던 위치를 조용히 지운다.
 */
export async function findLocationIdsInUse(tx: DbTx, ids: string[]): Promise<Set<string>> {
  const inUse = new Set<string>();
  if (ids.length === 0) return inUse;

  // execute 는 드라이버의 RowList 를 돌려준다 — 이 저장소의 raw sql 조회와 같은 방식으로 행 타입을 붙인다.
  const fks = (await tx.execute(sql`
    SELECT n.nspname AS schema, t.relname AS "table", a.attname AS column, array_length(c.conkey, 1) AS columns
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = to_regclass('locations')
  `)) as unknown as ForeignKeyColumn[];

  const multi = fks.filter((fk) => Number(fk.columns) !== 1);
  if (multi.length > 0) {
    // 다열 외래키는 첫 열만 보면 판정이 틀린다 — 조용히 빠뜨리지 않고 멈춘다.
    throw new Error(`locations 를 가리키는 다열 외래키는 사용 중 판정이 지원하지 않는다: ${multi.map((fk) => fk.table).join(', ')}`);
  }

  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  for (const fk of fks) {
    const rows = (await tx.execute(sql`
      SELECT DISTINCT ${sql.identifier(fk.column)}::text AS id
      FROM ${sql.identifier(fk.schema)}.${sql.identifier(fk.table)}
      WHERE ${sql.identifier(fk.column)} IN (${idList})
    `)) as unknown as { id: string }[];
    for (const row of rows) inUse.add(row.id);
  }
  return inUse;
}

/**
 * 랙의 숫자 칸을 랙 행의 `default_bin_start..default_bin_end` 에 맞춘다(#1235).
 * - 범위 안에 없는 칸은 만든다(가운데 빠진 칸도). 같은 번호를 다른 자릿수로 쓴 칸이 있으면 만들지 않는다.
 * - 범위 밖 숫자 칸은 사용 중이 아닐 때만 지운다. 사용 중이면 남긴다(끝 번호보다 큰 칸이 남아도 정상).
 * - 커스텀 칸(숫자 아닌 이름)은 건드리지 않는다. `auto_generate_bins=false` 인 수동 랙은 아무것도 안 한다.
 *
 * core 의 `PUT /racks/:rackId` 와 셀메이트 로케이션 만들기 스크립트가 같이 부른다.
 */
export async function syncRackBins(tx: DbTx, rackId: string): Promise<RackBinChanges> {
  const [rack] = await tx
    .select({
      warehouseId: wmsTables.locationColumns.warehouseId,
      columnName: wmsTables.locationColumns.columnName,
      rackNumber: wmsTables.locationRacks.rackNumber,
      start: wmsTables.locationRacks.defaultBinStart,
      end: wmsTables.locationRacks.defaultBinEnd,
      auto: wmsTables.locationRacks.autoGenerateBins,
    })
    .from(wmsTables.locationRacks)
    .innerJoin(wmsTables.locationColumns, eq(wmsTables.locationRacks.columnId, wmsTables.locationColumns.id))
    .where(eq(wmsTables.locationRacks.id, rackId))
    .limit(1);
  if (!rack) throw new NotFoundError(`Rack not found: ${rackId}`);

  const changes: RackBinChanges = { created: [], deleted: [], keptInUse: [] };
  if (!rack.auto) return changes;

  // 판정과 삭제 사이에 다른 트랜잭션이 그 칸을 쓰기 시작하지 못하게 랙의 칸 행을 먼저 잠근다.
  const existing = await tx
    .select({
      id: wmsTables.locations.id,
      code: wmsTables.locations.code,
      binIdentifier: wmsTables.locations.binIdentifier,
    })
    .from(wmsTables.locations)
    .where(eq(wmsTables.locations.rackId, rackId))
    .for('update');

  const plan = planRackBinSync({
    start: rack.start,
    end: rack.end,
    existing: existing.map((l) => ({ id: l.id, binIdentifier: l.binIdentifier ?? '' })),
  });

  if (plan.createBinIdentifiers.length > 0) {
    const rows = plan.createBinIdentifiers.map((binIdentifier) => {
      const code = rackBinLocationCode(rack.columnName, rack.rackNumber, binIdentifier);
      return {
        warehouseId: rack.warehouseId,
        code,
        locationType: 'standard' as const,
        rackId,
        binIdentifier,
        displayName: code,
        isActive: true,
      };
    });
    const taken = await tx
      .select({ code: wmsTables.locations.code })
      .from(wmsTables.locations)
      .where(
        and(
          eq(wmsTables.locations.warehouseId, rack.warehouseId),
          inArray(
            wmsTables.locations.code,
            rows.map((r) => r.code),
          ),
          // zone 행은 rack_id 가 NULL 이라 ne 만으로는 빠진다.
          or(isNull(wmsTables.locations.rackId), ne(wmsTables.locations.rackId, rackId)),
        ),
      );
    if (taken.length > 0) {
      throw new ConflictError(`같은 코드의 로케이션이 다른 곳에 이미 있습니다: ${taken.map((t) => t.code).join(', ')}`);
    }
    await tx.insert(wmsTables.locations).values(rows);
    changes.created = rows.map((r) => r.code).sort();
  }

  if (plan.deleteCandidateIds.length > 0) {
    const inUse = await findLocationIdsInUse(tx, plan.deleteCandidateIds);
    const codeById = new Map(existing.map((l) => [l.id, l.code]));
    const deletable = plan.deleteCandidateIds.filter((id) => !inUse.has(id));
    if (deletable.length > 0) {
      await tx.delete(wmsTables.locations).where(inArray(wmsTables.locations.id, deletable));
    }
    changes.deleted = deletable.map((id) => codeById.get(id) ?? id).sort();
    changes.keptInUse = plan.deleteCandidateIds
      .filter((id) => inUse.has(id))
      .map((id) => codeById.get(id) ?? id)
      .sort();
  }

  return changes;
}
