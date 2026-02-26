import { Injectable, Logger } from '@nestjs/common';
import { ProductSearchQueryDto } from './dto/product-search-query.dto';
import { ProductSearchResponseDto } from './dto/product-search-response.dto';
import { SuggestKeywordsQueryDto } from './dto/suggest-keywords-query.dto';
import {
  SearchSuggestionsResponseDto,
  TrendingKeywordsResponseDto,
} from './dto/search-keyword-response.dto';
import { TrendingKeywordsQueryDto } from './dto/trending-keywords-query.dto';
import { ProductIndexService } from './product-index.service';
import { SearchKeywordService } from './search-keyword.service';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly productIndexService: ProductIndexService,
    private readonly searchKeywordService: SearchKeywordService,
  ) {}

  async searchProducts(
    query: ProductSearchQueryDto,
  ): Promise<ProductSearchResponseDto> {
    const response = await this.productIndexService.searchProducts(query);
    const hasKeyword = Boolean(query.q?.trim());
    const isFirstPage = (query.page || 1) === 1;

    if (hasKeyword && isFirstPage) {
      void this.searchKeywordService
        .recordSearchKeyword(query.q || '', response.pagination.total)
        .catch((error) => {
          this.logger.warn(
            `Failed to record search keyword: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    }

    return response;
  }

  async getTrendingKeywords(
    query: TrendingKeywordsQueryDto,
  ): Promise<TrendingKeywordsResponseDto> {
    return this.searchKeywordService.getTrendingKeywords(query.size || 10);
  }

  async suggestKeywords(
    query: SuggestKeywordsQueryDto,
  ): Promise<SearchSuggestionsResponseDto> {
    return this.searchKeywordService.suggestKeywords(query.q || '', query.size || 10);
  }
}
