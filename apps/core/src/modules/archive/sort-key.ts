/**
 * 형제 순서를 «분수 인덱스(fractional index)» 문자열로 다룬다.
 *
 * 왜 정수 순번이 아닌가: 정수를 쓰면 한 번 옮길 때마다 형제 전원의 순번을 다시 매겨야 해서
 * 드래그 한 번이 형제 수만큼의 UPDATE 가 되고, 두 사람이 동시에 옮기면 순서가 서로를 덮는다.
 * 분수 인덱스는 «두 이웃 사이의 값»을 새로 만들 수 있어 이동이 항상 UPDATE 한 줄이다.
 * Figma·Linear·Notion 이 같은 문제에 쓰는 방식이다.
 *
 * 구현은 David Greenspan 의 «Implementing Fractional Indexing» 이 정리한 형태를 그대로 따른다.
 * 키는 [정수부][소수부] 이고 정수부의 첫 글자가 정수부 길이를 인코딩한다 —
 * 그래서 자리올림 없이도 «바이트» 사전순 비교가 곧 수치 순서다.
 *
 * 🔴 «바이트» 순서여야 한다는 조건이 핵심이다. 이 DB 의 기본 콜레이션(en_US.utf8)에서는
 * `'Zz' < 'a0'` 가 거짓이라 대문자 구간(= 맨 앞으로 옮긴 페이지)이 뒤로 밀린다.
 * 그래서 `sort_key` 컬럼에 `COLLATE "C"` 를 박아 뒀다 — archive.schema.ts 의 sortKeyColumn 참고.
 * 이 조건이 깨지면 화면과 DB 의 순서가 조용히 갈라진다.
 *
 * 불변식 두 가지가 안전성을 지탱한다.
 *  - 소수부는 절대 가장 작은 자리(`0`)로 끝나지 않는다. 끝나면 그 아래로 값을 못 만들어
 *    키가 무한히 길어진다.
 *  - 두 키 사이를 요청하면 반드시 «둘 사이에» 있는 키를 돌려준다. 같거나 뒤집힌 입력은
 *    호출부의 버그이므로 던진다.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length; // 62
const SMALLEST = DIGITS[0];
const LARGEST = DIGITS[BASE - 1];
/** 정수부가 더 내려갈 수 없는 바닥. 이 키 자체는 쓰지 않는다. */
const INTEGER_FLOOR = `A${SMALLEST.repeat(26)}`;

/** 형제가 하나도 없을 때 쓰는 첫 키. */
export const FIRST_SORT_KEY = `a${SMALLEST}`;

export class SortKeyError extends Error {}

/**
 * `before` 와 `after` 사이의 키를 만든다.
 * - 맨 앞에 넣으려면 `before` 를 null, 맨 뒤면 `after` 를 null 로 준다.
 * - 둘 다 null 이면 첫 키.
 */
export function generateKeyBetween(before: string | null, after: string | null): string {
  if (before !== null) validateKey(before);
  if (after !== null) validateKey(after);
  if (before !== null && after !== null && before >= after) {
    throw new SortKeyError(`정렬 키 순서가 뒤집혔습니다: ${before} >= ${after}`);
  }

  if (before === null) {
    if (after === null) return FIRST_SORT_KEY;

    const afterInt = integerPart(after);
    const afterFraction = after.slice(afterInt.length);

    // 정수부가 바닥이면 더 못 내려가니 소수부를 파고든다.
    if (afterInt === INTEGER_FLOOR) return afterInt + midpoint('', afterFraction);
    // after 에 소수부가 있으면 정수부만 떼어낸 값이 이미 after 보다 작다.
    if (afterInt < after) return afterInt;

    const decremented = decrementInteger(afterInt);
    if (decremented === null) throw new SortKeyError('정렬 키를 더 내릴 수 없습니다');
    return decremented;
  }

  const beforeInt = integerPart(before);
  const beforeFraction = before.slice(beforeInt.length);

  if (after === null) {
    const incremented = incrementInteger(beforeInt);
    return incremented === null ? beforeInt + midpoint(beforeFraction, null) : incremented;
  }

  const afterInt = integerPart(after);
  if (beforeInt === afterInt) {
    return beforeInt + midpoint(beforeFraction, after.slice(afterInt.length));
  }

  const incremented = incrementInteger(beforeInt);
  if (incremented === null) throw new SortKeyError('정렬 키를 더 올릴 수 없습니다');
  if (incremented < after) return incremented;

  return beforeInt + midpoint(beforeFraction, null);
}

/** 목록 끝에 붙일 키. 형제가 없으면 첫 키. */
export function generateKeyAfter(last: string | null): string {
  return generateKeyBetween(last, null);
}

