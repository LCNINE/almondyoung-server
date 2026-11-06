import { Public, User, RequirePermission } from '@app/authorization';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CreateTopNoticeDto,
  TopNoticeListQueryDto,
  TopNoticePublicDto,
  TopNoticeResponseDto,
  UpdateTopNoticeDto,
} from './dto';
import { TopNoticesService } from './top-notices.service';

@ApiTags('Top Notices')
@Controller('top-notices')
export class TopNoticesController {
  constructor(private readonly topNoticesService: TopNoticesService) {}

  @RequirePermission('marketing.display.write')
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: '상단 공지 띠 생성 (관리자)' })
  @ApiBody({ type: CreateTopNoticeDto })
  @ApiResponse({ status: 201, type: TopNoticeResponseDto })
  async create(@Body() dto: CreateTopNoticeDto, @User() user: { userId: string }): Promise<TopNoticeResponseDto> {
    return this.topNoticesService.create(dto, user?.userId);
  }

  @RequirePermission('marketing.display.read')
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: '상단 공지 띠 목록 조회 (관리자)' })
  @ApiResponse({ status: 200, type: [TopNoticeResponseDto] })
  async list(@Query() query: TopNoticeListQueryDto): Promise<TopNoticeResponseDto[]> {
    return this.topNoticesService.list(query);
  }

  @Public()
  @Get('public')
  @ApiOperation({
    summary: '상단 공지 띠 목록 조회 (스토어프론트)',
    description: '활성 + 게시기간 내 띠를 정렬 순서대로 반환합니다. 모든 방문자에게 같은 띠가 보입니다.',
  })
  @ApiResponse({ status: 200, type: [TopNoticePublicDto] })
  async listPublic(): Promise<TopNoticePublicDto[]> {
    return this.topNoticesService.listPublic();
  }

  @RequirePermission('marketing.display.read')
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '상단 공지 띠 상세 조회 (관리자)' })
  @ApiParam({ name: 'id', description: '띠 ID' })
  @ApiResponse({ status: 200, type: TopNoticeResponseDto })
  @ApiResponse({ status: 404, description: '띠를 찾을 수 없음' })
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<TopNoticeResponseDto> {
    return this.topNoticesService.getById(id);
  }

  @RequirePermission('marketing.display.write')
  @Put(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '상단 공지 띠 수정 (관리자)' })
  @ApiParam({ name: 'id', description: '띠 ID' })
  @ApiBody({ type: UpdateTopNoticeDto })
  @ApiResponse({ status: 200, type: TopNoticeResponseDto })
  @ApiResponse({ status: 404, description: '띠를 찾을 수 없음' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTopNoticeDto,
    @User() user: { userId: string },
  ): Promise<TopNoticeResponseDto> {
    return this.topNoticesService.update(id, dto, user?.userId);
  }

  @RequirePermission('marketing.display.write')
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '상단 공지 띠 삭제 (관리자, Soft Delete)' })
  @ApiParam({ name: 'id', description: '띠 ID' })
  @ApiResponse({ status: 200, description: '삭제 성공' })
  @ApiResponse({ status: 404, description: '띠를 찾을 수 없음' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @User() user: { userId: string }): Promise<{ message: string }> {
    await this.topNoticesService.remove(id, user?.userId);

    return { message: 'Top notice deleted successfully' };
  }
}
