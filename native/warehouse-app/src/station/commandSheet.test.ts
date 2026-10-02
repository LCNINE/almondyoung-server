import { describe, expect, it } from 'vitest';
import { assertUniqueKeys } from './actions';
import { parseCommand } from './commandCode';
import { COMMAND_SHEET_SECTIONS, SHEET_DIGITS, digitEntry, keyEntry } from './commandSheet';

describe('명령 바코드 시트', () => {
  it('첫 절은 탭 F1~F6 — IME 켠 PC 에서 명령이 읽히는지 바로 확인한다', () => {
    expect(COMMAND_SHEET_SECTIONS[0].title).toBe('탭');
    expect(COMMAND_SHEET_SECTIONS[0].actions.map((a) => a.key)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
  });

  it('절마다 키가 겹치지 않고, 모든 바코드가 그 키로 되읽힌다', () => {
    for (const section of COMMAND_SHEET_SECTIONS) {
      expect(() => assertUniqueKeys(section.actions.map((a) => ({ ...a, id: a.key })))).not.toThrow();
      for (const action of section.actions) {
        const entry = keyEntry(action);
        expect(parseCommand(entry.code)).toEqual({ kind: 'key', key: action.key });
        expect(entry.bits).toMatch(/^[01]+$/);
      }
    }
  });

  it('숫자 1~9, 0 순서로 싣고 각각 숫자 명령으로 되읽힌다', () => {
    expect(SHEET_DIGITS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
    for (const digit of SHEET_DIGITS) expect(parseCommand(digitEntry(digit).code)).toEqual({ kind: 'digit', digit });
  });

  it('Esc 는 시트에 Esc 로 적는다', () => {
    expect(keyEntry({ key: 'Escape', label: '내려놓기' }).caption).toBe('Esc');
  });
});
