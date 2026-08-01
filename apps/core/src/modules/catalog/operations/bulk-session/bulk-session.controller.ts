import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { BulkSessionService } from './services/bulk-session.service';
import { MAX_UPLOAD_BYTES } from './services/bulk-upload.parser';
import { BULK_ITEM_STATUS_VALUES, BulkItemStatus, isBulkItemStatus } from './services/bulk-session.reader';
import {
  BulkSessionAcceptedDto,
  BulkSessionItemDto,
  BulkSessionItemListDto,
  BulkSessionListDto,
  BulkSessionProgressDto,
  ConflictDecisionDto,
  CreateBulkSessionDto,
} from './dto';

function parsePage(page: string): number {
  return Math.max(1, Number.parseInt(page, 10) || 1);
}

function parseLimit(limit: string): number {
  return Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
}

@ApiTags('Product Bulk Session')
@Controller('product-bulk-sessions')
export class BulkSessionController {
  constructor(private readonly service: BulkSessionService) {}

  @Post()
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiOperation({ summary: '작성한 양식 업로드 접수. 파싱·검증은 워커가 이어받는다.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' }, name: { type: 'string' } },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 202, type: BulkSessionAcceptedDto })
  @ApiResponse({ status: 400, description: '파일 오류 또는 해석할 수 없는 양식' })
  async create(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateBulkSessionDto,
    @User() user: { userId: string },
  ): Promise<BulkSessionAcceptedDto> {
    if (!file) throw new BadRequestException('file is required');
    return this.service.upload({
      buffer: file.buffer,
      fileName: file.originalname,
      name: dto.name,
      userId: user.userId,
    });
  }

  @Get()
  @ApiOperation({ summary: '내 일괄 등록 세션 목록(페이지)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, type: BulkSessionListDto })
  async list(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @User() user: { userId: string },
  ): Promise<BulkSessionListDto> {
    return this.service.listSessions(user.userId, parsePage(page), parseLimit(limit));
  }

  @Get(':id')
  @ApiOperation({ summary: '세션 요약 + 단계별 집계(폴링 대상). 행 목록은 없다.' })
  @ApiResponse({ status: 200, type: BulkSessionProgressDto })
  @ApiResponse({ status: 404, description: '세션이 없거나 내 것이 아님' })
  async getProgress(@Param('id') id: string, @User() user: { userId: string }): Promise<BulkSessionProgressDto> {
    return this.service.getProgress(id, user.userId);
  }

  @Get(':id/items')
  @ApiOperation({ summary: '행 목록(변경분·충돌·라벨 포함). status 필터·페이지' })
  @ApiQuery({ name: 'status', required: false, enum: BULK_ITEM_STATUS_VALUES })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, type: BulkSessionItemListDto })
  async getItems(
    @Param('id') id: string,
    @Query('status') status: string | undefined,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @User() user: { userId: string },
  ): Promise<BulkSessionItemListDto> {
    let validatedStatus: BulkItemStatus | undefined;
    if (status !== undefined) {
      if (!isBulkItemStatus(status)) {
        throw new BadRequestException(`status 는 ${BULK_ITEM_STATUS_VALUES.join(', ')} 중 하나여야 합니다`);
      }
      validatedStatus = status;
    }
    return this.service.getItems(id, user.userId, validatedStatus, parsePage(page), parseLimit(limit));
  }

  @Patch(':id/items/:itemId/conflict-decision')
  @ApiOperation({ summary: '필드별 충돌 결정(overwrite/skip). 부분 갱신 — 기존 결정에 머지된다.' })
  @ApiResponse({ status: 200, type: BulkSessionItemDto })
  @ApiResponse({ status: 400, description: '충돌하지 않은 필드에 결정을 달았거나 값이 overwrite/skip 이 아님' })
  @ApiResponse({ status: 404, description: '세션 또는 행이 없거나 내 것이 아님' })
  @ApiResponse({ status: 409, description: 'review 단계가 아님' })
  async setConflictDecision(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: ConflictDecisionDto,
    @User() user: { userId: string },
  ): Promise<BulkSessionItemDto> {
    return this.service.setConflictDecision(id, itemId, user.userId, dto.decisions);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: '검토 완료 승인. review → awaiting_images | drafting' })
  @ApiResponse({ status: 200, type: BulkSessionProgressDto })
  @ApiResponse({ status: 409, description: '미결정 충돌이 있거나 review 단계가 아님' })
  async approve(@Param('id') id: string, @User() user: { userId: string }): Promise<BulkSessionProgressDto> {
    return this.service.approve(id, user.userId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: '세션 취소. 진행 중 phase → canceled. failed 도 취소 대상이다.' })
  @ApiResponse({ status: 200, type: BulkSessionProgressDto })
  @ApiResponse({ status: 409, description: '이미 종료된 세션(published·canceled)' })
  async cancel(@Param('id') id: string, @User() user: { userId: string }): Promise<BulkSessionProgressDto> {
    return this.service.cancel(id, user.userId);
  }
}
