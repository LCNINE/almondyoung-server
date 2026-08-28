import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRealmGuard, JwtAuthGuard } from '@app/authorization';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TrafficQuery } from '../read-model/traffic.query';
import { RealtimeQuery } from '../read-model/realtime.query';
import { RealtimeTrafficResponseDto, TrafficStatisticsQueryDto, TrafficStatisticsResponseDto } from './traffic-query.dto';

class RealtimeQueryDto {
  @ApiPropertyOptional({ example: 10, default: 10, description: '페이지 목록 최대 행 수' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}

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
  constructor(
    private readonly trafficQuery: TrafficQuery,
    private readonly realtimeQuery: RealtimeQuery,
  ) {}

  @Get('traffic/realtime')
  @ApiOperation({
    summary: '실시간 접속 현황',
    description:
      'GA4 실시간 리포트 — 최근 30분 활성 사용자와 분 단위 추이·페이지·기기별. ' +
      '기간을 고를 수 없다(GA4 실시간 창이 30분 고정). GA4 env 미배선이면 enabled=false 로 응답한다.',
  })
  getRealtime(@Query() query: RealtimeQueryDto): Promise<RealtimeTrafficResponseDto> {
    return this.realtimeQuery.getRealtime(query.limit ?? 10);
  }

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
