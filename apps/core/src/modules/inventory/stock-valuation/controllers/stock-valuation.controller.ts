import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { ApiOkResponsePaginated } from '../../shared/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '../../shared/dto';
import { StockValuationService } from '../services/stock-valuation.service';
import {
  GetStockValuationProductsQueryDto,
  StockValuationProductDto,
  StockValuationSummaryDto,
} from '../dto/stock-valuation.dto';

@ApiTags('Inventory')
@Controller('inventory/statistics/stock-valuation')
@UseGuards(ScopeGuard)
export class StockValuationController {
  constructor(private readonly stockValuation: StockValuationService) {}

  @Get('/summary')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({
    summary: '재고 금액 요약 (묶인 돈)',
    description:
      '전 창고 재고를 원가(active 버전 supply_price)로 평가한 요약. 원가 판정 불가(미입력·상충·다중연결·미매칭)는 금액 0으로 뭉개지 않고 사유별 분리 집계합니다.',
  })
  @ApiResponse({ status: 200, type: StockValuationSummaryDto })
  @ApiResponse({ status: 403, description: '재고 조회 권한이 없습니다.' })
  async getSummary(): Promise<StockValuationSummaryDto> {
    return this.stockValuation.getSummary();
  }

  @Get('/products')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({
    summary: '상품별 재고 금액 (전체 페이지네이션)',
    description:
      '상품(master)별 ON_HAND 수량·재고 금액. masterIds 필터로 통계 화면의 무판매 상품 병합에 씁니다. ' +
      '재고를 여러 상품 공유 SKU 로만 들고 있어 금액 귀속이 불가한 상품도 수량 0 + unattributed* 로 함께 반환합니다 — ' +
      '응답에 없는 것과 재고가 없는 것을 화면이 혼동하지 않게 하기 위함입니다.',
  })
  @ApiOkResponsePaginated(StockValuationProductDto)
  @ApiResponse({ status: 403, description: '재고 조회 권한이 없습니다.' })
  async getProducts(
    @Query() query: GetStockValuationProductsQueryDto,
  ): Promise<PaginatedResponseDto<StockValuationProductDto>> {
    return this.stockValuation.getProducts(query);
  }
}
