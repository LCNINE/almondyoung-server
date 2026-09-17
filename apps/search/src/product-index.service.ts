import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { API } from '@opensearch-project/opensearch';
import { ProductSearchQueryDto } from './dto/product-search-query.dto';
import { ProductSearchItemDto, ProductSearchResponseDto } from './dto/product-search-response.dto';
import { OpenSearchService } from './opensearch.service';
import {
  COMPACT_NGRAM_MAX,
  COMPACT_NGRAM_MIN,
  JAMO_FIELDS_MAPPINGS,
  MEMBERS_ONLY_FIELD_MAPPINGS,
  PRODUCTS_INDEX_MAPPINGS,
  PRODUCTS_INDEX_SETTINGS,
  REVIEW_FIELDS_MAPPINGS,
  ReviewStatsUpdateFields,
  SALES_FIELDS_MAPPINGS,
  SearchProductDocument,
  SEO_FIELDS_MAPPINGS,
} from './types/product-document.type';
import { EmbeddingService } from './embedding.service';
import { SpellCorrectionService } from './spell-correction.service';
import { compactText, qwertyToHangul, toJamo } from './utils/text.utils';

type SearchStage = 'strict' | 'fallback';

/** 키워드 ↔ 상품 색인 대조 근거 — 판정 없이 재료만 */
export interface KeywordMatchEvidence {
  /** 문자열 포함 정확 일치 상품 수 */
  exactCount: number;
  /** 정확 일치 상품명 샘플 */
  exactNames: string[];
  /** 자모 유사(오타 후보) 상품명 샘플 — 무관 상품이 섞일 수 있는 참고 정보 */
  similarNames: string[];
}

const EVIDENCE_SAMPLE_SIZE = 3;

