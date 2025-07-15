import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { StockService } from './stock.service';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { CreateStockEntryDto } from './dto/create-stock-entry.dto';
import { AdjustStockQuantityDto } from './dto/adjust-stock-quantity.dto';
import { GetStockQueryDto } from './dto/get-stock-query.dto';

@ApiTags('Stock')
@Controller('wms/stocks')
export class StockController {
  constructor(private readonly stockService: StockService) { }

  @Post('/entry')
  @ApiOperation({ summary: '새로운 재고 묶음 생성 (판매등록 시 재고 0, 또는 수동 입고)' })
  @ApiResponse({ status: 201, description: '새로운 재고 묶음이 성공적으로 생성되었습니다.' })
  @ApiResponse({ status: 400, description: '잘못된 요청 또는 유효성 검사 실패.' })
  @ApiResponse({ status: 404, description: '관련 Product Matching 항목을 찾을 수 없음.' })
  async createStockEntry(@Body() createStockEntryDto: CreateStockEntryDto) {
    return this.stockService.createStockEntry(createStockEntryDto);
  }

  @Post('/adjust')
  @ApiOperation({ summary: '재고 수량 조정 (증가/감소, 파손/분실 등)' })
  @ApiResponse({ status: 200, description: '재고 수량이 성공적으로 조정되었습니다.' })
  @ApiResponse({ status: 400, description: '잘못된 요청 또는 유효성 검사 실패.' })
  @ApiResponse({ status: 404, description: '활성 재고 항목을 찾을 수 없음.' })
  async adjustStockQuantity(@Body() adjustDto: AdjustStockQuantityDto) {
    return this.stockService.adjustStockQuantity(adjustDto.stockId, adjustDto.delta, adjustDto.reason, adjustDto.orderId);
  }

  @Get()
  @ApiOperation({ summary: '현재 재고 조회 (SKU, 창고, 위치, 재고 유형, 특정 시점 기준)' })
  @ApiQuery({ name: 'skuId', required: false, description: '검색할 SKU ID (UUID 형식)' })
  @ApiQuery({ name: 'warehouseId', required: false, description: '검색할 창고 ID (UUID 형식)' })
  @ApiQuery({ name: 'locationId', required: false, description: '검색할 위치 ID (UUID 형식)' })
  @ApiQuery({ name: 'stockType', required: false, enum: ['physical', 'infinite', 'drop_shipped', 'consignment'], description: '재고 유형 필터' })
  @ApiQuery({ name: 'asOfTimestamp', required: false, description: '특정 시점의 재고 조회 (ISO 8601 형식)' })
  @ApiResponse({ status: 200, description: '현재 재고 정보를 반환합니다.' })
  async getCurrentStock(@Query() query: GetStockQueryDto) {
    return this.stockService.getCurrentStock(query);
  }

  @Get('/history')
  @ApiOperation({ summary: '재고 이력 조회 (SKU, 창고, 기간 기준)' })
  @ApiQuery({ name: 'skuId', required: true, description: '조회할 SKU ID (UUID 형식)' })
  @ApiQuery({ name: 'warehouseId', required: false, description: '조회할 창고 ID (UUID 형식)' })
  @ApiQuery({ name: 'startDate', required: false, description: '조회 시작일 (YYYY-MM-DD)' })
  @ApiQuery({ name: 'endDate', required: false, description: '조회 종료일 (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: '재고 이력 목록을 반환합니다.' })
  async getStockHistory(
    @Query('skuId') skuId: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stockService.getStockHistory(skuId, warehouseId, startDate, endDate);
  }

}