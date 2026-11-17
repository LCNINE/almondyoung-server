// 로케이션 축 (core) — 적치 목적지가 있나, 재고가 실제 선반에 있나, 셀메이트 위치 텍스트와 이어지나.
import type { Sql } from '../db';
import type { Report } from '../report';
import { shelfCodeLinks, shelfMoveSummary } from '../rules';
import {
  CUTOVER_MOVE_MEMO,
  judgeShelfMove,
  SHELF_MOVE_RULES,
  ShelfMoveRule,
} from '../../../../apps/core/src/modules/inventory/core/shelf-move-verdict';

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

  // 입고기본존 재고를 #1236 이동 스크립트와 같은 판정(shelf-move-verdict)으로 센다. guard 몫(적치 대기·배정·불일치)과
  // 신선도(stale)는 여기서 세지 않는다 — 그건 이동 스크립트의 dry-run 출력이 정본이다.
  const stock = await tx<
    {
      warehouse_id: string;
      qty: number;
      position_code: string | null;
      updated_at: Date | null;
      shelves: string[] | null;
    }[]
  >`
    select sl.warehouse_id, sl.qty::int as qty, p.position_code, p.updated_at,
           (select array_agg(ol.code) from stock_ledgers o join locations ol on ol.id = o.location_id
             where o.sku_id = sl.sku_id and o.warehouse_id = sl.warehouse_id and o.stock_state = 'ON_HAND'
               and o.qty > 0 and ol.location_type = 'standard') as shelves
    from stock_ledgers sl
    join warehouses w on w.id = sl.warehouse_id and w.is_sellable
    join locations l on l.id = sl.location_id and l.system_role = 'inbound_default'
    left join sku_shelf_positions p on p.sku_id = sl.sku_id
    where sl.stock_state = 'ON_HAND' and sl.qty > 0`;
  const shelfRows = await tx<{ warehouse_id: string; code: string }[]>`
    select l.warehouse_id, l.code from locations l join warehouses w on w.id = l.warehouse_id and w.is_sellable
    where l.is_active and not l.is_system and l.location_type = 'standard'`;
  const shelvesByWarehouse = new Map<string, Set<string>>();
  for (const s of shelfRows) {
    const set = shelvesByWarehouse.get(s.warehouse_id) ?? new Set<string>();
    set.add(s.code);
    shelvesByWarehouse.set(s.warehouse_id, set);
  }
  const judge = (row: (typeof stock)[number], includeRules: ReadonlySet<ShelfMoveRule>) =>
    judgeShelfMove({
      position:
        row.position_code && row.updated_at ? { code: row.position_code, updatedAt: new Date(row.updated_at) } : null,
      freshSince: null,
      locationCodes: shelvesByWarehouse.get(row.warehouse_id) ?? new Set(),
      shelvesWithStock: row.shelves ?? [],
      includeRules,
    });
  const exactOnly = stock.map((row) => judge(row, new Set()));
  const summary = shelfMoveSummary(
    exactOnly,
    stock.map((row) => judge(row, new Set(SHELF_MOVE_RULES))),
  );
  const moveQty = stock.reduce((sum, row, i) => (exactOnly[i].kind === 'move' ? sum + Number(row.qty) : sum), 0);
  const moveMsg = `위치가 하나인 SKU ${summary.move}개(${moveQty}개)가 입고기본존에 있다`;
  const moveFix =
    'bash scripts/sellmate/run.sh live move-stock-to-shelf --positions-since=<load-shelf-positions 직전 시각> 후 --apply (#1236)';
  if (summary.move === 0) r.ok('위치가 하나인 SKU 의 재고가 입고기본존에 남아 있지 않다');
  else if (r.phase === 'after' || r.cutoverAt) {
    // 컷오버 뒤에는 앱 입고분이 다시 입고기본존에 들어오므로 남은 것만으로는 실패가 아니다 — 이동 스크립트가 돌지 않았을 때만 실패.
    const [ran] = await tx<{ n: number }[]>`
      select count(*)::int as n from movement_jobs j join warehouses w on w.id = j.warehouse_id and w.is_sellable
      where j.memo = ${CUTOVER_MOVE_MEMO}`;
    if (ran.n === 0) r.bad(`${moveMsg} — 이동 스크립트가 돈 흔적이 없다`, moveFix);
    else r.info(`${moveMsg} — 이동 스크립트는 돌았다(작업 ${ran.n}건). 남은 건 앱 입고분·이동 때 남긴 SKU`);
  } else r.dayOf(moveMsg, moveFix);
  const kept = Object.entries(summary.byReason)
    .filter(([, n]) => n > 0)
    .map(([reason, n]) => `${reason} ${n}`)
    .join(' · ');
  if (kept) r.info(`입고기본존에 남길 SKU(사유별) ${kept} — 컷오버 뒤 실사 대상`);
  if (summary.unlockedByRules > 0)
    r.info(
      `고쳐 읽은 코드라 스위치가 꺼져 남는 SKU ${summary.unlockedByRules}개 — 현장 확인 뒤 --include-rule 로 켠다`,
    );

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
  if (links.exceptions.length > 0)
    r.info(
      `꼴에 안 맞아 사람이 정할 선반 텍스트 ${links.exceptions.length}개 (만들기 스크립트 dry-run 이 목록을 보여 준다)`,
    );
  if (links.unlinked.length > 0)
    r.bad(
      `로케이션이 없는 선반 코드 ${links.unlinked.length}개`,
      '로케이션 마스터 생성 (#1235): bash scripts/sellmate/run.sh live build-location-master --apply',
    );
}
