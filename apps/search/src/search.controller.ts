import { Controller, Get, Query } from '@nestjs/common';
import { ProductSearchQueryDto } from './dto/product-search-query.dto';
import { ProductSearchResponseDto } from './dto/product-search-response.dto';
import { SuggestKeywordsQueryDto } from './dto/suggest-keywords-query.dto';
import {
  SearchSuggestionsResponseDto,
  TrendingKeywordsResponseDto,
} from './dto/search-keyword-response.dto';
import { TrendingKeywordsQueryDto } from './dto/trending-keywords-query.dto';
import { SearchService } from './search.service';

@Controller('search/products')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  async search(
    @Query() query: ProductSearchQueryDto,
  ): Promise<ProductSearchResponseDto> {
    return this.searchService.searchProducts(query);
  }

  @Get('trending-keywords')
  async getTrendingKeywords(
    @Query() query: TrendingKeywordsQueryDto,
  ): Promise<TrendingKeywordsResponseDto> {
    return this.searchService.getTrendingKeywords(query);
  }

  @Get('suggestions')
  async suggestKeywords(
    @Query() query: SuggestKeywordsQueryDto,
  ): Promise<SearchSuggestionsResponseDto> {
    return this.searchService.suggestKeywords(query);
  }
}
