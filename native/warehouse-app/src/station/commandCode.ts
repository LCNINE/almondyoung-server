import { STATION_KEYS, type StationKey } from './keys';

/**
 * 명령 바코드(스펙 §5.3). 숫자·기호만 쓴다 — 스캔 버퍼는 한글 IME 조합 입력(isComposing)을 버리므로
 * 영문 명령은 IME 켠 PC 에서 사라지거나 한글로 바뀐다.
 *
 *   %90%00            Esc
 *   %90%01 … %90%12   F1 … F12   — 명령 = 그 키를 누른 것. 같은 키가 화면 상태마다 다른 액션이어도 시트 한 장이 맞는다
 *   %91%0 … %91%9     숫자 0 … 9 — 「수량」 입력 대신
 */
export type Command =
  | { kind: 'key'; key: StationKey }
  | { kind: 'digit'; digit: number }
  | { kind: 'unknown'; code: string };

export function commandCodeOfKey(key: StationKey): string {
  const n = key === 'Escape' ? 0 : Number(key.slice(1));
  return `%90%${String(n).padStart(2, '0')}`;
}

export function commandCodeOfDigit(digit: number): string {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) throw new RangeError(`숫자 명령은 0~9: ${digit}`);
  return `%91%${digit}`;
}

export function parseCommand(code: string): Command {
  const key = /^%90%(\d{2})$/.exec(code);
  if (key) {
    const n = Number(key[1]);
    const found = n === 0 ? 'Escape' : STATION_KEYS.find((k) => k === `F${n}`);
    if (found) return { kind: 'key', key: found };
  }
  const digit = /^%91%(\d)$/.exec(code);
  if (digit) return { kind: 'digit', digit: Number(digit[1]) };
  return { kind: 'unknown', code };
}
