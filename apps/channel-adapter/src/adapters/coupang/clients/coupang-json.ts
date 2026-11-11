/**
 * 쿠팡 JSON 입출력 — 긴 ID(`shipmentBoxId`·`orderId`·`receiptId`)를 손실 없이 다룬다.
 *
 * 이 ID 들은 JS number 의 안전 정수(2^53) 범위를 넘을 수 있어 `JSON.parse` 를 그대로 쓰면
 * 끝자리가 조용히 깨진다. 읽을 때는 정수 리터럴을 문자열로 감싼 뒤 파싱하고,
 * 보낼 때는 `/^\d+$/` 문자열을 따옴표 없는 정수로 되돌려 쓴다.
 */
export const COUPANG_LONG_ID_KEYS = ['shipmentBoxId', 'shipmentBoxIds', 'orderId', 'receiptId'] as const;

const LONG_ID_KEY_SET: ReadonlySet<string> = new Set(COUPANG_LONG_ID_KEYS);
const NUMBER_LITERAL = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const DIGITS_ONLY = /^\d+$/;

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';
}

/** 문자열 리터럴이 끝나는 위치(닫는 따옴표의 다음 인덱스) */
function endOfString(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') i += 2;
    else if (ch === '"') return i + 1;
    else i += 1;
  }
  return text.length;
}

function nextNonWhitespace(text: string, from: number): string | undefined {
  let i = from;
  while (i < text.length && isWhitespace(text[i])) i += 1;
  return text[i];
}

export function parseCoupangJson(text: string): unknown {
  let out = '';
  let i = 0;
  // 방금 읽은 키가 긴 ID 키인지 — 다음 값 하나에서 소비된다
  let pending = false;
  // 열린 괄호마다: 원소가 긴 ID 인 배열이면 true
  const stack: boolean[] = [];

  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const end = endOfString(text, i);
      const raw = text.slice(i, end);
      out += raw;
      if (nextNonWhitespace(text, end) === ':') {
        pending = LONG_ID_KEY_SET.has(raw.slice(1, -1));
      } else {
        pending = false;
      }
      i = end;
    } else if (ch === '[') {
      stack.push(pending);
      pending = false;
      out += ch;
      i += 1;
    } else if (ch === '{') {
      stack.push(false);
      pending = false;
      out += ch;
      i += 1;
    } else if (ch === ']' || ch === '}') {
      stack.pop();
      out += ch;
      i += 1;
    } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      NUMBER_LITERAL.lastIndex = i;
      const match = NUMBER_LITERAL.exec(text);
      const literal = match ? match[0] : ch;
      const inLongArray = stack.length > 0 && stack[stack.length - 1];
      if ((pending || inLongArray) && DIGITS_ONLY.test(literal)) {
        out += `"${literal}"`;
      } else {
        out += literal;
      }
      pending = false;
      i += literal.length;
    } else {
      if (ch === 't' || ch === 'f' || ch === 'n') pending = false;
      out += ch;
      i += 1;
    }
  }
  return JSON.parse(out);
}

export function stringifyCoupangJson(body: unknown): string {
  const nonce = `__COUPANG_LONG_${Math.random().toString(36).slice(2)}__`;
  const marker = (digits: string) => `${nonce}${digits}`;

  const mark = (value: unknown, key: string | undefined, inLongArray: boolean): unknown => {
    if (typeof value === 'string') {
      const isLong = inLongArray || (key !== undefined && LONG_ID_KEY_SET.has(key));
      return isLong && DIGITS_ONLY.test(value) ? marker(value) : value;
    }
    if (Array.isArray(value)) {
      const longArray = key !== undefined && LONG_ID_KEY_SET.has(key);
      return value.map((item) => mark(item, undefined, longArray));
    }
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mark(v, k, false)]));
    }
    return value;
  };

  const json = JSON.stringify(mark(body, undefined, false));
  return json.replace(new RegExp(`"${nonce}(\\d+)"`, 'g'), '$1');
}
