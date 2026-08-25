import { randomUUID } from 'crypto';
import { Client } from '@opensearch-project/opensearch';
import { OpenSearchService } from './opensearch.service';
import { OpenSearchKeywordRepository } from './opensearch-keyword.repository';

/**
 * 키워드 통계 집계를 실 OpenSearch 로 검증한다 — 검증 대상이 집계 DSL 자체라 목으로는
 * 아무것도 확인하지 못한다. 전용 스크래치 인덱스를 만들고 끝나면 지운다.
 *
 * 실행: docker compose up -d opensearch 후
 *   SEARCH_ITEST_OPENSEARCH_NODE=http://localhost:9200 \
 *   npx jest --testPathPattern="opensearch-keyword.repository.integration"
 */
const NODE = process.env.SEARCH_ITEST_OPENSEARCH_NODE;
const describeIfOs = NODE ? describe : describe.skip;

describeIfOs('OpenSearchKeywordRepository (실 OpenSearch)', () => {
  jest.setTimeout(60_000);

  const index = `itest_query_events_${randomUUID().slice(0, 8)}`;
  let client: Client;
  let repository: OpenSearchKeywordRepository;

  beforeAll(async () => {
    client = new Client({ node: NODE as string });
    const openSearchService = {
      getClient: () => client,
      getQueryEventsIndex: () => index,
    } as unknown as OpenSearchService;
    repository = new OpenSearchKeywordRepository(openSearchService);

    const doc = (keyword: string, searchedAt: string, resultCount: number) => ({
      keyword,
      keywordNorm: keyword.toLowerCase(),
      keywordCompact: keyword.toLowerCase().replace(/\s+/g, ''),
      searchedAt,
      resultCount,
    });

    // 8월 1~2일(KST) 이벤트. 경계 검증용으로 KST 8/1 자정 직전(=UTC 7/31 14:59) 1건 포함.
    const records = [
      doc('선크림', '2026-07-31T14:59:00.000Z', 5), // KST 7/31 23:59 — 기간 밖
      doc('선크림', '2026-07-31T15:00:00.000Z', 5), // KST 8/1 00:00 — 기간 안
      doc('선크림', '2026-08-01T01:00:00.000Z', 5),
      doc('선크림', '2026-08-02T01:00:00.000Z', 0), // 결과 0건 1회
      doc('헤어토닉', '2026-08-01T02:00:00.000Z', 0),
      doc('헤어토닉', '2026-08-02T02:00:00.000Z', 0),
      // 직전 기간(7월 30일 KST) — getKeywordCounts 검증용
      doc('선크림', '2026-07-30T01:00:00.000Z', 5),
    ];
    for (const record of records) {
      await repository.record(record);
    }
    await client.indices.refresh({ index });
  });

  afterAll(async () => {
    await client.indices.delete({ index }).catch(() => undefined);
    await client.close();
  });

  it('KST 경계·결과 0건·일별 추이가 집계된다', async () => {
    const result = await repository.getKeywordStatistics({
      fromIso: '2026-07-31T15:00:00.000Z', // KST 8/1 00:00
      toExclusiveIso: '2026-08-02T15:00:00.000Z', // KST 8/3 00:00
      size: 10,
    });

    expect(result.totalSearches).toBe(5); // 7/31 23:59 KST 건은 빠진다
    expect(result.zeroResultSearches).toBe(3);

    const sunscreen = result.top.find((row) => row.keywordNorm === '선크림');
    expect(sunscreen).toMatchObject({ keyword: '선크림', count: 3, zeroCount: 1 });

    const zeroKeys = result.zeroTop.map((row) => row.keywordNorm);
    expect(zeroKeys).toContain('헤어토닉');
    const hairTonic = result.zeroTop.find((row) => row.keywordNorm === '헤어토닉');
    expect(hairTonic).toMatchObject({ count: 2 });

    // 일별 버킷은 KST 달력 날짜로 나온다.
    const byBucket = new Map(result.series.map((row) => [row.bucket, row]));
    expect(byBucket.get('2026-08-01')).toMatchObject({ count: 3, zeroCount: 1 });
    expect(byBucket.get('2026-08-02')).toMatchObject({ count: 2, zeroCount: 2 });
  });

  it('getKeywordCounts 는 요청한 keyword_norm 만 기간 내에서 센다', async () => {
    const counts = await repository.getKeywordCounts({
      fromIso: '2026-07-29T15:00:00.000Z', // KST 7/30 00:00
      toExclusiveIso: '2026-07-31T15:00:00.000Z', // KST 8/1 00:00
      keywordNorms: ['선크림', '헤어토닉'],
    });

    expect(counts.get('선크림')).toBe(2); // 7/30 1건 + 7/31 23:59 KST 1건
    expect(counts.has('헤어토닉')).toBe(false);
  });
});
