import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';
import {
  KeywordStatRow,
  KeywordStatisticsAggregation,
  KeywordVolumeBucket,
  SearchKeywordRecord,
  SearchKeywordRepository,
  SuggestedKeyword,
  TrendingKeyword,
} from './search-keyword.repository';
import {
  QUERY_EVENTS_INDEX_MAPPINGS,
  QUERY_EVENTS_INDEX_SETTINGS,
  SearchQueryEventDocument,
} from './types/query-keyword-document.type';

@Injectable()
export class OpenSearchKeywordRepository implements SearchKeywordRepository, OnModuleInit {
  private readonly logger = new Logger(OpenSearchKeywordRepository.name);
  private initPromise: Promise<void> | null = null;

  constructor(private readonly openSearchService: OpenSearchService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureQueryEventsIndex();
  }

  async record(record: SearchKeywordRecord): Promise<void> {
    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getQueryEventsIndex();
    await this.ensureQueryEventsIndex();

    const body: SearchQueryEventDocument = {
      keyword: record.keyword,
      keyword_norm: record.keywordNorm,
      keyword_compact: record.keywordCompact,
      searched_at: record.searchedAt,
      result_count: record.resultCount,
    };

    await client.index({
      index,
      body,
      refresh: false,
    });
  }

  async getTrendingKeywords(options: { size: number; windowHours: number }): Promise<TrendingKeyword[]> {
    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getQueryEventsIndex();
    await this.ensureQueryEventsIndex();

    const response = await client.search({
      index,
      body: {
        size: 0,
        query: {
          range: {
            searched_at: {
              gte: `now-${options.windowHours}h`,
              lte: 'now',
            },
          },
        },
        aggs: {
          keywords: {
            terms: {
              field: 'keyword_norm',
              size: Math.max(options.size * 3, options.size),
              order: { _count: 'desc' as const },
            },
            aggs: {
              latest: {
                top_hits: {
                  size: 1,
                  sort: [{ searched_at: { order: 'desc' as const } }],
                  _source: {
                    includes: ['keyword', 'searched_at'],
                  },
                },
              },
            },
          },
        },
      },
    });

    const buckets = this.extractBuckets(response.body);
    return this.toKeywordRows(buckets, options.size);
  }

  async getSuggestions(options: {
    prefix: string;
    compactPrefix: string;
    size: number;
    lookbackDays: number;
  }): Promise<SuggestedKeyword[]> {
    if (!options.prefix && !options.compactPrefix) {
      return [];
    }

    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getQueryEventsIndex();
    await this.ensureQueryEventsIndex();

    const shouldClauses: any[] = [];

    if (options.prefix) {
      shouldClauses.push({
        prefix: {
          keyword_norm: options.prefix,
        },
      });
    }

    if (options.compactPrefix) {
      shouldClauses.push({
        prefix: {
          keyword_compact: options.compactPrefix,
        },
      });
    }

    const response = await client.search({
      index,
      body: {
        size: 0,
        query: {
          bool: {
            filter: [
              {
                range: {
                  searched_at: {
                    gte: `now-${options.lookbackDays}d`,
                    lte: 'now',
                  },
                },
              },
            ],
            should: shouldClauses,
            minimum_should_match: 1,
          },
        },
        aggs: {
          keywords: {
            terms: {
              field: 'keyword_norm',
              size: Math.max(options.size * 5, options.size),
              order: { _count: 'desc' as const },
            },
            aggs: {
              latest: {
                top_hits: {
                  size: 1,
                  sort: [{ searched_at: { order: 'desc' as const } }],
                  _source: {
                    includes: ['keyword', 'searched_at'],
                  },
                },
              },
            },
          },
        },
      },
    });

    const buckets = this.extractBuckets(response.body);
    return this.toKeywordRows(buckets, options.size);
  }

