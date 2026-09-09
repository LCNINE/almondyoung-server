import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScopes, User } from '@app/authorization';
import { ReviewRewardRuleService } from './review-reward-rule.service';
import { ReviewRewardGrantService } from './review-reward-grant.service';
import { ReviewBestSelectionService } from './review-best-selection.service';
import { toUpsertRuleInput } from './reward-rule.mapper';
import {
  BestSelectionListQueryDto,
  RewardGrantListQueryDto,
  SetRuleActiveDto,
  UpsertRewardRuleDto,
} from './dto/reward-rule.dto';
import { ReviewRewardTrigger } from './reward-rule.types';

/**
 * 리뷰 보상 정책의 관리자 표면. 규칙을 만들고 켜고 끄는 것, 지급 내역을 보는 것,
 * 주간 베스트를 확정하는 것까지가 여기 있다.
 */
@ApiTags('Reviews')
@Controller('reviews/admin/rewards')
export class AdminRewardController {
  constructor(
    private readonly ruleService: ReviewRewardRuleService,
    private readonly grantService: ReviewRewardGrantService,
    private readonly bestSelectionService: ReviewBestSelectionService,
  ) {}

  @Get('rules')
  @RequireScopes('admin:ugc:read')
  @ApiOperation({ summary: '리뷰 보상 규칙 목록' })
  async listRules(@Query('trigger') trigger?: ReviewRewardTrigger) {
    return this.ruleService.list(trigger ? { trigger } : undefined);
  }

  @Get('rules/:id')
  @RequireScopes('admin:ugc:read')
  @ApiOperation({ summary: '리뷰 보상 규칙 상세' })
  async getRule(@Param('id', ParseUUIDPipe) id: string) {
    return this.ruleService.getById(id);
  }

  @Post('rules')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '리뷰 보상 규칙 생성' })
  async createRule(@Body() dto: UpsertRewardRuleDto, @User('userId') adminUserId: string) {
    return this.ruleService.create(toUpsertRuleInput(dto), adminUserId);
  }

  @Put('rules/:id')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '리뷰 보상 규칙 수정' })
  async updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertRewardRuleDto,
    @User('userId') adminUserId: string,
  ) {
    return this.ruleService.update(id, toUpsertRuleInput(dto), adminUserId);
  }

  @Patch('rules/:id/active')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '리뷰 보상 규칙 활성/비활성' })
  async setRuleActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRuleActiveDto,
    @User('userId') adminUserId: string,
  ) {
    return this.ruleService.setActive(id, dto.active, adminUserId);
  }

  @Delete('rules/:id')
  @RequireScopes('admin:ugc:modify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '리뷰 보상 규칙 삭제' })
  async removeRule(@Param('id', ParseUUIDPipe) id: string) {
    await this.ruleService.remove(id);
  }

  @Get('grants')
  @RequireScopes('admin:ugc:read')
  @ApiOperation({ summary: '리뷰 보상 지급 내역 (미지급 사유 포함)' })
  async listGrants(@Query() query: RewardGrantListQueryDto) {
    return this.grantService.list({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      status: query.status,
      userId: query.userId,
    });
  }

  @Get('summary')
  @RequireScopes('admin:ugc:read')
  @ApiOperation({ summary: '기간 지급 요약 — 총액·건수와 미지급 사유 분포' })
  async summary(@Query('days') days?: string) {
    const windowDays = Math.min(Math.max(Number(days) || 30, 1), 365);
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    return this.grantService.summarize(since);
  }

  @Get('best-selections')
  @RequireScopes('admin:ugc:read')
  @ApiOperation({ summary: '주간 베스트 리뷰 후보·확정 목록' })
  async listBestSelections(@Query() query: BestSelectionListQueryDto) {
    return this.bestSelectionService.list({
      status: query.status,
      periodStart: query.periodStart ? new Date(query.periodStart) : undefined,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
  }

  @Post('best-selections/generate')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '주간 베스트 후보 즉시 집계 (크론과 같은 일을 수동으로)' })
  async generateBestSelections() {
    return this.bestSelectionService.generateCandidates();
  }

  @Post('best-selections/:id/confirm')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '주간 베스트 확정 — 이때 지급이 나간다' })
  async confirmBestSelection(@Param('id', ParseUUIDPipe) id: string, @User('userId') adminUserId: string) {
    return this.bestSelectionService.confirm(id, adminUserId);
  }

  @Post('best-selections/:id/reject')
  @RequireScopes('admin:ugc:modify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '주간 베스트 후보 제외' })
  async rejectBestSelection(@Param('id', ParseUUIDPipe) id: string, @User('userId') adminUserId: string) {
    await this.bestSelectionService.reject(id, adminUserId);
  }
}
