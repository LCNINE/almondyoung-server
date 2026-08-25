import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRealmGuard, JwtAuthGuard } from '@app/authorization';
import { TrafficQuery } from '../read-model/traffic.query';
import { TrafficStatisticsQueryDto, TrafficStatisticsResponseDto } from './traffic-query.dto';

/**
 * 관리자 유입 통계 (GA4 Data API 조회 전용). admin-web 프록시를 통해서만 호출된다.
 *
 * JwtAuthGuard 뒤에 AdminRealmGuard — 모든 서비스가 AUTH_SECRET 을 공유하므로
 * 인증만으로는 고객 토큰도 통과한다. staff role(admin/master)을 강제한다.
 */
@ApiTags('Statistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminRealmGuard)
@Controller('statistics')
export class TrafficController {
  constructor(private readonly trafficQuery: TrafficQuery) {}

  @Get('traffic')
  @ApiOperation({
    summary: '유입 통계',
    description:
      'GA4 세션 지표 — 일별 추이, 랜딩페이지·기기·국가별. 기본은 자연검색(Organic Search)만. GA4 env 미배선이면 enabled=false 로 응답한다.',
  })
  getTraffic(@Query() query: TrafficStatisticsQueryDto): Promise<TrafficStatisticsResponseDto> {
    if (query.from > query.to) {
      throw new BadRequestException(`조회 기간이 뒤집혔습니다: ${query.from} > ${query.to}`);
    }
    return this.trafficQuery.getTraffic(query.from, query.to, query.channelGroup ?? 'organic', query.limit ?? 10);
  }
}
