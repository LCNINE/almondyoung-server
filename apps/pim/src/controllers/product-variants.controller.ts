import { Controller, Get, Put, Body, Param, Query, HttpException, HttpStatus } from '@nestjs/common';
import { ProductVariantsService } from '../services/product-variants.service';
import { ZodValidationPipe } from '@app/shared';
import { UpdateVariantBulkDto, VariantWithPriceDto, UpdateProductVariant } from '../types';

@Controller('variants')
export class ProductVariantsController {
  constructor(private readonly productVariantsService: ProductVariantsService) {}

  @Get('masters/:masterId')
  async getVariantsByMaster(
    @Param('masterId') masterId: string, 
    @Query() query: {
      status?: string;
      includePrice?: string;
      page?: string;
      limit?: string;
    }
  ): Promise<{
    data: VariantWithPriceDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const filters = {
        status: query.status,
        includePrice: query.includePrice !== 'false',
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit ? parseInt(query.limit) : undefined,
      };

      return await this.productVariantsService.getVariantsByMaster(masterId, filters);
    } catch (error) {
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to get variants by master', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':id')
  async getVariantDetail(@Param('id') id: string): Promise<VariantWithPriceDto> {
    try {
      const variant = await this.productVariantsService.getVariantDetail(id);
      
      if (!variant) {
        throw new HttpException('Variant not found', HttpStatus.NOT_FOUND);
      }

      return variant;
    } catch (error) {
      if (error.message === 'Variant not found' || error.status === HttpStatus.NOT_FOUND) {
        throw new HttpException('Variant not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to get variant detail', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put(':id')
  async updateVariant(
    @Param('id') id: string, 
    @Body() updateDto: UpdateProductVariant
  ): Promise<any> {
    try {
      const updatedVariant = await this.productVariantsService.updateVariant(id, updateDto);
      return {
        success: true,
        data: updatedVariant
      };
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Variant not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to update variant', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put('bulk')
  async bulkUpdateVariants(@Body() bulkUpdateDto: UpdateVariantBulkDto): Promise<void> {
    try {
      await this.productVariantsService.bulkUpdateVariants(bulkUpdateDto);
    } catch (error) {
      if (error.message.includes('required') || error.message.includes('Invalid')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException('Failed to bulk update variants', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':id/price')
  async getVariantPrice(@Param('id') id: string): Promise<{ variantId: string; price: number }> {
    try {
      const price = await this.productVariantsService.calculateVariantPrice(id);
      return {
        variantId: id,
        price
      };
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Variant not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to calculate variant price', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put(':id/status')
  async updateVariantStatus(
    @Param('id') id: string, 
    @Body() statusDto: { status: string }
  ): Promise<void> {
    try {
      if (!statusDto.status) {
        throw new HttpException('Status is required', HttpStatus.BAD_REQUEST);
      }

      await this.productVariantsService.updateVariantStatus(id, statusDto.status);
    } catch (error) {
      if (error.message.includes('required') || error.message.includes('Invalid')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      if (error.message.includes('not found')) {
        throw new HttpException('Variant not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException('Failed to update variant status', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
} 