  async getRelatedKeywords(options: {
    compactKeyword: string;
    excludeNorm: string;
    size: number;
    lookbackDays: number;
  }): Promise<SuggestedKeyword[]> {
    if (!options.compactKeyword) {
      return [];
    }

    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getQueryEventsIndex();
    await this.ensureQueryEventsIndex();

    const response = await client.search({
      index,
      body: {
        size: 0,
        query: {
          bool: {
            filter: [
              {
                range: {
                  searched_at: {
                    gte: `now-${options.lookbackDays}d`,
                    lte: 'now',
                  },
                },
              },
              // keyword_compact 는 공백 없는 소문자라 앞뒤 * 만으로 부분 일치가 된다.
              { wildcard: { keyword_compact: `*${this.escapeWildcard(options.compactKeyword)}*` } },
              { range: { result_count: { gt: 0 } } },
            ],
            must_not: options.excludeNorm ? [{ term: { keyword_norm: options.excludeNorm } }] : [],
          },
        },
        aggs: {
          keywords: {
            terms: {
              field: 'keyword_norm',
              size: Math.max(options.size * 5, options.size),
              order: { _count: 'desc' as const },
            },
            aggs: {
              latest: {
                top_hits: {
                  size: 1,
                  sort: [{ searched_at: { order: 'desc' as const } }],
                  _source: {
                    includes: ['keyword', 'searched_at'],
                  },
                },
              },
            },
          },
        },
      },
    });

    const buckets = this.extractBuckets(response.body);
    return this.toKeywordRows(buckets, options.size);
  }

  private escapeWildcard(value: string): string {
    return value.replace(/([*?\\])/g, '\\$1');
  }

  async getKeywordStatistics(options: {
    fromIso: string;
    toExclusiveIso: string;
    size: number;
  }): Promise<KeywordStatisticsAggregation> {
    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getQueryEventsIndex();
    await this.ensureQueryEventsIndex();

    const rangeFilter = {
      range: {
        searched_at: {
          gte: options.fromIso,
          lt: options.toExclusiveIso,
        },
      },
    };

    const keywordTermsAgg = (size: number) => ({
      terms: {
        field: 'keyword_norm',
        size,
        order: { _count: 'desc' as const },
      },
      aggs: {
        latest: {
          top_hits: {
            size: 1,
            sort: [{ searched_at: { order: 'desc' as const } }],
            _source: { includes: ['keyword', 'searched_at'] },
          },
        },
        zero: {
          filter: { term: { result_count: 0 } },
        },
      },
    });

    const response = await client.search({
      index,
      body: {
        size: 0,
        track_total_hits: true,
        query: rangeFilter,
        aggs: {
          keywords: keywordTermsAgg(Math.max(options.size * 5, options.size)),
          zero_only: {
            filter: { term: { result_count: 0 } },
            aggs: { keywords: keywordTermsAgg(options.size) },
          },
          volume: {
            date_histogram: {
              field: 'searched_at',
              calendar_interval: 'day' as const,
              time_zone: '+09:00',
              format: 'yyyy-MM-dd',
              min_doc_count: 0,
            },
            aggs: {
              zero: { filter: { term: { result_count: 0 } } },
            },
          },
        },
      },
    });

    const body: any = response.body;
    const totalSearches =
      typeof body?.hits?.total === 'number' ? body.hits.total : (body?.hits?.total?.value ?? 0);
    const zeroResultSearches = body?.aggregations?.zero_only?.doc_count ?? 0;

    const series: KeywordVolumeBucket[] = (body?.aggregations?.volume?.buckets ?? []).map((bucket: any) => ({
      bucket: typeof bucket?.key_as_string === 'string' ? bucket.key_as_string : '',
      count: typeof bucket?.doc_count === 'number' ? bucket.doc_count : 0,
      zeroCount: bucket?.zero?.doc_count ?? 0,
    }));

    return {
      totalSearches: Number(totalSearches ?? 0),
      zeroResultSearches: Number(zeroResultSearches ?? 0),
      series,
      top: this.toStatRows(body?.aggregations?.keywords?.buckets),
      zeroTop: this.toStatRows(body?.aggregations?.zero_only?.keywords?.buckets),
    };
  }

