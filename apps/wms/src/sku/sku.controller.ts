import { Controller, Get, Query, Param } from '@nestjs/common';
import { SkuService } from './sku.service';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';

@ApiTags('SKU')
@Controller('wms/skus')
export class SkuController {
  constructor(private readonly skuService: SkuService) { }

  @Get()
  @ApiOperation({ summary: 'SKU 검색 (상품명, 바코드/상품코드)' })
  @ApiQuery({ name: 'name', required: false, description: 'SKU 이름' })
  @ApiQuery({ name: 'productCode', required: false, description: 'SKU 바코드 또는 상품 코드' })
  @ApiResponse({ status: 200, description: 'SKU 목록을 반환합니다.' })
  async searchSkus(
    @Query('name') name?: string,
    @Query('barcode') barcode?: string,
  ) {
    return this.skuService.searchSkus(name, barcode);
  }

  @Get(':id')
  @ApiOperation({ summary: 'SKU ID로 조회' })
  @ApiResponse({ status: 200, description: '단일 SKU 정보 반환' })
  async findSkuById(@Param('id') id: string) {
    return this.skuService.findSkuById(id);
  }
}