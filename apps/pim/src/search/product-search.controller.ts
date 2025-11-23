import { Controller, Get, Query, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProductSearchService } from './product-search.service';
import { ProductSearchRequestDto, ProductSearchResponseDto } from './dto';

@ApiTags('Product Search')
@Controller('products/search')
export class ProductSearchController {
  constructor(private readonly searchService: ProductSearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Search products with Elasticsearch',
    description:
      'Search products using keywords, filters, and tags. Supports fuzzy search and nested tag filtering.',
  })
  @ApiResponse({
    status: 200,
    description: 'Search results',
    type: ProductSearchResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 500, description: 'Search error' })
  async search(
    @Query() query: ProductSearchRequestDto,
  ): Promise<ProductSearchResponseDto> {
    try {
      return await this.searchService.search(query);
    } catch (error) {
      throw new HttpException(
        `Search failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

