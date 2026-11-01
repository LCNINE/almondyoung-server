import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboundTenant } from '@app/tenancy';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UgcInternalAuth } from '../../shared/decorators/internal-auth.decorator';
import { mintServiceToken } from '../clients/service-token';
import { ALMOND_PRINT_DEFAULT_DPI } from '../constants/almond-template.constants';
import { AlmondPrintLinkResponseDto } from '../dto/almond-design.dto';
import { parsePrintFormatAndDpi } from './print-link-params';
import { AlmondDesignsService } from '../services/almond-designs.service';
import { type AlmondDesignInfo } from '../types/almond-design.types';

@ApiTags('Almond Designs (internal)')
@ApiBearerAuth()
@Controller('internal/almond-designs')
export class InternalAlmondDesignsController {
  constructor(
    private readonly service: AlmondDesignsService,
    private readonly config: ConfigService,
    @Inject(OutboundTenant) private readonly outboundTenant: Pick<OutboundTenant, 'tenantId'>,
  ) {}

  @Get(':id')
  @UgcInternalAuth()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '시안 상품·규격 정보 (내부 호출)' })
  @ApiResponse({ status: 404 })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AlmondDesignInfo> {
    return this.service.getInfo(id);
  }

  @Get(':id/print-link')
  @UgcInternalAuth()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'format', enum: ['pdf', 'eps', 'jpg'] })
  @ApiQuery({ name: 'dpi', required: false, example: ALMOND_PRINT_DEFAULT_DPI })
  @ApiOperation({ summary: '인쇄 파일 다운로드 링크 (내부 호출, 서비스 토큰으로 file-service 사용)' })
  @ApiResponse({ status: 200, type: AlmondPrintLinkResponseDto })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 404 })
  printLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') format: string,
    @Query('dpi', new DefaultValuePipe(ALMOND_PRINT_DEFAULT_DPI), ParseIntPipe) dpi: number,
  ): Promise<AlmondPrintLinkResponseDto> {
    const parsed = parsePrintFormatAndDpi(format, dpi);
    const secret = this.config.get<string>('AUTH_SECRET');
    if (!secret) throw new Error('AUTH_SECRET is not configured');
    return this.service.printLink(
      id,
      parsed.format,
      parsed.dpi,
      mintServiceToken(secret, this.outboundTenant.tenantId()),
    );
  }
}
