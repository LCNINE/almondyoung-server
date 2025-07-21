// apps/wms/src/sku/sku.controller.ts
import { Controller, Get, Post, Put, Delete, Query, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { SkuService } from './sku.service';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { CreateSkuDto } from './dto/create-sku.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';
import { AddBarcodeDto } from './dto/add-barcode.dto';
import { SkuResponseDto } from './dto/sku-response.dto';
import { SkuStockSummaryDto } from './dto/sku-stock-summary.dto';
import { UpdateAlwaysSellableDto, BatchUpdateAlwaysSellableDto } from './dto/update-always-sellable.dto';

@ApiTags('SKU')
@Controller('wms/skus')
export class SkuController {
  constructor(private readonly skuService: SkuService) { }

  @Post()
  @ApiOperation({ summary: 'SKU 생성' })
  @ApiResponse({ status: 201, description: 'SKU가 성공적으로 생성되었습니다.', type: SkuResponseDto })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  async createSku(@Body() createSkuDto: CreateSkuDto): Promise<SkuResponseDto> {
    return this.skuService.createSku(createSkuDto);
  }

  @Get()
  @ApiOperation({ summary: 'SKU 검색' })
  @ApiQuery({ name: 'id', required: false, description: 'SKU ID (정확히 일치)' })
  @ApiQuery({ name: 'code', required: false, description: 'SKU 코드 (정확히 일치)' })
  @ApiQuery({ name: 'barcode', required: false, description: 'SKU 기본 바코드 또는 서브 바코드' })
  @ApiQuery({ name: 'name', required: false, description: 'SKU 이름 (부분 일치)' })
  @ApiQuery({ name: 'supplierName', required: false, description: '공급사 이름 (부분 일치)' })
  @ApiQuery({ name: 'inventoryManagement', required: false, type: Boolean, description: '재고 관리 여부' })
  @ApiResponse({ status: 200, description: '검색된 SKU 목록', type: [SkuResponseDto] })
  async searchSkus(
    @Query('id') id?: string,
    @Query('code') code?: string,
    @Query('barcode') barcode?: string,
    @Query('name') name?: string,
    @Query('supplierName') supplierName?: string,
    @Query('inventoryManagement') inventoryManagement?: string,
  ): Promise<SkuResponseDto[]> {
    const inventoryManagementBool = inventoryManagement === 'true' ? true :
      inventoryManagement === 'false' ? false :
        undefined;

    return this.skuService.searchSkus({
      id,
      code,
      barcode,
      name,
      supplierName,
      inventoryManagement: inventoryManagementBool
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'SKU 상세 조회' })
  @ApiParam({ name: 'id', description: 'SKU ID' })
  @ApiResponse({ status: 200, description: 'SKU 상세 정보', type: SkuResponseDto })
  @ApiResponse({ status: 404, description: 'SKU를 찾을 수 없습니다.' })
  async getSkuById(@Param('id') id: string): Promise<SkuResponseDto> {
    return this.skuService.getSkuById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'SKU 수정' })
  @ApiParam({ name: 'id', description: 'SKU ID' })
  @ApiResponse({ status: 200, description: 'SKU가 성공적으로 수정되었습니다.', type: SkuResponseDto })
  @ApiResponse({ status: 404, description: 'SKU를 찾을 수 없습니다.' })
  async updateSku(
    @Param('id') id: string,
    @Body() updateSkuDto: UpdateSkuDto
  ): Promise<SkuResponseDto> {
    return this.skuService.updateSku(id, updateSkuDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'SKU 삭제' })
  @ApiParam({ name: 'id', description: 'SKU ID' })
  @ApiResponse({ status: 204, description: 'SKU가 성공적으로 삭제되었습니다.' })
  @ApiResponse({ status: 404, description: 'SKU를 찾을 수 없습니다.' })
  @ApiResponse({ status: 409, description: '재고가 있거나 상품 매칭에 사용 중인 SKU는 삭제할 수 없습니다.' })
  async deleteSku(@Param('id') id: string): Promise<void> {
    return this.skuService.deleteSku(id);
  }

  @Post(':id/barcodes')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'SKU에 바코드 추가' })
  @ApiParam({ name: 'id', description: 'SKU ID' })
  @ApiResponse({ status: 204, description: '바코드가 성공적으로 추가되었습니다.' })
  @ApiResponse({ status: 404, description: 'SKU를 찾을 수 없습니다.' })
  @ApiResponse({ status: 409, description: '이미 존재하는 바코드입니다.' })
  async addBarcode(
    @Param('id') id: string,
    @Body() addBarcodeDto: AddBarcodeDto
  ): Promise<void> {
    return this.skuService.addBarcode(id, addBarcodeDto);
  }

  @Delete(':id/barcodes/:barcodeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'SKU에서 바코드 제거' })
  @ApiParam({ name: 'id', description: 'SKU ID' })
  @ApiParam({ name: 'barcodeId', description: '바코드 ID' })
  @ApiResponse({ status: 204, description: '바코드가 성공적으로 제거되었습니다.' })
  @ApiResponse({ status: 400, description: '기본 바코드는 제거할 수 없습니다.' })
  @ApiResponse({ status: 404, description: 'SKU 또는 바코드를 찾을 수 없습니다.' })
  async removeBarcode(
    @Param('id') id: string,
    @Param('barcodeId') barcodeId: string
  ): Promise<void> {
    return this.skuService.removeBarcode(id, barcodeId);
  }

  @Get(':id/stock-summary')
  @ApiOperation({ summary: 'SKU 재고 요약 조회' })
  @ApiParam({ name: 'id', description: 'SKU ID' })
  @ApiResponse({ status: 200, description: 'SKU 재고 요약 정보', type: SkuStockSummaryDto })
  @ApiResponse({ status: 404, description: 'SKU를 찾을 수 없습니다.' })
  async getSkuStockSummary(@Param('id') id: string): Promise<SkuStockSummaryDto> {
    return this.skuService.getSkuStockSummary(id);
  }

  @Put(':id/always-sellable-zero-stock')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'SKU의 재고 0 판매 가능 설정 업데이트' })
  @ApiParam({ name: 'id', description: 'SKU ID' })
  @ApiResponse({ status: 204, description: '설정이 성공적으로 업데이트되었습니다.' })
  @ApiResponse({ status: 400, description: '재고가 있는 SKU는 설정할 수 없습니다.' })
  @ApiResponse({ status: 404, description: 'SKU를 찾을 수 없습니다.' })
  async updateAlwaysSellableZeroStock(
    @Param('id') id: string,
    @Body() updateDto: UpdateAlwaysSellableDto
  ): Promise<void> {
    return this.skuService.updateAlwaysSellableZeroStock(id, updateDto.value);
  }

  @Post('batch/always-sellable-zero-stock')
  @ApiOperation({ summary: '여러 SKU의 재고 0 판매 가능 설정 일괄 업데이트' })
  @ApiResponse({
    status: 200,
    description: '일괄 업데이트 결과',
    schema: {
      properties: {
        success: { type: 'array', items: { type: 'string' } },
        failed: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              skuId: { type: 'string' },
              reason: { type: 'string' }
            }
          }
        }
      }
    }
  })
  async batchUpdateAlwaysSellableZeroStock(
    @Body() batchUpdateDto: BatchUpdateAlwaysSellableDto
  ): Promise<{ success: string[]; failed: Array<{ skuId: string; reason: string }> }> {
    return this.skuService.batchUpdateAlwaysSellableZeroStock(batchUpdateDto.updates);
  }
}