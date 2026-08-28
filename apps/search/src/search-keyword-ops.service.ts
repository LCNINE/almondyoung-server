import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  AdminKeywordDetailResponseDto,
  AdminZeroHitKeywordsResponseDto,
  KEYWORD_ISSUE_STATUSES,
  KeywordAssigneeLoadDto,
  KeywordIssueDto,
  KeywordIssueFilter,
  KeywordIssueStatus,
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

/** 담당자별 부하 — 많이 맡은 순, 동수면 이름순으로 고정해 페이지가 흔들리지 않게 한다. */
function buildAssigneeLoad(
  rows: { keywordNorm: string }[],
  issues: Map<string, SearchKeywordIssue>,
): KeywordAssigneeLoadDto[] {
  const byId = new Map<string, KeywordAssigneeLoadDto>();
  for (const row of rows) {
    const issue = issues.get(row.keywordNorm);
    if (!issue?.assigneeId) continue;
    const existing = byId.get(issue.assigneeId);
    if (existing) {
      existing.count += 1;
    } else {
      byId.set(issue.assigneeId, { assigneeId: issue.assigneeId, assigneeName: issue.assigneeName, count: 1 });
    }
  }
  return [...byId.values()].sort(
    (a, b) => b.count - a.count || (a.assigneeName ?? '').localeCompare(b.assigneeName ?? ''),
  );
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
    statusFilter?: KeywordIssueFilter,
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

    // 상태별 집계와 필터가 전체 집합을 대상으로 하려면 이슈를 페이지가 아니라 전량으로 읽어야 한다.
    // 운영자가 손댄 키워드만 행이 있어 실제 반환량은 훨씬 작다.
    const issues = await this.keywordIssueRepository.findByNorms(enriched.map((row) => row.keywordNorm));
    const statusOf = (keywordNorm: string): KeywordIssueStatus => issues.get(keywordNorm)?.status ?? 'new';

    const unresolved = enriched.filter((row) => !row.resolvedByIndex);
    const isOpen = (keywordNorm: string) => {
      const status = statusOf(keywordNorm);
      return status !== 'resolved' && status !== 'ignored';
    };
    const byStatus = Object.fromEntries(KEYWORD_ISSUE_STATUSES.map((status) => [status, 0])) as Record<
      KeywordIssueStatus,
      number
    >;
    for (const row of unresolved) byStatus[statusOf(row.keywordNorm)] += 1;

    const summary = {
      zeroKeywordCount: unresolved.length,
      neglectedOver7Days: unresolved.filter((row) => row.neglectDays >= NEGLECT_ALERT_DAYS).length,
      openNeglectedOver7Days: unresolved.filter(
        (row) => row.neglectDays >= NEGLECT_ALERT_DAYS && isOpen(row.keywordNorm),
      ).length,
      maxNeglectDays: unresolved.reduce((max, row) => Math.max(max, row.neglectDays), 0),
      neglectBuckets: {
        under7: unresolved.filter((row) => row.neglectDays < 7).length,
        from7to13: unresolved.filter((row) => row.neglectDays >= 7 && row.neglectDays < 14).length,
        from14to29: unresolved.filter((row) => row.neglectDays >= 14 && row.neglectDays < 30).length,
        over30: unresolved.filter((row) => row.neglectDays >= 30).length,
      },
      byStatus,
      unassignedCount: unresolved.filter((row) => !issues.get(row.keywordNorm)?.assigneeId).length,
      byAssignee: buildAssigneeLoad(unresolved, issues),
      resolvedByIndexCount: enriched.length - unresolved.length,
    };

    // 필터는 목록에만 적용한다 — 요약은 종합 대시보드 경보 피드의 모수라 기간 전체 기준을 유지한다.
    const filtered = !statusFilter
      ? enriched
      : statusFilter === 'open'
        ? unresolved.filter((row) => isOpen(row.keywordNorm))
        : enriched.filter((row) => statusOf(row.keywordNorm) === statusFilter);

    const pageRows = filtered.slice((page - 1) * limit, (page - 1) * limit + limit);
    const evidence = await this.gatherEvidence(pageRows.map((row) => row.keyword));

    const items: ZeroHitKeywordRowDto[] = pageRows.map((row) => {
      const ev = evidence.get(row.keyword);
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
        matchedProductsCount: ev?.matchedProductsCount ?? 0,
        matchedProductNames: ev?.matchedProductNames ?? [],
        similarProductNames: ev?.similarProductNames ?? [],
        correctedQuery: ev?.correctedQuery ?? null,
        issue: issue ? toIssueDto(issue) : null,
      };
    });

    return { range: { from, to }, page, limit, totalItems: filtered.length, summary, items };
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

    const [detail, activityMap, previousCounts, issues, evidence] = await Promise.all([
      this.repository.getKeywordDetail({ keywordNorm, fromIso, toExclusiveIso }),
      this.repository.getKeywordActivity({ keywordNorms: [keywordNorm] }),
      this.repository.getKeywordCounts({
        fromIso: kstDayStartIso(prev.from),
        toExclusiveIso: kstDayStartIso(addDays(prev.to, 1)),
        keywordNorms: [keywordNorm],
      }),
      this.keywordIssueRepository.findByNorms([keywordNorm]),
      this.gatherEvidence([keyword]),
    ]);

    const activity = activityMap.get(keywordNorm);
    const lastPositiveAt = activity?.lastPositiveAt ?? null;
    const firstZeroAt = activity?.firstZeroAt ?? null;
    const lastZeroAt = activity?.lastZeroAt ?? null;
    const neglecting = Boolean(lastZeroAt && (!lastPositiveAt || lastPositiveAt < lastZeroAt));
    const anchorIso = lastPositiveAt ?? firstZeroAt;
    const ev = evidence.get(keyword);
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
      matchedProductsCount: ev?.matchedProductsCount ?? 0,
      matchedProductNames: ev?.matchedProductNames ?? [],
      similarProductNames: ev?.similarProductNames ?? [],
      correctedQuery: ev?.correctedQuery ?? null,
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
   * 색인 대조 **근거** 수집 — 자동 판정을 내리지 않는다 (판정은 오탐이 잦아 제거,
   * 개발/MD 판단은 사람이 status 로 지정한다). 정확 일치 상품 수·이름, 자모 유사
   * 상품명(오타 후보), 영타 교정어를 재료로 돌려준다. 영타 교정어의 정확 일치
   * 상품명은 유사 목록에 합친다. 색인 조회가 실패해도 목록 조회는 막지 않는다.
   */
  private async gatherEvidence(keywords: string[]): Promise<
    Map<
      string,
      {
        matchedProductsCount: number;
        matchedProductNames: string[];
        similarProductNames: string[];
        correctedQuery: string | null;
      }
    >
  > {
    const result = new Map<
      string,
      {
        matchedProductsCount: number;
        matchedProductNames: string[];
        similarProductNames: string[];
        correctedQuery: string | null;
      }
    >();
    const unique = [...new Set(keywords.filter((keyword) => keyword.length > 0))];
    if (unique.length === 0) return result;

    const correctedBy = new Map<string, string>();
    for (const keyword of unique) {
      const corrected = qwertyToHangul(keyword);
      if (corrected) correctedBy.set(keyword, corrected);
    }

    try {
      const evidence = await this.productIndexService.getKeywordMatchEvidence([
        ...new Set([...unique, ...correctedBy.values()]),
      ]);
      for (const keyword of unique) {
        const own = evidence.get(keyword);
        const corrected = correctedBy.get(keyword) ?? null;
        const correctedEvidence = corrected ? evidence.get(corrected) : undefined;
        const similar = [
          ...new Set([
            ...(own?.similarNames ?? []),
            ...(correctedEvidence?.exactNames ?? []),
            ...(correctedEvidence?.similarNames ?? []),
          ]),
        ].filter((name) => !(own?.exactNames ?? []).includes(name));
        result.set(keyword, {
          matchedProductsCount: own?.exactCount ?? 0,
          matchedProductNames: own?.exactNames ?? [],
          similarProductNames: similar,
          correctedQuery: corrected,
        });
      }
    } catch {
      for (const keyword of unique) {
        result.set(keyword, {
          matchedProductsCount: 0,
          matchedProductNames: [],
          similarProductNames: [],
          correctedQuery: correctedBy.get(keyword) ?? null,
        });
      }
    }
    return result;
  }
}