  async getKeywordCounts(options: {
    fromIso: string;
    toExclusiveIso: string;
    keywordNorms: string[];
  }): Promise<Map<string, number>> {
    if (options.keywordNorms.length === 0) {
      return new Map();
    }
    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getQueryEventsIndex();
    await this.ensureQueryEventsIndex();

    const response = await client.search({
      index,
      body: {
        size: 0,
        query: {
          bool: {
            filter: [
              {
                range: {
                  searched_at: {
                    gte: options.fromIso,
                    lt: options.toExclusiveIso,
                  },
                },
              },
              { terms: { keyword_norm: options.keywordNorms } },
            ],
          },
        },
        aggs: {
          keywords: {
            terms: {
              field: 'keyword_norm',
              size: options.keywordNorms.length,
            },
          },
        },
      },
    });

    const map = new Map<string, number>();
    for (const bucket of this.extractBuckets(response.body)) {
      if (typeof bucket?.key === 'string' && typeof bucket?.doc_count === 'number') {
        map.set(bucket.key, bucket.doc_count);
      }
    }
    return map;
  }

  private toStatRows(buckets: unknown): KeywordStatRow[] {
    if (!Array.isArray(buckets)) return [];
    return buckets
      .map((bucket: any) => {
        const hit = bucket?.latest?.hits?.hits?.[0]?._source;
        const key = typeof bucket?.key === 'string' ? bucket.key : '';
        const keyword = typeof hit?.keyword === 'string' && hit.keyword.length > 0 ? hit.keyword : key;
        const count = typeof bucket?.doc_count === 'number' ? bucket.doc_count : 0;
        if (!key || count <= 0) return null;
        return {
          keyword,
          keywordNorm: key,
          count,
          zeroCount: bucket?.zero?.doc_count ?? 0,
          lastSearchedAt: typeof hit?.searched_at === 'string' ? hit.searched_at : '',
        };
      })
      .filter((row): row is KeywordStatRow => row !== null);
  }

  private ensureQueryEventsIndex(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initIndex();
    }
    return this.initPromise;
  }

  private async initIndex(): Promise<void> {
    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getQueryEventsIndex();
    const existsResponse = await client.indices.exists({ index });

    if (!existsResponse.body) {
      try {
        await client.indices.create({
          index,
          body: {
            settings: QUERY_EVENTS_INDEX_SETTINGS,
            mappings: QUERY_EVENTS_INDEX_MAPPINGS,
          },
        });
        this.logger.log(`Created query events index: ${index}`);
      } catch (error) {
        if (error.meta?.body?.error?.type !== 'resource_already_exists_exception') {
          this.initPromise = null;
          throw error;
        }
      }
    }
  }

  private extractBuckets(body: any): any[] {
    const buckets = body?.aggregations?.keywords?.buckets;
    return Array.isArray(buckets) ? buckets : [];
  }

  private toKeywordRows(buckets: any[], size: number): TrendingKeyword[] {
    const rows = buckets
      .map((bucket) => {
        const hit = bucket?.latest?.hits?.hits?.[0]?._source;
        const key = typeof bucket?.key === 'string' ? bucket.key : '';
        const keyword = typeof hit?.keyword === 'string' && hit.keyword.length > 0 ? hit.keyword : key;
        const lastSearchedAt = typeof hit?.searched_at === 'string' ? hit.searched_at : '';
        const count = typeof bucket?.doc_count === 'number' ? bucket.doc_count : 0;

        if (!key || !keyword || count <= 0) {
          return null;
        }

        return {
          keyword,
          keywordNorm: key,
          count,
          lastSearchedAt,
        };
      })
      .filter((row): row is TrendingKeyword => row !== null)
      .sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return b.lastSearchedAt.localeCompare(a.lastSearchedAt);
      });

    return rows.slice(0, size);
  }
}
