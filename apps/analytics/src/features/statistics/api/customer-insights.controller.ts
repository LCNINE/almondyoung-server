import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, RequirePermission, PermissionGuard } from '@app/authorization';
import { CustomerInsights, CustomerInsightsQuery } from '../read-model/customer-insights.query';
import { CustomerInsightsQueryDto } from './statistics-query.dto';

/**
 * 구매 기반 고객 분석. admin-web 프록시를 통해서만 호출된다.
 *
 * 판정은 JwtAuthGuard 뒤의 PermissionGuard 가 라우트의 권한 키로 한다.
 */
@ApiTags('Statistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('statistics')
export class CustomerInsightsController {
  constructor(private readonly customerInsightsQuery: CustomerInsightsQuery) {}

  @RequirePermission('analytics.report.read')
  @Get('customers/insights')
  @ApiOperation({
    summary: '구매 기반 고객 분석',
    description:
      '코호트 리텐션(to 기준 최근 12개월 첫구매), RFM 분포·세그먼트(전 고객), 상품별 재구매(전 기간 누적), 기간 내 멤버십 등급 전환.',
  })
  getInsights(@Query() query: CustomerInsightsQueryDto): Promise<CustomerInsights> {
    return this.customerInsightsQuery.getInsights(query.from, query.to, query.limit, query.minBuyers, query.page);
  }
}
