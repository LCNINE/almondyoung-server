import { describe, expect, it } from 'vitest';
import { isReturnBinCode } from './returnBin';

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
});
