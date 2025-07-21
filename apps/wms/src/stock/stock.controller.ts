// apps/wms/src/stock/stock.controller.ts
import { Controller, Get, Post, Body, Query, Param } from '@nestjs/common';
import { StockService } from './stock.service';
import { WarehouseTransferService } from './warehouse-transfer.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { CreateStockEntryDto } from './dto/create-stock-entry.dto';
import { AdjustStockQuantityDto } from './dto/adjust-stock-quantity.dto';
import { GetStockQueryDto } from './dto/get-stock-query.dto';
import { CreateInboundDto } from './dto/create-inbound.dto';
import { InterWarehouseTransferDto } from './dto/inter-warehouse-transfer.dto';
import { IntraWarehouseMoveDto } from './dto/intra-warehouse-move.dto';
import { ProcessOutboundDto } from './dto/process-outbound.dto';

@ApiTags('Stock')
@Controller('wms/stocks')
export class StockController {
  constructor(
    private readonly stockService: StockService,
    private readonly warehouseTransferService: WarehouseTransferService,
    private readonly warehouseService: WarehouseService,
  ) { }

  @Post('/entry')
  @ApiOperation({ summary: '새로운 재고 묶음 생성 (판매등록 시 재고 0, 또는 수동 입고)' })
  @ApiResponse({ status: 201, description: '새로운 재고 묶음이 성공적으로 생성되었습니다.' })
  @ApiResponse({ status: 400, description: '잘못된 요청 또는 유효성 검사 실패.' })
  @ApiResponse({ status: 404, description: '관련 Product Matching 항목을 찾을 수 없음.' })
  async createStockEntry(@Body() createStockEntryDto: CreateStockEntryDto) {
    return this.stockService.createStockEntry(createStockEntryDto);
  }

  @Post('/inbound')
  @ApiOperation({ summary: '거래처로부터의 입고 처리 (국내/해외)' })
  @ApiResponse({ status: 201, description: '입고가 성공적으로 처리되었습니다.' })
  async processInbound(@Body() inboundDto: CreateInboundDto) {
    return this.stockService.processInbound(inboundDto);
  }

  @Post('/transfer/inter-warehouse')
  @ApiOperation({ summary: '창고 간 재고 이동' })
  @ApiResponse({ status: 200, description: '창고 간 이동이 성공적으로 처리되었습니다.' })
  async transferBetweenWarehouses(@Body() transferDto: InterWarehouseTransferDto) {
    return this.warehouseTransferService.transferBetweenWarehouses(transferDto);
  }

  @Post('/transfer/intra-warehouse')
  @ApiOperation({ summary: '창고 내 위치 이동' })
  @ApiResponse({ status: 200, description: '창고 내 이동이 성공적으로 처리되었습니다.' })
  async moveWithinWarehouse(@Body() moveDto: IntraWarehouseMoveDto) {
    return this.warehouseTransferService.moveWithinWarehouse(moveDto);
  }

  @Post('/outbound/:stockId')
  @ApiOperation({ summary: '출고 처리' })
  @ApiResponse({ status: 200, description: '출고가 성공적으로 처리되었습니다.' })
  async processOutbound(
    @Param('stockId') stockId: string,
    @Body() outboundDto: ProcessOutboundDto
  ) {
    return this.stockService.processOutbound(
      stockId,
      outboundDto.quantity,
      outboundDto.reason,
      outboundDto.orderId
    );
  }

  @Post('/adjust')
  @ApiOperation({ summary: '재고 수량 조정 (관리자 수동 조정)' })
  @ApiResponse({ status: 200, description: '재고 수량이 성공적으로 조정되었습니다.' })
  @ApiResponse({ status: 400, description: '잘못된 요청 또는 유효성 검사 실패.' })
  @ApiResponse({ status: 404, description: '활성 재고 항목을 찾을 수 없음.' })
  async adjustStockQuantity(@Body() adjustDto: AdjustStockQuantityDto) {
    return this.stockService.adjustStockManually(
      adjustDto.stockId,
      adjustDto.delta,
      adjustDto.reason
    );
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

  @Get('/sku/:skuId/total')
  @ApiOperation({ summary: 'SKU별 총 재고 조회 (모든 창고 합계)' })
  @ApiResponse({
    status: 200,
    description: 'SKU의 총 재고 정보를 반환합니다.',
    schema: {
      type: 'object',
      properties: {
        skuId: { type: 'string' },
        totalRealQuantity: { type: 'number' },
        totalReservedQuantity: { type: 'number' },
        totalAvailableQuantity: { type: 'number' }
      }
    }
  })
  async getTotalStockBySku(@Param('skuId') skuId: string) {
    return this.stockService.getTotalStockBySku(skuId);
  }

  @Get('/sku/:skuId/warehouse/:warehouseId')
  @ApiOperation({ summary: '특정 창고의 SKU별 재고 상세 조회' })
  @ApiResponse({ status: 200, description: '창고별 SKU 재고 상세 정보를 반환합니다.' })
  async getStockBySkuAndWarehouse(
    @Param('skuId') skuId: string,
    @Param('warehouseId') warehouseId: string
  ) {
    return this.stockService.getStockBySkuAndWarehouse(skuId, warehouseId);
  }

  @Get('/location/:locationId')
  @ApiOperation({ summary: '특정 위치의 재고 현황 조회' })
  @ApiResponse({ status: 200, description: '위치별 재고 목록을 반환합니다.' })
  async getStocksByLocation(@Param('locationId') locationId: string) {
    return this.warehouseTransferService.getStocksByLocation(locationId);
  }

  @Get('/warehouse/:warehouseId/locations/utilization')
  @ApiOperation({ summary: '창고별 위치 활용률 조회' })
  @ApiResponse({
    status: 200,
    description: '창고의 위치별 활용률을 반환합니다.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          locationId: { type: 'string' },
          locationCode: { type: 'string' },
          stockCount: { type: 'number' },
          skuCount: { type: 'number' },
          totalQuantity: { type: 'number' }
        }
      }
    }
  })
  async getLocationUtilization(@Param('warehouseId') warehouseId: string) {
    return this.warehouseTransferService.getLocationUtilization(warehouseId);
  }

  @Get('/warehouse/:warehouseId/summary')
  @ApiOperation({ summary: '특정 창고의 재고 요약 조회' })
  @ApiResponse({ status: 200, description: '창고별 재고 요약을 반환합니다.' })
  async getWarehouseStockSummary(@Param('warehouseId') warehouseId: string) {
    return this.warehouseService.getWarehouseStockSummary(warehouseId);
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