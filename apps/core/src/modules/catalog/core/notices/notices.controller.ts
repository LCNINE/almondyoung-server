import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MasterRoleGuard, Public } from '@app/authorization';
import { NoticesService } from './notices.service';
import { CreateNoticeDto, NoticeResponseDto, UpdateNoticeDto } from './dto';

@ApiTags('Notices')
@Controller('notices')
export class NoticesController {
  constructor(private readonly noticesService: NoticesService) {}

  @Post()
  @UseGuards(MasterRoleGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '공지사항 생성 (관리자)', description: '새로운 공지사항을 등록합니다.' })
  @ApiBody({ type: CreateNoticeDto })
  @ApiResponse({ status: 201, description: '공지사항 생성 성공', type: NoticeResponseDto })
  async createNotice(@Body() dto: CreateNoticeDto): Promise<NoticeResponseDto> {
    return this.noticesService.createNotice(dto);
  }

  @Get()
  @UseGuards(MasterRoleGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '공지사항 목록 조회 (관리자)',
    description: '관리자용 목록 — 카테고리 필터링 가능, 비활성 포함 옵션.',
  })
  @ApiQuery({ name: 'category', required: false, description: '공지 분류' })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    type: Boolean,
    description: '비활성 공지 포함 여부 (기본: false)',
  })
  @ApiResponse({ status: 200, description: '공지사항 목록 조회 성공', type: [NoticeResponseDto] })
  async listNotices(
    @Query('category') category?: string,
    @Query('includeInactive') includeInactive?: boolean,
  ): Promise<NoticeResponseDto[]> {
    return this.noticesService.listNotices({ category, includeInactive: includeInactive === true });
  }

  @Public()
  @Get('public')
  @ApiOperation({
    summary: '공지사항 목록 조회 (스토어프론트)',
    description: '활성화된 공지 중 현재 게시기간 내인 것만 반환합니다. 인증 불필요.',
  })
  @ApiQuery({ name: 'category', required: false, description: '공지 분류' })
  @ApiResponse({ status: 200, description: '공지사항 목록 조회 성공', type: [NoticeResponseDto] })
  async listPublicNotices(@Query('category') category?: string): Promise<NoticeResponseDto[]> {
    return this.noticesService.listPublicNotices(category);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: '공지사항 상세 조회', description: 'ID로 공지사항을 조회합니다.' })
  @ApiParam({ name: 'id', description: '공지사항 ID' })
  @ApiResponse({ status: 200, description: '공지사항 조회 성공', type: NoticeResponseDto })
  @ApiResponse({ status: 404, description: '공지사항을 찾을 수 없음' })
  async getNoticeById(@Param('id') id: string): Promise<NoticeResponseDto> {
    return this.noticesService.getNoticeById(id);
  }

  @Put(':id')
  @UseGuards(MasterRoleGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '공지사항 수정 (관리자)', description: '공지사항 정보를 수정합니다.' })
  @ApiParam({ name: 'id', description: '공지사항 ID' })
  @ApiBody({ type: UpdateNoticeDto })
  @ApiResponse({ status: 200, description: '공지사항 수정 성공', type: NoticeResponseDto })
  @ApiResponse({ status: 404, description: '공지사항을 찾을 수 없음' })
  async updateNotice(@Param('id') id: string, @Body() dto: UpdateNoticeDto): Promise<NoticeResponseDto> {
    return this.noticesService.updateNotice(id, dto);
  }

  @Delete(':id')
  @UseGuards(MasterRoleGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '공지사항 삭제 (관리자, Soft Delete)', description: '공지사항을 soft delete 합니다.' })
  @ApiParam({ name: 'id', description: '공지사항 ID' })
  @ApiQuery({ name: 'deletedBy', required: false, description: '삭제자 ID' })
  @ApiResponse({ status: 200, description: '공지사항 삭제 성공' })
  @ApiResponse({ status: 404, description: '공지사항을 찾을 수 없음' })
  async deleteNotice(@Param('id') id: string, @Query('deletedBy') deletedBy?: string): Promise<{ message: string }> {
    await this.noticesService.deleteNotice(id, deletedBy);
    return { message: 'Notice deleted successfully' };
  }
}
