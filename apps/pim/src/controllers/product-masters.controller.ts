import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpException, HttpStatus } from '@nestjs/common';
import { ProductMastersService } from '../services/product-masters.service';
import { CreateMasterDto, MasterDetailDto, PricePreviewDto, ProductMaster, UpdateProductMaster } from '../types';

@Controller('masters')
export class ProductMastersController {
  constructor(
    private readonly productMastersService: ProductMastersService,
  ) {}

  @Post()
  async createMaster(@Body() createMasterDto: CreateMasterDto): Promise<ProductMaster> {
    try {
      if (!createMasterDto.name || !createMasterDto.basePrice || !createMasterDto.pricingStrategy) {
        throw new HttpException('Validation failed', HttpStatus.BAD_REQUEST);
      }

      const master = await this.productMastersService.createMaster(createMasterDto);
      
      return master;
    } catch (error) {
      if (error.message === 'Validation failed') {
        throw error;
      }
      throw new HttpException('Failed to create master', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get()
  async getMasters(@Query() query: {
    page?: string;
    limit?: string;
    status?: string;
    categoryId?: string;
    brand?: string;
    pricingStrategy?: string;
    search?: string;
  }): Promise<{
    data: ProductMaster[];
    page: number;
    limit: number;
    total: number;
  }> {
    try {
      const filters = {
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit ? parseInt(query.limit) : undefined,
        status: query.status,
        categoryId: query.categoryId,
        brand: query.brand,
        pricingStrategy: query.pricingStrategy,
        search: query.search
      };

      return await this.productMastersService.getMasters(filters);
    } catch (error) {
      throw new HttpException('Failed to get masters', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':id')
  async getMasterDetail(@Param('id') id: string): Promise<MasterDetailDto> {
    try {
      const master = await this.productMastersService.getMasterDetail(id);
      
      if (!master) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }

      return master;
    } catch (error) {
      if (error.message === 'Master not found' || error.status === HttpStatus.NOT_FOUND) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException('Failed to get master detail', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put(':id')
  async updateMaster(@Param('id') id: string, @Body() updateData: UpdateProductMaster): Promise<{ success: boolean; data: ProductMaster }> {
    try {
      const updatedMaster = await this.productMastersService.updateMaster(id, updateData);
      return {
        success: true,
        data: updatedMaster
      };
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to update master', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':id')
  async deleteMaster(@Param('id') id: string): Promise<void> {
    try {
      const deleted = await this.productMastersService.deleteMaster(id);
      
      if (!deleted) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }
    } catch (error) {
      if (error.message === 'Master not found' || error.status === HttpStatus.NOT_FOUND) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to delete master', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':id/price-preview')
  async getPricePreview(@Param('id') id: string): Promise<PricePreviewDto> {
    try {
      return await this.productMastersService.getPricePreview(id);
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to get price preview', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put(':id/pricing')
  async changePricingStrategy(
    @Param('id') id: string,
    @Body() pricingDto: { 
      pricingStrategy: string;
      migrationData?: any;
    }
  ): Promise<void> {
    try {
      if (!pricingDto.pricingStrategy) {
        throw new HttpException('Pricing strategy is required', HttpStatus.BAD_REQUEST);
      }

      const master = await this.productMastersService.getMasterById(id);
      if (!master) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }

      await this.productMastersService.changePricingStrategy(
        id, 
        pricingDto.pricingStrategy as any,
        pricingDto.migrationData
      );
    } catch (error) {
      if (error.message === 'Master not found' || error.status === HttpStatus.NOT_FOUND) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required') || error.message.includes('Invalid')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to change pricing strategy', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
} 