function extractHitNames(response: any): string[] {
  const hits: any[] = response?.hits?.hits ?? [];
  return hits
    .map((hit) => hit?._source?.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

// nori 가 미등록 고유명사를 동사 활용형으로 오분석해 토큰을 통째로 날려버리는 경우가 있다.
// 예: "오샤레" → 오(VV 동사어간) + 샤(E 어미) + 레(E 어미) → posfilter 가 E 를 버려 ["오"] 만 남는다.
// 남은 "오" 는 "타사와라"("와라"→"오") 같은 무관 상품과 name^8 로 매칭돼 정답을 랭킹 밖으로 밀어낸다.
// nori 토큰 총 길이가 원문의 이 비율 미만이면 "뭉갬"으로 보고 nori 기반 절을 통째로 뺀다.
// (측정: 오샤레 0.33 / 타사와라 0.75 / 그 외 대표 키워드 1.00 — 임계 0.6 은 양쪽에 여유가 있다.)
const NORI_COLLAPSE_RATIO_THRESHOLD = 0.6;

// 벡터는 키워드가 이만큼도 못 찾았을 때만 보강으로 태운다. 한 화면(20 건) 기준.
export const VECTOR_FILL_KEYWORD_LIMIT = 20;

// 그때도 덧붙이는 건 이만큼까지다. k-NN 은 유사도 하한이 없어 항상 k 개를 채워 오므로
// ("니치반" 키워드 3 건 + 벡터 99 건) 개수로 막지 않으면 무관 상품이 화면을 덮는다.
export const VECTOR_FILL_LIMIT = 10;
// 1~2음절 쿼리는 정상이어도 비율이 튀기 쉬워 감지 대상에서 뺀다.
const NORI_COLLAPSE_MIN_LENGTH = 3;
const NORI_ANALYZE_CACHE_LIMIT = 2000;
// RRF 상수. 1위와 2위의 격차를 완충한다.
const RRF_K = 60;
// 벡터 순위에 곱하는 가중치. 1.0(동등)으로 배포했더니 "펌지"의 1위가 실제 펌지에서
// "펌지 대용 리본"으로 밀렸다 — 벡터가 펌제·펌스틱을 "펌 관련"으로 뭉쳐 끌어올린 탓이다.
// 0.3 이면 평가셋 적중은 그대로(10/17)면서 인기 검색어 1위 변경이 57 → 42 로 줄었다.
const RRF_VECTOR_WEIGHT = 0.3;
const VECTOR_POOL_LIMIT = 100;

// 후보 전체의 벡터·본문을 전송하지 않고, 현재 페이지를 표시할 필드만 조회한다.
const SEARCH_ITEM_SOURCE_FIELDS = [
  'master_id',
  'version_id',
  'name',
  'thumbnail',
  'brand',
  'min_base_price',
  'max_base_price',
  'min_membership_price',
  'max_membership_price',
  'category_ids',
];

// 자모 오타 절을 태울 최소 길이(공백 제외 음절 수).
// 2음절을 막으면 "헨나"→헤나, "깍이"→깎이 같은 유일한 정답까지 0건이 된다. 대신 "태그"→"택1"
// 처럼 후보가 넓어지는 검색어가 같이 열리므로 boost 로 뒤로 민다. 자모 절은 fallback 에만 있어
// 정상 매칭되는 검색어의 상위 순위는 건드리지 않는다.
const JAMO_TYPO_MIN_LENGTH = 2;
const JAMO_SHORT_BOOST = 0.3;
const JAMO_SHORT_MAX_LENGTH = 2;
// 편집거리 2 를 허용할 최소 길이. 짧은 검색어에서 열면 후보가 폭증한다.
const JAMO_FUZZY2_MIN_LENGTH = 5;

@Injectable()
export class ProductIndexService implements OnModuleInit {
  private readonly logger = new Logger(ProductIndexService.name);
  private readonly keywordResultPoolLimit = 5000;
  private readonly reviewScoreWeight: number;
  private readonly salesScoreWeight: number;
  private readonly reviewSortVolumeWeight: number;
  private readonly reviewSortCountSaturation: number;
  private initPromise: Promise<void> | null = null;
  private readonly noriCollapseCache = new Map<string, boolean>();

  constructor(
    private readonly openSearchService: OpenSearchService,
    private readonly configService: ConfigService,
    private readonly embeddingService: EmbeddingService,
    private readonly spellCorrectionService: SpellCorrectionService,
  ) {
    this.reviewScoreWeight = this.parsePositiveNumber(configService.get<string>('REVIEW_SCORE_WEIGHT'), 0.1);
    this.salesScoreWeight = this.parsePositiveNumber(configService.get<string>('SALES_SCORE_WEIGHT'), 0.1);
    this.reviewSortVolumeWeight = this.parsePositiveNumber(
      configService.get<string>('REVIEW_SORT_VOLUME_WEIGHT') ?? configService.get<string>('REVIEW_SORT_COUNT_WEIGHT'),
      1.0,
    );
    this.reviewSortCountSaturation = this.parseStrictPositiveNumber(
      configService.get<string>('REVIEW_SORT_COUNT_SATURATION'),
      1000,
    );
  }

  async onModuleInit(): Promise<void> {
    // 인덱스 준비 실패로 부팅을 막지 않는다 (사유는 OpenSearchService.onModuleInit 참조).
    // ensureProductsIndex 는 실패를 캐시하지 않으므로 첫 검색 요청에서 다시 시도된다.
    try {
      await this.ensureProductsIndex();
    } catch (error) {
      this.logger.warn(
        `상품 인덱스 준비 실패 — 검색 요청에서 재시도한다: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // 사전 구축은 색인을 훑느라 몇 초 걸린다. 검색은 사전 없이도 동작하므로 기다리지 않는다.
    void this.spellCorrectionService.buildDictionary();
  }

  private parsePositiveNumber(raw: string | undefined, fallback: number): number {
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private parseStrictPositiveNumber(raw: string | undefined, fallback: number): number {
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private computeReviewSortScore(bayesianReviewScore: number, reviewCount: number): number {
    const safeBayesian = Number.isFinite(bayesianReviewScore) ? bayesianReviewScore : 0;
    const safeReviewCount = Number.isFinite(reviewCount) && reviewCount > 0 ? reviewCount : 0;
    const normalizedVolume = Math.min(1, Math.log1p(safeReviewCount) / Math.log1p(this.reviewSortCountSaturation));
    const volumeBoost = normalizedVolume * this.reviewSortVolumeWeight;
    return Math.round((safeBayesian + volumeBoost) * 1000) / 1000;
  }

  async upsertProduct(masterId: string, document: SearchProductDocument): Promise<void> {
    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getProductsIndex();
    await this.ensureProductsIndex();

    const doc = { ...document, ...(await this.buildNameVector(document)) };

    // doc_as_upsert: true — creates if missing, otherwise merges; review fields in existing docs are preserved
    await client.update({
      index,
      id: masterId,
      body: {
        doc,
        doc_as_upsert: true,
      },
    });
  }

  /**
   * 상품명 벡터. 실패해도 색인은 진행한다 — 벡터가 없으면 그 상품이 키워드 검색으로만 잡힐 뿐이고,
   * 나중에 백필로 채워진다. 여기서 던지면 상품 갱신 이벤트가 통째로 DLQ 로 간다.
   */
  private async buildNameVector(document: SearchProductDocument): Promise<{ name_vector?: number[] }> {
    if (!this.embeddingService.enabled || document.name_vector) {
      return {};
    }

    try {
      const [vector] = await this.embeddingService.embedProductNames([
        { name: document.name, brand: document.brand },
      ]);
      return vector ? { name_vector: vector } : {};
    } catch (error) {
      this.logger.warn(`상품명 임베딩 실패 — 벡터 없이 색인한다: ${error instanceof Error ? error.message : error}`);
      return {};
    }
  }

  async updateProductReviewStats(masterId: string, stats: ReviewStatsUpdateFields): Promise<void> {
    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getProductsIndex();
    await this.ensureProductsIndex();
    const doc = {
      ...stats,
      review_sort_score:
        stats.review_sort_score ?? this.computeReviewSortScore(stats.bayesian_review_score, stats.review_count),
    };

    try {
      await client.update({
        index,
        id: masterId,
        body: { doc },
      });
    } catch (error) {
      if (error.meta?.statusCode === 404) {
        this.logger.warn(
          `updateProductReviewStats: product ${masterId} not found in index — skipping (event will not be retried)`,
        );
        return;
      }
      throw error;
    }
  }

  /**
   * Medusa 가 밀어 넣는 누적 판매 수량을 반영한다. 색인에 없는 상품은 조용히 건너뛴다
   * (판매는 있는데 아직 색인 안 된 상품 — 재색인이 오면 채워진다).
   *
   * @returns 실제로 반영된 건수
   */
  async updateProductSalesCounts(entries: Array<{ masterId: string; salesCount: number }>): Promise<number> {
    if (entries.length === 0) return 0;

    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getProductsIndex();
    await this.ensureProductsIndex();

    const updatedAt = new Date().toISOString();
    const body = entries.flatMap((entry) => [
      { update: { _index: index, _id: entry.masterId } },
      { doc: { sales_count: entry.salesCount, sales_count_updated_at: updatedAt } },
    ]);

    const response = await client.bulk({ body });
    const items: any[] = response.body?.items ?? [];

    let applied = 0;
    for (const item of items) {
      const status = item.update?.status;
      if (status !== undefined && status < 300) applied += 1;
      else if (status !== 404) {
        this.logger.warn(`updateProductSalesCounts failed for one doc: ${JSON.stringify(item.update?.error)}`);
      }
    }
    return applied;
  }

  async deleteProduct(masterId: string): Promise<void> {
    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getProductsIndex();
    await this.ensureProductsIndex();

    try {
      await client.delete({
        index,
        id: masterId,
      });
    } catch (error) {
      if (error.meta?.statusCode === 404) {
        this.logger.debug(`Product ${masterId} not found in index`);
        return;
      }
      throw error;
    }
  }

  async searchProducts(query: ProductSearchQueryDto): Promise<ProductSearchResponseDto> {
    const index = this.openSearchService.getProductsIndex();
    await this.ensureProductsIndex();

    const page = query.page || 1;
    const size = query.size || 20;
    const from = (page - 1) * size;
    const sort = this.buildSort(query);
    const hasKeyword = Boolean(query.q?.trim());

    let resultHits: any[] = [];
    let total = 0;
    let keywordMatchCount = 0;

    if (hasKeyword) {
      const noriCollapsed = await this.isNoriCollapsed(query.q!.trim());
      const strictQuery = this.buildQuery(query, 'strict', noriCollapsed);
      const fallbackQuery = this.buildQuery(query, 'fallback', noriCollapsed);
      // strict 우선순서를 유지하고 현재 페이지까지의 후보만 조회한다.
      // 벡터 보충 대상(20건 미만)은 전체 키워드 후보를 모은 뒤 RRF에 넘긴다.
      const candidateLimit = Math.min(this.keywordResultPoolLimit, Math.max(VECTOR_FILL_KEYWORD_LIMIT, from + size));
      // 건수는 strict/fallback의 합집합으로 구하고 기존 5000건 상한을 유지한다.
      const strictResponse = await this.executeSearch({
        index,
        query: strictQuery,
        sort,
        from: 0,
        size: candidateLimit,
        fetchSource: false,
        trackTotalHits: false,
        // global 집계 안에서 동일한 필터를 포함한 합집합을 센다. 후보 정렬은 strict 그대로다.
        // 검색마다 순위/건수 요청을 동시에 보내 작은 노드의 큐를 늘리지 않게 한 요청에 묶는다.
        aggregations: {
          keyword_pool: {
            global: {},
            aggs: {
              matches: { filter: { bool: { should: [strictQuery, fallbackQuery], minimum_should_match: 1 } } },
            },
          },
        },
      });
      const strictHits = strictResponse.body.hits.hits as any[];
      const keywordTotal = strictResponse.body.aggregations?.keyword_pool?.matches?.doc_count;
      if (typeof keywordTotal !== 'number') {
        throw new Error('Missing keyword match count aggregation');
      }
      keywordMatchCount = Math.min(this.keywordResultPoolLimit, keywordTotal);
      let keywordHits = strictHits;
      // 후보가 덜 찬 경우에만 fallback을 보충한다. 전체 건수는 위 집계에서 이미 계산한다.
      if (strictHits.length < candidateLimit && keywordMatchCount > strictHits.length) {
        const fallbackResponse = await this.executeSearch({
          index,
          query: { bool: { must: [fallbackQuery], must_not: [strictQuery] } },
          sort,
          from: 0,
          size: candidateLimit - strictHits.length,
          fetchSource: false,
          trackTotalHits: false,
        });
        keywordHits = this.mergeHitsWithPriority(strictHits, fallbackResponse.body.hits.hits, candidateLimit);
      }
      const useVector =
        query.sort === 'relevance' &&
        query.correct !== false &&
        keywordMatchCount > 0 &&
        keywordMatchCount < VECTOR_FILL_KEYWORD_LIMIT;
      const vectorHits = useVector ? await this.searchByVector(index, query) : [];
      const mergedHits =
        vectorHits.length > 0
          ? this.fuseWithRrf(keywordHits, vectorHits.slice(0, VECTOR_FILL_LIMIT), this.keywordResultPoolLimit)
          : keywordHits;
      total = vectorHits.length > 0 ? mergedHits.length : keywordMatchCount;
      resultHits = mergedHits.slice(from, from + size);
      if (keywordMatchCount === 0 && query.correct !== false) {
        const corrected = await this.retryWithCorrection(query);
        if (corrected) return corrected;
      }
      resultHits = await this.fetchPageSources(index, resultHits);
    } else {
      const response = await this.executeSearch({
        index,
        query: this.buildQuery(query, 'strict'),
        sort,
        from,
        size,
      });
      const hits = response.body.hits;
      total = this.extractTotal(hits.total);
      resultHits = hits.hits as any[];
      keywordMatchCount = total;
    }

    const items: ProductSearchItemDto[] = resultHits.map((hit: any) => {
      const source = hit._source as SearchProductDocument;
      return {
        productId: source.master_id,
        versionId: source.version_id,
        name: source.name,
        thumbnail: source.thumbnail,
        brand: source.brand,
        minBasePrice: source.min_base_price,
        maxBasePrice: source.max_base_price,
        minMembershipPrice: source.min_membership_price,
        maxMembershipPrice: source.max_membership_price,
        categoryIds: source.category_ids || [],
        score: hit._score ?? null,
      };
    });

    const correctedQuery = hasKeyword && query.correct !== false ? qwertyToHangul(query.q!.trim()) : '';

    return {
      items,
      pagination: {
        page,
        size,
        total,
        totalPages: Math.ceil(total / size),
      },
      ...(correctedQuery ? { correctedQuery } : {}),
      keywordMatchCount,
    };
  }

  /**
   * 키워드 ↔ 상품 색인 대조 **근거** — 자동 "판정"에 쓰지 않는다.
   * 사람이 개발/MD 를 판단할 재료로, (1) 문자열 포함 정확 일치(오타보정·fuzzy 없음 —
   * scripts/ops/search-zero-hit/collect.py 의 index_match 와 같은 절)와 (2) 자모 유사
   * 상품명(검색 엔진의 오타 절과 같은 name_jamo/brand_jamo fuzzy)을 함께 돌려준다.
   * 유사 매칭은 무관 상품이 걸릴 수 있으므로 화면에서 "유사" 라벨로만 보여줄 것.
   */
  async getKeywordMatchEvidence(keywords: string[]): Promise<Map<string, KeywordMatchEvidence>> {
    const result = new Map<string, KeywordMatchEvidence>();
    if (keywords.length === 0) return result;

    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getProductsIndex();
    await this.ensureProductsIndex();

    const escapeWildcard = (value: string) => value.replace(/([*?\\])/g, '\\$1');
    // 키워드당 msearch 2건(정확·유사)이라 배치를 절반으로 줄인다.
    const batchSize = 20;
    for (let start = 0; start < keywords.length; start += batchSize) {
      const chunk = keywords.slice(start, start + batchSize);
      const lines: Record<string, unknown>[] = [];
      for (const keyword of chunk) {
        const compactRaw = compactText(keyword).toLowerCase();
        const compact = escapeWildcard(compactRaw);
        lines.push({ index });
        lines.push({
          size: EVIDENCE_SAMPLE_SIZE,
          track_total_hits: true,
          _source: ['name'],
          query: {
            bool: {
              should: [
                { wildcard: { name_compact: { value: `*${compact}*` } } },
                { wildcard: { 'brand.keyword': { value: `*${escapeWildcard(keyword)}*` } } },
                { match_phrase: { brand: keyword } },
                { match_phrase: { seo_keywords: keyword } },
                { match_phrase: { tags: keyword } },
              ],
              minimum_should_match: 1,
            },
          },
        });
        lines.push({ index });
        // 자모 유사 — 검색 엔진의 buildJamoTypoClauses 와 같은 필드·fuzziness 규칙.
        // 너무 짧은 키워드는 편집거리 1도 헐거워서 아예 안 돌린다 (match_none).
        lines.push({
          size: EVIDENCE_SAMPLE_SIZE,
          _source: ['name'],
          query:
            compactRaw.length >= JAMO_TYPO_MIN_LENGTH
              ? {
                  multi_match: {
                    query: toJamo(keyword),
                    fields: ['name_jamo^6', 'brand_jamo^4'],
                    fuzziness: compactRaw.length >= JAMO_FUZZY2_MIN_LENGTH ? 2 : 1,
                    prefix_length: 0,
                    max_expansions: 25,
                    minimum_should_match: '100%',
                  },
                }
              : { match_none: {} },
        });
      }
      const response = await client.msearch({ body: lines });
      const responses: any[] = (response.body as any)?.responses ?? [];
      chunk.forEach((keyword, offset) => {
        const exact = responses[offset * 2];
        const similar = responses[offset * 2 + 1];
        const totalRaw = exact?.hits?.total;
        const exactNames = extractHitNames(exact);
        result.set(keyword, {
          exactCount: Number((typeof totalRaw === 'number' ? totalRaw : totalRaw?.value) ?? 0),
          exactNames,
          // 정확 일치에 이미 나온 이름은 유사 목록에서 뺀다 — 화면 중복 방지
          similarNames: extractHitNames(similar).filter((name) => !exactNames.includes(name)),
        });
      });
    }
    return result;
  }

  // 거절된 promise 를 «들고 있으면» 안 된다. OpenSearch 가 돌아와도 캐시된 거절이 그대로
  // 돌아와 이 프로세스가 사는 동안 영영 색인을 못 연다. 예전엔 부팅에서 죽고 새로 뜨는 덕에
  // 가려져 있던 함정이다 — 부팅이 살아남게 된 지금은 여기서 비워야 재연결이 성립한다.
  private ensureProductsIndex(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initIndex().catch((error) => {
        this.initPromise = null;
        throw error;
      });
    }
    return this.initPromise;
  }

  private async initIndex(): Promise<void> {
    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getProductsIndex();
    const existsResponse = await client.indices.exists({ index });

    if (!existsResponse.body) {
      try {
        await client.indices.create({
          index,
          body: {
            settings: PRODUCTS_INDEX_SETTINGS,
            mappings: PRODUCTS_INDEX_MAPPINGS,
          },
        });
        this.logger.log(`Created products index: ${index}`);
      } catch (error) {
        // initPromise 비우기는 ensureProductsIndex 의 catch 가 «모든» 실패 경로에 대해 한다.
        // 여기서만 비우면 위 indices.exists() 가 던지는 경우(=접속 불가)가 빠진다.
        if (error.meta?.body?.error?.type !== 'resource_already_exists_exception') {
          throw error;
        }
      }
    }

    // Ensure review field mappings exist (additive PUT — safe to call on every startup)
    try {
      await client.indices.putMapping({
        index,
        body: REVIEW_FIELDS_MAPPINGS,
      });
    } catch (error) {
      this.logger.warn(`putMapping for review fields failed (non-fatal): ${error.message}`);
    }

    // 판매량 필드도 additive PUT — 재색인 없이 기존 인덱스에 붙는다.
    try {
      await client.indices.putMapping({
        index,
        body: SALES_FIELDS_MAPPINGS,
      });
    } catch (error) {
      this.logger.warn(`putMapping for sales fields failed (non-fatal): ${error.message}`);
    }

    // Ensure members-only visibility field mapping exists (additive PUT — 기존 인덱스에도 적용)
    try {
      await client.indices.putMapping({
        index,
        body: MEMBERS_ONLY_FIELD_MAPPINGS,
      });
    } catch (error) {
      this.logger.warn(`putMapping for members-only field failed (non-fatal): ${error.message}`);
    }

    // 재색인 전까지 기존 문서는 값이 비어 자모 절만 안 걸린다.
    try {
      await client.indices.putMapping({
        index,
        body: JAMO_FIELDS_MAPPINGS,
      });
    } catch (error) {
      this.logger.warn(`putMapping for jamo fields failed (non-fatal): ${error.message}`);
    }

    // 자모와 마찬가지로 기존 문서는 재색인 전까지 값이 비어 있다.
    try {
      await client.indices.putMapping({
        index,
        body: SEO_FIELDS_MAPPINGS,
      });
    } catch (error) {
      this.logger.warn(`putMapping for seo fields failed (non-fatal): ${error.message}`);
    }
  }

  private async executeSearch(params: {
    index: string;
    query: any;
    sort: any[];
    from: number;
    size: number;
    fetchSource?: boolean;
    trackTotalHits?: boolean;
    aggregations?: API.Search_RequestBody['aggs'];
  }): Promise<any> {
    const client = this.openSearchService.getClient();
    return client.search({
      index: params.index,
      // 결과와 집계를 함께 캐시한다. 색인 refresh 시 OpenSearch가 자동 무효화한다.
      request_cache: true,
      body: {
        query: params.query,
        sort: params.sort,
        from: params.from,
        size: params.size,
        track_total_hits: params.trackTotalHits ?? true,
        _source: params.fetchSource === false ? false : SEARCH_ITEM_SOURCE_FIELDS,
        ...(params.aggregations ? { aggs: params.aggregations } : {}),
      },
    });
  }

  private async fetchPageSources(index: string, hits: any[]): Promise<any[]> {
    if (hits.length === 0) return hits;

    const response = await this.openSearchService.getClient().mget({
      index,
      realtime: false,
      body: {
        docs: hits.map((hit) => ({ _id: hit._id, _source: SEARCH_ITEM_SOURCE_FIELDS })),
      },
    });
    const sources = new Map<string, SearchProductDocument>();
    for (const doc of response.body.docs) {
      if ('error' in doc) {
        throw new Error(`Failed to fetch search result ${doc._id}`);
      }
      if (doc.found && doc._source) {
        sources.set(doc._id, doc._source as SearchProductDocument);
      }
    }

    // 조회 사이에 삭제된 상품은 제외한다. 점수와 순서는 후보 검색의 값을 보존한다.
    return hits.flatMap((hit) => {
      const source = sources.get(hit._id);
      return source ? [{ ...hit, _source: source }] : [];
    });
  }

  private extractTotal(totalField: unknown): number {
    if (typeof totalField === 'object' && totalField !== null) {
      const value = (totalField as { value?: unknown }).value;
      return typeof value === 'number' ? value : 0;
    }
    return typeof totalField === 'number' ? totalField : 0;
  }

  /**
   * 0건일 때 교정어로 다시 찾는다. 교정어도 0건이면 null 을 돌려 원래의 빈 결과를 쓴다 —
   * "닮은 말"을 찾았다는 것만으로 화면에 다른 검색어를 띄우면 안 된다.
   */
  private async retryWithCorrection(query: ProductSearchQueryDto): Promise<ProductSearchResponseDto | null> {
    const corrected = this.spellCorrectionService.suggest(query.q!.trim());
    if (!corrected) {
      return null;
    }

    const retried = await this.searchProducts({ ...query, q: corrected, correct: false });
    if (retried.pagination.total === 0) {
      return null;
    }

    this.logger.log(`검색어 교정: "${query.q}" → "${corrected}" (${retried.pagination.total}건)`);
    // 교정어가 찾은 건수는 원본 검색어가 찾은 게 아니다 — 0 으로 남겨야 "바리깡"이 소싱 후보에 남는다.
    return { ...retried, correctedQuery: corrected, keywordMatchCount: 0 };
  }

  /** 상품명 임베딩으로 k-NN 검색. 실패하면 빈 배열 — 검색은 키워드만으로 계속 간다. */
  private async searchByVector(index: string, query: ProductSearchQueryDto): Promise<any[]> {
    if (!this.embeddingService.enabled) {
      return [];
    }

    // 벡터 실패가 키워드 검색 전체의 실패로 전파되지 않게 한다.
    try {
      const vector = await this.embeddingService.embedQuery(query.q!.trim());
      if (!vector) {
        return [];
      }

      const response = await this.openSearchService.getClient().search({
        index,
        body: {
          size: VECTOR_POOL_LIMIT,
          _source: false,
          query: {
            bool: {
              must: [{ knn: { name_vector: { vector, k: VECTOR_POOL_LIMIT } } }],
              filter: this.buildFilterClauses(query),
            },
          },
        },
      });
      return response.body.hits.hits as any[];
    } catch (error) {
      this.logger.warn(`벡터 검색 실패 — 키워드 결과만 쓴다: ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }

  /**
   * Reciprocal Rank Fusion. BM25 는 상한이 없고 코사인은 0~1 이라 점수를 그대로 더할 수 없어,
   * 순위의 역수를 더한다. 양쪽에서 다 걸린 상품이 위로 올라온다.
   */
  private fuseWithRrf(keywordHits: any[], vectorHits: any[], limit: number): any[] {
    const scores = new Map<string, { score: number; hit: any }>();

    const accumulate = (hits: any[], weight: number): void => {
      hits.forEach((hit, index) => {
        const key = this.getHitKey(hit);
        if (!key) {
          return;
        }
        const entry = scores.get(key) ?? { score: 0, hit };
        entry.score += weight / (RRF_K + index + 1);
        scores.set(key, entry);
      });
    };

    accumulate(keywordHits, 1);
    accumulate(vectorHits, RRF_VECTOR_WEIGHT);

    return [...scores.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.hit);
  }

  private mergeHitsWithPriority(primaryHits: any[], secondaryHits: any[], limit: number): any[] {
    const merged: any[] = [];
    const seen = new Set<string>();

    const pushHit = (hit: any): void => {
      const key = this.getHitKey(hit);
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      merged.push(hit);
    };

    for (const hit of primaryHits) {
      pushHit(hit);
      if (merged.length >= limit) {
        return merged;
      }
    }

    for (const hit of secondaryHits) {
      pushHit(hit);
      if (merged.length >= limit) {
        return merged;
      }
    }

    return merged;
  }

  private getHitKey(hit: any): string | null {
    const source = hit?._source as Partial<SearchProductDocument> | undefined;
    if (typeof hit?._id === 'string') {
      return hit._id;
    }
    if (source?.master_id && source?.version_id) {
      return `${source.master_id}:${source.version_id}`;
    }
    if (source?.master_id) {
      return source.master_id;
    }
    return null;
  }

  // nori 가 검색어를 뭉갰는지 판정. 판정 실패(OpenSearch 오류 등)는 false —
  // 뭉갬 방어는 랭킹 개선일 뿐이라 실패 시 기존 동작을 그대로 쓰는 편이 안전하다.
  private async isNoriCollapsed(q: string): Promise<boolean> {
    const compact = compactText(q);
    if (compact.length < NORI_COLLAPSE_MIN_LENGTH) {
      return false;
    }

    const cached = this.noriCollapseCache.get(compact);
    if (cached !== undefined) {
      return cached;
    }

    let collapsed = false;
    try {
      const response = await this.openSearchService.getClient().indices.analyze({
        index: this.openSearchService.getProductsIndex(),
        body: { analyzer: 'nori', text: q },
      });
      const tokens = (response.body?.tokens ?? []) as { token: string }[];
      const analyzedLength = tokens.reduce((sum, item) => sum + item.token.length, 0);
      collapsed = analyzedLength / compact.length < NORI_COLLAPSE_RATIO_THRESHOLD;

      if (collapsed) {
        this.logger.log(
          `nori collapse detected for "${q}": ${analyzedLength}/${compact.length} — skipping nori clauses`,
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`nori collapse check failed for "${q}" (non-fatal): ${reason}`);
      return false;
    }

    if (this.noriCollapseCache.size >= NORI_ANALYZE_CACHE_LIMIT) {
      this.noriCollapseCache.clear();
    }
    this.noriCollapseCache.set(compact, collapsed);

    return collapsed;
  }

  private buildQuery(query: ProductSearchQueryDto, stage: SearchStage, noriCollapsed = false): any {
    const q = query.q?.trim();
    const compactQ = compactText(q ?? '');
    const mustClauses: any[] = [];
    const filterClauses = this.buildFilterClauses(query);

    if (q) {
      if (stage === 'strict') {
        mustClauses.push(this.buildStrictTextQuery(q, compactQ, noriCollapsed));
      } else {
        mustClauses.push(this.buildFallbackTextQuery(q, compactQ, query.correct !== false));
      }
    }

    const boolQuery = {
      bool: {
        must: mustClauses.length > 0 ? mustClauses : undefined,
        filter: filterClauses,
      },
    };

    // Blend review quality into relevance ranking only when keyword is present.
    // sort=review uses a pure sort field instead; other explicit sorts don't benefit from blending.
    if (q && query.sort === 'relevance') {
      return this.wrapWithReviewBoost(boolQuery);
    }

    return boolQuery;
  }

  // final_score = text_relevance_score
  //             + (bayesian_review_score * reviewScoreWeight)
  //             + (ln(1 + sales_count) * salesScoreWeight)
  //
  // 두 가중치 모두 일부러 작다 — 텍스트 점수는 1000 단위라 이 항들은 «텍스트가 거의 같을 때만»
  // 순서를 뒤집는 동점 처리로 동작한다. 실제로 "메가 액상 색소"/"메가 펌핑 색소"처럼 점수가
  // 소수점까지 같은 경우가 흔해서 뒤집을 여지는 충분하다.
  //
  // 판매량에 log 를 씌우는 이유: 누적 판매는 0~수천으로 자릿수가 벌어져 선형으로 더하면
  // 베스트셀러가 텍스트 관련도를 통째로 덮는다. 그러면 잘 팔린 상품이 더 위로 → 더 팔림 →
  // 더 위로 가 되어 신상품이 영영 안 올라온다. ln(1+n) 이면 1000개 팔린 상품이 10개 팔린
  // 상품보다 2.9배가 아니라 ~2.9점 만큼만 앞선다.
  private wrapWithReviewBoost(boolQuery: any): any {
    return {
      function_score: {
        query: boolQuery,
        functions: [
          {
            field_value_factor: {
              field: 'bayesian_review_score',
              factor: this.reviewScoreWeight,
              modifier: 'none',
              missing: 3.5,
            },
          },
          {
            // field_value_factor 는 modifier(factor × 값) 순서다. factor 에 가중치를
            // 넣으면 ln(1 + w×n) 이 되어 log 안으로 들어가버리므로, factor 는 1 로 두고
            // 가중치는 function 의 weight 로 곱한다 → ln(1+n) × w.
            field_value_factor: {
              field: 'sales_count',
              factor: 1,
              modifier: 'ln1p',
              missing: 0,
            },
            weight: this.salesScoreWeight,
          },
        ],
        score_mode: 'sum',
        boost_mode: 'sum',
      },
    };
  }

  private buildFilterClauses(query: ProductSearchQueryDto): any[] {
    const filters: any[] = [{ term: { status: 'active' } }];

    if (query.categoryIds?.length) {
      filters.push({
        terms: { category_ids: query.categoryIds },
      });
    }

    if (query.brands?.length) {
      filters.push({
        terms: { 'brand.keyword': query.brands },
      });
    }

    if (query.minPrice !== undefined) {
      filters.push({
        range: { max_base_price: { gte: query.minPrice } },
      });
    }

    if (query.maxPrice !== undefined) {
      filters.push({
        range: { min_base_price: { lte: query.maxPrice } },
      });
    }

    // 멤버십 아닌 사용자에겐 멤버십 전용 노출 상품을 제외한다.
    // filter 안에서 걸러야 pagination.total/totalPages 가 소스에서 정확해진다(사후 필터의 count 불일치 방지).
    // 플래그 미지정 시 fail-closed(제외)로 동작. must_not term(true) 이라 아직 backfill 안 된
    // 기존 문서(필드 없음)는 제외되지 않음 — 하위호환.
    if (!query.includeMembersOnly) {
      filters.push({
        bool: { must_not: [{ term: { is_visible_to_members_only: true } }] },
      });
    }

    return filters;
  }

  private buildStrictTextQuery(q: string, compactQ: string, noriCollapsed = false): any {
    // nori 를 타지 않는 절만 남긴다 — name.standard(standard) 와 name.ngram(edge_ngram).
    // 이 둘은 미등록 외래어에도 원문 그대로 매칭돼서 뭉갬의 영향을 받지 않는다.
    const noriFreeClauses = [
      {
        match_phrase: {
          'name.standard': {
            query: q,
            boost: 25,
          },
        },
      },
      ...this.buildCompactClauses(compactQ),
      {
        match: {
          'name.ngram': {
            query: q,
            // 기본값 OR 이면 토큰 하나만 걸려도 매칭된다 — "셀프 네일" 1883건 vs "셀프네일" 13건.
            operator: 'and',
            boost: 15,
          },
        },
      },
      {
        match_phrase_prefix: {
          'name.standard': {
            query: q,
            boost: 4,
            max_expansions: 20,
          },
        },
      },
    ];

    if (noriCollapsed) {
      return {
        bool: {
          should: noriFreeClauses,
          minimum_should_match: 1,
        },
      };
    }

    return {
      bool: {
        should: [
          ...noriFreeClauses,
          {
            match_phrase: {
              name: {
                query: q,
                boost: 10,
              },
            },
          },
          {
            multi_match: {
              query: q,
              fields: ['name^8', 'brand^5', 'category_names^3', 'tags^3', 'seo_keywords^2', 'description'],
              operator: 'or',
              minimum_should_match: '100%',
            },
          },
          {
            // 토큰이 여러 필드에 흩어진 경우("퍼마"=name, "색소"=category_names).
            // 위 multi_match 는 best_fields 라 필드 하나가 전체 토큰을 가져야 해서
            // 이런 조합을 통째로 놓친다. cross_fields 는 필드를 합쳐서 판정.
            multi_match: {
              query: q,
              type: 'cross_fields',
              fields: ['name^8', 'brand^5', 'category_names^3', 'tags^3', 'seo_keywords^2'],
              operator: 'and',
              boost: 20,
            },
          },
        ],
        minimum_should_match: 1,
      },
    };
  }

  private buildFallbackTextQuery(q: string, compactQ: string, allowCorrection = true): any {
    const compactLength = compactQ.length;
    const minimumShouldMatch = this.resolveFallbackMinimumShouldMatch(q, compactQ);

    const multiMatch: Record<string, unknown> = {
      query: q,
      fields: ['name^6', 'brand^4', 'category_names^2', 'tags^2', 'seo_keywords^2', 'description'],
      analyzer: 'nori_search_synonym',
      operator: 'or',
      minimum_should_match: minimumShouldMatch,
    };

    if (compactLength >= 3) {
      multiMatch.fuzziness = 1;
      multiMatch.prefix_length = compactLength >= 8 ? 3 : 2;
      multiMatch.max_expansions = 25;
      multiMatch.fuzzy_transpositions = false;
    }

    // fallback 은 뭉갬 여부와 무관하게 nori 절을 유지한다 — strict 가 정답을 앞세우고,
    // fallback 이 재현율(0건 방지)을 받친다. 둘 다 빼면 "엠보니들"처럼 복합어 부분매칭에
    // 의존하는 검색어가 138건 → 0건이 된다(실측).
    return {
      bool: {
        should: [
          { multi_match: multiMatch },
          {
            match: {
              'name.ngram': {
                query: q,
                operator: 'and',
                boost: 10,
              },
            },
          },
          {
            match_phrase_prefix: {
              'name.standard': {
                query: q,
                boost: 2,
                max_expansions: 20,
              },
            },
          },
          ...this.buildCompactClauses(compactQ),
          ...this.buildJamoTypoClauses(q, compactQ),
          ...(allowCorrection ? this.buildQwertyClauses(q) : []),
        ],
        minimum_should_match: 1,
      },
    };
  }

  // "드림롯드" 로 "드림 롯드" 를 찾는다. nori 가 붙임/띄움을 다르게 잘라서 안 맞으므로
  // 양쪽 공백을 지우고 부분 문자열로 본다.
  private buildCompactClauses(compactQ: string): any[] {
    // max_gram 보다 길면 인덱스에 해당 ngram 이 없다.
    if (compactQ.length < COMPACT_NGRAM_MIN || compactQ.length > COMPACT_NGRAM_MAX) {
      return [];
    }

    return [{ match: { 'name_compact.ngram': { query: compactQ, boost: 18 } } }];
  }

  /**
   * "룰러킹" 으로 "롤러킹" 을 찾는다. 위 multi_match 는 완성형 토큰 위에서 돌아
   * prefix_length 를 못 푼다(풀면 정상 검색어 85.8% 가 5000건으로 폭증). 자모 필드에서만 푼다.
   *
   * 실측(오타 900쌍): 0건 68.0% → 1.2%, recall@20 12.9% → 64.5%.
   *
   * ponytail: 토큰 통째 비교라 "파인애플" 오타가 "파인애플스티커" 에 묻히면 못 잡는다.
   * 자모 ngram 서브필드가 업그레이드 경로 — 인덱스가 커지니 잔여율이 문제될 때.
   */
  private buildJamoTypoClauses(q: string, compactQ: string): any[] {
    // 1음절은 자모로 펴도 3자모 이하라 편집거리 1 이 인덱스를 통째로 긁는다.
    if (compactQ.length < JAMO_TYPO_MIN_LENGTH) {
      return [];
    }

    const jamoQuery = toJamo(q);
    const jamoClause = (fuzziness: number, boost: number): any => ({
      multi_match: {
        query: jamoQuery,
        fields: ['name_jamo^6', 'brand_jamo^4'],
        fuzziness,
        prefix_length: 0,
        max_expansions: 25,
        minimum_should_match: '100%',
        boost,
      },
    });

    // strict 절(정확 일치)보다 항상 뒤에 오도록 낮게 잡는다.
    const clauses = [jamoClause(1, compactQ.length <= JAMO_SHORT_MAX_LENGTH ? JAMO_SHORT_BOOST : 1)];

    // 오타 2글자 이상. 후보가 넓어지니 긴 검색어에서만 열고 boost 로 뒤에 둔다.
    if (compactQ.length >= JAMO_FUZZY2_MIN_LENGTH) {
      clauses.push(jamoClause(2, 0.3));
    }

    return clauses;
  }

  // "vjak" → "퍼마". 원문 절을 대체하지 않고 덧붙이기만 한다 — "Perma" 같은
  // 진짜 영문 검색어를 망가뜨리면 안 된다.
  private buildQwertyClauses(q: string): any[] {
    const hangul = qwertyToHangul(q);
    if (!hangul) {
      return [];
    }

    return [
      {
        multi_match: {
          query: hangul,
          fields: ['name^8', 'brand^5', 'category_names^3', 'tags^3', 'seo_keywords^2'],
          operator: 'and',
          boost: 2,
        },
      },
      {
        match: {
          'name_compact.ngram': {
            query: compactText(hangul),
            boost: 2,
          },
        },
      },
    ];
  }

  private resolveFallbackMinimumShouldMatch(q: string, compactQ: string): string {
    const termCount = q
      .trim()
      .split(/\s+/)
      .filter((term) => term.length > 0).length;

    if (termCount >= 5) {
      return '60%';
    }
    if (termCount === 4) {
      return '75%';
    }
    if (termCount === 3) {
      return '2';
    }
    if (termCount === 2) {
      return '2';
    }

    if (compactQ.length >= 8) {
      return '70%';
    }
    if (compactQ.length >= 5) {
      return '80%';
    }
    return '100%';
  }

  private buildSort(query: ProductSearchQueryDto): any[] {
    switch (query.sort) {
      case 'newest':
        return [{ updated_at: { order: 'desc' } }];
      case 'price_asc':
        return [{ min_base_price: { order: 'asc', missing: '_last' } }];
      case 'price_desc':
        return [{ min_base_price: { order: 'desc', missing: '_last' } }];
      case 'review':
        // Explicit review sort: quality confidence + diminishing review-count volume.
        // review_sort_score = bayesian_review_score
        //   + min(1, log1p(review_count) / log1p(REVIEW_SORT_COUNT_SATURATION)) * REVIEW_SORT_VOLUME_WEIGHT.
        return [
          { review_sort_score: { order: 'desc', missing: 0 } },
          { review_count: { order: 'desc', missing: 0 } },
          { updated_at: { order: 'desc' } },
        ];
      case 'relevance':
      default:
        if (query.q?.trim()) {
          // function_score in buildQuery produces a blended _score; sort by that first.
          return [{ _score: { order: 'desc' } }, { updated_at: { order: 'desc' } }];
        }
        return [{ updated_at: { order: 'desc' } }];
    }
  }
}
