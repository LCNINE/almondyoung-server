import { describe, expect, it } from 'vitest';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { isReturnBinCode, readReturnBin, RETURN_BIN_KEY, writeReturnBin } from './returnBin';

describe('내 되돌림 바구니', () => {
  it.each([
    ['RB-001', true],
    [' RB-A.1 ', true],
    ['rb-001', false],
    ['TOTE-1', false],
    ['RB-', false],
  ])('%s 는 바구니 바코드인가 → %s', (code, expected) => {
    expect(isReturnBinCode(code)).toBe(expected);
  });

  it('이 창고의 바구니만 돌려준다 — 창고를 바꾸면 다시 지정해야 한다', () => {
    const prefs = createMemoryPrefs();
    writeReturnBin(prefs, { warehouseId: 'w-1', barcode: 'RB-001' });
    expect(readReturnBin(prefs, 'w-1')).toBe('RB-001');
    expect(readReturnBin(prefs, 'w-2')).toBeNull();
    writeReturnBin(prefs, null);
    expect(prefs.get(RETURN_BIN_KEY)).toBeNull();
  });

  it('깨진 값은 없는 것으로 본다', () => {
    const prefs = createMemoryPrefs({ [RETURN_BIN_KEY]: '{not json' });
    expect(readReturnBin(prefs, 'w-1')).toBeNull();
  });

  it.each([
    ['null', 'null'],
    ['빈 객체', '{}'],
    ['RB- 없는 바코드', JSON.stringify({ warehouseId: 'w-1', barcode: 'TOTE-1' })],
    ['문자열이 아닌 바코드', JSON.stringify({ warehouseId: 'w-1', barcode: 5 })],
  ])('모양이 틀린 저장값(%s)은 없는 것으로 본다', (_name, raw) => {
    const prefs = createMemoryPrefs({ [RETURN_BIN_KEY]: raw });
    expect(readReturnBin(prefs, 'w-1')).toBeNull();
  });
});
