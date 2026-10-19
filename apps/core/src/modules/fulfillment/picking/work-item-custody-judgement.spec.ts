import type { ShipmentAllocation, ShipmentCustodyBalance } from './allocation/allocation.types';
import {
  judgeCompleteAllocation,
  judgeHeldCustody,
  judgeUnpickCustody,
  packingRefOf,
  PACKING_REF_PREFIX,
  spotsOf,
} from './work-item-custody-judgement';

const alloc = (line: string, loc: string, qty: number, skuId = 'sku-1'): ShipmentAllocation => ({
  id: `a-${line}-${loc}`,
  shipmentLineId: line,
  skuId,
  sourceLocationId: loc,
  qty,
});
const bal = (over: Partial<ShipmentCustodyBalance> & { id: string }): ShipmentCustodyBalance => ({
  skuId: 'sku-1',
  sourceLocationId: 'loc-1',
  custodyType: 'WORKER',
  custodyRef: 'w1',
  shipmentLineId: 'line-1',
  qty: 1,
  ...over,
});
const worker = spotsOf([{ custodyType: 'WORKER', refs: new Set(['w1']) }]);

describe('spotsOf / packingRefOf', () => {
  it('null ref is never allowed; type and ref must both match', () => {
    expect(worker.allows({ custodyType: 'WORKER', custodyRef: 'w1' })).toBe(true);
    expect(worker.allows({ custodyType: 'WORKER', custodyRef: null })).toBe(false);
    expect(worker.allows({ custodyType: 'WORKER', custodyRef: 'w2' })).toBe(false);
    expect(worker.allows({ custodyType: 'TOTE', custodyRef: 'w1' })).toBe(false);
  });
  it('packing ref keeps the strategies prefix', () => {
    expect(PACKING_REF_PREFIX).toBe('work-item:');
    expect(packingRefOf('x')).toBe('work-item:x');
  });
});

describe('judgeCompleteAllocation', () => {
  it('discrete shape: one WORKER row = allocation qty', () => {
    expect(judgeCompleteAllocation(2, [{ custodyType: 'WORKER', custodyRef: 'w1', qty: 2 }], worker)).toBe(true);
  });
  it('WORKER short of allocation is false', () => {
    expect(judgeCompleteAllocation(2, [{ custodyType: 'WORKER', custodyRef: 'w1', qty: 1 }], worker)).toBe(false);
  });
  it('a spot outside the allowed set is false', () => {
    expect(
      judgeCompleteAllocation(
        2,
        [
          { custodyType: 'WORKER', custodyRef: 'w1', qty: 1 },
          { custodyType: 'WORKER', custodyRef: 'other', qty: 1 },
        ],
        worker,
      ),
    ).toBe(false);
  });
  it('aggregate shape: SORTING 2 + PACKING 1 = 3, both allowed', () => {
    const held = spotsOf([
      { custodyType: 'SORTING', refs: new Set(['s']) },
      { custodyType: 'PACKING', refs: new Set(['p']) },
    ]);
    expect(
      judgeCompleteAllocation(
        3,
        [
          { custodyType: 'SORTING', custodyRef: 's', qty: 2 },
          { custodyType: 'PACKING', custodyRef: 'p', qty: 1 },
        ],
        held,
      ),
    ).toBe(true);
  });
  it('tote shape: two active totes true; one tote outside the allocation false', () => {
    const held = spotsOf([{ custodyType: 'TOTE', refs: new Set(['t1', 't2']) }]);
    const rows = [
      { custodyType: 'TOTE' as const, custodyRef: 't1', qty: 1 },
      { custodyType: 'TOTE' as const, custodyRef: 't2', qty: 1 },
    ];
    expect(judgeCompleteAllocation(2, rows, held)).toBe(true);
    expect(judgeCompleteAllocation(2, [rows[0], { custodyType: 'TOTE', custodyRef: 't9', qty: 1 }], held)).toBe(false);
  });
});

describe('judgeHeldCustody', () => {
  it('every balance must be allowed', () => {
    expect(judgeHeldCustody([{ custodyType: 'WORKER', custodyRef: 'w1' }], worker)).toBe(true);
    expect(judgeHeldCustody([{ custodyType: 'WORKER', custodyRef: 'w2' }], worker)).toBe(false);
  });
});

