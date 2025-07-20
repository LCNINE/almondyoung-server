import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpException, HttpStatus } from '@nestjs/common';
import { ChannelProductsService } from '../services/channel-products.service';
import { CreateChannelProductDto, ChannelProduct, UpdateChannelProduct, SalesChannel, ProductMaster } from '../types';

@Controller('channel-products')
export class ChannelProductsController {
  constructor(private readonly channelProductsService: ChannelProductsService) {}

  @Post()
  async createChannelProduct(@Body() createDto: CreateChannelProductDto): Promise<ChannelProduct> {
    try {
      if (!createDto.masterId || !createDto.channelId) {
        throw new HttpException('Master ID and Channel ID are required', HttpStatus.BAD_REQUEST);
      }

      return await this.channelProductsService.createChannelProduct(createDto);
    } catch (error) {
      if (error.message.includes('required') || error.message.includes('already exists')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException('Failed to create channel product', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('masters/:masterId')
  async getChannelProductsByMaster(@Param('masterId') masterId: string): Promise<(ChannelProduct & { channel: SalesChannel })[]> {
    try {
      return await this.channelProductsService.getChannelProductsByMaster(masterId);
    } catch (error) {
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to get channel products by master', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('channels/:channelId')
  async getChannelProductsByChannel(
    @Param('channelId') channelId: string, 
    @Query() query: {
      isActive?: string;
      search?: string;
      page?: string;
      limit?: string;
    }
  ): Promise<{
    data: (ChannelProduct & { master: ProductMaster })[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const filters = {
        isActive: query.isActive ? query.isActive === 'true' : undefined,
        search: query.search,
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit ? parseInt(query.limit) : undefined,
      };

      return await this.channelProductsService.getChannelProductsByChannel(channelId, filters);
    } catch (error) {
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to get channel products by channel', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':id')
  async getChannelProduct(@Param('id') id: string): Promise<ChannelProduct> {
    try {
      const channelProduct = await this.channelProductsService.getChannelProduct(id);
      
      if (!channelProduct) {
        throw new HttpException('Channel product not found', HttpStatus.NOT_FOUND);
      }

      return channelProduct;
    } catch (error) {
      if (error.message === 'Channel product not found' || error.status === HttpStatus.NOT_FOUND) {
        throw new HttpException('Channel product not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to get channel product', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put(':id')
  async updateChannelProduct(
    @Param('id') id: string, 
    @Body() updateDto: UpdateChannelProduct
  ): Promise<ChannelProduct> {
    try {
      return await this.channelProductsService.updateChannelProduct(id, updateDto);
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Channel product not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to update channel product', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':id')
  async deleteChannelProduct(@Param('id') id: string): Promise<void> {
    try {
      await this.channelProductsService.deleteChannelProduct(id);
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Channel product not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to delete channel product', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('masters/:masterId/channels/:channelId/merged')
  async getMergedChannelProduct(
    @Param('masterId') masterId: string, 
    @Param('channelId') channelId: string
  ): Promise<{
    id: string;
    masterId: string;
    channelId: string;
    name: string;
    description: string;
    images: string[];
    isActive: boolean;
    basePrice: number;
    channelSpecificData?: any;
  }> {
    try {
      const mergedProduct = await this.channelProductsService.getMergedChannelProduct(masterId, channelId);
      
      if (!mergedProduct) {
        throw new HttpException('Channel product not found', HttpStatus.NOT_FOUND);
      }

      return mergedProduct;
    } catch (error) {
      if (error.message === 'Channel product not found' || error.status === HttpStatus.NOT_FOUND) {
        throw new HttpException('Channel product not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to get merged channel product', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put(':id/name')
  async overrideProductName(
    @Param('id') id: string,
    @Body() nameDto: { name: string }
  ): Promise<void> {
    try {
      if (!nameDto.name) {
        throw new HttpException('Product name is required', HttpStatus.BAD_REQUEST);
      }

      await this.channelProductsService.overrideProductName(id, nameDto.name);
    } catch (error) {
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      if (error.message.includes('not found')) {
        throw new HttpException('Channel product not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException('Failed to override product name', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put(':id/status')
  async setChannelProductActive(
    @Param('id') id: string,
    @Body() statusDto: { isActive: boolean }
  ): Promise<void> {
    try {
      if (statusDto.isActive === undefined) {
        throw new HttpException('isActive is required', HttpStatus.BAD_REQUEST);
      }

      await this.channelProductsService.setChannelProductActive(id, statusDto.isActive);
    } catch (error) {
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      if (error.message.includes('not found')) {
        throw new HttpException('Channel product not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException('Failed to set channel product status', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
} 