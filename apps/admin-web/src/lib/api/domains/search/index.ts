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

export const searchAdminApi = {
  getKeywordStatistics: async (query: KeywordStatisticsQuery): Promise<KeywordStatistics> => {
    const params = new URLSearchParams({ from: query.from, to: query.to });
    if (query.limit) params.set('limit', String(query.limit));
    const res = await client.get(
      `${SEARCH_SERVICE_BASE_URL}/search/admin/keywords/statistics?${params.toString()}`
    );
    return res.data;
  },
};
