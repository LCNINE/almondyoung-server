import { Controller, Get, Query, Patch, Param, Body, Post, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBody } from '@nestjs/swagger';
import { ProductMatchingService } from '../services/product-matching.service';
import { ResolveMatchingDto, StockPolicyDto } from '../dto/product-matching/resolve-matching.dto';
import { SetMatchingPriorityDto } from '../dto/product-matching/set-matching-priority.dto';
import { ResolveOptionMatchingDto } from '../dto/product-matching/option-matching.dto';
import { ChangeStrategyDto } from '../dto/product-matching/change-strategy.dto';
import { VariantSkuLookupDto } from '../dto/product-matching/variant-sku-lookup.dto';
import { matchingStatusEnum } from '../../../database/schemas/wms-schema';

@ApiTags('Product Matching')
@Controller('matchings')
export class ProductMatchingController {
  constructor(private readonly productMatchingService: ProductMatchingService) {}

  @Get()
  @ApiOperation({ summary: '매칭 대기 목록 조회' })
  @ApiQuery({
    name: 'status',
    enum: matchingStatusEnum.enumValues,
    required: false,
    description: '매칭 상태 필터 (pending, matched, ignored)',
  })
  @ApiResponse({ status: 200, description: '매칭 대기 목록을 반환합니다.' })
  async getMatchingPendings(@Query('status') status?: (typeof matchingStatusEnum.enumValues)[number]) {
    return this.productMatchingService.getMatchingPendings(status);
  }

  @Patch(':id/resolve')
  @ApiOperation({ summary: '매칭 대기 해소 (SKU와 매칭 또는 무시)' })
  @ApiResponse({ status: 200, description: '매칭 대기가 성공적으로 해소되었습니다.' })
  async resolveMatchingPending(@Param('id') matchingId: string, @Body() resolveDto: ResolveMatchingDto) {
    return this.productMatchingService.resolveMatchingPending(matchingId, resolveDto);
  }

  @Patch(':id/resolve-options')
  @ApiOperation({ summary: '옵션별 매칭 해소' })
  @ApiResponse({ status: 200, description: '옵션별 매칭이 성공적으로 해소되었습니다.' })
  async resolveOptionMatching(@Param('id') matchingId: string, @Body() resolveOptionDto: ResolveOptionMatchingDto) {
    return this.productMatchingService.resolveOptionMatching(matchingId, resolveOptionDto.optionMappings);
  }

  @Patch(':id/priority')
  @ApiOperation({ summary: '매칭 대기 우선순위 설정' })
  @ApiResponse({ status: 200, description: '매칭 우선순위가 설정되었습니다.' })
  async setMatchingPriority(@Param('id') matchingId: string, @Body() priorityDto: SetMatchingPriorityDto) {
    return this.productMatchingService.setMatchingPriority(matchingId, priorityDto.priority);
  }

  @Patch(':id/strategy')
  @ApiOperation({ summary: '매칭 전략 변경' })
  @ApiResponse({ status: 200, description: '매칭 전략이 변경되었습니다.' })
  async changeMatchingStrategy(@Param('id') matchingId: string, @Body() changeStrategyDto: ChangeStrategyDto) {
    return this.productMatchingService.changeMatchingStrategy(matchingId, changeStrategyDto.strategy);
  }

  // ═══════════════════════════════════════════════════════════════
  // 재고 정책 관리 API 추가
  // ═══════════════════════════════════════════════════════════════

  @Patch(':id/stock-policy')
  @ApiOperation({ summary: '매칭의 재고 정책 업데이트' })
  @ApiBody({ type: StockPolicyDto })
  @ApiResponse({ status: 200, description: '재고 정책이 성공적으로 업데이트되었습니다.' })
  @ApiResponse({ status: 404, description: '매칭을 찾을 수 없습니다.' })
  async updateStockPolicy(@Param('id') matchingId: string, @Body() stockPolicyDto: StockPolicyDto) {
    return this.productMatchingService.updateStockPolicy(matchingId, stockPolicyDto);
  }

  @Get('variants/:variantId/stock-policy')
  @ApiOperation({ summary: 'Variant의 재고 정책 조회' })
  @ApiResponse({
    status: 200,
    description: '재고 정책을 반환합니다.',
    schema: {
      type: 'object',
      properties: {
        inventoryManagement: { type: 'boolean' },
        preStockSellable: { type: 'boolean' },
        alwaysSellableZeroStock: { type: 'boolean' },
        isGift: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Variant에 대한 매칭이 없습니다.' })
  async getStockPolicyForVariant(@Param('variantId') variantId: string) {
    const policy = await this.productMatchingService.getStockPolicyForVariant(variantId);
    if (!policy) {
      throw new NotFoundException(`No matching found for variant ${variantId}`);
    }
    return policy;
  }

  // ═══════════════════════════════════════════════════════════════
  // SKU 조회 API
  // ═══════════════════════════════════════════════════════════════

  @Post('variants/:variantId/sku-lookup')
  @ApiOperation({ summary: 'Variant의 SKU 조합 조회' })
  @ApiResponse({
    status: 200,
    description: '선택된 옵션에 따른 SKU 목록을 반환합니다.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          skuId: { type: 'string' },
          quantity: { type: 'number' },
        },
      },
    },
  })
  async getSkusForVariant(@Param('variantId') variantId: string, @Body() lookupDto: VariantSkuLookupDto) {
    return this.productMatchingService.getSkusForVariant(variantId, lookupDto.selectedOptions);
  }
}
