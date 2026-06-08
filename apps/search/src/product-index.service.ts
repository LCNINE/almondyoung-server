import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductSearchQueryDto } from './dto/product-search-query.dto';
import { ProductSearchItemDto, ProductSearchResponseDto } from './dto/product-search-response.dto';
import { OpenSearchService } from './opensearch.service';
import {
  PRODUCTS_INDEX_MAPPINGS,
  PRODUCTS_INDEX_SETTINGS,
  REVIEW_FIELDS_MAPPINGS,
  ReviewStatsUpdateFields,
  SearchProductDocument,
} from './types/product-document.type';
import { compactText } from './utils/text.utils';

type SearchStage = 'strict' | 'fallback';

@Injectable()
export class ProductIndexService implements OnModuleInit {
  private readonly logger = new Logger(ProductIndexService.name);
  private readonly keywordResultPoolLimit = 5000;
  private readonly reviewScoreWeight: number;
  private readonly reviewSortVolumeWeight: number;
  private readonly reviewSortCountSaturation: number;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly openSearchService: OpenSearchService,
    private readonly configService: ConfigService,
  ) {
    this.reviewScoreWeight = this.parsePositiveNumber(configService.get<string>('REVIEW_SCORE_WEIGHT'), 0.1);
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
    await this.ensureProductsIndex();
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
    const normalizedVolume = Math.min(
      1,
      Math.log1p(safeReviewCount) / Math.log1p(this.reviewSortCountSaturation),
    );
    const volumeBoost = normalizedVolume * this.reviewSortVolumeWeight;
    return Math.round((safeBayesian + volumeBoost) * 1000) / 1000;
  }

  async upsertProduct(masterId: string, document: SearchProductDocument): Promise<void> {
    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getProductsIndex();
    await this.ensureProductsIndex();

    // doc_as_upsert: true — creates if missing, otherwise merges; review fields in existing docs are preserved
    await client.update({
      index,
      id: masterId,
      body: {
        doc: document,
        doc_as_upsert: true,
      },
    });
  }

  async updateProductReviewStats(masterId: string, stats: ReviewStatsUpdateFields): Promise<void> {
    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getProductsIndex();
    await this.ensureProductsIndex();
    const doc = {
      ...stats,
      review_sort_score:
        stats.review_sort_score ??
        this.computeReviewSortScore(stats.bayesian_review_score, stats.review_count),
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

    if (hasKeyword) {
      const [strictResponse, fallbackResponse] = await Promise.all([
        this.executeSearch({
          index,
          query: this.buildQuery(query, 'strict'),
          sort,
          from: 0,
          size: this.keywordResultPoolLimit,
        }),
        this.executeSearch({
          index,
          query: this.buildQuery(query, 'fallback'),
          sort,
          from: 0,
          size: this.keywordResultPoolLimit,
        }),
      ]);

      const strictHits = strictResponse.body.hits.hits as any[];
      const fallbackHits = fallbackResponse.body.hits.hits as any[];
      const mergedHits = this.mergeHitsWithPriority(strictHits, fallbackHits, this.keywordResultPoolLimit);

      total = mergedHits.length;
      resultHits = mergedHits.slice(from, from + size);
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

    return {
      items,
      pagination: {
        page,
        size,
        total,
        totalPages: Math.ceil(total / size),
      },
    };
  }

  private ensureProductsIndex(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initIndex();
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
        if (error.meta?.body?.error?.type !== 'resource_already_exists_exception') {
          this.initPromise = null;
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
  }

  private async executeSearch(params: {
    index: string;
    query: any;
    sort: any[];
    from: number;
    size: number;
  }): Promise<any> {
    const client = this.openSearchService.getClient();
    return client.search({
      index: params.index,
      body: {
        query: params.query,
        sort: params.sort,
        from: params.from,
        size: params.size,
        track_total_hits: true,
      },
    });
  }

  private extractTotal(totalField: unknown): number {
    if (typeof totalField === 'object' && totalField !== null) {
      const value = (totalField as { value?: unknown }).value;
      return typeof value === 'number' ? value : 0;
    }
    return typeof totalField === 'number' ? totalField : 0;
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

  private buildQuery(query: ProductSearchQueryDto, stage: SearchStage): any {
    const q = query.q?.trim();
    const compactQ = compactText(q ?? '');
    const mustClauses: any[] = [];
    const filterClauses = this.buildFilterClauses(query);

    if (q) {
      if (stage === 'strict') {
        mustClauses.push(this.buildStrictTextQuery(q, compactQ));
      } else {
        mustClauses.push(this.buildFallbackTextQuery(q, compactQ));
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

  // final_score = text_relevance_score + (bayesian_review_score * reviewScoreWeight)
  // Weight is intentionally small so review can only overcome near-equal text matches (~0.5 score diff at default 0.1).
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

    return filters;
  }

  private buildStrictTextQuery(q: string, _compactQ: string): any {
    return {
      bool: {
        should: [
          {
            match_phrase: {
              'name.standard': {
                query: q,
                boost: 25,
              },
            },
          },
          {
            match: {
              'name.ngram': {
                query: q,
                boost: 15,
              },
            },
          },
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
              fields: ['name^8', 'brand^5', 'category_names^3', 'tags^3', 'description'],
              operator: 'or',
              minimum_should_match: '100%',
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
        ],
        minimum_should_match: 1,
      },
    };
  }

  private buildFallbackTextQuery(q: string, compactQ: string): any {
    const compactLength = compactQ.length;
    const minimumShouldMatch = this.resolveFallbackMinimumShouldMatch(q, compactQ);

    const multiMatch: Record<string, unknown> = {
      query: q,
      fields: ['name^6', 'brand^4', 'category_names^2', 'tags^2', 'description'],
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

    return {
      bool: {
        should: [
          { multi_match: multiMatch },
          {
            match: {
              'name.ngram': {
                query: q,
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
        ],
        minimum_should_match: 1,
      },
    };
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
