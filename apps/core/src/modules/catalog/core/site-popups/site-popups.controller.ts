import { Public, RolesGuard, User } from '@app/authorization';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateSitePopupDto, SitePopupListQueryDto, SitePopupResponseDto, UpdateSitePopupDto } from './dto';
import { SitePopupsService } from './site-popups.service';
import { SITE_POPUP_VIEWER_TYPES, SitePopupViewerType } from './site-popup.constants';

@ApiTags('Site Popups')
@Controller('site-popups')
export class SitePopupsController {
  constructor(private readonly sitePopupsService: SitePopupsService) {}

  @Post()
  @UseGuards(RolesGuard('master', 'admin'))
  @ApiBearerAuth()
  @ApiOperation({ summary: '팝업 공지 생성 (관리자)' })
  @ApiBody({ type: CreateSitePopupDto })
  @ApiResponse({ status: 201, type: SitePopupResponseDto })
  async create(
    @Body() dto: CreateSitePopupDto,
    @User() user: { userId: string },
  ): Promise<SitePopupResponseDto> {
    return this.sitePopupsService.create(dto, user?.userId);
  }

  @Get()
  @UseGuards(RolesGuard('master', 'admin'))
  @ApiBearerAuth()
  @ApiOperation({ summary: '팝업 공지 목록 조회 (관리자)' })
  @ApiResponse({ status: 200, type: [SitePopupResponseDto] })
  async list(@Query() query: SitePopupListQueryDto): Promise<SitePopupResponseDto[]> {
    return this.sitePopupsService.list(query);
  }

  @Public()
  @Get('public')
  @ApiOperation({
    summary: '팝업 공지 목록 조회 (스토어프론트)',
    description:
      '활성 + 게시기간 내이면서 방문자 구분에 맞는 팝업만 반환합니다. 경로 매칭과 "다시 보지 않기" 는 클라이언트가 처리합니다.',
  })
  @ApiQuery({ name: 'viewer', required: false, enum: SITE_POPUP_VIEWER_TYPES, description: '방문자 구분 (기본 guest)' })
  @ApiResponse({ status: 200, type: [SitePopupResponseDto] })
  async listPublic(@Query('viewer') viewer?: string): Promise<SitePopupResponseDto[]> {
    const resolved: SitePopupViewerType = SITE_POPUP_VIEWER_TYPES.includes(viewer as SitePopupViewerType)
      ? (viewer as SitePopupViewerType)
      : 'guest';

    return this.sitePopupsService.listPublic(resolved);
  }

  @Get(':id')
  @UseGuards(RolesGuard('master', 'admin'))
  @ApiBearerAuth()
  @ApiOperation({ summary: '팝업 공지 상세 조회 (관리자)' })
  @ApiParam({ name: 'id', description: '팝업 ID' })
  @ApiResponse({ status: 200, type: SitePopupResponseDto })
  @ApiResponse({ status: 404, description: '팝업을 찾을 수 없음' })
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<SitePopupResponseDto> {
    return this.sitePopupsService.getById(id);
  }

  @Put(':id')
  @UseGuards(RolesGuard('master', 'admin'))
  @ApiBearerAuth()
  @ApiOperation({ summary: '팝업 공지 수정 (관리자)' })
  @ApiParam({ name: 'id', description: '팝업 ID' })
  @ApiBody({ type: UpdateSitePopupDto })
  @ApiResponse({ status: 200, type: SitePopupResponseDto })
  @ApiResponse({ status: 404, description: '팝업을 찾을 수 없음' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSitePopupDto,
    @User() user: { userId: string },
  ): Promise<SitePopupResponseDto> {
    return this.sitePopupsService.update(id, dto, user?.userId);
  }

  @Post(':id/reset-dismissals')
  @UseGuards(RolesGuard('master', 'admin'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: '팝업 숨김 초기화 (관리자)',
    description: '"다시 보지 않기" 를 누른 방문자에게도 팝업을 다시 노출합니다.',
  })
  @ApiParam({ name: 'id', description: '팝업 ID' })
  @ApiResponse({ status: 200, type: SitePopupResponseDto })
  async resetDismissals(
    @Param('id', ParseUUIDPipe) id: string,
    @User() user: { userId: string },
  ): Promise<SitePopupResponseDto> {
    return this.sitePopupsService.resetDismissals(id, user?.userId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard('master', 'admin'))
  @ApiBearerAuth()
  @ApiOperation({ summary: '팝업 공지 삭제 (관리자, Soft Delete)' })
  @ApiParam({ name: 'id', description: '팝업 ID' })
  @ApiResponse({ status: 200, description: '삭제 성공' })
  @ApiResponse({ status: 404, description: '팝업을 찾을 수 없음' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @User() user: { userId: string },
  ): Promise<{ message: string }> {
    await this.sitePopupsService.remove(id, user?.userId);
    return { message: 'Site popup deleted successfully' };
  }
}
