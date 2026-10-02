import { describe, expect, it } from 'vitest';
import { STATION_KEYS, TAB_KEYS, stationKeyOf } from './keys';

const press = (key: string, mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}) => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe('stationKeyOf', () => {
  it.each([...STATION_KEYS])('%s 는 셸 키', (key) => {
    expect(stationKeyOf(press(key))).toBe(key);
  });

  it.each(['F13', 'a', '5', '%', 'Enter', 'Tab', 'Esc'])('%s 는 셸 키가 아니다', (key) => {
    expect(stationKeyOf(press(key))).toBeNull();
  });

  it.each(['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const)(
    '%s 가 붙은 조합은 건드리지 않는다(Alt+F4 창 닫기, Shift+F10 등)',
    (mod) => {
      expect(stationKeyOf(press('F4', { [mod]: true }))).toBeNull();
    }
  );

  it('키 순서는 F1…F12 다음 Esc, 탭 키는 F1~F6', () => {
    expect(STATION_KEYS).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Escape']);
    expect(TAB_KEYS).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
  });
});
