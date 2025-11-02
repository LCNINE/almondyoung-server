import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
    Query,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { SkuPricingService } from '../services/sku-pricing.service';
import { CreateSkuPricingDto } from '../dto/sku-pricing/create-sku-pricing.dto';
import { UpdateSkuPricingDto } from '../dto/sku-pricing/update-sku-pricing.dto';
import { SkuPricingResponseDto } from '../dto/sku-pricing/sku-pricing-response.dto';

@ApiTags('SKU Pricing')
@Controller('wms/inventory/skus')
export class SkuPricingController {
    constructor(private readonly skuPricingService: SkuPricingService) {}

    @Post('pricing')
    @ApiOperation({
        summary: 'SKU 가격 생성/수정 (Create or update SKU pricing)',
        description: 'Creates new pricing or updates existing pricing for a SKU (upsert pattern)',
    })
    @ApiResponse({
        status: 201,
        description: 'Pricing created or updated successfully',
        type: SkuPricingResponseDto,
    })
    @ApiResponse({ status: 400, description: 'Invalid input data' })
    @ApiResponse({ status: 404, description: 'SKU not found' })
    async createOrUpdatePricing(
        @Body() dto: CreateSkuPricingDto
    ): Promise<SkuPricingResponseDto> {
        return this.skuPricingService.createOrUpdatePricing(dto);
    }

    @Get(':skuId/pricing')
    @ApiOperation({
        summary: 'SKU 가격 조회 (Get SKU pricing)',
        description: 'Get pricing information for a specific SKU',
    })
    @ApiParam({ name: 'skuId', description: 'SKU ID' })
    @ApiResponse({
        status: 200,
        description: 'Pricing retrieved successfully',
        type: SkuPricingResponseDto,
    })
    @ApiResponse({ status: 404, description: 'Pricing not found' })
    async getPricing(
        @Param('skuId') skuId: string
    ): Promise<SkuPricingResponseDto | null> {
        return this.skuPricingService.getPricingBySkuId(skuId);
    }

    @Get(':skuId/pricing/effective')
    @ApiOperation({
        summary: '유효한 가격 조회 (Get effective pricing)',
        description: 'Get currently valid pricing based on effective and expiry dates',
    })
    @ApiParam({ name: 'skuId', description: 'SKU ID' })
    @ApiQuery({
        name: 'referenceDate',
        required: false,
        description: 'Reference date (ISO 8601 format). Defaults to current date.',
        type: String,
    })
    @ApiResponse({
        status: 200,
        description: 'Effective pricing retrieved successfully',
        type: SkuPricingResponseDto,
    })
    @ApiResponse({ status: 404, description: 'No valid pricing found for this date' })
    async getEffectivePricing(
        @Param('skuId') skuId: string,
        @Query('referenceDate') referenceDate?: string
    ): Promise<SkuPricingResponseDto | null> {
        const date = referenceDate ? new Date(referenceDate) : new Date();
        return this.skuPricingService.getEffectivePricing(skuId, date);
    }

    @Put(':skuId/pricing')
    @ApiOperation({
        summary: 'SKU 가격 수정 (Update SKU pricing)',
        description: 'Update existing pricing for a SKU',
    })
    @ApiParam({ name: 'skuId', description: 'SKU ID' })
    @ApiResponse({
        status: 200,
        description: 'Pricing updated successfully',
        type: SkuPricingResponseDto,
    })
    @ApiResponse({ status: 400, description: 'Invalid input data' })
    @ApiResponse({ status: 404, description: 'Pricing not found' })
    async updatePricing(
        @Param('skuId') skuId: string,
        @Body() dto: UpdateSkuPricingDto
    ): Promise<SkuPricingResponseDto> {
        return this.skuPricingService.updatePricing(skuId, dto);
    }

    @Delete(':skuId/pricing')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'SKU 가격 삭제 (Delete SKU pricing)',
        description: 'Delete pricing information for a SKU',
    })
    @ApiParam({ name: 'skuId', description: 'SKU ID' })
    @ApiResponse({
        status: 200,
        description: 'Pricing deleted successfully',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean', example: true },
                message: { type: 'string', example: 'Pricing deleted successfully' },
            },
        },
    })
    @ApiResponse({ status: 404, description: 'Pricing not found' })
    async deletePricing(
        @Param('skuId') skuId: string
    ): Promise<{ success: boolean; message: string }> {
        return this.skuPricingService.deletePricing(skuId);
    }

    @Get('pricing/all')
    @ApiOperation({
        summary: '전체 가격 목록 조회 (Get all pricing)',
        description: 'Get all SKU pricing information',
    })
    @ApiResponse({
        status: 200,
        description: 'All pricing retrieved successfully',
        type: [SkuPricingResponseDto],
    })
    async getAllPricing(): Promise<SkuPricingResponseDto[]> {
        return this.skuPricingService.getAllPricing();
    }

    @Get(':skuId/pricing/valid')
    @ApiOperation({
        summary: '가격 유효성 확인 (Check pricing validity)',
        description: 'Check if pricing is currently valid',
    })
    @ApiParam({ name: 'skuId', description: 'SKU ID' })
    @ApiQuery({
        name: 'referenceDate',
        required: false,
        description: 'Reference date (ISO 8601 format). Defaults to current date.',
        type: String,
    })
    @ApiResponse({
        status: 200,
        description: 'Validity check completed',
        schema: {
            type: 'object',
            properties: {
                isValid: { type: 'boolean' },
                skuId: { type: 'string' },
                referenceDate: { type: 'string', format: 'date-time' },
            },
        },
    })
    async checkPricingValidity(
        @Param('skuId') skuId: string,
        @Query('referenceDate') referenceDate?: string
    ): Promise<{ isValid: boolean; skuId: string; referenceDate: Date }> {
        const date = referenceDate ? new Date(referenceDate) : new Date();
        const isValid = await this.skuPricingService.isPricingValid(skuId, date);
        return {
            isValid,
            skuId,
            referenceDate: date,
        };
    }
}

