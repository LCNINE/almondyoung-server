import { Injectable, Logger } from '@nestjs/common';
import { ElasticsearchService } from './elasticsearch.service';
import {
  ProductSearchRequestDto,
  ProductSearchResponseDto,
  ProductSearchItemDto,
  TagGroupAggregationDto,
  TagValueAggregationDto,
} from './dto';
import { PIM_PRODUCTS_INDEX } from './types/index-mappings';

@Injectable()
export class ProductSearchService {
  private readonly logger = new Logger(ProductSearchService.name);

  constructor(private readonly esService: ElasticsearchService) { }

  async search(
    request: ProductSearchRequestDto,
  ): Promise<ProductSearchResponseDto> {
    const client = this.esService.getClient();
    const page = request.page || 1;
    const limit = request.limit || 20;
    const from = (page - 1) * limit;

    const query = this.buildQuery(request);
    const sort = this.buildSort(request);
    const aggs = this.buildAggregations();

    try {
      const response = await client.search({
        index: PIM_PRODUCTS_INDEX,
        query,
        sort,
        from,
        size: limit,
        aggs,
      });

      const items: ProductSearchItemDto[] = response.hits.hits.map((hit: any) => ({
        ...hit._source,
        _score: hit._score,
      }));

      const total = typeof response.hits.total === 'object'
        ? response.hits.total.value
        : (response.hits.total ?? 0);

      const pagination = {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      };

      const aggregations = this.parseAggregations(response.aggregations);

      return {
        items,
        pagination,
        aggregations,
      };
    } catch (error) {
      this.logger.error('Search failed', error.stack);
      throw error;
    }
  }

  private buildQuery(request: ProductSearchRequestDto): any {
    const mustClauses: any[] = [];
    const filterClauses: any[] = [];

    if (request.keyword) {
      mustClauses.push({
        multi_match: {
          query: request.keyword,
          fields: ['name^3', 'description', 'product_code^2'],
          fuzziness: 'AUTO',
          operator: 'or',
        },
      });
    }

    if (request.categoryId) {
      filterClauses.push({
        term: { category_id: request.categoryId },
      });
    }

    if (request.brands && request.brands.length > 0) {
      filterClauses.push({
        terms: { brand: request.brands },
      });
    }

    if (request.status) {
      filterClauses.push({
        term: { status: request.status },
      });
    }

    if (request.minPrice !== undefined || request.maxPrice !== undefined) {
      const rangeQuery: any = {};
      if (request.minPrice !== undefined) {
        rangeQuery.gte = request.minPrice;
      }
      if (request.maxPrice !== undefined) {
        rangeQuery.lte = request.maxPrice;
      }
      filterClauses.push({
        range: { price: rangeQuery },
      });
    }

    if (request.tagFilters && request.tagFilters.length > 0) {
      for (const tagFilter of request.tagFilters) {
        filterClauses.push({
          nested: {
            path: 'tags',
            query: {
              bool: {
                must: [
                  { term: { 'tags.group_id': tagFilter.groupId } },
                  { terms: { 'tags.value_id': tagFilter.valueIds } },
                ],
              },
            },
          },
        });
      }
    }

    if (mustClauses.length === 0 && filterClauses.length === 0) {
      return { match_all: {} };
    }

    return {
      bool: {
        must: mustClauses.length > 0 ? mustClauses : undefined,
        filter: filterClauses.length > 0 ? filterClauses : undefined,
      },
    };
  }

  private buildSort(request: ProductSearchRequestDto): any[] {
    const sortBy = request.sortBy || 'relevance';
    const sortOrder = request.sortOrder || 'desc';

    switch (sortBy) {
      case 'price':
        return [{ price: { order: sortOrder } }];
      case 'createdAt':
        return [{ created_at: { order: sortOrder } }];
      case 'relevance':
      default:
        if (request.keyword) {
          return [{ _score: { order: 'desc' } }];
        }
        return [{ created_at: { order: 'desc' } }];
    }
  }

  private buildAggregations(): any {
    return {
      tags_by_group: {
        nested: {
          path: 'tags',
        },
        aggs: {
          groups: {
            terms: {
              field: 'tags.group_id',
              size: 50,
            },
            aggs: {
              group_name: {
                top_hits: {
                  size: 1,
                  _source: ['tags.group_name'],
                },
              },
              values: {
                terms: {
                  field: 'tags.value_id',
                  size: 100,
                },
                aggs: {
                  value_name: {
                    top_hits: {
                      size: 1,
                      _source: ['tags.value_name'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  private parseAggregations(aggs: any): any {
    if (!aggs || !aggs.tags_by_group) {
      return {};
    }

    const tagGroups: TagGroupAggregationDto[] = [];

    for (const groupBucket of aggs.tags_by_group.groups.buckets) {
      const groupId = groupBucket.key;
      const groupName = groupBucket.group_name.hits.hits[0]?._source?.tags?.group_name || groupId;

      const values: TagValueAggregationDto[] = [];

      for (const valueBucket of groupBucket.values.buckets) {
        const valueId = valueBucket.key;
        const valueName = valueBucket.value_name.hits.hits[0]?._source?.tags?.value_name || valueId;

        values.push({
          value_id: valueId,
          value_name: valueName,
          count: valueBucket.doc_count,
        });
      }

      tagGroups.push({
        group_id: groupId,
        group_name: groupName,
        values,
      });
    }

    return { tags: tagGroups };
  }
}

