import { Injectable } from '@nestjs/common';
import { ProductSearchQueryDto } from './dto/product-search-query.dto';
import { ProductSearchResponseDto } from './dto/product-search-response.dto';
import { ProductIndexService } from './product-index.service';

@Injectable()
export class SearchService {
  constructor(private readonly productIndexService: ProductIndexService) {}

  async searchProducts(
    query: ProductSearchQueryDto,
  ): Promise<ProductSearchResponseDto> {
    return this.productIndexService.searchProducts(query);
  }
}
