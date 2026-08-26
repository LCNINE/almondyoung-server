import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRealmGuard, JwtAuthGuard } from '@app/authorization';
import { BehaviorQuery } from '../read-model/behavior.query';
import { BehaviorStatisticsQueryDto, BehaviorStatisticsResponseDto } from './behavior-query.dto';

/**
 * 관리자 행동 통계 (GA4 Data API 조회 전용). admin-web 프록시를 통해서만 호출된다.
 *
 * JwtAuthGuard 뒤에 AdminRealmGuard — 모든 서비스가 AUTH_SECRET 을 공유하므로
 * 인증만으로는 고객 토큰도 통과한다. staff role(admin/master)을 강제한다.
 */
@ApiTags('Statistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminRealmGuard)
@Controller('statistics')
export class BehaviorController {
  constructor(private readonly behaviorQuery: BehaviorQuery) {}

  @Get('behavior')
  @ApiOperation({
    summary: '행동 통계',
    description:
      'GA4 구매 퍼널(상품조회→담기→체크아웃→결제이동→구매) — 합계, 일별 전환율, 상품별·기기별 행동. GA4 env 미배선이면 enabled=false 로 응답한다.',
  })
  getBehavior(@Query() query: BehaviorStatisticsQueryDto): Promise<BehaviorStatisticsResponseDto> {
    if (query.from > query.to) {
      throw new BadRequestException(`조회 기간이 뒤집혔습니다: ${query.from} > ${query.to}`);
    }
    return this.behaviorQuery.getBehavior(query.from, query.to, query.limit ?? 20);
  }
}
