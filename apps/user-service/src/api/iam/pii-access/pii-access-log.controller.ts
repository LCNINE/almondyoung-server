import { RequirePermission, RequireScopes } from '@app/authorization';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentIamActor, type IamActor } from '../iam-actor';
import {
  CreatePiiAccessReviewDto,
  PiiAccessLogsQueryDto,
  PiiAccessPageDto,
  PiiAccessReviewDto,
  PiiAccessSummaryDto,
  PiiAccessSummaryQueryDto,
} from './dto/pii-access.dto';
import { PiiAccessService } from './pii-access.service';

// 옛 표식: 이 권한은 첫 부여가 없다(= master 만) — 옛 가드에서도 master 만 통과하게 맞춘다.
@ApiTags('Admin/IAM pii access log')
@ApiBearerAuth('access-token')
@Controller('admin/iam')
export class PiiAccessLogController {
  constructor(private readonly service: PiiAccessService) {}

  @ApiOperation({ summary: '개인정보 접속기록(최신순, 커서 페이지) — 조회도 변경 이력에 남는다' })
  @RequirePermission('iam.pii_access_log.read')
  @Get('pii-access-logs')
  @RequireScopes('master')
  page(@CurrentIamActor() actor: IamActor, @Query() query: PiiAccessLogsQueryDto): Promise<PiiAccessPageDto> {
    return this.service.page(actor, query);
  }

  @ApiOperation({ summary: '기간 안 행위자별 접속 건수·업무시간 외 건수' })
  @RequirePermission('iam.pii_access_log.read')
  @Get('pii-access-logs/summary')
  @RequireScopes('master')
  summary(@Query() query: PiiAccessSummaryQueryDto): Promise<PiiAccessSummaryDto> {
    return this.service.summary(query);
  }

  @ApiOperation({ summary: '접속기록 점검 기록' })
  @RequirePermission('iam.pii_access_log.read')
  @Get('pii-access-reviews')
  @RequireScopes('master')
  reviews(): Promise<PiiAccessReviewDto[]> {
    return this.service.reviews();
  }

  @ApiOperation({ summary: '접속기록 점검 완료 남기기' })
  @RequirePermission('iam.pii_access_log.read')
  @Post('pii-access-reviews')
  @RequireScopes('master')
  createReview(@CurrentIamActor() actor: IamActor, @Body() dto: CreatePiiAccessReviewDto): Promise<PiiAccessReviewDto> {
    return this.service.createReview(actor, dto);
  }
}
