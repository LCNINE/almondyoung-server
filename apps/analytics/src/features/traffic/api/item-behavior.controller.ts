import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRealmGuard, JwtAuthGuard } from '@app/authorization';
import { ItemBehaviorQuery } from '../read-model/item-behavior.query';
import { ItemBehaviorQueryDto, ItemBehaviorResponseDto } from './item-behavior.dto';

/**
 * 상품 단건 GA4 행동. 행동 탭(`/statistics/behavior`)과 리포트를 공유하지 않는다 —
 * 그쪽 리포트에 차원을 더하면 행이 쪼개져 기존 표가 바뀐다.
 */
@ApiTags('Statistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminRealmGuard)
@Controller('statistics')
export class ItemBehaviorController {
  constructor(private readonly itemBehaviorQuery: ItemBehaviorQuery) {}

  @Get('behavior/item')
  @ApiOperation({
    summary: '상품 단건 행동 (GA4)',
    description:
      'GA4 item_id 하나의 조회·담기·구매와 전 상품 합계(비교 기준). itemId 는 Medusa product id 다. ' +
      'GA4 env 미배선이면 enabled=false 로 응답한다.',
  })
  getItemBehavior(@Query() query: ItemBehaviorQueryDto): Promise<ItemBehaviorResponseDto> {
    if (query.from > query.to) {
      throw new BadRequestException(`조회 기간이 뒤집혔습니다: ${query.from} > ${query.to}`);
    }
    return this.itemBehaviorQuery.getItemBehavior(query.from, query.to, query.itemId);
  }
}
