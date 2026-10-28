import { RequirePermission } from '@app/authorization';
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

@ApiTags('Admin/IAM pii access log')
@ApiBearerAuth('access-token')
@Controller('admin/iam')
export class PiiAccessLogController {
  constructor(private readonly service: PiiAccessService) {}

  @ApiOperation({ summary: '개인정보 접속기록(최신순, 커서 페이지) — 조회도 변경 이력에 남는다' })
  @RequirePermission('iam.pii_access_log.read')
  @Get('pii-access-logs')
  page(@CurrentIamActor() actor: IamActor, @Query() query: PiiAccessLogsQueryDto): Promise<PiiAccessPageDto> {
    return this.service.page(actor, query);
  }

  @ApiOperation({ summary: '기간 안 행위자별 접속 건수·업무시간 외 건수' })
  @RequirePermission('iam.pii_access_log.read')
  @Get('pii-access-logs/summary')
  summary(@Query() query: PiiAccessSummaryQueryDto): Promise<PiiAccessSummaryDto> {
    return this.service.summary(query);
  }

  @ApiOperation({ summary: '접속기록 점검 기록' })
  @RequirePermission('iam.pii_access_log.read')
  @Get('pii-access-reviews')
  reviews(): Promise<PiiAccessReviewDto[]> {
    return this.service.reviews();
  }

  @ApiOperation({ summary: '접속기록 점검 완료 남기기' })
  @RequirePermission('iam.pii_access_log.read')
  @Post('pii-access-reviews')
  createReview(@CurrentIamActor() actor: IamActor, @Body() dto: CreatePiiAccessReviewDto): Promise<PiiAccessReviewDto> {
    return this.service.createReview(actor, dto);
  }
}
