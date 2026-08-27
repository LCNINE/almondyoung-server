import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  AdminKeywordDetailResponseDto,
  AdminZeroHitKeywordsResponseDto,
  KeywordAutoCause,
  KeywordIssueDto,
  UpsertKeywordIssueDto,
  ZeroHitKeywordRowDto,
} from './dto/admin-keyword-ops.dto';
import { KeywordIssueRepository } from './keyword-issue.repository';
import { ProductIndexService } from './product-index.service';
import { SEARCH_KEYWORD_REPOSITORY, SearchKeywordRepository } from './search-keyword.repository';
import {
  addDays,
  kstDayStartIso,
  normalizeDisplayKeyword,
  normalizeKeyword,
  previousRange,
} from './search-keyword.service';
import type { SearchKeywordIssue } from './db/schema';
import { qwertyToHangul } from './utils/text.utils';

/** 기간 내 0건 검색어 집계 상한 — collect.py 와 같은 값. 넘치면 count 상위만 남는다. */
const ZERO_HIT_AGG_LIMIT = 5000;
/** 경보 요약의 "N일 이상 방치" 임계 */
const NEGLECT_ALERT_DAYS = 7;

/** ISO instant → KST 달력 날짜 */
function kstDateOf(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function todayKst(): string {
  return kstDateOf(new Date().toISOString());
}

/** 달력 날짜 차이 (to - from, 일). 음수면 0. */
function daysBetween(fromDate: string, toDate: string): number {
  return Math.max(0, Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000));
}

