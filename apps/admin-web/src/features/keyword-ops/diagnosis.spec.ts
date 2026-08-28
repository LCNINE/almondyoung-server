import { buildKeywordDiagnosis, buildZeroSearchForecastSentence, zeroSearchRate } from './diagnosis';
import type { ZeroHitSummary } from '@/lib/api/domains/search';

const summary = (overrides: Partial<ZeroHitSummary> = {}): ZeroHitSummary => ({
  zeroKeywordCount: 128,
  neglectedOver7Days: 9,
  openNeglectedOver7Days: 9,
  maxNeglectDays: 23,
  neglectBuckets: { under7: 119, from7to13: 5, from14to29: 3, over30: 1 },
  byStatus: { new: 100, dev: 10, md: 15, in_progress: 2, resolved: 1, ignored: 0 },
  unassignedCount: 74,
  byAssignee: [],
  resolvedByIndexCount: 4,
  ...overrides,
});

const textOf = (sentences: { id: string; text: string }[], id: string) =>
  sentences.find((sentence) => sentence.id === id)?.text ?? '';

describe('zeroSearchRate', () => {
  it('전체 검색이 0이면 비율이 정의되지 않는다', () => {
    expect(zeroSearchRate(0, 0)).toBeNull();
  });

  it('값이 아직 안 왔으면 null', () => {
    expect(zeroSearchRate(undefined, 10)).toBeNull();
    expect(zeroSearchRate(100, undefined)).toBeNull();
  });

  it('빈손 검색 횟수 / 전체 검색 횟수', () => {
    expect(zeroSearchRate(1000, 100)).toBeCloseTo(0.1);
  });
});

describe('buildKeywordDiagnosis', () => {
  // 이 화면 오독의 원인이 "0건"이라는 한 단어가 횟수와 종수를 동시에 가리킨 것이었다.
  // 그래서 모든 문장은 값마다 단위를 달고 나가야 한다.
  it('검색 횟수는 "회", 검색어 가짓수는 "종"으로 읽어준다', () => {
    const sentences = buildKeywordDiagnosis({
      totalSearches: 12340,
      zeroResultSearches: 1234,
      summary: summary(),
      rangeDays: 7,
    });

    const volume = textOf(sentences, 'volume');
    expect(volume).toContain('12,340회');
    expect(volume).toContain('1,234회');
    expect(volume).toContain('10.0%');

    const keywords = textOf(sentences, 'keywords');
    expect(keywords).toContain('128종');
    expect(keywords).toContain('9종');
    expect(keywords).toContain('23일');
  });

  it('횟수를 종수 단위로, 종수를 횟수 단위로 부르지 않는다', () => {
    const sentences = buildKeywordDiagnosis({
      totalSearches: 12340,
      zeroResultSearches: 1234,
      summary: summary(),
      rangeDays: 7,
    });

    expect(textOf(sentences, 'volume')).not.toContain('종');
    expect(textOf(sentences, 'keywords')).not.toContain('회');
  });

  it('방치가 없으면 경보 톤을 쓰지 않는다', () => {
    const sentences = buildKeywordDiagnosis({
      totalSearches: 100,
      zeroResultSearches: 3,
      summary: summary({ neglectedOver7Days: 0 }),
      rangeDays: 7,
    });

    expect(sentences.find((sentence) => sentence.id === 'keywords')?.tone).toBe('neutral');
    expect(textOf(sentences, 'keywords')).toContain('7일 넘게 방치된 것은 없습니다');
  });

  it('방치가 있으면 경보 톤으로 표시한다', () => {
    const sentences = buildKeywordDiagnosis({
      totalSearches: 100,
      zeroResultSearches: 3,
      summary: summary(),
      rangeDays: 7,
    });

    expect(sentences.find((sentence) => sentence.id === 'keywords')?.tone).toBe('alert');
  });

  it('검색이 한 번도 없었으면 비율 문장을 만들지 않는다', () => {
    const sentences = buildKeywordDiagnosis({
      totalSearches: 0,
      zeroResultSearches: 0,
      summary: undefined,
      rangeDays: 7,
    });

    expect(textOf(sentences, 'volume')).toBe('최근 7일 동안 검색이 한 번도 없었습니다.');
    expect(textOf(sentences, 'volume')).not.toContain('%');
  });

  it('데이터가 아직 없으면 문장을 만들지 않는다 — 0 을 단정하지 않는다', () => {
    expect(
      buildKeywordDiagnosis({
        totalSearches: undefined,
        zeroResultSearches: undefined,
        summary: undefined,
        rangeDays: 7,
      }),
    ).toEqual([]);
  });

  it('담당자 미지정과 자동 해소는 값이 있을 때만 문장이 붙는다', () => {
    const withNone = buildKeywordDiagnosis({
      totalSearches: 10,
      zeroResultSearches: 1,
      summary: summary({ unassignedCount: 0, resolvedByIndexCount: 0 }),
      rangeDays: 7,
    });
    expect(withNone.map((sentence) => sentence.id)).toEqual(['volume', 'keywords']);

    const withBoth = buildKeywordDiagnosis({
      totalSearches: 10,
      zeroResultSearches: 1,
      summary: summary(),
      rangeDays: 7,
    });
    expect(withBoth.map((sentence) => sentence.id)).toEqual([
      'volume',
      'keywords',
      'unassigned',
      'auto-resolved',
    ]);
  });

  it('결과를 못 준 검색어가 없으면 그렇게 말한다', () => {
    const sentences = buildKeywordDiagnosis({
      totalSearches: 100,
      zeroResultSearches: 0,
      summary: summary({ zeroKeywordCount: 0, neglectedOver7Days: 0, unassignedCount: 0, resolvedByIndexCount: 0 }),
      rangeDays: 7,
    });
    expect(textOf(sentences, 'keywords')).toBe('결과를 못 준 검색어가 없습니다.');
  });
});

describe('buildZeroSearchForecastSentence', () => {
  it('예측이 없으면 문장도 없다 — 근거 없는 수를 쓰지 않는다', () => {
    expect(buildZeroSearchForecastSentence(null, 7)).toBeNull();
  });

  it('추정임을 문장에 밝힌다', () => {
    const sentence = buildZeroSearchForecastSentence(123.4, 7);
    expect(sentence).toContain('123회');
    expect(sentence).toContain('7일');
    expect(sentence).toContain('계절성·이벤트 미반영');
  });

  it('음수로 내려간 추세는 0 으로 자른다 — 검색 횟수는 음수가 될 수 없다', () => {
    expect(buildZeroSearchForecastSentence(-40, 7)).toContain('0회');
  });
});
