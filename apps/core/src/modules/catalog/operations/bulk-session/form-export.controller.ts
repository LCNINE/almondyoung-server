import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RolesGuard, User } from '@app/authorization';
import { FormExportService } from './services/form-export.service';
import {
  CreateFormExportDto,
  FormExportAcceptedDto,
  FormExportDownloadDto,
  FormExportListDto,
  FormExportStatusDto,
} from './dto';
import { parsePage, parseLimit } from './pagination';

@ApiTags('Product Bulk Form')
// bulk-session.controller.ts 와 같은 이유·같은 형태로 잠근다 — 이 컨트롤러(양식 생성·
// 다운로드)도 잠그지 않으면 세션 컨트롤러만 잠근 우회로가 남는다.
//
// ⚠️ 배포 위험: "양식 다운로드"는 이미 라이브 노출 상태다. 실제 MD 계정 토큰의 `roles`
// 클레임에 admin/master 가 없으면 배포 즉시 403 이 된다. 배포 전 실측이 선행조건 —
// Task 13 체크리스트 항목, 이 자리에서 판단할 사안이 아니다.
@UseGuards(RolesGuard('master', 'admin'))
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

  @Get()
  @ApiOperation({ summary: '내 양식 생성 목록(페이지)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, type: FormExportListDto })
  async list(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @User() user: { userId: string },
  ): Promise<FormExportListDto> {
    return this.service.list(user.userId, parsePage(page), parseLimit(limit));
  }

  // ⚠️ 이 핸들러는 반드시 `@Get(':exportId')` 보다 **위**에 있어야 한다. Nest 는 선언
  // 순서로 매칭하므로 아래에 두면 'blank' 가 :exportId 로 잡혀 404 가 난다.
  @Get('blank')
  @ApiOperation({ summary: '빈 양식 다운로드. 신규 전용 세션용 — 잡도 만료도 없다.' })
  @ApiResponse({ status: 200, description: 'xlsx 바이너리' })
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="product-bulk-form-blank.xlsx"')
  async getBlank(): Promise<StreamableFile> {
    return new StreamableFile(await this.service.buildBlankWorkbook());
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

  @Post(':exportId/retry')
  @HttpCode(202)
  @ApiOperation({ summary: '같은 상품 집합으로 양식 생성을 다시 접수한다' })
  @ApiResponse({ status: 202, type: FormExportAcceptedDto })
  @ApiResponse({ status: 404, description: '없거나 내 잡이 아님' })
  async retry(@Param('exportId') exportId: string, @User() user: { userId: string }): Promise<FormExportAcceptedDto> {
    return this.service.retry(exportId, user.userId);
  }
}
