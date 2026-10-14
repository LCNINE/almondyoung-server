import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProduces, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequireScopes } from '@app/authorization';
import { NotFoundError } from '@app/shared';
import {
  ALMOND_PRINT_DEFAULT_DPI,
  ALMOND_PRINT_MAX_DPI,
  ALMOND_PRINT_MIN_DPI,
} from '../constants/almond-template.constants';
import { AdminAlmondDesignResponseDto, AlmondPrintLinkResponseDto } from '../dto/almond-design.dto';
import { parsePrintFormatAndDpi } from './print-link-params';
import { AlmondDesignsService } from '../services/almond-designs.service';
import { type AlmondPrintFormat } from '../types/almond-design.types';

@ApiTags('Almond Designs (admin)')
@ApiBearerAuth()
@Controller('admin/almond-designs')
export class AdminAlmondDesignsController {
  constructor(private readonly service: AlmondDesignsService) {}

  @Get(':id')
  @RequireScopes('admin:template:write')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '고객 시안 조회' })
  @ApiResponse({ status: 200, type: AdminAlmondDesignResponseDto })
  @ApiResponse({ status: 404 })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminAlmondDesignResponseDto> {
    return this.service.getForAdmin(id);
  }

  @Get(':id/preview/:side')
  @RequireScopes('admin:template:write')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'side', enum: ['front.jpg', 'back.jpg'] })
  @ApiOperation({
    summary:
      '고객 시안 미리보기 JPG. 인쇄 파일과 같은 원본을 긴 변 1200px 로 줄여 어드민 Lambda 응답 상한(6MB) 안에 둔다',
  })
  @ApiProduces('image/jpeg')
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('side') side: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    if (side !== 'front.jpg' && side !== 'back.jpg') throw new BadRequestException('side 는 front.jpg 또는 back.jpg');
    const jpg = await this.service.renderPreview(id, side === 'front.jpg' ? 'front' : 'back');
    if (jpg === null) throw new NotFoundError(`Almond design has no back side: ${id}`);
    reply.headers({
      'content-type': 'image/jpeg',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    });
    return jpg;
  }

  @Get(':id/print-link')
  @RequireScopes('admin:template:write')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'format', enum: ['pdf', 'eps', 'jpg'] })
  @ApiQuery({ name: 'dpi', required: false, example: ALMOND_PRINT_DEFAULT_DPI })
  @ApiOperation({
    summary: '인쇄 파일 다운로드 링크',
    description:
      '인쇄 파일을 file-service(S3)에 올리고 5분짜리 서명 URL 을 준다. 브라우저가 S3 에서 직접 받으므로 어드민 Lambda 응답 상한(6MB)에 걸리지 않는다. 같은 형식·dpi 는 한 번 만든 파일을 재사용한다.',
  })
  @ApiResponse({ status: 200, type: AlmondPrintLinkResponseDto })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 404 })
  printLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') format: string,
    @Query('dpi', new DefaultValuePipe(ALMOND_PRINT_DEFAULT_DPI), ParseIntPipe) dpi: number,
    @Req() request: FastifyRequest,
  ): Promise<AlmondPrintLinkResponseDto> {
    const parsed = parsePrintFormatAndDpi(format, dpi);
    const header = request.headers.authorization;
    const accessToken = header?.startsWith('Bearer ') ? header.slice(7) : request.cookies.accessToken;
    if (!accessToken) throw new UnauthorizedException();
    return this.service.printLink(id, parsed.format, parsed.dpi, accessToken);
  }

  @Get(':id/print.eps')
  @RequireScopes('admin:template:write')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: '인쇄용 EPS (앞·뒷면 나란히 한 장, 글자 아웃라인, CMYK). 유포 시트지처럼 AI/EPS 만 받는 상품용',
  })
  @ApiProduces('application/postscript')
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  printEps(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) reply: FastifyReply): Promise<Buffer> {
    return this.sendPrintFile(id, 'eps', reply);
  }

  @Get(':id/print.pdf')
  @RequireScopes('admin:template:write')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: '인쇄용 PDF (앞면 1쪽·뒷면 2쪽, 글자 아웃라인, CMYK). 명함용 — PET·미니배너는 PDF 를 받지 않는다',
  })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  printPdf(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) reply: FastifyReply): Promise<Buffer> {
    return this.sendPrintFile(id, 'pdf', reply);
  }

  @Get(':id/print.jpg')
  @RequireScopes('admin:template:write')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'dpi', required: false, example: ALMOND_PRINT_DEFAULT_DPI })
  @ApiOperation({
    summary: '인쇄용 CMYK JPG (앞·뒷면 나란히 한 장). PET·미니배너 350dpi, 현수막은 1/10 파일이라 700dpi',
  })
  @ApiProduces('image/jpeg')
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 404 })
  printJpg(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('dpi', new DefaultValuePipe(ALMOND_PRINT_DEFAULT_DPI), ParseIntPipe) dpi: number,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    if (dpi < ALMOND_PRINT_MIN_DPI || dpi > ALMOND_PRINT_MAX_DPI) {
      throw new BadRequestException(`dpi 는 ${ALMOND_PRINT_MIN_DPI}~${ALMOND_PRINT_MAX_DPI} 사이여야 합니다.`);
    }
    return this.sendPrintFile(id, 'jpg', reply, dpi);
  }

  private async sendPrintFile(
    id: string,
    format: AlmondPrintFormat,
    reply: FastifyReply,
    dpi?: number,
  ): Promise<Buffer> {
    const file = await this.service.renderPrintFile(id, format, dpi);
    reply.headers({
      'content-type': file.contentType,
      'content-disposition': `attachment; filename="${file.fileName}"`,
      'cache-control': 'no-store',
    });
    return file.body;
  }
}
