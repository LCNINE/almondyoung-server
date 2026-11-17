// 로케이션 축 (core) — 적치 목적지가 있나, 재고가 실제 선반에 있나, 셀메이트 위치 텍스트와 이어지나.
import type { Sql } from '../db';
import type { Report } from '../report';
import { shelfCodeLinks } from '../rules';

export async function checkLocation(tx: Sql, r: Report): Promise<void> {
  r.section('로케이션 1. 판매 창고의 적치 목적지');
  // apps/core/src/modules/inventory/movement/ destinationIssue: 적치(putaway) 목적지가 시스템 로케이션이면 SYSTEM 거절.
  const locs = await tx<{ warehouse: string; system: number; zone: number; standard: number }[]>`
    select w.name as warehouse,
           count(*) filter (where l.is_system)::int as system,
           count(*) filter (where not l.is_system and l.location_type = 'zone')::int as zone,
           count(*) filter (where not l.is_system and l.location_type = 'standard')::int as standard
    from warehouses w left join locations l on l.warehouse_id = w.id and l.is_active
    where w.is_sellable group by 1 order by 1`;
  r.table(locs);
  for (const w of locs) {
    if (w.standard > 0) r.ok(`${w.warehouse}: 선반(standard) 로케이션 ${w.standard}개`);
    else
      r.bad(
        `${w.warehouse}: 선반 로케이션이 없다 — 앱 입고분을 적치할 곳이 없다`,
        '셀메이트 선반 위치로 로케이션 마스터를 만든다 (#1235)',
      );
  }

  r.section('로케이션 2. 재고가 어디에 있나 (판매 창고 ON_HAND)');
  const where = await tx<{ location: string; is_system: boolean; skus: number; qty: number }[]>`
    select l.code as location, l.is_system, count(distinct sl.sku_id)::int as skus, sum(sl.qty)::bigint as qty
    from stock_ledgers sl
    join warehouses w on w.id = sl.warehouse_id and w.is_sellable
    join locations l on l.id = sl.location_id
    where sl.stock_state = 'ON_HAND' and sl.qty > 0
    group by 1, 2 order by 4 desc limit 15`;
  r.table(where);

  // 위치가 하나뿐인 SKU 인데 아직 시스템 로케이션(입고기본존)에 있는 재고 — #1236 이 옮길 대상.
  const [single] = await tx<{ skus: number; qty: number }[]>`
    with one as (
      select sku_id from sku_shelf_positions group by 1 having count(distinct position_code) = 1)
    select count(distinct sl.sku_id)::int as skus, coalesce(sum(sl.qty), 0)::bigint as qty
    from stock_ledgers sl
    join warehouses w on w.id = sl.warehouse_id and w.is_sellable
    join locations l on l.id = sl.location_id and l.is_system
    join one on one.sku_id = sl.sku_id
    where sl.stock_state = 'ON_HAND' and sl.qty > 0`;
  if (single.skus === 0) r.ok('위치가 하나인 SKU 의 재고가 시스템 로케이션에 남아 있지 않다');
  else
    r.dayOf(
      `위치가 하나인 SKU ${single.skus}개(${single.qty}개)가 아직 시스템 로케이션에 있다`,
      '마지막 셀메이트 sync 직후 실제 로케이션으로 MOVE (#1236)',
    );
  const [multi] = await tx<{ skus: number }[]>`
    select count(*)::int as skus from (
      select sku_id from sku_shelf_positions group by 1 having count(distinct position_code) > 1) x`;
  r.info(`셀메이트 위치가 둘 이상인 SKU ${multi.skus}개 — 옮기지 않고 컷오버 뒤 실사 대상`);

  r.section('로케이션 3. 셀메이트 선반 위치 텍스트(sku_shelf_positions)와 로케이션의 연결');
  const [shelf] = await tx<{ rows: number; last_upd: Date | null }[]>`
    select count(*)::int as rows, max(updated_at) as last_upd from sku_shelf_positions`;
  const shelfCodes = await tx<{ code: string }[]>`select distinct position_code as code from sku_shelf_positions`;
  const locationCodes = await tx<{ code: string }[]>`
    select l.code from locations l join warehouses w on w.id = l.warehouse_id and w.is_sellable`;
  // 고쳐 읽기(CC-4-1 → CC-04-01)는 로케이션 만들기 스크립트와 같은 함수다 — rules.ts shelfCodeLinks.
  const links = shelfCodeLinks(
    shelfCodes.map((c) => c.code),
    locationCodes.map((c) => c.code),
  );
  r.info(`선반 위치 ${shelf.rows}행 · 고유 코드 ${shelfCodes.length}개 · 로케이션과 이어진 코드 ${links.linked}개`);
  r.info(`선반 위치 마지막 적재 ${shelf.last_upd?.toISOString() ?? '없음'} — 셀메이트 sync(Ⓔ)가 멈추면 굳는다(#1237)`);
  if (links.exceptions.length > 0) r.info(`꼴에 안 맞아 사람이 정할 선반 텍스트 ${links.exceptions.length}개 (만들기 스크립트 dry-run 이 목록을 보여 준다)`);
  if (links.unlinked.length > 0)
    r.bad(
      `로케이션이 없는 선반 코드 ${links.unlinked.length}개`,
      '로케이션 마스터 생성 (#1235): bash scripts/sellmate/run.sh live build-location-master --apply',
    );
}
