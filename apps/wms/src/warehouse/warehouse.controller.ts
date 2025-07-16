// apps/wms/src/warehouse/warehouse.controller.ts
import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WarehouseService } from './warehouse.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';

@ApiTags('Warehouse')
@Controller('wms/warehouses')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) { }

  @Post()
  @ApiOperation({ summary: '새 창고 생성' })
  @ApiResponse({ status: 201, description: '창고가 생성되었습니다.' })
  create(@Body() createWarehouseDto: CreateWarehouseDto) {
    return this.warehouseService.create(createWarehouseDto);
  }

  @Get()
  @ApiOperation({ summary: '모든 창고 목록 조회' })
  @ApiResponse({ status: 200, description: '창고 목록을 반환합니다.' })
  findAll() {
    return this.warehouseService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: '특정 창고 조회' })
  @ApiResponse({ status: 200, description: '창고 정보를 반환합니다.' })
  @ApiResponse({ status: 404, description: '창고를 찾을 수 없습니다.' })
  findOne(@Param('id') id: string) {
    return this.warehouseService.findOne(id);
  }

  @Get(':id/summary')
  @ApiOperation({ summary: '창고별 재고 요약 조회' })
  @ApiResponse({ status: 200, description: '창고별 재고 요약을 반환합니다.' })
  getWarehouseStockSummary(@Param('id') id: string) {
    return this.warehouseService.getWarehouseStockSummary(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '창고 정보 수정' })
  @ApiResponse({ status: 200, description: '창고 정보가 수정되었습니다.' })
  @ApiResponse({ status: 404, description: '창고를 찾을 수 없습니다.' })
  update(@Param('id') id: string, @Body() updateWarehouseDto: UpdateWarehouseDto) {
    return this.warehouseService.update(id, updateWarehouseDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '창고 삭제' })
  @ApiResponse({ status: 200, description: '창고가 삭제되었습니다.' })
  @ApiResponse({ status: 404, description: '창고를 찾을 수 없습니다.' })
  @ApiResponse({ status: 400, description: '기본 창고이거나 사용 중인 창고는 삭제할 수 없습니다.' })
  remove(@Param('id') id: string) {
    return this.warehouseService.remove(id);
  }
}