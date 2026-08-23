import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { ApiOkResponsePaginated } from '../../shared/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '../../shared/dto';
import { CurrentStockDto } from '../dto/current-stock.dto';
import { GetStockQueryDto } from '../dto/get-stock-query.dto';
import { GetStockSummaryListQueryDto, StockSummaryListItemDto } from '../dto/stock-summary-list.dto';
import { SkuStockSummaryDto } from '../dto/sku-stock-summary.dto';
import { LocationContentsDto } from '../dto/location-contents.dto';
import { InboundPipelineResponseDto } from '../dto/inbound-pipeline.dto';
import { StockProjectionService } from '../services/stock-projection.service';

// skuIds 는 쉼표 구분 문자열도 받아서 데코레이터 파이프를 걸 수 없다 — 분해한 뒤
// 원소마다 같은 파이프를 태워 warehouseId 와 판정 기준을 하나로 유지한다.
// class-validator 의 isUUID 를 쓰지 않는 이유: 그쪽은 RFC-4122 version/variant 니블까지
// 보므로 기본 창고 id(`00000000-0000-0000-0000-000000000001`) 같은 Postgres 가 받는
// UUID 를 거부한다. ParseUUIDPipe 의 기본값('all')은 Postgres 와 같은 범위를 받는다.
const SKU_ID_PIPE = new ParseUUIDPipe();

@ApiTags('Inventory')
@Controller('inventory')
@UseGuards(ScopeGuard)
export class StockProjectionController {
  constructor(private readonly stockProjection: StockProjectionService) {}

  @Get('/stocks')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({
    summary: '재고 현황 조회 (창고별 논리적 재고)',
    description:
      '창고별 SKU 재고 현황을 조회합니다. 물리적 재고(onHand, defective, inTransfer)와 논리적 상태(reserved, available, inboundPending)를 포함합니다.',
  })
  @ApiQuery({ name: 'warehouseId', required: true, description: '창고 ID (필수)' })
  @ApiQuery({ name: 'skuId', required: false, description: 'SKU ID 필터' })
  @ApiOkResponsePaginated(CurrentStockDto)
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async getCurrentStock(@Query() query: GetStockQueryDto): Promise<PaginatedResponseDto<CurrentStockDto>> {
    return this.stockProjection.getCurrentStock(query);
  }

  @Get('/stocks/summary')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({
    summary: '재고 요약 목록 조회 (SKU × 창고)',
    description: 'SKU·창고별 재고 요약 목록을 조회합니다. 재고 움직임이 전혀 없는 SKU × 창고 조합은 제외됩니다.',
  })
  @ApiQuery({ name: 'skuId', required: false, description: 'SKU ID 필터' })
  @ApiQuery({ name: 'warehouseId', required: false, description: '창고 ID 필터' })
  @ApiQuery({ name: 'search', required: false, description: 'SKU 이름 검색어 (부분일치)' })
  @ApiQuery({
    name: 'quantityState',
    required: false,
    enum: ['out_of_stock', 'reserved', 'inbound_pending', 'outbound_pending'],
    description: '운영 재고 상태 필터',
  })
  @ApiOkResponsePaginated(StockSummaryListItemDto)
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async listStockSummaries(
    @Query() query: GetStockSummaryListQueryDto,
  ): Promise<PaginatedResponseDto<StockSummaryListItemDto>> {
    return this.stockProjection.listStockSummaries(query);
  }

  @Get('/stocks/sku/:skuId/total')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
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
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async getTotalStockBySku(@Param('skuId') skuId: string) {
    return this.stockProjection.getTotalBySku(skuId);
  }

