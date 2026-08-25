import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRealmGuard, JwtAuthGuard } from '@app/authorization';
import { CustomerInsights, CustomerInsightsQuery } from '../read-model/customer-insights.query';
import { CustomerInsightsQueryDto } from './statistics-query.dto';

/**
 * 구매 기반 고객 분석. admin-web 프록시를 통해서만 호출된다.
 *
 * 기존 StatisticsController(JwtAuthGuard만)와 달리 AdminRealmGuard 를 함께 건다 —
 * 신설 라우트부터 staff role 강제가 기본값이다. 기존 라우트 소급은 별도 작업.
 */
@ApiTags('Statistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminRealmGuard)
@Controller('statistics')
export class CustomerInsightsController {
  constructor(private readonly customerInsightsQuery: CustomerInsightsQuery) {}

  @Get('customers/insights')
  @ApiOperation({
    summary: '구매 기반 고객 분석',
    description:
      '코호트 리텐션(to 기준 최근 12개월 첫구매), RFM 분포·세그먼트(전 고객), 상품별 재구매(전 기간 누적), 기간 내 멤버십 등급 전환.',
  })
  getInsights(@Query() query: CustomerInsightsQueryDto): Promise<CustomerInsights> {
    return this.customerInsightsQuery.getInsights(query.from, query.to, query.limit, query.minBuyers);
  }
}
