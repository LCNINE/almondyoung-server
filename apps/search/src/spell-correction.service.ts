import { Injectable, Logger } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';
import { toJamo } from './utils/text.utils';

// 자모 기준 편집 거리 상한. "나찌반"↔"니치반"이 2(ㅏ↔ㅣ, ㅉ↔ㅊ)라 2까지 본다.
// 3 을 넘기면 "글루"↔"클립" 같은 무관한 쌍이 붙는다.
const MAX_DISTANCE = 2;
// 짧은 검색어는 편집 거리 2 가 곧 절반이라 다른 단어가 된다. 음절 수로 상한을 조인다.
const MAX_DISTANCE_BY_SYLLABLE: Record<number, number> = { 1: 0, 2: 1, 3: 2 };
// 상품명에서 뽑은 후보 중 이 길이 미만은 버린다 — "1개", "대" 같은 조각이 교정 대상이 되면 안 된다.
const MIN_CANDIDATE_LENGTH = 2;
const MAX_CANDIDATE_LENGTH = 12;
// 사전 구축 시 훑을 상품 수 상한. 부팅이 색인 크기에 끌려가지 않게 막는다.
const SCAN_LIMIT = 20000;
const SUGGEST_CACHE_LIMIT = 2000;

interface Candidate {
  word: string;
  jamo: string;
  // 이 단어를 이름에 가진 상품 수. 동점일 때 흔한 쪽을 고른다.
  freq: number;
}

@Injectable()
export class SpellCorrectionService {
  private readonly logger = new Logger(SpellCorrectionService.name);
  // 자모 길이별로 나눠 담는다. 편집 거리 d 이내면 길이 차도 d 이내라 그 구간만 보면 된다.
  private readonly byJamoLength = new Map<number, Candidate[]>();
  private readonly suggestCache = new Map<string, string | null>();
  private ready = false;

  constructor(private readonly openSearchService: OpenSearchService) {}

  get candidateCount(): number {
    return [...this.byJamoLength.values()].reduce((sum, list) => sum + list.length, 0);
  }

  /**
   * 상품명을 훑어 교정 후보 사전을 만든다. 부팅 때 한 번 돌리고, 실패해도 검색은 그대로 간다
   * (교정만 꺼진다).
   */
  async buildDictionary(): Promise<void> {
    const index = this.openSearchService.getProductsIndex();
    const freq = new Map<string, number>();

    try {
      let searchAfter: (string | number)[] | undefined;
      let scanned = 0;

      while (scanned < SCAN_LIMIT) {
        const response = await this.openSearchService.getClient().search({
          index,
          body: {
            size: 1000,
            _source: ['name'],
            query: { term: { status: 'active' } },
            sort: [{ _id: 'asc' }],
            ...(searchAfter ? { search_after: searchAfter } : {}),
          },
        });

        const hits = response.body.hits.hits as any[];
        if (hits.length === 0) {
          break;
        }

        for (const hit of hits) {
          for (const word of this.tokenize(hit._source?.name ?? '')) {
            freq.set(word, (freq.get(word) ?? 0) + 1);
          }
        }
        scanned += hits.length;
        searchAfter = hits[hits.length - 1].sort;
      }
    } catch (error) {
      this.logger.warn(`교정 사전 구축 실패 — 교정 없이 검색만 동작한다: ${this.message(error)}`);
      return;
    }

    this.byJamoLength.clear();
    for (const [word, count] of freq) {
      const jamo = toJamo(word);
      const bucket = this.byJamoLength.get(jamo.length) ?? [];
      bucket.push({ word, jamo, freq: count });
      this.byJamoLength.set(jamo.length, bucket);
    }

    this.ready = true;
    this.logger.log(`교정 사전 구축 완료 — 후보 ${this.candidateCount}개`);
  }

  /**
   * 결과가 0건인 검색어에만 부른다. 자모 편집 거리가 가까운 후보를 돌려주고, 없으면 null.
   * 후보가 진짜 결과를 내는지는 호출부가 재검색으로 확인한다 — 여기서는 "닮은 말"만 고른다.
   */
  suggest(query: string): string | null {
    const trimmed = query.trim();
    if (!this.ready || !trimmed) {
      return null;
    }

    const cached = this.suggestCache.get(trimmed);
    if (cached !== undefined) {
      return cached;
    }

    const result = this.findNearest(trimmed);
    if (this.suggestCache.size >= SUGGEST_CACHE_LIMIT) {
      const oldest = this.suggestCache.keys().next().value;
      if (oldest !== undefined) {
        this.suggestCache.delete(oldest);
      }
    }
    this.suggestCache.set(trimmed, result);
    return result;
  }

  private findNearest(query: string): string | null {
    const syllables = query.replace(/\s+/g, '').length;
    const limit = MAX_DISTANCE_BY_SYLLABLE[syllables] ?? MAX_DISTANCE;
    if (limit === 0) {
      return null;
    }

    const jamo = toJamo(query);
    let best: { word: string; distance: number; freq: number } | null = null;

    for (let length = jamo.length - limit; length <= jamo.length + limit; length++) {
      for (const candidate of this.byJamoLength.get(length) ?? []) {
        if (candidate.word === query) {
          // 상품명에 그대로 있는 말이면 교정할 이유가 없다.
          return null;
        }

        const distance = this.boundedDistance(jamo, candidate.jamo, limit);
        if (distance > limit) {
          continue;
        }
        if (!best || distance < best.distance || (distance === best.distance && candidate.freq > best.freq)) {
          best = { word: candidate.word, distance, freq: candidate.freq };
        }
      }
    }

    return best?.word ?? null;
  }

  /** 편집 거리. limit 을 넘는 순간 포기한다 — 정확한 값이 아니라 "가까운지"만 알면 된다. */
  private boundedDistance(a: string, b: string, limit: number): number {
    if (Math.abs(a.length - b.length) > limit) {
      return limit + 1;
    }

    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

    for (let i = 1; i <= a.length; i++) {
      const current = [i, ...new Array<number>(b.length).fill(0)];
      let rowMin = i;

      for (let j = 1; j <= b.length; j++) {
        current[j] = Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
        rowMin = Math.min(rowMin, current[j]);
      }

      if (rowMin > limit) {
        return limit + 1;
      }
      previous = current;
    }

    return previous[b.length];
  }

  /** 상품명을 교정 후보로 쓸 단어로 자른다. 규격·모델번호는 후보가 될 이유가 없다. */
  private tokenize(name: string): string[] {
    const words = name
      .split(/[\s/,()[\]+&]+/)
      .map((word) => word.trim().toLowerCase())
      .filter(
        (word) =>
          word.length > 0 &&
          word.length <= MAX_CANDIDATE_LENGTH &&
          // 한글이 하나라도 있어야 한다. 영문·숫자 모델번호는 자모 편집 거리로 다룰 대상이 아니다.
          /[가-힣]/.test(word) &&
          !/\d/.test(word),
      );

    const candidates = words.filter((word) => word.length >= MIN_CANDIDATE_LENGTH);

    // 붙여 친 검색어("텟에프터")는 상품명이 "탯 에프터"로 띄어져 있으면 어느 단어와도
    // 가깝지 않다. 인접한 두 단어를 붙인 말도 후보로 넣어야 걸린다.
    for (let i = 0; i + 1 < words.length; i++) {
      const joined = words[i] + words[i + 1];
      if (joined.length >= MIN_CANDIDATE_LENGTH && joined.length <= MAX_CANDIDATE_LENGTH) {
        candidates.push(joined);
      }
    }

    return candidates;
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
