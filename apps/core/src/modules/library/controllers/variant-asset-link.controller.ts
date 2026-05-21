import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { VariantAssetLinkService } from '../services/variant-asset-link.service';
import { DigitalAssetResponseDto, SetVariantAssetLinksDto } from '../dto';

@ApiTags('Library / Variant Asset Links')
@Controller('variants/:variantId/digital-assets')
export class VariantAssetLinkController {
  constructor(private readonly service: VariantAssetLinkService) {}

  @Get()
  @ApiOperation({ summary: 'variant 의 매칭 자산 목록' })
  @ApiResponse({ status: 200, type: DigitalAssetResponseDto, isArray: true })
  async list(@Param('variantId') variantId: string): Promise<DigitalAssetResponseDto[]> {
    return this.service.listAssetsForVariant(variantId);
  }

  @Put()
  @HttpCode(204)
  @ApiOperation({ summary: 'variant 의 매칭 자산 집합을 완전 교체' })
  async set(
    @Param('variantId') variantId: string,
    @Body() dto: SetVariantAssetLinksDto,
    @Req() req: any,
  ): Promise<void> {
    await this.service.setLinksForVariant(variantId, dto.assetIds, req.user?.id);
  }

  @Post(':assetId')
  @HttpCode(204)
  @ApiOperation({ summary: 'variant 에 자산 1 개 추가 매칭' })
  async add(
    @Param('variantId') variantId: string,
    @Param('assetId') assetId: string,
    @Req() req: any,
  ): Promise<void> {
    await this.service.addLink(variantId, assetId, req.user?.id);
  }

  @Delete(':assetId')
  @HttpCode(204)
  @ApiOperation({ summary: 'variant 의 자산 매칭 1 개 해제' })
  async remove(
    @Param('variantId') variantId: string,
    @Param('assetId') assetId: string,
  ): Promise<void> {
    await this.service.removeLink(variantId, assetId);
  }
}
