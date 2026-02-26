import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';
import {
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
export class OpenSearchKeywordRepository
  implements SearchKeywordRepository, OnModuleInit
{
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

  async getTrendingKeywords(options: {
    size: number;
    windowHours: number;
  }): Promise<TrendingKeyword[]> {
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

  private toKeywordRows(
    buckets: any[],
    size: number,
  ): TrendingKeyword[] {
    const rows = buckets
      .map((bucket) => {
        const hit = bucket?.latest?.hits?.hits?.[0]?._source;
        const key = typeof bucket?.key === 'string' ? bucket.key : '';
        const keyword =
          typeof hit?.keyword === 'string' && hit.keyword.length > 0
            ? hit.keyword
            : key;
        const lastSearchedAt =
          typeof hit?.searched_at === 'string' ? hit.searched_at : '';
        const count =
          typeof bucket?.doc_count === 'number' ? bucket.doc_count : 0;

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
