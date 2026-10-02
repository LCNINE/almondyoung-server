import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProduces, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequireScopes } from '@app/authorization';
import {
  ALMOND_PRINT_DEFAULT_DPI,
  ALMOND_PRINT_MAX_DPI,
  ALMOND_PRINT_MIN_DPI,
} from '../constants/almond-template.constants';
import { AdminAlmondDesignResponseDto } from '../dto/almond-design.dto';
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
  @ApiOperation({ summary: '인쇄용 CMYK JPG (앞·뒷면 나란히 한 장). PET배너는 300, 미니배너는 350dpi' })
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
