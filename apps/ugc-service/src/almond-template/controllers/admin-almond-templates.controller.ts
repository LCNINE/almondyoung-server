import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { User, RequirePermission } from '@app/authorization';
import { ALMOND_TEMPLATE_THUMBNAIL_HEADERS } from '../constants/almond-template.constants';
import {
  AdminAlmondTemplateDetailResponseDto,
  AdminAlmondTemplateSummaryResponseDto,
  AlmondTemplatePreviewImageResponseDto,
  UpdateAlmondTemplateStatusDto,
  UpsertAlmondTemplateDto,
} from '../dto/almond-template.dto';
import { LinkAlmondTemplateProductDto } from '../dto/link-almond-template-product.dto';
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
  @Put(':id/product')
  @ApiOperation({
    summary: '아몬드템플릿을 상품에 연결하고 게시',
    description: '행의 product_id 와 시안 JSON 의 productId 를 같이 바꾸고 published 로 만든다. 이미 같은 값이면 그대로 돌려준다',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: LinkAlmondTemplateProductDto })
  @ApiResponse({ status: 200, type: AdminAlmondTemplateSummaryResponseDto })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409 })
  linkProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkAlmondTemplateProductDto,
    @User('userId') userId: string,
  ): Promise<AdminAlmondTemplateSummaryResponseDto> {
    return this.service.linkProduct(id, dto.productId, userId);
  }

  @RequirePermission('marketing.almond_template.write')
  @Post(':id/preview-image')
  @ApiOperation({
    summary: '아몬드템플릿 미리보기 JPG 를 만들어 file-service 에 공개로 올린다',
    description: '인쇄 파일 업로드와 같은 클라이언트·같은 토큰으로 올리고 fileId 를 돌려준다',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 201, type: AlmondTemplatePreviewImageResponseDto })
  @ApiResponse({ status: 404 })
  async previewImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
  ): Promise<AlmondTemplatePreviewImageResponseDto> {
    const header = request.headers.authorization;
    const accessToken = header?.startsWith('Bearer ') ? header.slice(7) : request.cookies.accessToken;
    if (!accessToken) throw new UnauthorizedException();
    return { fileId: await this.service.uploadPreviewImage(id, accessToken) };
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
