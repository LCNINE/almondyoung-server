import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequireScopes } from '@app/authorization';
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
  @ApiOperation({ summary: '인쇄용 EPS (앞·뒷면 나란히 한 장, 글자 아웃라인, CMYK)' })
  @ApiProduces('application/postscript')
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  printEps(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) reply: FastifyReply): Promise<Buffer> {
    return this.sendPrintFile(id, 'eps', reply);
  }

  @Get(':id/print.pdf')
  @RequireScopes('admin:template:write')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '인쇄용 PDF (앞면 1쪽·뒷면 2쪽, 글자 아웃라인, CMYK)' })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  printPdf(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) reply: FastifyReply): Promise<Buffer> {
    return this.sendPrintFile(id, 'pdf', reply);
  }

  private async sendPrintFile(id: string, format: AlmondPrintFormat, reply: FastifyReply): Promise<Buffer> {
    const file = await this.service.renderPrintFile(id, format);
    reply.headers({
      'content-type': file.contentType,
      'content-disposition': `attachment; filename="${file.fileName}"`,
      'cache-control': 'no-store',
    });
    return file.body;
  }
}