  @Get('/stocks/sku/:skuId/warehouse/:warehouseId')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: 'SKU별 특정 창고 재고 상세 조회' })
  @ApiParam({ name: 'skuId', description: 'SKU ID' })
  @ApiParam({ name: 'warehouseId', description: '창고 ID' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async getStockBySkuAndWarehouse(@Param('skuId') skuId: string, @Param('warehouseId') warehouseId: string) {
    return this.stockProjection.getBySkuAndWarehouse(skuId, warehouseId);
  }

  @Get('/stocks/location/:locationId')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '로케이션 내용물 조회 (SKU·상태·수량)' })
  @ApiParam({ name: 'locationId', description: '로케이션 ID' })
  @ApiResponse({ status: 200, type: LocationContentsDto })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async getLocationContents(@Param('locationId') locationId: string): Promise<LocationContentsDto> {
    return this.stockProjection.getLocationContents(locationId);
  }

  @Get('/stocks/inbound-pipeline')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({
    summary: '공급 파이프라인 조회 (발주 잔량 · 이동 대기 · 이동 중)',
    description:
      '판매 창고 관점에서 언제 몇 개가 들어오는지를 3단계로 냅니다. ①발주 잔량(비판매 창고 입고 예정) ②이동 대기(비판매 창고 보유, 미선적) ③이동 중(선적 후 미도착). ②는 판매가능수량에도 입고예정에도 잡히지 않는 구간이라 빼면 중복 발주가 납니다. ' +
      '【범위 주의】③만 warehouseId 로 좁혀집니다. ①②는 비판매 창고 전체의 합이며 대상 창고로 좁혀지지 않습니다 — 판매 창고가 하나(부천)라는 전제 위에서만 이 창고의 예정 물량과 같습니다. ' +
      '판매 창고가 둘 이상이 되면 ①②는 모든 판매 창고에 같은 수량이 중복 표시되므로, 이 값을 창고별 "총 입고 예정"으로 그리거나 합산하면 안 됩니다.',
  })
  @ApiQuery({ name: 'warehouseId', required: true, description: '도착(판매) 창고 ID' })
  @ApiQuery({ name: 'skuIds', required: true, description: 'SKU ID 목록 (쉼표 구분 또는 반복 파라미터)' })
  @ApiResponse({ status: 200, type: InboundPipelineResponseDto })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async getInboundPipeline(
    // UUID 형식은 파이프에서 막는다 — 그냥 통과시키면 Postgres 가 22P02 로 터져
    // 입력 오류가 500 이 된다. 파이프는 값이 없을 때도 400 을 낸다.
    @Query('warehouseId', new ParseUUIDPipe()) warehouseId: string,
    @Query('skuIds') skuIds?: string | string[],
  ): Promise<InboundPipelineResponseDto> {
    const ids = (Array.isArray(skuIds) ? skuIds : (skuIds ?? '').split(','))
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (ids.length === 0) throw new BadRequestException('skuIds is required');
    for (const id of ids) {
      await SKU_ID_PIPE.transform(id, { type: 'query', data: 'skuIds' });
    }

    return this.stockProjection.getInboundPipeline({ skuIds: ids, toWarehouseId: warehouseId });
  }

  @Get('/stocks/history')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '재고 이벤트 이력 조회 (SKU, 창고, 기간 기준)' })
  @ApiQuery({ name: 'skuId', required: true, description: '조회할 SKU ID (UUID 형식)' })
  @ApiQuery({ name: 'warehouseId', required: false, description: '조회할 창고 ID (UUID 형식)' })
  @ApiQuery({ name: 'startDate', required: false, description: '조회 시작일 (YYYY-MM-DD)' })
  @ApiQuery({ name: 'endDate', required: false, description: '조회 종료일 (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: '재고 이벤트 이력 목록을 반환합니다.' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
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
  @RequireScopes(INVENTORY_SCOPE.ADJUST)
  @ApiOperation({ summary: '재고 현황 재구축 (이벤트 소싱으로부터)' })
  @ApiParam({ name: 'skuId', description: 'SKU ID' })
  @ApiParam({ name: 'warehouseId', description: '창고 ID' })
  @ApiResponse({ status: 204, description: '재고 현황이 성공적으로 재구축되었습니다.' })
  @ApiResponse({ status: 403, description: '재고 원장 조정 권한이 없습니다.' })
  async rebuildStockSummary(@Param('skuId') skuId: string, @Param('warehouseId') warehouseId: string) {
    await this.stockProjection.rebuildSummary(skuId, warehouseId);
  }

  @Delete('/stocks/events/:eventId/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes(INVENTORY_SCOPE.ADJUST)
  @ApiOperation({ summary: '재고 이벤트 취소 (반대 이벤트 생성)' })
  @ApiParam({ name: 'eventId', description: '취소할 이벤트 ID' })
  @ApiResponse({ status: 204, description: '이벤트가 성공적으로 취소되었습니다.' })
  @ApiResponse({ status: 403, description: '재고 원장 조정 권한이 없습니다.' })
  async cancelStockEvent(@Param('eventId') eventId: string, @Body('reason') reason: string) {
    await this.stockProjection.cancelEvent(eventId, reason);
  }

  @Get('/skus/:id/stock-summary')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: 'SKU 재고 요약 (창고별 + 합계)' })
  @ApiParam({ name: 'id', description: 'SKU ID' })
  @ApiResponse({ status: 200, type: SkuStockSummaryDto })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async getSkuStockSummary(@Param('id') id: string): Promise<SkuStockSummaryDto> {
    return this.stockProjection.getSkuSummary(id);
  }
}
