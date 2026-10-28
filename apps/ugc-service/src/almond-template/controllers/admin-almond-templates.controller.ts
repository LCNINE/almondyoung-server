import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Put, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { User, RequirePermission } from '@app/authorization';
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

  @RequirePermission('marketing.almond_template.read')
  @Get()
  @ApiOperation({ summary: '아몬드템플릿 전체 목록 (draft 포함)' })
  @ApiResponse({ status: 200, type: [AdminAlmondTemplateSummaryResponseDto] })
  list(): Promise<AdminAlmondTemplateSummaryResponseDto[]> {
    return this.service.listForAdmin();
  }

  @RequirePermission('marketing.almond_template.read')
  @Get(':id')
  @ApiOperation({ summary: '아몬드템플릿 상세 (상태 무관)' })
  @ApiResponse({ status: 200, type: AdminAlmondTemplateDetailResponseDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminAlmondTemplateDetailResponseDto> {
    return this.service.getForAdmin(id);
  }

  @RequirePermission('marketing.almond_template.read')
  @Get(':id/thumbnail.svg')
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

  @RequirePermission('marketing.almond_template.write')
  @Put()
  @ApiOperation({
    summary: '아몬드템플릿 저장',
    description:
      'id 가 있으면 그 시안을 갱신하고 없으면 새로 만든다. 같은 상품·크기·이름이 이미 있으면 409. 본문 상한은 이 라우트만 20MB',
  })
  @ApiBody({ type: UpsertAlmondTemplateDto })
  @ApiResponse({ status: 200, type: AdminAlmondTemplateDetailResponseDto })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409 })
  upsert(
    @Body() dto: UpsertAlmondTemplateDto,
    @User('userId') userId: string,
  ): Promise<AdminAlmondTemplateDetailResponseDto> {
    return this.service.upsert(dto, userId);
  }

  @RequirePermission('marketing.almond_template.write')
  @Patch(':id/status')
  @ApiOperation({ summary: '아몬드템플릿 게시 상태 변경 (draft ↔ published)' })
  @ApiBody({ type: UpdateAlmondTemplateStatusDto })
  @ApiResponse({ status: 200, type: AdminAlmondTemplateSummaryResponseDto })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAlmondTemplateStatusDto,
    @User('userId') userId: string,
  ): Promise<AdminAlmondTemplateSummaryResponseDto> {
    return this.service.updateStatus(id, dto.status, userId);
  }

  @RequirePermission('marketing.almond_template.write')
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '아몬드템플릿 삭제' })
  @ApiResponse({ status: 204 })
  async remove(@Param('id', ParseUUIDPipe) id: string, @User('userId') userId: string): Promise<void> {
    await this.service.remove(id, userId);
  }
}
