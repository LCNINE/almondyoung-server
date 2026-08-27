import { client } from '@/lib/api/client';
import { SEARCH_SERVICE_BASE_URL } from '@/const/api-const';

export interface KeywordStatisticsQuery {
  from: string;
  to: string;
  limit?: number;
}

export interface KeywordVolumeBucket {
  /** KST 달력 날짜 (YYYY-MM-DD) */
  bucket: string;
  count: number;
  zeroCount: number;
}

export interface TopKeyword {
  keyword: string;
  keywordNorm: string;
  count: number;
  /** 이 키워드 검색 중 결과 0건이었던 횟수 */
  zeroCount: number;
  lastSearchedAt: string;
  /** 직전 동일 길이 기간의 검색 횟수 */
  previousCount: number;
}

export interface ZeroResultKeyword {
  keyword: string;
  keywordNorm: string;
  count: number;
  lastSearchedAt: string;
}

export interface KeywordStatistics {
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  totalSearches: number;
  zeroResultSearches: number;
  series: KeywordVolumeBucket[];
  top: TopKeyword[];
  /** 결과 0건 검색어 순위 — 수요는 있는데 상품이 없는 키워드 */
  zeroTop: ZeroResultKeyword[];
  /** 전기간 대비 검색량 급상승 키워드 */
  rising: TopKeyword[];
}

// ─── 키워드 운영 (0건 방치 추적·담당·메모) ───

export const KEYWORD_ISSUE_STATUSES = ['new', 'dev', 'md', 'in_progress', 'resolved', 'ignored'] as const;
export type KeywordIssueStatus = (typeof KEYWORD_ISSUE_STATUSES)[number];
export type KeywordAutoCause = 'engine' | 'sourcing' | 'unclassified';

export interface KeywordIssue {
  keywordNorm: string;
  keyword: string;
  status: KeywordIssueStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  memo: string | null;
  updatedAt: string;
}

export interface ZeroHitKeywordRow {
  keyword: string;
  keywordNorm: string;
  zeroCount: number;
  lastSearchedAt: string;
  lastPositiveAt: string | null;
  firstZeroAt: string | null;
  /** 마지막 결과 있음(없으면 최초 0건)부터 오늘까지의 일수 — "N일 지연" 배지 */
  neglectDays: number;
  /** 0건 이후 결과가 다시 나오기 시작했으면 true (자동 해소) */
  resolvedByIndex: boolean;
  autoCause: KeywordAutoCause;
  matchedProductsCount: number;
  correctedQuery: string | null;
  issue: KeywordIssue | null;
}

export interface ZeroHitSummary {
  zeroKeywordCount: number;
  neglectedOver7Days: number;
  maxNeglectDays: number;
}

export interface ZeroHitKeywordsQuery {
  from: string;
  to: string;
  page?: number;
  limit?: number;
}

export interface ZeroHitKeywordsResult {
  range: { from: string; to: string };
  page: number;
  limit: number;
  totalItems: number;
  summary: ZeroHitSummary;
  items: ZeroHitKeywordRow[];
}

export interface KeywordDetailQuery {
  keyword: string;
  from: string;
  to: string;
}

export interface KeywordDetail {
  keyword: string;
  keywordNorm: string;
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  /** 기간 내 검색 횟수 — 0 이면 "검색 이력 없음" 정상 케이스 */
  count: number;
  zeroCount: number;
  previousCount: number;
  series: KeywordVolumeBucket[];
  lastSearchedAt: string | null;
  lastPositiveAt: string | null;
  firstZeroAt: string | null;
  neglectDays: number | null;
  autoCause: KeywordAutoCause;
  matchedProductsCount: number;
  correctedQuery: string | null;
  issue: KeywordIssue | null;
}

export interface UpsertKeywordIssueInput {
  keywordNorm: string;
  keyword: string;
  status?: KeywordIssueStatus;
  assigneeId?: string | null;
  assigneeName?: string | null;
  memo?: string | null;
}

export const searchAdminApi = {
  getKeywordStatistics: async (query: KeywordStatisticsQuery): Promise<KeywordStatistics> => {
    const params = new URLSearchParams({ from: query.from, to: query.to });
    if (query.limit) params.set('limit', String(query.limit));
    const res = await client.get(
      `${SEARCH_SERVICE_BASE_URL}/search/admin/keywords/statistics?${params.toString()}`
    );
    return res.data;
  },

  getZeroHitKeywords: async (query: ZeroHitKeywordsQuery): Promise<ZeroHitKeywordsResult> => {
    const params = new URLSearchParams({ from: query.from, to: query.to });
    if (query.page) params.set('page', String(query.page));
    if (query.limit) params.set('limit', String(query.limit));
    const res = await client.get(
      `${SEARCH_SERVICE_BASE_URL}/search/admin/keywords/zero-hit?${params.toString()}`
    );
    return res.data;
  },

  getKeywordDetail: async (query: KeywordDetailQuery): Promise<KeywordDetail> => {
    const params = new URLSearchParams({ keyword: query.keyword, from: query.from, to: query.to });
    const res = await client.get(
      `${SEARCH_SERVICE_BASE_URL}/search/admin/keywords/detail?${params.toString()}`
    );
    return res.data;
  },

  upsertKeywordIssue: async ({ keywordNorm, ...body }: UpsertKeywordIssueInput): Promise<KeywordIssue> => {
    const res = await client.patch(
      `${SEARCH_SERVICE_BASE_URL}/search/admin/keywords/issues/${encodeURIComponent(keywordNorm)}`,
      body
    );
    return res.data;
  },
};