describe('judgeUnpickCustody', () => {
  const allocations = [alloc('line-1', 'loc-1', 2)];
  const base = { workItemId: 'wi-1', allocations };

  it('picking + all allowed -> ok', () => {
    expect(
      judgeUnpickCustody({ ...base, status: 'picking', held: worker, balances: [bal({ id: 'b1', qty: 2 })] }),
    ).toEqual({ ok: true });
  });
  it('picking + disallowed spot -> OWNER_MISMATCH with first offending balance', () => {
    expect(
      judgeUnpickCustody({
        ...base,
        status: 'picking',
        held: worker,
        balances: [bal({ id: 'b1', qty: 1 }), bal({ id: 'b2', qty: 1, custodyRef: 'zz' })],
      }),
    ).toEqual({ ok: false, code: 'PICKING_CUSTODY_OWNER_MISMATCH', balanceId: 'b2' });
  });
  it('balance on a grain without allocation -> GRAIN_MISMATCH; SKU mismatch too', () => {
    expect(
      judgeUnpickCustody({
        ...base,
        status: 'picking',
        held: worker,
        balances: [bal({ id: 'b1', sourceLocationId: 'loc-9' })],
      }),
    ).toEqual({ ok: false, code: 'PICKING_CUSTODY_GRAIN_MISMATCH', balanceId: 'b1', grain: 'line-1|loc-9' });
    expect(
      judgeUnpickCustody({ ...base, status: 'picking', held: worker, balances: [bal({ id: 'b1', skuId: 'other' })] }),
    ).toMatchObject({ ok: false, code: 'PICKING_CUSTODY_GRAIN_MISMATCH', balanceId: 'b1' });
  });
  it('sum above allocation -> OVERATTRIBUTED with grain', () => {
    expect(
      judgeUnpickCustody({
        ...base,
        status: 'picking',
        held: worker,
        balances: [bal({ id: 'b1', qty: 2 }), bal({ id: 'b2', qty: 1, custodyType: 'TOTE', custodyRef: 't' })],
      }),
    ).toEqual({ ok: false, code: 'PICKING_CUSTODY_OVERATTRIBUTED', balanceId: 'b2', grain: 'line-1|loc-1' });
  });
  it('grain violation wins over owner violation regardless of balance order', () => {
    const owner = bal({ id: 'b1', custodyRef: 'zz' });
    const grain = bal({ id: 'b2', sourceLocationId: 'loc-9' });
    for (const balances of [[owner, grain], [grain, owner]]) {
      expect(judgeUnpickCustody({ ...base, status: 'picking', held: worker, balances })).toMatchObject({
        ok: false,
        code: 'PICKING_CUSTODY_GRAIN_MISMATCH',
        balanceId: 'b2',
      });
    }
  });
  describe('ready_to_pack', () => {
    const packing = (id: string, over: Partial<ShipmentCustodyBalance> = {}) =>
      bal({ id, custodyType: 'PACKING', custodyRef: packingRefOf('wi-1'), qty: 2, ...over });
    it('exact PACKING ref and full qty -> ok', () => {
      expect(judgeUnpickCustody({ ...base, status: 'ready_to_pack', held: null, balances: [packing('b1')] })).toEqual({
        ok: true,
      });
    });
    it("another work item's PACKING ref -> INCOMPLETE", () => {
      expect(
        judgeUnpickCustody({
          ...base,
          status: 'ready_to_pack',
          held: null,
          balances: [packing('b1', { custodyRef: packingRefOf('wi-2') })],
        }),
      ).toEqual({ ok: false, code: 'PICKING_PACKING_CUSTODY_INCOMPLETE' });
    });
    it('a grain short -> INCOMPLETE', () => {
      expect(
        judgeUnpickCustody({ ...base, status: 'ready_to_pack', held: null, balances: [packing('b1', { qty: 1 })] }),
      ).toMatchObject({ ok: false, code: 'PICKING_PACKING_CUSTODY_INCOMPLETE' });
      expect(judgeUnpickCustody({ ...base, status: 'ready_to_pack', held: null, balances: [] })).toMatchObject({
        ok: false,
        code: 'PICKING_PACKING_CUSTODY_INCOMPLETE',
      });
    });
  });
});
