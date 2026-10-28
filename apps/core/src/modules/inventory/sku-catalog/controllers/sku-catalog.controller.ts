import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@app/authorization';
import { SkuCatalogService } from '../services/sku-catalog.service';
import { CreateSkuDto } from '../dto/create-sku.dto';
import { UpdateSkuDto } from '../dto/update-sku.dto';
import { AddBarcodeDto } from '../dto/add-barcode.dto';
import { BarcodeDto, SkuResponseDto } from '../dto/sku-response.dto';
import { DeletedSkuFiltersDto } from '../dto/deleted-sku-filters.dto';
import { AdvancedInventoryFiltersDto } from '../dto/advanced-filters.dto';
import { SkuBarcodeMapper } from '../mappers/sku.mapper';

@ApiTags('Inventory')
@Controller('inventory/skus')
export class SkuCatalogController {
  constructor(private readonly skus: SkuCatalogService) {}

  @RequirePermission('inventory.master.write')
  @Post()
  @ApiOperation({ summary: '새 SKU 생성' })
  @ApiResponse({ status: 201, description: 'SKU가 성공적으로 생성되었습니다.', type: SkuResponseDto })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async create(@Body() dto: CreateSkuDto): Promise<SkuResponseDto> {
    return this.skus.create(dto);
  }

  @RequirePermission('inventory.stock.read')
  @Get('deleted')
  @ApiOperation({ summary: '삭제된 SKU 목록 조회' })
  @ApiResponse({
    status: 200,
    description: '삭제된 SKU 목록',
    schema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: { $ref: '#/components/schemas/SkuResponseDto' } },
        total: { type: 'number' },
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async getDeleted(@Query() filters: DeletedSkuFiltersDto) {
    return this.skus.getDeleted(filters);
  }

  @RequirePermission('inventory.stock.read')
  @Get()
  @ApiOperation({ summary: 'SKU 검색' })
  @ApiQuery({ name: 'id', required: false })
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'barcode', required: false })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'supplierName', required: false })
  @ApiQuery({ name: 'inventoryManagement', required: false, type: Boolean })
  @ApiQuery({ name: 'groupId', required: false })
  @ApiQuery({ name: 'holderId', required: false })
  @ApiResponse({ status: 200, description: '검색된 SKU 목록', type: [SkuResponseDto] })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async search(
    @Query('id') id?: string,
    @Query('code') code?: string,
    @Query('barcode') barcode?: string,
    @Query('name') name?: string,
    @Query('supplierName') supplierName?: string,
    @Query('inventoryManagement') inventoryManagement?: boolean,
    @Query('groupId') groupId?: string,
    @Query('holderId') holderId?: string,
  ): Promise<SkuResponseDto[]> {
    return this.skus.search({ id, code, barcode, name, supplierName, inventoryManagement, groupId, holderId });
  }

  @RequirePermission('inventory.stock.read')
  @Get('search/advanced')
  @ApiOperation({ summary: 'SKU 고급 검색 (재고 필터링 포함)' })
  @ApiResponse({
    status: 200,
    description: '검색된 SKU 목록',
    schema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: { $ref: '#/components/schemas/SkuResponseDto' } },
        total: { type: 'number' },
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async searchAdvanced(@Query() filters: AdvancedInventoryFiltersDto) {
    return this.skus.searchAdvanced(filters);
  }

  @RequirePermission('inventory.stock.read')
  @Get(':id')
  @ApiOperation({ summary: 'SKU 상세 조회' })
  @ApiResponse({ status: 200, description: 'SKU 상세 정보', type: SkuResponseDto })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async getById(@Param('id') id: string): Promise<SkuResponseDto> {
    return this.skus.getById(id);
  }

  @RequirePermission('inventory.master.write')
  @Put(':id')
  @ApiOperation({ summary: 'SKU 수정' })
  @ApiResponse({ status: 200, description: 'SKU 수정 완료', type: SkuResponseDto })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async update(@Param('id') id: string, @Body() dto: UpdateSkuDto): Promise<SkuResponseDto> {
    return this.skus.update(id, dto);
  }

  @RequirePermission('inventory.master.write')
  @Patch(':id/restore')
  @ApiOperation({ summary: '삭제된 SKU 복구' })
  @ApiResponse({ status: 200, description: 'SKU 복구 완료', type: SkuResponseDto })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async restore(@Param('id') id: string): Promise<SkuResponseDto> {
    return this.skus.restore(id);
  }

  @RequirePermission('inventory.master.write')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'SKU 삭제 (soft delete)' })
  @ApiResponse({ status: 204, description: 'SKU 삭제 완료' })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async delete(@Param('id') id: string): Promise<void> {
    return this.skus.delete(id);
  }

  @RequirePermission('inventory.master.write')
  @Post(':id/barcodes')
  @ApiOperation({ summary: 'SKU에 바코드 추가' })
  @ApiResponse({ status: 201, description: '바코드 추가 완료', type: BarcodeDto })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async addBarcode(@Param('id') id: string, @Body() dto: AddBarcodeDto): Promise<BarcodeDto> {
    const barcode = await this.skus.addBarcode(id, dto);
    return SkuBarcodeMapper.toDto(barcode);
  }

  @RequirePermission('inventory.master.write')
  @Delete(':id/barcodes/:barcodeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'SKU에서 바코드 제거' })
  @ApiResponse({ status: 204, description: '바코드 제거 완료' })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async removeBarcode(@Param('id') id: string, @Param('barcodeId') barcodeId: string): Promise<void> {
    return this.skus.removeBarcode(id, barcodeId);
  }
}
