import { keptRowsCsv, parseShelfMoveArgs, ShelfMoveRow } from './move-stock-to-shelf';

describe('parseShelfMoveArgs', () => {
  it('기본은 dry-run · 신선도 기준 없음 · 고쳐 읽은 규칙 꺼짐', () => {
    const o = parseShelfMoveArgs([]);
    expect(o.apply).toBe(false);
    expect(o.positionsSince).toBeNull();
    expect([...o.includeRules]).toEqual([]);
  });

  it('--apply 는 --positions-since 없이 거절한다 — 낡은 위치 행으로 옮기지 않게', () => {
    expect(() => parseShelfMoveArgs(['--apply'])).toThrow(/--positions-since/);
  });

  it('신선도 기준과 규칙 스위치를 읽는다', () => {
    const o = parseShelfMoveArgs([
      '--apply',
      '--positions-since=2026-11-20T09:00:00+09:00',
      '--include-rule=zero-pad,custom-bin',
    ]);
    expect(o.apply).toBe(true);
    expect(o.positionsSince?.toISOString()).toBe('2026-11-20T00:00:00.000Z');
    expect([...o.includeRules].sort()).toEqual(['custom-bin', 'zero-pad']);
  });

  it('창고를 지정할 수 있다 — 지정하지 않으면 null(판매 창고가 하나일 때만 CLI 가 그 창고를 쓴다)', () => {
    expect(parseShelfMoveArgs([]).warehouseId).toBeNull();
    expect(parseShelfMoveArgs(['--warehouse-id=wh-1']).warehouseId).toBe('wh-1');
  });

  it('모르는 규칙·읽을 수 없는 시각은 거절한다', () => {
    expect(() => parseShelfMoveArgs(['--include-rule=bogus'])).toThrow(/bogus/);
    expect(() => parseShelfMoveArgs(['--positions-since=어제'])).toThrow(/positions-since/);
  });
});

describe('keptRowsCsv — 옮기지 않은 SKU 목록(컷오버 뒤 실사 입력)', () => {
  const row = (over: Partial<ShelfMoveRow>): ShelfMoveRow => ({
    warehouseId: 'wh-1',
    skuId: 'sku-1',
    skuCode: 'SKU-1',
    positionText: 'A-01-01',
    qty: 10,
    outcome: 'moved',
    movedQty: 10,
    toCode: 'A-01-01',
    ...over,
  });

  it('남긴 행과 실패만 쓰고, 다 옮긴 행은 쓰지 않는다', () => {
    const csv = keptRowsCsv([
      row({}),
      row({ skuCode: 'SKU-2', outcome: 'keep:unreadable', movedQty: 0, toCode: null, positionText: '외부창고' }),
      row({ skuCode: 'SKU-3', outcome: 'failed', movedQty: 0, error: 'boom' }),
    ]);
    expect(csv.trim().split('\n')).toEqual([
      'warehouse_id,sku_code,reason,qty,position_text',
      'wh-1,SKU-2,unreadable,10,외부창고',
      'wh-1,SKU-3,failed,10,A-01-01',
    ]);
  });

  it('일부만 옮긴 행은 남은 수량을 protected 로 쓴다', () => {
    const csv = keptRowsCsv([row({ movedQty: 7 })]);
    expect(csv.trim().split('\n')[1]).toBe('wh-1,SKU-1,protected,3,A-01-01');
  });

  it('쉼표·따옴표가 든 위치 텍스트는 CSV 로 감싼다', () => {
    const csv = keptRowsCsv([
      row({ outcome: 'keep:unreadable', movedQty: 0, toCode: null, positionText: 'A-01-01,"B"' }),
    ]);
    expect(csv.trim().split('\n')[1]).toBe('wh-1,SKU-1,unreadable,10,"A-01-01,""B"""');
  });
});
