import { BadRequestException, Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AdminRealmGuard, JwtAuthGuard } from '@app/authorization';
import { AdminKeywordStatisticsQueryDto, AdminKeywordStatisticsResponseDto } from './dto/admin-keyword-statistics.dto';
import {
  AdminKeywordDetailQueryDto,
  AdminKeywordDetailResponseDto,
  AdminZeroHitKeywordsQueryDto,
  AdminZeroHitKeywordsResponseDto,
  KeywordIssueDto,
  UpsertKeywordIssueDto,
} from './dto/admin-keyword-ops.dto';
import { SearchKeywordOpsService } from './search-keyword-ops.service';
import { SearchKeywordService } from './search-keyword.service';

/**
 * 관리자 검색 키워드 통계. admin-web 프록시를 통해서만 호출된다.
 *
 * JwtAuthGuard 뒤에 AdminRealmGuard — 모든 서비스가 AUTH_SECRET 을 공유하므로
 * 인증만으로는 고객 토큰도 통과한다. staff role(admin/master)을 강제한다
 * (notification/channel-adapter 와 같은 짝). AUTH_SECRET 또는 OIDC_ISSUER_URL
 * env 가 있어야 부팅된다 (AuthorizationModule 의 AUTH_CONFIG 팩토리).
 */
@UseGuards(JwtAuthGuard, AdminRealmGuard)
@Controller('search/admin/keywords')
export class AdminKeywordController {
  constructor(
    private readonly searchKeywordService: SearchKeywordService,
    private readonly searchKeywordOpsService: SearchKeywordOpsService,
  ) {}

  @Get('statistics')
  async getStatistics(@Query() query: AdminKeywordStatisticsQueryDto): Promise<AdminKeywordStatisticsResponseDto> {
    if (query.from > query.to) {
      throw new BadRequestException(`조회 기간이 뒤집혔습니다: ${query.from} > ${query.to}`);
    }
    return this.searchKeywordService.getKeywordStatistics(query.from, query.to, query.limit);
  }

  /** 0건 검색어 운영 목록 — "N일 지연" 방치 추적 + 색인 근거 + 담당·메모 */
  @Get('zero-hit')
  async getZeroHitKeywords(@Query() query: AdminZeroHitKeywordsQueryDto): Promise<AdminZeroHitKeywordsResponseDto> {
    if (query.from > query.to) {
      throw new BadRequestException(`조회 기간이 뒤집혔습니다: ${query.from} > ${query.to}`);
    }
    return this.searchKeywordOpsService.getZeroHitKeywords(
      query.from,
      query.to,
      query.page,
      query.limit,
      query.status,
    );
  }

  /** 특정 키워드 단건 드릴다운 — 검색수·0건수·일별 추이·전기간 비교 */
  @Get('detail')
  async getKeywordDetail(@Query() query: AdminKeywordDetailQueryDto): Promise<AdminKeywordDetailResponseDto> {
    if (query.from > query.to) {
      throw new BadRequestException(`조회 기간이 뒤집혔습니다: ${query.from} > ${query.to}`);
    }
    return this.searchKeywordOpsService.getKeywordDetail(query.keyword, query.from, query.to);
  }

  /** 키워드 운영 상태 upsert — 담당자 지정·메모·처리 상태 */
  @Patch('issues/:keywordNorm')
  async upsertIssue(
    @Param('keywordNorm') keywordNorm: string,
    @Body() body: UpsertKeywordIssueDto,
  ): Promise<KeywordIssueDto> {
    return this.searchKeywordOpsService.upsertIssue(keywordNorm, body);
  }
}
