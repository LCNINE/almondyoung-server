import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { FormExportService } from './services/form-export.service';
import { CreateFormExportDto, FormExportAcceptedDto, FormExportDownloadDto, FormExportStatusDto } from './dto';

@ApiTags('Product Bulk Form')
@Controller('product-forms')
export class FormExportController {
  constructor(private readonly service: FormExportService) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: '양식 생성 접수. 조립은 워커가 이어받는다.' })
  @ApiResponse({ status: 202, type: FormExportAcceptedDto })
  async create(@Body() dto: CreateFormExportDto, @User() user: { userId: string }): Promise<FormExportAcceptedDto> {
    return this.service.request(dto.masterIds, user.userId);
  }

  @Get(':exportId')
  @ApiOperation({ summary: '양식 생성 상태 조회(폴링 대상)' })
  @ApiResponse({ status: 200, type: FormExportStatusDto })
  async getStatus(@Param('exportId') exportId: string, @User() user: { userId: string }): Promise<FormExportStatusDto> {
    return this.service.getStatus(exportId, user.userId);
  }

  @Get(':exportId/download-url')
  @ApiOperation({ summary: '완성된 양식의 다운로드 URL' })
  @ApiResponse({ status: 200, type: FormExportDownloadDto })
  @ApiResponse({ status: 409, description: '아직 생성이 끝나지 않음 — 잠시 후 재시도' })
  async getDownloadUrl(
    @Param('exportId') exportId: string,
    @User() user: { userId: string },
  ): Promise<FormExportDownloadDto> {
    return { url: await this.service.getDownloadUrl(exportId, user.userId) };
  }
}
