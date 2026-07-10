import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiResponse } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { User } from '@app/authorization';
import { ProductImportService } from './services/product-import.service';
import { ValidatePreviewDto, CommitResultDto, SessionDetailDto, PublishResultDto } from './dto';

@ApiTags('Product Import')
@Controller('product-imports')
export class ProductImportController {
  constructor(private readonly service: ProductImportService) {}

  @Get('template')
  @ApiOperation({ summary: '대량등록 엑셀 템플릿 다운로드' })
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.service.getTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=product-import-template.xlsx');
    res.send(buffer);
  }

  @Post('validate')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiOperation({ summary: '워크북 검증(무상태 프리뷰, DB 쓰기 없음)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @ApiResponse({ status: 200, type: ValidatePreviewDto })
  async validate(@UploadedFile() file: Express.Multer.File): Promise<ValidatePreviewDto> {
    if (!file) throw new BadRequestException('file is required');
    return this.service.validate(file.buffer);
  }

  @Post('commit')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiOperation({ summary: '워크북 커밋(세션 생성 + draft 상품 일괄 생성)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @ApiResponse({ status: 201, type: CommitResultDto })
  async commit(@UploadedFile() file: Express.Multer.File, @User() user: { userId: string }): Promise<CommitResultDto> {
    if (!file) throw new BadRequestException('file is required');
    return this.service.commit(file.buffer, file.originalname, user.userId);
  }

  @Get()
  @ApiOperation({ summary: '임포트 세션 목록' })
  async getSessions(@Query('page') page = '1', @Query('limit') limit = '20') {
    const p = Math.max(1, Number.parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
    return this.service.getSessions(p, l);
  }

  @Get(':sessionId')
  @ApiOperation({ summary: '임포트 세션 상세(성공/실패 아이템 전체)' })
  @ApiResponse({ status: 200, type: SessionDetailDto })
  async getSession(@Param('sessionId') sessionId: string): Promise<SessionDetailDto> {
    return this.service.getSession(sessionId);
  }

  @Post(':sessionId/publish')
  @ApiOperation({ summary: '세션 내 draft 일괄 publish' })
  @ApiResponse({ status: 201, type: PublishResultDto })
  async publish(@Param('sessionId') sessionId: string): Promise<PublishResultDto> {
    return this.service.publishSession(sessionId);
  }
}
