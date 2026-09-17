import { matchHints, PROMPT_HINTS } from './prompt-hints';

describe('matchHints', () => {
  it('빈 입력에는 아무것도 추천하지 않는다', () => {
    expect(matchHints('')).toEqual([]);
    expect(matchHints('   ')).toEqual([]);
  });

  it('입력 조각을 품은 추천어만 고른다', () => {
    const hits = matchHints('일괄', 10);
    expect(hits.length).toBeGreaterThan(1);
    expect(hits.every((hint) => hint.includes('일괄'))).toBe(true);
  });

  it('이미 추천어를 그대로 친 경우에는 띄우지 않는다', () => {
    const only = PROMPT_HINTS.find(
      (hint) =>
        PROMPT_HINTS.filter((other) => other.includes(hint)).length === 1
    );
    expect(only).toBeDefined();
    expect(matchHints(only as string)).toEqual([]);
  });

  it('limit 을 넘지 않는다', () => {
    expect(matchHints('상품', 3).length).toBeLessThanOrEqual(3);
  });
});
