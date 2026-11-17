/**
 * Minimal ZPL test label. Real label templates land in Phase 4; this proves the
 * print path end-to-end. ^XA/^XZ delimit a label; ^FO sets origin; ^A0 a font;
 * ^BC a Code128 barcode; ^FD field data; ^FS field separator.
 */
export function renderTestLabel(p: { title: string; barcode: string }): string {
  return [
    '^XA',
    '^CI28', // UTF-8
    `^FO50,50^A0N,40,40^FD${p.title}^FS`,
    `^FO50,120^BCN,100,Y,N,N^FD${p.barcode}^FS`,
    '^XZ',
  ].join('\n');
}

/**
 * 50×30 mm 라벨(203 dpi) 시험 인쇄. 프린터 내장 글꼴은 한글을 못 그리므로 ASCII 만 쓴다.
 */
export function renderTestLabel50x30(): string {
  return [
    '^XA',
    '^PW400',
    '^LL240',
    '^FO20,20^A0N,30,30^FDLABEL TEST 50x30^FS',
    '^FO20,80^BCN,80,Y,N,N^FD12345678^FS',
    '^XZ',
  ].join('\n');
}
