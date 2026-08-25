import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@app/authorization';
import { StatisticsQuery } from '../read-model/statistics.query';
import { ProductStatisticsQueryDto, StatisticsRangeQueryDto, UnsoldProductsQueryDto } from './statistics-query.dto';

/**
 * 관리자 통계 조회 API. admin-web 프록시를 통해서만 호출된다.
 *
 * 가드는 JwtAuthGuard — membership 관리자 라우트와 같은 수준이다. 스코프 부여(#551 방식)는
 * analytics 전반의 스코프 도입과 함께 별도로 다룬다.
 */
@ApiTags('Statistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statisticsQuery: StatisticsQuery) {}

  @Get('sales')
  @ApiOperation({
    summary: '매출 개요',
    description:
      'agg_channel_daily 기반 기간 KPI(순매출·주문수·객단가·취소환불률)와 시계열·채널 비중. 취소는 취소일에 귀속되므로 일별 순매출이 음수일 수 있다.',
  })
  getSales(@Query() query: StatisticsRangeQueryDto) {
    return this.statisticsQuery.getSales(query.from, query.to, query.channel, query.granularity);
  }

  @Get('products')
  @ApiOperation({
    summary: '상품 통계',
    description: '상품 랭킹(순매출·직전 기간 대비), primary 카테고리 구성, 옵션별 판매(총매출만).',
  })
  getProducts(@Query() query: ProductStatisticsQueryDto) {
    return this.statisticsQuery.getProducts(query.from, query.to, query.channel, query.sort, query.limit, query.order);
  }

  @Get('products/unsold')
  @ApiOperation({
    summary: '기간 내 무판매 활성 상품',
    description:
      '기간 내 판매가 0건이라 랭킹에 아예 나오지 않는 활성 상품 목록. 마지막 판매일이 오래된(없는) 순.',
  })
  getUnsoldProducts(@Query() query: UnsoldProductsQueryDto) {
    return this.statisticsQuery.getUnsoldProducts(query.from, query.to, query.channel, query.limit);
  }

  @Get('customers')
  @ApiOperation({
    summary: '고객·멤버십 통계',
    description:
      '재구매율·생애 구매액(전 기간 누적), 기간 내 신규 고객 추이, 멤버십 회원 수 스냅샷, 해지 사유, 등급별 매출(시점 조인).',
  })
  getCustomers(@Query() query: StatisticsRangeQueryDto) {
    return this.statisticsQuery.getCustomers(query.from, query.to, query.granularity);
  }
}
