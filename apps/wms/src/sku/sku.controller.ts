// apps/wms/src/sku/sku.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { SkuService } from './sku.service';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';

@ApiTags('SKU')
@Controller('wms/skus')
export class SkuController {
  constructor(private readonly skuService: SkuService) { }

  @Get()
  @ApiOperation({ summary: 'SKU 검색 (ID, 코드, 바코드, 이름, 공급사 이름)' })
  @ApiQuery({ name: 'id', required: false, description: 'SKU ID (정확히 일치)' })
  @ApiQuery({ name: 'code', required: false, description: 'SKU 코드 (정확히 일치)' })
  @ApiQuery({ name: 'barcode', required: false, description: 'SKU 기본 바코드 또는 서브 바코드 (부분 일치)' })
  @ApiQuery({ name: 'name', required: false, description: 'SKU 이름 (부분 일치)' })
  @ApiQuery({ name: 'supplierName', required: false, description: '공급사 이름 (부분 일치)' })
  @ApiResponse({ status: 200, description: '검색된 SKU 목록을 반환합니다.' })
  async searchSkus(
    @Query('id') id?: string,
    @Query('code') code?: string,
    @Query('barcode') barcode?: string,
    @Query('name') name?: string,
    @Query('supplierName') supplierName?: string,
  ) {
    return this.skuService.searchSkus({ id, code, barcode, name, supplierName });
  }

}