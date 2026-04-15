import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Query,
  HttpException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiQuery } from '@nestjs/swagger';
import { PricingService } from './pricing.service';
import { PricingCalculatorService } from './pricing-calculator.service';
import {
  ReplacePricingRulesDto,
  PricingRulesResponseDto,
  CalculatePriceRequestDto,
  CalculatePriceResponseDto,
  AppliedRuleDto,
  PriceBreakdownDto,
  GetPriceSetRequestDto,
  VariantPriceSetDto,
} from './dto';

@ApiTags('Version Pricing')
@Controller('versions/:versionId/pricing')
export class VersionPricingController {
  constructor(
    private readonly pricingService: PricingService,
    private readonly calculatorService: PricingCalculatorService,
  ) {}

  @Get('rules')
  @ApiOperation({
    summary: 'Get pricing rules for a specific version',
    description:
      'Retrieve pricing rules for a specific product version. Works with any version status (draft, active, inactive).',
  })
  @ApiParam({ name: 'versionId', description: 'Version ID' })
  @ApiResponse({
    status: 200,
    description: 'Pricing rules retrieved',
    type: PricingRulesResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Version not found' })
  async getVersionRules(@Param('versionId') versionId: string): Promise<PricingRulesResponseDto> {
    return this.pricingService.getVersionRules(versionId);
  }

  @Put('rules')
  @ApiOperation({
    summary: 'Replace pricing rules for a draft version',
    description: 'Replace all pricing rules for a draft version. Only draft versions can be modified.',
  })
  @ApiParam({ name: 'versionId', description: 'Version ID (must be draft)' })
  @ApiBody({ type: ReplacePricingRulesDto, description: 'Pricing rules to replace' })
  @ApiResponse({
    status: 200,
    description: 'Pricing rules replaced',
    type: PricingRulesResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Version is not draft' })
  @ApiResponse({ status: 404, description: 'Version not found' })
  async replaceVersionRules(
    @Param('versionId') versionId: string,
    @Body() dto: ReplacePricingRulesDto,
  ): Promise<PricingRulesResponseDto> {
    try {
      return await this.pricingService.replaceVersionRules(versionId, dto);
    } catch (error) {
      if (error.message?.includes('not draft') || error.message?.includes('Only draft')) {
        throw new HttpException('Only draft versions can be modified', HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
  }

  @Delete('rules')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete pricing rules for a draft version',
    description: 'Delete all pricing rules for a draft version. Only draft versions can be modified.',
  })
  @ApiParam({ name: 'versionId', description: 'Version ID (must be draft)' })
  @ApiResponse({
    status: 204,
    description: 'Pricing rules deleted',
  })
  @ApiResponse({ status: 400, description: 'Version is not draft' })
  @ApiResponse({ status: 404, description: 'Version not found' })
  async deleteVersionRules(@Param('versionId') versionId: string): Promise<void> {
    try {
      return await this.pricingService.deleteVersionRules(versionId);
    } catch (error) {
      if (error.message?.includes('not draft') || error.message?.includes('Only draft')) {
        throw new HttpException('Only draft versions can be modified', HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
  }

  @Post('calculate')
  @ApiOperation({
    summary: 'Calculate price for a variant in a specific version',
    description: 'Calculate the price for a variant using the pricing rules of a specific version.',
  })
  @ApiParam({ name: 'versionId', description: 'Version ID' })
  @ApiBody({ type: CalculatePriceRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Price calculated',
    type: CalculatePriceResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Version or variant not found' })
  async calculatePrice(
    @Param('versionId') versionId: string,
    @Body() dto: CalculatePriceRequestDto,
  ): Promise<CalculatePriceResponseDto> {
    const result = await this.calculatorService.calculateVariantPriceByVersion(
      versionId,
      dto.variantId,
      dto.quantity,
      dto.customerType || 'regular',
    );

    const appliedRules: AppliedRuleDto[] = result.appliedRules.map((rule) => ({
      ruleId: rule.ruleId,
      layer: rule.layer,
      order: rule.order,
      scopeType: rule.scopeType,
      operationType: rule.operationType,
      operationValue: rule.operationValue,
      priceBeforeRule: rule.priceBeforeRule,
      priceAfterRule: rule.priceAfterRule,
    }));

    const priceBreakdown: PriceBreakdownDto = {
      initialPrice: result.priceBreakdown.initialPrice,
      afterBasePrice: result.priceBreakdown.afterBasePrice,
      afterMembershipPrice: result.priceBreakdown.afterMembershipPrice,
      afterTieredPrice: result.priceBreakdown.afterTieredPrice,
    };

    return {
      variantId: result.variantId,
      price: result.price,
      totalPrice: result.totalPrice,
      appliedRules,
      priceBreakdown,
    };
  }

  @Get('price-set')
  @ApiOperation({
    summary: 'Get complete price set for a variant in a specific version',
    description: 'Get base, membership, and tiered prices for a variant using pricing rules from a specific version.',
  })
  @ApiParam({ name: 'versionId', description: 'Version ID' })
  @ApiQuery({ name: 'variantId', description: 'Variant ID', required: true })
  @ApiResponse({
    status: 200,
    description: 'Price set retrieved',
    type: VariantPriceSetDto,
  })
  @ApiResponse({ status: 404, description: 'Version or variant not found' })
  async getPriceSet(
    @Param('versionId') versionId: string,
    @Query('variantId') variantId: string,
  ): Promise<VariantPriceSetDto> {
    return this.pricingService.getVariantPriceSet(versionId, variantId);
  }
}
