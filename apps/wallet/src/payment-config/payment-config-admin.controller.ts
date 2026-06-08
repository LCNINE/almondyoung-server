import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentConfigService } from './payment-config.service';
import { WalletAdminAuth } from '../wallet-admin-auth.decorator';
import { PaymentMethodCatalog, Region } from '../types';
import {
  CatalogResponseDto,
  CreateRegionDto,
  PutRegionMethodsDto,
  RegionMethodMatrixResponseDto,
  RegionResponseDto,
  UpdateCatalogDto,
  UpdateRegionDto,
} from './dto';

function toCatalogResponse(c: PaymentMethodCatalog): CatalogResponseDto {
  return {
    id: c.id,
    code: c.code,
    displayName: c.displayName,
    description: c.description,
    isEnabled: c.isEnabled,
    sortOrder: c.sortOrder,
  };
}

function toRegionResponse(r: Region): RegionResponseDto {
  return { id: r.id, code: r.code, name: r.name, isActive: r.isActive, sortOrder: r.sortOrder };
}

@ApiTags('Admin - Payment Config')
@WalletAdminAuth()
@Controller('v1/admin')
export class PaymentConfigAdminController {
  constructor(private readonly service: PaymentConfigService) {}

  // ── Catalog (글로벌 결제수단) ──────────────────────────────────────────────

  @Get('payment-methods')
  @ApiOperation({ summary: '결제수단 카탈로그 목록 (글로벌 활성화 상태 포함)' })
  async listCatalog(): Promise<CatalogResponseDto[]> {
    const rows = await this.service.listCatalog();
    return rows.map(toCatalogResponse);
  }

  @Patch('payment-methods/:code')
  @ApiOperation({ summary: '결제수단 글로벌 활성화/비활성화 및 표시정보 수정' })
  async updateCatalog(@Param('code') code: string, @Body() dto: UpdateCatalogDto): Promise<CatalogResponseDto> {
    return toCatalogResponse(await this.service.updateCatalog(code, dto));
  }

  // ── Regions ─────────────────────────────────────────────────────────────────

  @Get('regions')
  @ApiOperation({ summary: '리전 목록' })
  async listRegions(): Promise<RegionResponseDto[]> {
    const rows = await this.service.listRegions();
    return rows.map(toRegionResponse);
  }

  @Post('regions')
  @HttpCode(201)
  @ApiOperation({ summary: '리전 생성 (소문자 alpha-2)' })
  async createRegion(@Body() dto: CreateRegionDto): Promise<RegionResponseDto> {
    return toRegionResponse(await this.service.createRegion(dto));
  }

  @Patch('regions/:code')
  @ApiOperation({ summary: '리전 수정/활성화' })
  async updateRegion(@Param('code') code: string, @Body() dto: UpdateRegionDto): Promise<RegionResponseDto> {
    return toRegionResponse(await this.service.updateRegion(code, dto));
  }

  // ── Region ↔ 결제수단 매핑 ───────────────────────────────────────────────────

  @Get('regions/:code/payment-methods')
  @ApiOperation({ summary: '해당 리전의 결제수단 매트릭스 (카탈로그 전체 + 리전별 상태)' })
  async getRegionMethods(@Param('code') code: string): Promise<RegionMethodMatrixResponseDto> {
    return this.service.getRegionMethods(code);
  }

  @Put('regions/:code/payment-methods')
  @ApiOperation({ summary: '리전별 결제수단 활성화 일괄 저장' })
  async putRegionMethods(
    @Param('code') code: string,
    @Body() dto: PutRegionMethodsDto,
  ): Promise<RegionMethodMatrixResponseDto> {
    return this.service.putRegionMethods(code, dto);
  }
}
