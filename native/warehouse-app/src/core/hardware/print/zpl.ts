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
