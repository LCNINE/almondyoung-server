import { Injectable, Logger } from '@nestjs/common';
import { ProductSearchQueryDto } from './dto/product-search-query.dto';
import { ProductSearchResponseDto } from './dto/product-search-response.dto';
import { SuggestKeywordsQueryDto } from './dto/suggest-keywords-query.dto';
import { SearchSuggestionsResponseDto, TrendingKeywordsResponseDto } from './dto/search-keyword-response.dto';
import { TrendingKeywordsQueryDto } from './dto/trending-keywords-query.dto';
import { ProductIndexService } from './product-index.service';
import { SearchKeywordService } from './search-keyword.service';

const RELATED_KEYWORDS_SIZE = 10;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly productIndexService: ProductIndexService,
    private readonly searchKeywordService: SearchKeywordService,
  ) {}

  async searchProducts(query: ProductSearchQueryDto): Promise<ProductSearchResponseDto> {
    const response = await this.productIndexService.searchProducts(query);
    const hasKeyword = Boolean(query.q?.trim());
    const isFirstPage = (query.page || 1) === 1;

    if (hasKeyword && isFirstPage && query.track !== false) {
      void this.searchKeywordService.recordSearchKeyword(query.q || '', response.pagination.total).catch((error) => {
        this.logger.warn(`Failed to record search keyword: ${error instanceof Error ? error.message : String(error)}`);
      });
    }

    if (!hasKeyword) {
      return response;
    }

    // 교정된 검색어가 있으면 그쪽으로 연관어를 찾는다 — "tpwp" 로는 아무것도 안 걸린다.
    const relatedSource = response.correctedQuery || query.q!.trim();
    const relatedKeywords = await this.searchKeywordService
      .getRelatedKeywords(relatedSource, RELATED_KEYWORDS_SIZE)
      .catch((error) => {
        this.logger.warn(`Failed to load related keywords: ${error instanceof Error ? error.message : String(error)}`);
        return [] as string[];
      });

    return relatedKeywords.length > 0 ? { ...response, relatedKeywords } : response;
  }

  async getTrendingKeywords(query: TrendingKeywordsQueryDto): Promise<TrendingKeywordsResponseDto> {
    return this.searchKeywordService.getTrendingKeywords(query.size || 10);
  }

  async suggestKeywords(query: SuggestKeywordsQueryDto): Promise<SearchSuggestionsResponseDto> {
    return this.searchKeywordService.suggestKeywords(query.q || '', query.size || 10);
  }
}
