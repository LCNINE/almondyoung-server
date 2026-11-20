import { CsvRow, parseCsv, PickBox, renderPickList, sortForPicking, toCsv } from './outputs';

function box(shipmentId: string, route: PickBox['route'], locations: string[]): PickBox {
  return {
    shipmentId,
    orderNos: [`acme-${shipmentId}`],
    trackingNo: `TRK-${shipmentId}`,
    route,
    recipientName: '김*몬',
    lines: [{ skuName: 'acme 상품', qty: 1 }],
    sources: locations.map((locationCode) => ({ locationCode, skuName: 'acme 상품', qty: 1 })),
  };
}

describe('sortForPicking', () => {
  it('sorts by first location then force boxes last', () => {
    const sorted = sortForPicking([
      box('f1', 'force', []),
      box('b', 'location', ['B-02', 'A-01']),
      box('a', 'location', ['A-05']),
      box('c', 'location', ['C-01']),
    ]);
    expect(sorted.map((b) => b.shipmentId)).toEqual(['a', 'b', 'c', 'f1']);
  });
});

describe('renderPickList', () => {
  it('escapes html in names', () => {
    const b = box('s1', 'location', ['A-01']);
    b.lines = [{ skuName: '<b>&"', qty: 2 }];
    b.recipientName = '<i>';
    const html = renderPickList('r1', [b]);
    expect(html).toContain('&lt;b&gt;&amp;&quot; × 2');
    expect(html).toContain('&lt;i&gt;');
    expect(html).not.toContain('<b>&"');
  });

  it('marks force boxes as already picked', () => {
    expect(renderPickList('r1', [box('f', 'force', [])])).toContain('이미 피킹됨');
  });
});

describe('csv', () => {
  const rows: CsvRow[] = [
    { shipmentId: 's1', orderNo: 'acme-1 / acme-2', trackingNo: 'T1', route: 'location', batchId: 'b' },
    { shipmentId: 's2', orderNo: 'a,"b"', trackingNo: 'T2', route: 'force', batchId: 'b' },
  ];

  it('round-trips csv', () => {
    const text = toCsv(rows);
    expect(text.startsWith('﻿')).toBe(true);
    expect(text).toContain('\r\n');
    expect(parseCsv(text)).toEqual(rows);
  });

  it('parses an Excel-saved csv', () => {
    const text =
      '﻿shipmentId,orderNo,trackingNo,route,batchId\r\n' +
      's1,"1,2",T1,location,b\r\n' +
      '\r\n\r\n' +
      's3,acme-3,T3,force,b\r\n';
    expect(parseCsv(text)).toEqual([
      { shipmentId: 's1', orderNo: '1,2', trackingNo: 'T1', route: 'location', batchId: 'b' },
      { shipmentId: 's3', orderNo: 'acme-3', trackingNo: 'T3', route: 'force', batchId: 'b' },
    ]);
  });

  it('finds columns by header name, in any order', () => {
    const text = 'batchId,route,trackingNo,orderNo,shipmentId\nb,location,T1,o1,s1\n';
    expect(parseCsv(text)).toEqual([
      { shipmentId: 's1', orderNo: 'o1', trackingNo: 'T1', route: 'location', batchId: 'b' },
    ]);
  });

  it('refuses a csv without the header columns', () => {
    expect(() => parseCsv('orderNo,trackingNo,route,batchId\r\no1,T1,location,b\r\n')).toThrow('shipmentId');
  });
});