/** `count` 개의 키를 before 와 after 사이에 고르게 만든다. 정수 순번에서 옮겨올 때 쓴다. */
export function generateNKeysBetween(before: string | null, after: string | null, count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return [generateKeyBetween(before, after)];

  const half = Math.floor(count / 2);
  const middle = generateKeyBetween(before, after);

  return [
    ...generateNKeysBetween(before, middle, half),
    middle,
    ...generateNKeysBetween(middle, after, count - half - 1),
  ];
}

/**
 * 두 소수부 사이의 소수부. `after` 가 null 이면 `before` 보다 큰 아무 소수부.
 * 결과는 «0 으로 끝나지 않는다»를 지킨다.
 */
function midpoint(before: string, after: string | null): string {
  if (after !== null && before >= after) {
    throw new SortKeyError(`소수부 순서가 뒤집혔습니다: ${before} >= ${after}`);
  }
  if (before.endsWith(SMALLEST) || (after !== null && after.endsWith(SMALLEST))) {
    throw new SortKeyError('소수부는 가장 작은 자리로 끝날 수 없습니다');
  }

  if (after !== null) {
    // 공통 접두사는 그대로 두고 그 뒤에서만 가운데를 찾는다.
    let common = 0;
    while ((before[common] ?? SMALLEST) === after[common]) common += 1;
    if (common > 0) {
      return after.slice(0, common) + midpoint(before.slice(common), after.slice(common));
    }
  }

  const beforeDigit = before === '' ? 0 : DIGITS.indexOf(before[0]);
  const afterDigit = after === null ? BASE : DIGITS.indexOf(after[0]);

  if (afterDigit - beforeDigit > 1) {
    // 사이에 자리가 남아 있으면 한 글자로 끝난다.
    return DIGITS[Math.round(0.5 * (beforeDigit + afterDigit))];
  }

  if (after !== null && after.length > 1) {
    // 바로 옆자리라 사이가 없다 — after 의 첫 자리만 남기면 before 와 after 사이가 된다.
    return after.slice(0, 1);
  }

  // before 쪽으로 한 자리 더 파고든다.
  return DIGITS[beforeDigit] + midpoint(before.slice(1), null);
}

/** 정수부 첫 글자가 길이를 인코딩한다: a..z 는 2..27자, A..Z 는 27..2자. */
function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new SortKeyError(`정렬 키의 첫 글자가 올바르지 않습니다: ${head}`);
}

function integerPart(key: string): string {
  const length = integerLength(key[0]);
  if (length > key.length) throw new SortKeyError(`정렬 키가 잘렸습니다: ${key}`);
  return key.slice(0, length);
}

function validateKey(key: string): void {
  if (key === '') throw new SortKeyError('정렬 키가 비었습니다');
  if (key === INTEGER_FLOOR) throw new SortKeyError(`쓸 수 없는 정렬 키입니다: ${key}`);
  for (const char of key) {
    if (!DIGITS.includes(char)) throw new SortKeyError(`정렬 키에 쓸 수 없는 글자입니다: ${key}`);
  }

  const integer = integerPart(key);
  if (key.slice(integer.length).endsWith(SMALLEST)) {
    throw new SortKeyError(`정렬 키의 소수부가 가장 작은 자리로 끝납니다: ${key}`);
  }
}

function incrementInteger(integer: string): string | null {
  const head = integer[0];
  const digits = integer.slice(1).split('');

  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i -= 1) {
    const next = DIGITS.indexOf(digits[i]) + 1;
    if (next === BASE) {
      digits[i] = SMALLEST;
    } else {
      digits[i] = DIGITS[next];
      carry = false;
    }
  }

  if (carry) {
    if (head === 'Z') return `a${SMALLEST}`;
    if (head === 'z') return null;

    const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
    // 소문자 쪽은 첫 글자가 커질수록 길어지고, 대문자 쪽은 짧아진다.
    if (nextHead > 'a') {
      digits.push(SMALLEST);
    } else {
      digits.pop();
    }
    return nextHead + digits.join('');
  }

  return head + digits.join('');
}

function decrementInteger(integer: string): string | null {
  const head = integer[0];
  const digits = integer.slice(1).split('');

  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i -= 1) {
    const next = DIGITS.indexOf(digits[i]) - 1;
    if (next === -1) {
      digits[i] = LARGEST;
    } else {
      digits[i] = DIGITS[next];
      borrow = false;
    }
  }

  if (borrow) {
    if (head === 'a') return `Z${LARGEST}`;
    if (head === 'A') return null;

    const previousHead = String.fromCharCode(head.charCodeAt(0) - 1);
    if (previousHead < 'Z') {
      digits.push(LARGEST);
    } else {
      digits.pop();
    }
    return previousHead + digits.join('');
  }

  return head + digits.join('');
}
