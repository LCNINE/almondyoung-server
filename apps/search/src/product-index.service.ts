import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ProductSearchQueryDto } from './dto/product-search-query.dto';
import {
  ProductSearchItemDto,
  ProductSearchResponseDto,
} from './dto/product-search-response.dto';
import { OpenSearchService } from './opensearch.service';
import {
  PRODUCTS_INDEX_MAPPINGS,
  SearchProductDocument,
} from './types/product-document.type';
import { compactText } from './utils/text.utils';

@Injectable()
export class ProductIndexService implements OnModuleInit {
  private readonly logger = new Logger(ProductIndexService.name);
  private initPromise: Promise<void> | null = null;

  constructor(private readonly openSearchService: OpenSearchService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureProductsIndex();
  }

  async upsertProduct(
    masterId: string,
    document: SearchProductDocument,
  ): Promise<void> {
    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getProductsIndex();
    await this.ensureProductsIndex();

    await client.index({
      index,
      id: masterId,
      document,
    });
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

  async searchProducts(
    query: ProductSearchQueryDto,
  ): Promise<ProductSearchResponseDto> {
    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getProductsIndex();
    await this.ensureProductsIndex();

    const page = query.page || 1;
    const size = query.size || 20;
    const from = (page - 1) * size;

    const searchQuery = this.buildQuery(query);
    const sort = this.buildSort(query);

    const response: any = await client.search({
      index,
      query: searchQuery,
      sort,
      from,
      size,
      track_total_hits: true,
    });

    const items: ProductSearchItemDto[] = response.hits.hits.map((hit: any) => {
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

    const total =
      typeof response.hits.total === 'object'
        ? response.hits.total.value
        : (response.hits.total ?? 0);

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
    const exists = await client.indices.exists({ index });

    if (!exists) {
      try {
        await client.indices.create({
          index,
          settings: {
            number_of_shards: 1,
            number_of_replicas: 1,
          },
          mappings: PRODUCTS_INDEX_MAPPINGS,
        });
        this.logger.log(`Created products index: ${index}`);
      } catch (error) {
        if (error.meta?.body?.error?.type !== 'resource_already_exists_exception') {
          this.initPromise = null;
          throw error;
        }
      }
    }
  }

  private buildQuery(query: ProductSearchQueryDto): any {
    const q = query.q?.trim();
    const compactQ = compactText(q ?? '');
    const mustClauses: any[] = [];
    const filterClauses: any[] = [{ term: { status: 'active' } }];

    if (q) {
      mustClauses.push({
        bool: {
          should: [
            {
              multi_match: {
                query: q,
                fields: ['name^4', 'description^2', 'brand^2', 'category_names', 'tags'],
                fuzziness: 'AUTO',
                operator: 'or',
              },
            },
            {
              term: {
                name_compact: {
                  value: compactQ,
                  boost: 5,
                },
              },
            },
          ],
          minimum_should_match: 1,
        },
      });
    }

    if (query.categoryIds?.length) {
      filterClauses.push({
        terms: { category_ids: query.categoryIds },
      });
    }

    if (query.brands?.length) {
      filterClauses.push({
        terms: { 'brand.keyword': query.brands },
      });
    }

    if (query.minPrice !== undefined) {
      filterClauses.push({
        range: { max_base_price: { gte: query.minPrice } },
      });
    }

    if (query.maxPrice !== undefined) {
      filterClauses.push({
        range: { min_base_price: { lte: query.maxPrice } },
      });
    }

    return {
      bool: {
        must: mustClauses.length > 0 ? mustClauses : undefined,
        filter: filterClauses,
      },
    };
  }

  private buildSort(query: ProductSearchQueryDto): any[] {
    switch (query.sort) {
      case 'newest':
        return [{ updated_at: { order: 'desc' } }];
      case 'price_asc':
        return [{ min_base_price: { order: 'asc', missing: '_last' } }];
      case 'price_desc':
        return [{ min_base_price: { order: 'desc', missing: '_last' } }];
      case 'relevance':
      default:
        if (query.q?.trim()) {
          return [{ _score: { order: 'desc' } }, { updated_at: { order: 'desc' } }];
        }
        return [{ updated_at: { order: 'desc' } }];
    }
  }

}
