import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@app/authorization';
import { AdminKeywordStatisticsQueryDto, AdminKeywordStatisticsResponseDto } from './dto/admin-keyword-statistics.dto';
import { SearchKeywordService } from './search-keyword.service';

/**
 * 관리자 검색 키워드 통계. admin-web 프록시를 통해서만 호출된다.
 *
 * 가드는 JwtAuthGuard — analytics 통계 라우트와 같은 수준. AUTH_SECRET 또는
 * OIDC_ISSUER_URL env 가 있어야 부팅된다 (AuthorizationModule 의 AUTH_CONFIG 팩토리).
 */
@UseGuards(JwtAuthGuard)
@Controller('search/admin/keywords')
export class AdminKeywordController {
  constructor(private readonly searchKeywordService: SearchKeywordService) {}

  @Get('statistics')
  async getStatistics(@Query() query: AdminKeywordStatisticsQueryDto): Promise<AdminKeywordStatisticsResponseDto> {
    if (query.from > query.to) {
      throw new BadRequestException(`조회 기간이 뒤집혔습니다: ${query.from} > ${query.to}`);
    }
    return this.searchKeywordService.getKeywordStatistics(query.from, query.to, query.limit);
  }
}
