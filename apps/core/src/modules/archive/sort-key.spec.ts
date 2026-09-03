import { FIRST_SORT_KEY, SortKeyError, generateKeyAfter, generateKeyBetween, generateNKeysBetween } from './sort-key';

describe('generateKeyBetween — 알려진 값', () => {
  it('빈 목록의 첫 키', () => {
    expect(generateKeyBetween(null, null)).toBe('a0');
    expect(FIRST_SORT_KEY).toBe('a0');
  });

  it('맨 뒤에 붙이면 정수부가 올라간다', () => {
    expect(generateKeyBetween('a0', null)).toBe('a1');
    expect(generateKeyBetween('a1', null)).toBe('a2');
  });

  it('맨 앞에 넣으면 정수부가 내려간다', () => {
    expect(generateKeyBetween(null, 'a1')).toBe('a0');
    expect(generateKeyBetween(null, 'a0')).toBe('Zz');
  });

  it('붙어 있는 두 키 사이는 소수부를 판다', () => {
    expect(generateKeyBetween('a0', 'a1')).toBe('a0V');
    expect(generateKeyBetween('a0', 'a0V')).toBe('a0G');
  });

  it('정수부가 자리올림되면 길이가 늘어난다', () => {
    expect(generateKeyBetween('az', null)).toBe('b00');
    expect(generateKeyBetween('Zz', null)).toBe('a0');
  });
});

describe('generateKeyBetween — 잘못된 입력', () => {
  it('순서가 뒤집힌 입력은 거부한다', () => {
    expect(() => generateKeyBetween('a1', 'a0')).toThrow(SortKeyError);
    expect(() => generateKeyBetween('a1', 'a1')).toThrow(SortKeyError);
  });

  it('소수부가 0 으로 끝나는 키는 거부한다 — 그 아래로 값을 못 만든다', () => {
    expect(() => generateKeyBetween('a00', null)).toThrow(SortKeyError);
  });

  it('알파벳·숫자가 아닌 글자는 거부한다', () => {
    expect(() => generateKeyBetween('a-', null)).toThrow(SortKeyError);
  });
});

/**
 * 이 알고리즘의 값어치는 «어떤 순서로 얼마나 끼워 넣어도 정렬이 유지된다»이므로,
 * 예시 몇 개가 아니라 성질로 확인한다. 실패하면 시드를 찍어 재현할 수 있게 로그를 남긴다.
 */
describe('generateKeyBetween — 성질', () => {
  const isSortedStrictly = (keys: string[]): boolean =>
    keys.every((key, index) => index === 0 || keys[index - 1] < key);

  it('맨 뒤에 1,000번 붙여도 항상 오름차순이다', () => {
    const keys: string[] = [];
    let last: string | null = null;

    for (let i = 0; i < 1000; i += 1) {
      last = generateKeyAfter(last);
      keys.push(last);
    }

    expect(isSortedStrictly(keys)).toBe(true);
  });

  it('맨 앞에 500번 넣어도 항상 오름차순이다', () => {
    const keys: string[] = [];
    let first: string | null = null;

    for (let i = 0; i < 500; i += 1) {
      first = generateKeyBetween(null, first);
      keys.unshift(first);
    }

    expect(isSortedStrictly(keys)).toBe(true);
  });

  it('무작위 위치에 2,000번 끼워 넣어도 정렬이 유지된다', () => {
    // 고정 시드 LCG — 실패를 재현할 수 있어야 한다.
    let seed = 20260903;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    let keys: string[] = [generateKeyBetween(null, null)];

    for (let i = 0; i < 2000; i += 1) {
      const at = Math.floor(random() * (keys.length + 1));
      const before = at === 0 ? null : keys[at - 1];
      const after = at === keys.length ? null : keys[at];

      const key = generateKeyBetween(before, after);
      keys = [...keys.slice(0, at), key, ...keys.slice(at)];
    }

    expect(keys).toHaveLength(2001);
    expect(new Set(keys).size).toBe(2001);
    expect(isSortedStrictly(keys)).toBe(true);
  });

  it('같은 두 이웃 사이를 반복해 파고들어도 키가 폭주하지 않는다', () => {
    let before = 'a0';
    const after = 'a1';

    for (let i = 0; i < 200; i += 1) {
      before = generateKeyBetween(before, after);
      expect(before > 'a0').toBe(true);
      expect(before < after).toBe(true);
    }

    // 200번 파고들어도 키 길이는 로그 규모로만 자란다 — varchar(64) 안에 넉넉히 들어간다.
    expect(before.length).toBeLessThan(64);
  });

  it('Postgres 의 바이트 사전순과 자바스크립트 문자열 비교가 같은 답을 낸다', () => {
    // 키는 [0-9A-Za-z] 뿐이라 ASCII 코드 순서가 곧 정렬 순서다 —
    // 로케일에 따라 결과가 달라지는 문자가 섞이면 안 된다.
    const keys = Array.from({ length: 300 }, (_, index) => index).reduce<string[]>((acc) => {
      acc.push(generateKeyAfter(acc.at(-1) ?? null));
      return acc;
    }, []);

    for (const key of keys) {
      expect(key).toMatch(/^[0-9A-Za-z]+$/);
    }
    expect([...keys].sort()).toEqual(keys);
  });
});

describe('generateNKeysBetween', () => {
  it('요청한 개수만큼, 두 이웃 사이에 오름차순으로 만든다', () => {
    const keys = generateNKeysBetween('a0', 'a1', 20);

    expect(keys).toHaveLength(20);
    expect(new Set(keys).size).toBe(20);
    expect([...keys].sort()).toEqual(keys);
    expect(keys[0] > 'a0').toBe(true);
    expect(keys.at(-1)! < 'a1').toBe(true);
  });

  it('0개를 요청하면 빈 배열', () => {
    expect(generateNKeysBetween(null, null, 0)).toEqual([]);
  });

  it('양쪽이 열린 구간에도 만든다 — 정수 순번에서 옮겨올 때 쓰는 경로', () => {
    const keys = generateNKeysBetween(null, null, 50);

    expect(keys).toHaveLength(50);
    expect([...keys].sort()).toEqual(keys);
  });
});
