// 셀메이트 저녁 맞추기(#1304) 축 — 기준값(init)·짝 못 지은 품목·이월. 읽기 전용.
// 정본: scripts/sellmate/evening-reconcile.ts (테이블: apps/core/drizzle/20261116154029_add-sellmate-reconcile-tables.sql).
import type { Sql } from '../db';
import type { Report } from '../report';
import { judgeReconcile, type ReconcileFacts } from '../rules';

const MAX_ROWS = 30;

/** 테이블이 아직 없으면(#1247 마이그 전) undefined — 대조를 못 했다는 뜻. 그 밖의 오류는 그대로 던진다 */
async function readAdapterCutoverAt(adapter: Sql): Promise<Date | null | undefined> {
  const [reg] = await adapter<{ ok: boolean }[]>`
    select to_regclass('reservation_projection_settings') is not null as ok`;
  if (reg?.ok !== true) return undefined;
  const [row] = await adapter<{ cutover_at: Date | null }[]>`
    select cutover_at from reservation_projection_settings where id = 'singleton'`;
  return row?.cutover_at ?? null;
}

export async function checkReconcile(core: Sql, adapter: Sql | null, r: Report): Promise<void> {
  r.section('재고 1. 저녁 맞추기');
  const [exist] = await core<{ ok: boolean }[]>`
    select (to_regclass('sellmate_item_pairs') is not null
        and to_regclass('sellmate_reconcile_runs') is not null
        and to_regclass('sellmate_reconcile_states') is not null) as ok`;
  const facts: ReconcileFacts = {
    tablesExist: exist?.ok === true,
    initCutoverAt: null,
    adapterCutoverAt: adapter ? await readAdapterCutoverAt(adapter) : undefined,
    openRunCreatedAt: null,
    pairRows: 0,
    unpaired: [],
    carry: [],
  };
  if (facts.tablesExist) {
    const [init] = await core<{ cutover_at: Date | null }[]>`
      select cutover_at from sellmate_reconcile_runs where kind = 'init' limit 1`;
    facts.initCutoverAt = init?.cutover_at ?? null;
    const [open] = await core<{ created_at: Date }[]>`
      select created_at from sellmate_reconcile_runs where status = 'awaiting_close' limit 1`;
    facts.openRunCreatedAt = open?.created_at ?? null;
    const [pairs] = await core<{ n: number }[]>`select count(*)::int as n from sellmate_item_pairs`;
    facts.pairRows = pairs?.n ?? 0;
    const unpaired = await core<{ option_serial: string; unpaired_reason: string }[]>`
      select option_serial, unpaired_reason from sellmate_item_pairs
      where unpaired_reason is not null order by unpaired_reason, option_serial`;
    facts.unpaired = unpaired.map((u) => ({ optionSerial: u.option_serial, reason: u.unpaired_reason }));
    const carry = await core<{ option_serial: string; code: string; carry: number }[]>`
      select st.option_serial, s.code, st.carry from sellmate_reconcile_states st
      join skus s on s.id = st.sku_id where st.carry > 0 and st.frozen = false order by st.carry desc, st.option_serial`;
    facts.carry = carry.map((c) => ({ optionSerial: c.option_serial, skuCode: c.code, carry: c.carry }));
  }

  for (const v of judgeReconcile(facts, new Date())) {
    if (v.level === 'ok') r.ok(v.msg);
    else if (v.level === 'info') r.info(v.msg);
    else if (v.level === 'bad') r.bad(v.msg, v.fix ?? '');
    else r.dayOf(v.msg, v.fix ?? '');
  }
  if (facts.unpaired.length) r.table(facts.unpaired.slice(0, MAX_ROWS));
  if (facts.carry.length) r.table(facts.carry.slice(0, MAX_ROWS));
}
