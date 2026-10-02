import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Public } from '@app/authorization';
import { ALMOND_TEMPLATE_THUMBNAIL_HEADERS } from '../constants/almond-template.constants';
import { AlmondTemplateDetailResponseDto, AlmondTemplateSummaryResponseDto } from '../dto/almond-template.dto';
import { AlmondTemplatesService } from '../services/almond-templates.service';

const THUMBNAIL_HEADERS = {
  ...ALMOND_TEMPLATE_THUMBNAIL_HEADERS,
  'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
};

@ApiTags('Almond Templates (public)')
@Controller('almond-templates')
export class PublicAlmondTemplatesController {
  constructor(private readonly service: AlmondTemplatesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: '게시된 아몬드템플릿 목록', description: 'design·썸네일 본문은 빠진다. 최근 수정순' })
  @ApiResponse({ status: 200, type: [AlmondTemplateSummaryResponseDto] })
  list(): Promise<AlmondTemplateSummaryResponseDto[]> {
    return this.service.listPublished();
  }

  @Public()
  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '게시된 아몬드템플릿 상세 (design 포함)' })
  @ApiResponse({ status: 200, type: AlmondTemplateDetailResponseDto })
  @ApiResponse({ status: 404 })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AlmondTemplateDetailResponseDto> {
    return this.service.getPublished(id);
  }

  @Public()
  @Get(':id/thumbnail.svg')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '게시된 아몬드템플릿 썸네일 SVG' })
  @ApiProduces('image/svg+xml')
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async thumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const svg = await this.service.getPublishedThumbnail(id);
    reply.headers(THUMBNAIL_HEADERS);
    return svg;
  }
}
