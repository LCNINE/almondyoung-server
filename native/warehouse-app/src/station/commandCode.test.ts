import { describe, expect, it } from 'vitest';
import { isCommandCode } from '../core/hardware/scan/commandPrefix';
import { commandCodeOfDigit, commandCodeOfKey, parseCommand } from './commandCode';
import { STATION_KEYS } from './keys';

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

describe('명령 바코드', () => {
  it.each([...STATION_KEYS])('%s 키 명령은 왕복한다', (key) => {
    expect(parseCommand(commandCodeOfKey(key))).toEqual({ kind: 'key', key });
  });

  it('Esc 는 %90%00, F7 은 %90%07, F12 는 %90%12', () => {
    expect(commandCodeOfKey('Escape')).toBe('%90%00');
    expect(commandCodeOfKey('F7')).toBe('%90%07');
    expect(commandCodeOfKey('F12')).toBe('%90%12');
  });

  it.each(DIGITS)('숫자 %i 명령은 왕복한다', (digit) => {
    expect(parseCommand(commandCodeOfDigit(digit))).toEqual({ kind: 'digit', digit });
  });

  it('모든 명령 코드는 숫자와 기호만, 3자 이상, 서로 다르다 — 한글 IME 가 켜져도 그대로 읽힌다', () => {
    const codes = [...STATION_KEYS.map(commandCodeOfKey), ...DIGITS.map(commandCodeOfDigit)];
    for (const code of codes) {
      expect(code).toMatch(/^[0-9%]+$/);
      expect(code.length).toBeGreaterThanOrEqual(3); // 스캔 버퍼 minLength
      expect(isCommandCode(code)).toBe(true);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it.each(['%90%13', '%90%7', '%90%007', '%92%1', '%91%10', '%', '%90%07 '])('%s 는 모르는 명령', (code) => {
    expect(parseCommand(code)).toEqual({ kind: 'unknown', code });
  });

  it.each(['8801234567890', '421033881907', '4210-3388-1907', 'B-05-03', 'C-07-1'])(
    '%s 는 명령이 아니다(상품·송장·위치)',
    (code) => {
      expect(isCommandCode(code)).toBe(false);
    }
  );

  it.each([10, -1, 1.5])('숫자 명령은 0~9 정수만 만든다 (%s 거절)', (digit) => {
    expect(() => commandCodeOfDigit(digit)).toThrow(RangeError);
  });
});
