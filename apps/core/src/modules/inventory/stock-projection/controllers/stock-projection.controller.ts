import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiOkResponsePaginated } from '../../shared/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '../../shared/dto';
import { CurrentStockDto } from '../dto/current-stock.dto';
import { GetStockQueryDto } from '../dto/get-stock-query.dto';
import { SkuStockSummaryDto } from '../dto/sku-stock-summary.dto';
import { StockProjectionService } from '../services/stock-projection.service';

@ApiTags('Inventory')
@Controller('inventory')
export class StockProjectionController {
  constructor(private readonly stockProjection: StockProjectionService) {}

  @Get('/stocks')
  @ApiOperation({
    summary: '재고 현황 조회 (창고별 논리적 재고)',
    description:
      '창고별 SKU 재고 현황을 조회합니다. 물리적 재고(onHand, defective, inTransfer)와 논리적 상태(reserved, available, inboundPending)를 포함합니다.',
  })
  @ApiQuery({ name: 'warehouseId', required: true, description: '창고 ID (필수)' })
  @ApiQuery({ name: 'skuId', required: false, description: 'SKU ID 필터' })
  @ApiOkResponsePaginated(CurrentStockDto)
  async getCurrentStock(@Query() query: GetStockQueryDto): Promise<PaginatedResponseDto<CurrentStockDto>> {
    return this.stockProjection.getCurrentStock(query);
  }

  @Get('/stocks/sku/:skuId/total')
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
        totalAvailableQuantity: { type: 'number' },
      },
    },
  })
  async getTotalStockBySku(@Param('skuId') skuId: string) {
    return this.stockProjection.getTotalBySku(skuId);
  }

  @Get('/stocks/sku/:skuId/warehouse/:warehouseId')
  @ApiOperation({ summary: 'SKU별 특정 창고 재고 상세 조회' })
  @ApiParam({ name: 'skuId', description: 'SKU ID' })
  @ApiParam({ name: 'warehouseId', description: '창고 ID' })
  async getStockBySkuAndWarehouse(@Param('skuId') skuId: string, @Param('warehouseId') warehouseId: string) {
    return this.stockProjection.getBySkuAndWarehouse(skuId, warehouseId);
  }

  @Get('/stocks/history')
  @ApiOperation({ summary: '재고 이벤트 이력 조회 (SKU, 창고, 기간 기준)' })
  @ApiQuery({ name: 'skuId', required: true, description: '조회할 SKU ID (UUID 형식)' })
  @ApiQuery({ name: 'warehouseId', required: false, description: '조회할 창고 ID (UUID 형식)' })
  @ApiQuery({ name: 'startDate', required: false, description: '조회 시작일 (YYYY-MM-DD)' })
  @ApiQuery({ name: 'endDate', required: false, description: '조회 종료일 (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: '재고 이벤트 이력 목록을 반환합니다.' })
  async getStockHistory(
    @Query('skuId') skuId: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stockProjection.getHistory(skuId, warehouseId, startDate, endDate);
  }

  @Post('/stocks/summary/:skuId/:warehouseId/rebuild')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '재고 현황 재구축 (이벤트 소싱으로부터)' })
  @ApiParam({ name: 'skuId', description: 'SKU ID' })
  @ApiParam({ name: 'warehouseId', description: '창고 ID' })
  @ApiResponse({ status: 204, description: '재고 현황이 성공적으로 재구축되었습니다.' })
  async rebuildStockSummary(@Param('skuId') skuId: string, @Param('warehouseId') warehouseId: string) {
    await this.stockProjection.rebuildSummary(skuId, warehouseId);
  }

  @Delete('/stocks/events/:eventId/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '재고 이벤트 취소 (반대 이벤트 생성)' })
  @ApiParam({ name: 'eventId', description: '취소할 이벤트 ID' })
  @ApiResponse({ status: 204, description: '이벤트가 성공적으로 취소되었습니다.' })
  async cancelStockEvent(@Param('eventId') eventId: string, @Body('reason') reason: string) {
    await this.stockProjection.cancelEvent(eventId, reason);
  }

  @Get('/skus/:id/stock-summary')
  @ApiOperation({ summary: 'SKU 재고 요약 (창고별 + 합계)' })
  @ApiParam({ name: 'id', description: 'SKU ID' })
  @ApiResponse({ status: 200, type: SkuStockSummaryDto })
  async getSkuStockSummary(@Param('id') id: string): Promise<SkuStockSummaryDto> {
    return this.stockProjection.getSkuSummary(id);
  }
}
