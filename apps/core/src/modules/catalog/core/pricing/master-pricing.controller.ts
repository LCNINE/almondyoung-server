import { Controller, Get, Post, Param, Body, Query, HttpException, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiQuery } from '@nestjs/swagger';
import { InjectDb, DbService } from '@app/db';
import { PricingService } from './pricing.service';
import { PricingCalculatorService } from './pricing-calculator.service';
import { pimSchema, productMasterVersions } from '../../schema/catalog.schema';
import { DbTransaction } from '../../catalog.types';
import { eq, and } from 'drizzle-orm';
import {
  PricingRulesResponseDto,
  CalculatePriceRequestDto,
  CalculatePriceResponseDto,
  AppliedRuleDto,
  PriceBreakdownDto,
  VariantPriceSetDto,
} from './dto';

@ApiTags('Master Pricing')
@Controller('masters/:masterId/pricing')
export class MasterPricingController {
  constructor(
    @InjectDb() private readonly dbService: DbService<typeof pimSchema>,
    private readonly pricingService: PricingService,
    private readonly calculatorService: PricingCalculatorService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async findActiveVersion(masterId: string, tx?: DbTransaction): Promise<string | null> {
    const client = tx ?? this.db;
    const [activeVersion] = await client
      .select({ id: productMasterVersions.id })
      .from(productMasterVersions)
      .where(and(eq(productMasterVersions.masterId, masterId), eq(productMasterVersions.status, 'active')))
      .limit(1);

    return activeVersion?.id ?? null;
  }

  @Get('rules')
  @ApiOperation({
    summary: 'Get pricing rules for active version',
    description:
      'Retrieve pricing rules for the active version of a master product. Returns 404 if no active version exists.',
  })
  @ApiParam({ name: 'masterId', description: 'Master product ID' })
  @ApiResponse({
    status: 200,
    description: 'Pricing rules retrieved',
    type: PricingRulesResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Master not found or no active version' })
  async getActivePricingRules(@Param('masterId') masterId: string): Promise<PricingRulesResponseDto> {
    const versionId = await this.findActiveVersion(masterId);

    if (!versionId) {
      throw new HttpException('No active version found for this master product', HttpStatus.NOT_FOUND);
    }

    return this.pricingService.getVersionRules(versionId);
  }

  @Post('calculate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Calculate price using active version',
    description:
      'Calculate the price for a variant using the pricing rules of the active version. Returns 404 if no active version exists.',
  })
  @ApiParam({ name: 'masterId', description: 'Master product ID' })
  @ApiBody({ type: CalculatePriceRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Price calculated',
    type: CalculatePriceResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Master not found, no active version, or variant not found' })
  async calculatePrice(
    @Param('masterId') masterId: string,
    @Body() dto: CalculatePriceRequestDto,
  ): Promise<CalculatePriceResponseDto> {
    const versionId = await this.findActiveVersion(masterId);

    if (!versionId) {
      throw new HttpException('No active version found for this master product', HttpStatus.NOT_FOUND);
    }

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
    summary: 'Get complete price set using active version',
    description:
      'Get base, membership, and tiered prices for a variant using pricing rules from the active version. Returns 404 if no active version exists.',
  })
  @ApiParam({ name: 'masterId', description: 'Master product ID' })
  @ApiQuery({ name: 'variantId', description: 'Variant ID', required: false })
  @ApiQuery({ name: 'variantIds', description: 'Comma-separated variant IDs for bulk lookup', required: false })
  @ApiResponse({ status: 200, description: 'Price set retrieved', type: VariantPriceSetDto })
  @ApiResponse({ status: 404, description: 'Master not found, no active version, or variant not found' })
  async getPriceSet(
    @Param('masterId') masterId: string,
    @Query('variantId') variantId?: string,
    @Query('variantIds') variantIdsParam?: string,
  ): Promise<VariantPriceSetDto | { items: VariantPriceSetDto[] }> {
    const versionId = await this.findActiveVersion(masterId);

    if (!versionId) {
      throw new HttpException('No active version found for this master product', HttpStatus.NOT_FOUND);
    }

    if (variantIdsParam) {
      const ids = [...new Set(variantIdsParam.split(',').map((s) => s.trim()).filter(Boolean))];
      if (ids.length === 0) {
        throw new HttpException('variantIds must contain at least one ID', HttpStatus.BAD_REQUEST);
      }
      if (ids.length > 100) {
        throw new HttpException('variantIds must not exceed 100 items', HttpStatus.BAD_REQUEST);
      }
      const items = await this.pricingService.getVariantPriceSetMany(versionId, ids);
      return { items };
    }

    if (!variantId) {
      throw new HttpException('Either variantId or variantIds query parameter is required', HttpStatus.BAD_REQUEST);
    }

    return this.pricingService.getVariantPriceSet(versionId, variantId);
  }
}
