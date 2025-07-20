import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpException, HttpStatus } from '@nestjs/common';
import { SalesChannelsService } from '../services/sales-channels.service';
import { SalesChannel, NewSalesChannel, UpdateSalesChannel } from '../types';

@Controller('channels')
export class SalesChannelsController {
  constructor(private readonly salesChannelsService: SalesChannelsService) {}

  @Post()
  async createChannel(@Body() createDto: NewSalesChannel): Promise<SalesChannel> {
    try {
      if (!createDto.type || !createDto.name) {
        throw new HttpException('Channel type and name are required', HttpStatus.BAD_REQUEST);
      }

      return await this.salesChannelsService.createChannel(createDto);
    } catch (error) {
      if (error.message.includes('required') || error.message.includes('already exists')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to create channel', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get()
  async getChannels(@Query() query: {
    isActive?: string;
    type?: string;
    search?: string;
    page?: string;
    limit?: string;
  }): Promise<{
    data: SalesChannel[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const filters = {
        isActive: query.isActive ? query.isActive === 'true' : undefined,
        type: query.type,
        search: query.search,
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit ? parseInt(query.limit) : undefined,
      };

      return await this.salesChannelsService.getChannels(filters);
    } catch (error) {
      throw new HttpException('Failed to get channels', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('active')
  async getActiveChannels(): Promise<SalesChannel[]> {
    try {
      return await this.salesChannelsService.getActiveChannels();
    } catch (error) {
      throw new HttpException('Failed to get active channels', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':id')
  async getChannelById(@Param('id') id: string): Promise<SalesChannel> {
    try {
      const channel = await this.salesChannelsService.getChannelById(id);
      
      if (!channel) {
        throw new HttpException('Channel not found', HttpStatus.NOT_FOUND);
      }

      return channel;
    } catch (error) {
      if (error.message === 'Channel not found' || error.status === HttpStatus.NOT_FOUND) {
        throw new HttpException('Channel not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to get channel', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put(':id')
  async updateChannel(
    @Param('id') id: string, 
    @Body() updateDto: UpdateSalesChannel
  ): Promise<SalesChannel> {
    try {
      return await this.salesChannelsService.updateChannel(id, updateDto);
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Channel not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required') || error.message.includes('already exists')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to update channel', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':id')
  async deleteChannel(@Param('id') id: string): Promise<void> {
    try {
      await this.salesChannelsService.deleteChannel(id);
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Channel not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('Cannot delete channel')) {
        throw new HttpException(error.message, HttpStatus.CONFLICT);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to delete channel', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put(':id/status')
  async setChannelActive(
    @Param('id') id: string, 
    @Body() statusDto: { isActive: boolean }
  ): Promise<void> {
    try {
      if (statusDto.isActive === undefined) {
        throw new HttpException('isActive is required', HttpStatus.BAD_REQUEST);
      }

      await this.salesChannelsService.setChannelActive(id, statusDto.isActive);
    } catch (error) {
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      if (error.message.includes('not found')) {
        throw new HttpException('Channel not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException('Failed to set channel status', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('type/:type')
  async getChannelByType(@Param('type') type: string): Promise<SalesChannel> {
    try {
      const channel = await this.salesChannelsService.getChannelByType(type);
      
      if (!channel) {
        throw new HttpException('Channel not found', HttpStatus.NOT_FOUND);
      }

      return channel;
    } catch (error) {
      if (error.message === 'Channel not found' || error.status === HttpStatus.NOT_FOUND) {
        throw new HttpException('Channel not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to get channel by type', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('validate')
  async validateChannelConfig(@Body() configDto: { type: string; config: any }): Promise<{
    isValid: boolean;
    errors: string[];
  }> {
    try {
      if (!configDto.type) {
        throw new HttpException('Channel type is required', HttpStatus.BAD_REQUEST);
      }

      return await this.salesChannelsService.validateChannelConfig(configDto.type, configDto.config);
    } catch (error) {
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to validate channel config', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
} 