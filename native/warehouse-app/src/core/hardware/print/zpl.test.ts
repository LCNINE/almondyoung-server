import { describe, it, expect } from 'vitest';
import { renderTestLabel } from './zpl';

describe('renderTestLabel', () => {
  it('produces a ^XA…^XZ ZPL doc containing the title and barcode', () => {
    const zpl = renderTestLabel({ title: 'TEST', barcode: '123456' });
    expect(zpl.startsWith('^XA')).toBe(true);
    expect(zpl.trimEnd().endsWith('^XZ')).toBe(true);
    expect(zpl).toContain('TEST');
    expect(zpl).toContain('^BC'); // Code128 barcode command
    expect(zpl).toContain('123456');
  });
});
