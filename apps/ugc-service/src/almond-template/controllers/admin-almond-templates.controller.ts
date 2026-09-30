import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, User } from '@app/authorization';
import {
  AdminAlmondTemplateDetailResponseDto,
  AdminAlmondTemplateSummaryResponseDto,
  UpdateAlmondTemplateStatusDto,
  UpsertAlmondTemplateDto,
} from '../dto/almond-template.dto';
import { AlmondTemplatesService } from '../services/almond-templates.service';

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
