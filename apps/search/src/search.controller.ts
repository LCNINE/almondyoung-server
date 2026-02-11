import { Controller, Get, Query } from '@nestjs/common';
import { ProductSearchQueryDto } from './dto/product-search-query.dto';
import { ProductSearchResponseDto } from './dto/product-search-response.dto';
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
}
