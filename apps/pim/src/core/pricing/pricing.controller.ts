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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
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

@ApiTags('Pricing')
@Controller('products/:masterId/pricing')
export class PricingController {
  constructor(
    private readonly pricingService: PricingService,
    private readonly calculatorService: PricingCalculatorService,
  ) {}

  @Get('rules')
  @ApiOperation({ summary: 'Get pricing rules for a master product' })
  @ApiParam({ name: 'masterId', description: 'Master product ID' })
  @ApiResponse({
    status: 200,
    description: 'Pricing rules retrieved',
    type: PricingRulesResponseDto,
  })
  async getMasterRules(
    @Param('masterId') masterId: string,
  ): Promise<PricingRulesResponseDto> {
    return this.pricingService.getMasterRules(masterId);
  }

  @Put('rules')
  @ApiOperation({ summary: 'Replace all pricing rules for a master product' })
  @ApiParam({ name: 'masterId', description: 'Master product ID' })
  @ApiBody({ type: ReplacePricingRulesDto, description: 'Pricing rules to replace' })
  @ApiResponse({
    status: 200,
    description: 'Pricing rules replaced',
    type: PricingRulesResponseDto,
  })
  async replaceMasterRules(
    @Param('masterId') masterId: string,
    @Body() dto: ReplacePricingRulesDto,
  ): Promise<PricingRulesResponseDto> {
    return this.pricingService.replaceMasterRules(masterId, dto);
  }

  @Delete('rules')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete all pricing rules for a master product' })
  @ApiParam({ name: 'masterId', description: 'Master product ID' })
  @ApiResponse({
    status: 204,
    description: 'Pricing rules deleted',
  })
  async deleteMasterRules(
    @Param('masterId') masterId: string,
  ): Promise<void> {
    return this.pricingService.deleteMasterRules(masterId);
  }

  @Post('calculate')
  @ApiOperation({ summary: 'Calculate price for a variant' })
  @ApiParam({ name: 'masterId', description: 'Master product ID' })
  @ApiResponse({
    status: 200,
    description: 'Price calculated',
    type: CalculatePriceResponseDto,
  })
  async calculatePrice(
    @Param('masterId') masterId: string,
    @Body() dto: CalculatePriceRequestDto,
  ): Promise<CalculatePriceResponseDto> {
    const result = await this.calculatorService.calculateVariantPrice(
      masterId,
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
  @ApiOperation({ summary: 'Get complete price set for a variant (base, membership, tiered)' })
  @ApiParam({ name: 'masterId', description: 'Master product ID' })
  @ApiResponse({
    status: 200,
    description: 'Price set retrieved',
    type: VariantPriceSetDto,
  })
  async getPriceSet(
    @Param('masterId') masterId: string,
    @Query() dto: GetPriceSetRequestDto,
  ): Promise<VariantPriceSetDto> {
    return this.pricingService.getVariantPriceSet(
      masterId,
      dto.variantId,
      dto.versionId,
    );
  }
}

