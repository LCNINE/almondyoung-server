import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRealmGuard, JwtAuthGuard } from '@app/authorization';
import { ProfitQuery, ProfitStatistics } from '../read-model/profit.query';
import { ProfitStatisticsQueryDto } from './statistics-query.dto';

/**
 * 이익(수익성) 통계. admin-web 프록시를 통해서만 호출된다.
 * 신설 라우트 관례대로 AdminRealmGuard 로 staff 를 강제한다.
 */
@ApiTags('Statistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminRealmGuard)
@Controller('statistics')
export class ProfitController {
  constructor(private readonly profitQuery: ProfitQuery) {}

  @Get('profit')
  @ApiOperation({
    summary: '이익(수익성) 통계',
    description:
      '기간 내 상품별 순매출·추정 원가·마진과 전사 요약. 원가는 게시 시점 공급가 × 판매수량을 ' +
      '순매출 비율로 보정한 근사치이며, 원가 미입력 상품은 마진을 계산하지 않고 별도 몫으로 내려준다. ' +
      '상품 목록은 페이지네이션 전체 조회.',
  })
  getProfit(@Query() query: ProfitStatisticsQueryDto): Promise<ProfitStatistics> {
    return this.profitQuery.getProfit(
      query.from,
      query.to,
      query.channel,
      query.sort,
      query.order,
      query.page,
      query.limit,
    );
  }
}
