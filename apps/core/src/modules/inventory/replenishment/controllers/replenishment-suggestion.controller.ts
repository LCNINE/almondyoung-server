import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { ReplenishmentSuggestionService } from '../suggestion/replenishment-suggestion.service';
import {
  ListSuggestionsQueryDto,
  ReplenishmentSuggestionListDto,
  ReplenishmentSuggestionRowDto,
} from '../dto/replenishment-suggestion.dto';

/**
 * 보충 제안 HTTP 표면 (#743). 읽기 전용. 상태코드 매핑 try/catch 없음 — GlobalExceptionFilter 가 한다.
 */
@ApiTags('Inventory - Replenishment')
@Controller('replenishment')
@UseGuards(ScopeGuard)
export class ReplenishmentSuggestionController {
  constructor(private readonly service: ReplenishmentSuggestionService) {}

  @Get('suggestions')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({
    summary: '보충 제안 목록 — 발주 제안과 이동 제안',
    description: 'actions 가 하나 이상인 SKU 만 낸다. 판매창고 (재고위치 − 재주문점) 오름차순.',
  })
  @ApiResponse({ status: 200, type: ReplenishmentSuggestionListDto })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  @ApiResponse({ status: 409, description: '판매 창고가 정확히 하나가 아닙니다.' })
  list(@Query() query: ListSuggestionsQueryDto): Promise<ReplenishmentSuggestionListDto> {
    return this.service.listSuggestions({ action: query.action ?? 'all', limit: query.limit ?? 200 });
  }

  @Get('skus/:skuId')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: 'SKU 한 건의 보충 판정 — 제안이 없어도 행을 준다' })
  @ApiParam({ name: 'skuId' })
  @ApiResponse({ status: 200, type: ReplenishmentSuggestionRowDto })
  @ApiResponse({ status: 404, description: 'SKU 없음' })
  getSku(@Param('skuId') skuId: string): Promise<ReplenishmentSuggestionRowDto> {
    return this.service.getSku(skuId);
  }
}
