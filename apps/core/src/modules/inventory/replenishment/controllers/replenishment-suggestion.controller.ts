import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { ReplenishmentSuggestionService } from '../suggestion/replenishment-suggestion.service';
import {
  ListSuggestionsQueryDto,
  ReplenishmentSkuDetailDto,
  ReplenishmentSuggestionListDto,
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
    description:
      'actions 가 하나 이상인 SKU 만 낸다. 예상 커버 일수(판매창고 재고위치 ÷ 일평균) 오름차순, 일평균 0 은 뒤.',
  })
  @ApiResponse({ status: 200, type: ReplenishmentSuggestionListDto })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  @ApiResponse({ status: 409, description: '판매 창고가 정확히 하나가 아닙니다.' })
  list(@Query() query: ListSuggestionsQueryDto): Promise<ReplenishmentSuggestionListDto> {
    return this.service.listSuggestions({ action: query.action ?? 'all', limit: query.limit ?? 200 });
  }

  @Get('skus/:skuId')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({
    summary: 'SKU 한 건의 보충 판정 — 제안이 없어도, 제외된 SKU 여도 행을 준다',
    description: '프로필 드로어용. 수요 프로필과 적용된 유효 파라미터(α · L1 · L2 · 커버)를 함께 낸다.',
  })
  @ApiParam({ name: 'skuId' })
  @ApiResponse({ status: 200, type: ReplenishmentSkuDetailDto })
  @ApiResponse({ status: 404, description: 'SKU 없음' })
  getSku(@Param('skuId') skuId: string): Promise<ReplenishmentSkuDetailDto> {
    return this.service.getSku(skuId);
  }
}
