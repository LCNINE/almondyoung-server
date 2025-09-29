import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpException, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { ChannelProductsService } from '../services/channel-products.service';
import { CreateChannelProductDto, ChannelProduct, UpdateChannelProduct, SalesChannel, ProductMaster } from '../types';

@ApiTags('Channel Products')
@Controller('channel-products')
export class ChannelProductsController {
  constructor(private readonly channelProductsService: ChannelProductsService) {}

  @Post()
  @ApiOperation({ summary: '채널별 제품 생성', description: '특정 판매 채널에서 사용할 제품 정보를 생성합니다.' })
  @ApiBody({ type: CreateChannelProductDto, description: '채널별 제품 생성 정보' })
  @ApiResponse({ status: 201, description: '채널별 제품 생성 성공', type: ChannelProduct })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터 (masterId, channelId 필수)' })
  @ApiResponse({ status: 404, description: '제품 마스터 또는 판매 채널을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
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
  @ApiOperation({ summary: '마스터별 채널 제품 조회', description: '특정 제품 마스터의 모든 채널별 제품들을 조회합니다.' })
  @ApiParam({ name: 'masterId', description: '제품 마스터 ID' })
  @ApiResponse({ status: 200, description: '마스터별 채널 제품 조회 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 500, description: '서버 오류' })
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
  @ApiOperation({ summary: '채널별 제품 조회', description: '특정 판매 채널의 모든 제품들을 조회합니다.' })
  @ApiParam({ name: 'channelId', description: '판매 채널 ID' })
  @ApiQuery({ name: 'isActive', required: false, type: String, description: '활성 상태 필터 (true/false)' })
  @ApiQuery({ name: 'search', required: false, type: String, description: '검색 키워드' })
  @ApiQuery({ name: 'page', required: false, type: String, description: '페이지 번호' })
  @ApiQuery({ name: 'limit', required: false, type: String, description: '페이지 당 아이템 수' })
  @ApiResponse({ status: 200, description: '채널별 제품 조회 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 500, description: '서버 오류' })
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
  @ApiOperation({ summary: '채널 제품 상세 조회', description: '특정 채널 제품의 상세 정보를 조회합니다.' })
  @ApiParam({ name: 'id', description: '채널 제품 ID' })
  @ApiResponse({ status: 200, description: '채널 제품 상세 조회 성공', type: ChannelProduct })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 404, description: '채널 제품을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
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
  @ApiOperation({ summary: '채널 제품 수정', description: '기존 채널 제품 정보를 수정합니다.' })
  @ApiParam({ name: 'id', description: '채널 제품 ID' })
  @ApiBody({ type: UpdateChannelProduct, description: '수정할 채널 제품 정보' })
  @ApiResponse({ status: 200, description: '채널 제품 수정 성공', type: ChannelProduct })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '채널 제품을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
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
  @ApiOperation({ summary: '채널 제품 삭제', description: '채널 제품을 삭제합니다.' })
  @ApiParam({ name: 'id', description: '삭제할 채널 제품 ID' })
  @ApiResponse({ status: 200, description: '채널 제품 삭제 성공' })
  @ApiResponse({ status: 400, description: '삭제 요구사항 불충족' })
  @ApiResponse({ status: 404, description: '채널 제품을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
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
  @ApiOperation({ summary: '병합된 채널 제품 조회', description: '제품 마스터와 채널별 설정이 병합된 제품 정보를 조회합니다.' })
  @ApiParam({ name: 'masterId', description: '제품 마스터 ID' })
  @ApiParam({ name: 'channelId', description: '판매 채널 ID' })
  @ApiResponse({ status: 200, description: '병합된 채널 제품 조회 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 404, description: '채널 제품을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
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
  @ApiOperation({ summary: '제품명 덤어쓰기', description: '채널별 제품의 이름을 덤어쓰기합니다.' })
  @ApiParam({ name: 'id', description: '채널 제품 ID' })
  @ApiBody({
    description: '새로운 제품명',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '새로운 제품 이름' }
      },
      required: ['name']
    }
  })
  @ApiResponse({ status: 200, description: '제품명 덤어쓰기 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터 (name 필수)' })
  @ApiResponse({ status: 404, description: '채널 제품을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
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
  @ApiOperation({ summary: '채널 제품 상태 설정', description: '채널 제품의 활성/비활성 상태를 설정합니다.' })
  @ApiParam({ name: 'id', description: '채널 제품 ID' })
  @ApiBody({
    description: '상태 설정 데이터',
    schema: {
      type: 'object',
      properties: {
        isActive: { type: 'boolean', description: '활성 여부' }
      },
      required: ['isActive']
    }
  })
  @ApiResponse({ status: 200, description: '채널 제품 상태 설정 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터 (isActive 필수)' })
  @ApiResponse({ status: 404, description: '채널 제품을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
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