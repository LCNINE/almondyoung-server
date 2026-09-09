import { Controller, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { ReplenishmentProfileService } from '../demand/replenishment-profile.service';
import { RecomputeProfilesQueryDto, RefreshSummaryDto } from '../dto/replenishment-profile.dto';

/**
 * 프로필 재계산 (#743 A, 스펙 §7.4). 동기 실행 — 5,800 SKU × 365 일도 수 초 안쪽이다.
 * 상태코드 매핑 try/catch 없음 — GlobalExceptionFilter 가 한다.
 */
@ApiTags('Inventory - Replenishment')
@Controller('replenishment')
@UseGuards(ScopeGuard)
export class ReplenishmentProfileController {
  constructor(private readonly service: ReplenishmentProfileService) {}

  @Post('profiles/recompute')
  @HttpCode(200)
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({
    summary: '수요 시계열 · 프로필 · 리드타임 프로필을 지금 다시 계산한다',
    description: '야간 배치(03:40 KST)와 같은 세 단계. series=window 는 최근 창만, full 은 D0 이후 전량.',
  })
  @ApiResponse({ status: 200, type: RefreshSummaryDto })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  recompute(@Query() query: RecomputeProfilesQueryDto): Promise<RefreshSummaryDto> {
    return this.service.recompute(query.series ?? 'window');
  }
}