function toIssueDto(row: SearchKeywordIssue): KeywordIssueDto {
  return {
    keywordNorm: row.keywordNorm,
    keyword: row.keyword,
    status: row.status,
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    memo: row.memo,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 검색 키워드 운영 조회 — 0건 방치 추적·원인 자동 분류·담당/메모.
 * 읽기 전용 OpenSearch 조회 + search DB 의 운영 상태 테이블만 다룬다.
 * 검색 수집(fire-and-forget) 경로는 건드리지 않는다.
 */
@Injectable()
export class SearchKeywordOpsService {
  constructor(
    @Inject(SEARCH_KEYWORD_REPOSITORY)
    private readonly repository: SearchKeywordRepository,
    private readonly keywordIssueRepository: KeywordIssueRepository,
    private readonly productIndexService: ProductIndexService,
  ) {}

  async getZeroHitKeywords(
    from: string,
    to: string,
    page: number,
    limit: number,
  ): Promise<AdminZeroHitKeywordsResponseDto> {
    const fromIso = kstDayStartIso(from);
    const toExclusiveIso = kstDayStartIso(addDays(to, 1));

    const rows = await this.repository.getZeroHitKeywords({ fromIso, toExclusiveIso, size: ZERO_HIT_AGG_LIMIT });
    const activity = await this.repository.getKeywordActivity({
      keywordNorms: rows.map((row) => row.keywordNorm),
    });

    const today = todayKst();
    const enriched = rows.map((row) => {
      const act = activity.get(row.keywordNorm);
      const lastPositiveAt = act?.lastPositiveAt ?? null;
      const firstZeroAt = act?.firstZeroAt ?? null;
      const lastZeroAt = act?.lastZeroAt ?? null;
      // 0건 이후 결과가 다시 나오기 시작했으면 자동 해소로 본다.
      const resolvedByIndex = Boolean(lastPositiveAt && lastZeroAt && lastPositiveAt > lastZeroAt);
      const anchorIso = lastPositiveAt ?? firstZeroAt ?? row.lastSearchedAt;
      const neglectDays = resolvedByIndex || !anchorIso ? 0 : daysBetween(kstDateOf(anchorIso), today);
      return { ...row, lastPositiveAt, firstZeroAt, resolvedByIndex, neglectDays };
    });

    // 기본 정렬: 방치 중 우선, 최장 방치 순 → 0건 횟수 → keyword_norm (페이지 안정화)
    enriched.sort((a, b) => {
      if (a.resolvedByIndex !== b.resolvedByIndex) return a.resolvedByIndex ? 1 : -1;
      if (b.neglectDays !== a.neglectDays) return b.neglectDays - a.neglectDays;
      if (b.zeroCount !== a.zeroCount) return b.zeroCount - a.zeroCount;
      return a.keywordNorm.localeCompare(b.keywordNorm);
    });

    const unresolved = enriched.filter((row) => !row.resolvedByIndex);
    const summary = {
      zeroKeywordCount: unresolved.length,
      neglectedOver7Days: unresolved.filter((row) => row.neglectDays >= NEGLECT_ALERT_DAYS).length,
      maxNeglectDays: unresolved.reduce((max, row) => Math.max(max, row.neglectDays), 0),
    };

    const pageRows = enriched.slice((page - 1) * limit, (page - 1) * limit + limit);
    const [issues, classification] = await Promise.all([
      this.keywordIssueRepository.findByNorms(pageRows.map((row) => row.keywordNorm)),
      this.classifyKeywords(pageRows.map((row) => row.keyword)),
    ]);

    const items: ZeroHitKeywordRowDto[] = pageRows.map((row) => {
      const cls = classification.get(row.keyword);
      const issue = issues.get(row.keywordNorm);
      return {
        keyword: row.keyword,
        keywordNorm: row.keywordNorm,
        zeroCount: row.zeroCount,
        lastSearchedAt: row.lastSearchedAt,
        lastPositiveAt: row.lastPositiveAt,
        firstZeroAt: row.firstZeroAt,
        neglectDays: row.neglectDays,
        resolvedByIndex: row.resolvedByIndex,
        autoCause: cls?.autoCause ?? 'unclassified',
        matchedProductsCount: cls?.matchedProductsCount ?? 0,
        correctedQuery: cls?.correctedQuery ?? null,
        issue: issue ? toIssueDto(issue) : null,
      };
    });

    return { range: { from, to }, page, limit, totalItems: enriched.length, summary, items };
  }

  async getKeywordDetail(rawKeyword: string, from: string, to: string): Promise<AdminKeywordDetailResponseDto> {
    const keyword = normalizeDisplayKeyword(rawKeyword);
    const keywordNorm = normalizeKeyword(rawKeyword);
    if (!keywordNorm) {
      throw new BadRequestException('keyword 가 비어 있습니다');
    }
    const prev = previousRange(from, to);
    const fromIso = kstDayStartIso(from);
    const toExclusiveIso = kstDayStartIso(addDays(to, 1));

    const [detail, activityMap, previousCounts, issues, classification] = await Promise.all([
      this.repository.getKeywordDetail({ keywordNorm, fromIso, toExclusiveIso }),
      this.repository.getKeywordActivity({ keywordNorms: [keywordNorm] }),
      this.repository.getKeywordCounts({
        fromIso: kstDayStartIso(prev.from),
        toExclusiveIso: kstDayStartIso(addDays(prev.to, 1)),
        keywordNorms: [keywordNorm],
      }),
      this.keywordIssueRepository.findByNorms([keywordNorm]),
      this.classifyKeywords([keyword]),
    ]);

    const activity = activityMap.get(keywordNorm);
    const lastPositiveAt = activity?.lastPositiveAt ?? null;
    const firstZeroAt = activity?.firstZeroAt ?? null;
    const lastZeroAt = activity?.lastZeroAt ?? null;
    const neglecting = Boolean(lastZeroAt && (!lastPositiveAt || lastPositiveAt < lastZeroAt));
    const anchorIso = lastPositiveAt ?? firstZeroAt;
    const cls = classification.get(keyword);
    const issue = issues.get(keywordNorm);

    return {
      keyword: detail.latestKeyword ?? keyword,
      keywordNorm,
      range: { from, to },
      previousRange: prev,
      count: detail.count,
      zeroCount: detail.zeroCount,
      previousCount: previousCounts.get(keywordNorm) ?? 0,
      series: detail.series,
      lastSearchedAt: detail.lastSearchedAt,
      lastPositiveAt,
      firstZeroAt,
      neglectDays: neglecting && anchorIso ? daysBetween(kstDateOf(anchorIso), todayKst()) : null,
      autoCause: cls?.autoCause ?? 'unclassified',
      matchedProductsCount: cls?.matchedProductsCount ?? 0,
      correctedQuery: cls?.correctedQuery ?? null,
      issue: issue ? toIssueDto(issue) : null,
    };
  }

  async upsertIssue(rawKeywordNorm: string, dto: UpsertKeywordIssueDto): Promise<KeywordIssueDto> {
    const keywordNorm = normalizeKeyword(rawKeywordNorm);
    if (!keywordNorm) {
      throw new BadRequestException('keywordNorm 이 비어 있습니다');
    }
    const row = await this.keywordIssueRepository.upsert({
      keywordNorm,
      keyword: normalizeDisplayKeyword(dto.keyword),
      status: dto.status,
      assigneeId: dto.assigneeId,
      assigneeName: dto.assigneeName,
      memo: dto.memo,
    });
    return toIssueDto(row);
  }

  /**
   * 원인 자동 분류 — 색인 문자열 대조(+영타 교정 재대조).
   * 색인에 상품이 있으면 검색엔진/노출 문제(engine, 개발), 없으면 소싱 부재(sourcing, MD).
   * 색인 조회가 실패하면 unclassified 로 남긴다 — 목록 조회 자체를 막지 않는다.
   */
  private async classifyKeywords(
    keywords: string[],
  ): Promise<Map<string, { autoCause: KeywordAutoCause; matchedProductsCount: number; correctedQuery: string | null }>> {
    const result = new Map<string, { autoCause: KeywordAutoCause; matchedProductsCount: number; correctedQuery: string | null }>();
    const unique = [...new Set(keywords.filter((keyword) => keyword.length > 0))];
    if (unique.length === 0) return result;

    const correctedBy = new Map<string, string>();
    for (const keyword of unique) {
      const corrected = qwertyToHangul(keyword);
      if (corrected) correctedBy.set(keyword, corrected);
    }

    try {
      const matches = await this.productIndexService.countKeywordMatches([
        ...new Set([...unique, ...correctedBy.values()]),
      ]);
      for (const keyword of unique) {
        const matched = matches.get(keyword) ?? 0;
        const corrected = correctedBy.get(keyword) ?? null;
        const correctedMatched = corrected ? (matches.get(corrected) ?? 0) : 0;
        result.set(keyword, {
          autoCause: matched > 0 || correctedMatched > 0 ? 'engine' : 'sourcing',
          matchedProductsCount: matched,
          correctedQuery: corrected,
        });
      }
    } catch {
      for (const keyword of unique) {
        result.set(keyword, {
          autoCause: 'unclassified',
          matchedProductsCount: 0,
          correctedQuery: correctedBy.get(keyword) ?? null,
        });
      }
    }
    return result;
  }
}
