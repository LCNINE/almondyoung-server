import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Put, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequireScopes, User } from '@app/authorization';
import { ALMOND_TEMPLATE_THUMBNAIL_HEADERS } from '../constants/almond-template.constants';
import {
  AdminAlmondTemplateDetailResponseDto,
  AdminAlmondTemplateSummaryResponseDto,
  UpdateAlmondTemplateStatusDto,
  UpsertAlmondTemplateDto,
} from '../dto/almond-template.dto';
import { AlmondTemplatesService } from '../services/almond-templates.service';

const THUMBNAIL_HEADERS = {
  ...ALMOND_TEMPLATE_THUMBNAIL_HEADERS,
  'cache-control': 'private, no-store',
};

@ApiTags('Almond Templates (admin)')
@ApiBearerAuth()
@Controller('admin/almond-templates')
export class AdminAlmondTemplatesController {
  constructor(private readonly service: AlmondTemplatesService) {}

  @Get()
  @RequireScopes('admin:template:write')
  @ApiOperation({ summary: '아몬드템플릿 전체 목록 (draft 포함)' })
  @ApiResponse({ status: 200, type: [AdminAlmondTemplateSummaryResponseDto] })
  list(): Promise<AdminAlmondTemplateSummaryResponseDto[]> {
    return this.service.listForAdmin();
  }

  @Get(':id')
  @RequireScopes('admin:template:write')
  @ApiOperation({ summary: '아몬드템플릿 상세 (상태 무관)' })
  @ApiResponse({ status: 200, type: AdminAlmondTemplateDetailResponseDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminAlmondTemplateDetailResponseDto> {
    return this.service.getForAdmin(id);
  }

  @Get(':id/thumbnail.svg')
  @RequireScopes('admin:template:write')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '아몬드템플릿 썸네일 SVG (상태 무관)' })
  @ApiProduces('image/svg+xml')
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async thumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const svg = await this.service.getThumbnailForAdmin(id);
    reply.headers(THUMBNAIL_HEADERS);
    return svg;
  }

  @Put()
  @RequireScopes('admin:template:write')
  @ApiOperation({
    summary: '아몬드템플릿 저장',
    description: '같은 상품·크기·이름이 있으면 갱신한다. 본문 상한은 이 라우트만 20MB',
  })
  @ApiBody({ type: UpsertAlmondTemplateDto })
  @ApiResponse({ status: 200, type: AdminAlmondTemplateDetailResponseDto })
  @ApiResponse({ status: 400 })
  upsert(
    @Body() dto: UpsertAlmondTemplateDto,
    @User('userId') userId: string,
  ): Promise<AdminAlmondTemplateDetailResponseDto> {
    return this.service.upsert(dto, userId);
  }

  @Patch(':id/status')
  @RequireScopes('admin:template:write')
  @ApiOperation({ summary: '아몬드템플릿 게시 상태 변경 (draft ↔ published)' })
  @ApiBody({ type: UpdateAlmondTemplateStatusDto })
  @ApiResponse({ status: 200, type: AdminAlmondTemplateSummaryResponseDto })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAlmondTemplateStatusDto,
  ): Promise<AdminAlmondTemplateSummaryResponseDto> {
    return this.service.updateStatus(id, dto.status);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireScopes('admin:template:write')
  @ApiOperation({ summary: '아몬드템플릿 삭제' })
  @ApiResponse({ status: 204 })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.service.remove(id);
  }
}
