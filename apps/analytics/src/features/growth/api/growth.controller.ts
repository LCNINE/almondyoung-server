import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRealmGuard, JwtAuthGuard } from '@app/authorization';
import { toSeoulDateOnly } from '../../../shared/date.util';
import { daysBetweenInclusive } from '../domain/period';
import { CustomerFlowQuery } from '../read-model/customer-flow.query';
import { GrowthSummaryQuery } from '../read-model/growth-summary.query';
import { GrowthTrafficQuery } from '../read-model/growth-traffic.query';
import { RevenueAxisQuery } from '../read-model/revenue-axis.query';
import { GrowthRangeQueryDto } from './growth-query.dto';

/** 한 번에 볼 수 있는 최대 일수. 1년 + 윤일 여유. GA4 일별 행·코호트 스캔의 상한이 된다. */
const MAX_RANGE_DAYS = 400;

/**
 * 성장 3축(유입·전환·재구매) + 연간 목표. 관리자 전용 읽기 라우트이고 Medusa 를 부르지 않는다 —
 * 원천은 analytics 집계 표·사실 표(읽기만)와 GA4 Data API(캐시) 뿐이다.
 */
@ApiTags('Statistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminRealmGuard)
@Controller('statistics')
export class GrowthController {
  constructor(
    private readonly revenue: RevenueAxisQuery,
    private readonly customers: CustomerFlowQuery,
    private readonly traffic: GrowthTrafficQuery,
    private readonly summary: GrowthSummaryQuery,
  ) {}

  @Get('growth')
  @ApiOperation({
    summary: '성장 분석 — 기간의 매출 축·고객 축·GA4 축',
    description:
      '자사몰 주문·순매출(집계 표), 회원 재구매·성장 회계·N일 재구매 코호트(사실 표), 세션·채널·기기·퍼널(GA4). ' +
      'GA4 가 꺼져 있거나 실패하면 ga4.status 로 알리고 나머지는 그대로 응답한다.',
  })
  async getGrowth(@Query() query: GrowthRangeQueryDto) {
    if (query.from > query.to) {
      throw new BadRequestException(`조회 기간이 뒤집혔습니다: ${query.from} > ${query.to}`);
    }
    if (daysBetweenInclusive(query.from, query.to) > MAX_RANGE_DAYS) {
      throw new BadRequestException(`조회 기간은 최대 ${MAX_RANGE_DAYS}일입니다`);
    }
    const granularity = query.granularity ?? 'day';
    const today = toSeoulDateOnly(new Date());
    const [revenue, customers, ga4] = await Promise.all([
      this.revenue.getAxis(query.from, query.to, granularity),
      this.customers.getFlow(query.from, query.to, granularity, today),
      this.traffic.getTraffic(query.from, query.to, granularity),
    ]);
    return { range: { from: query.from, to: query.to }, granularity, today, revenue, customers, ga4 };
  }

  @Get('growth/summary')
  @ApiOperation({
    summary: '성장 요약 — 관리자 메인 «올해 목표» 카드·성장 탭 머리',
    description: '올해 목표, 올해 일별 순매출, 최근 8주 일별 매출·세션, 최근 28일 고객 흐름. 서버에서 60초 재사용한다.',
  })
  getSummary() {
    return this.summary.get();
  }
}
