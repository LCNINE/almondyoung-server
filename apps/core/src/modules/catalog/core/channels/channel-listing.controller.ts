import { Controller, Get, Post, Put, Delete, Body, Param, ConflictException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { RequirePermission } from '@app/authorization';
import { ChannelListingService } from './channel-listing.service';
import {
  CreateChannelListingDto,
  UpdateChannelListingDto,
  ChannelListingDto,
  ChannelListingWithChannelDto,
} from './dto';
import { ChannelListingMapper } from './mappers';

@ApiTags('Channel Listings')
@Controller('channel-listings')
export class ChannelListingController {
  constructor(private readonly channelListingService: ChannelListingService) {}

  @RequirePermission('catalog.channel_listing.write')
  @Post()
  @ApiOperation({
    summary: '채널 매핑 생성',
    description: 'PIM Variant와 채널 상품 ID 간의 매핑을 생성합니다.',
  })
  @ApiBody({ type: CreateChannelListingDto, description: '매핑 생성 정보' })
  @ApiResponse({
    status: 201,
    description: '매핑 생성 성공',
    type: ChannelListingDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 409, description: '이미 동일한 매핑이 존재함' })
  async create(@Body() dto: CreateChannelListingDto): Promise<ChannelListingDto> {
    const exists = await this.channelListingService.existsListing(dto.salesChannelId, dto.channelItemId);
    if (exists) {
      throw new ConflictException(`Mapping already exists for channel item: ${dto.channelItemId}`);
    }
    const listing = await this.channelListingService.createListing(dto);
    return ChannelListingMapper.toDto(listing);
  }

  @RequirePermission('catalog.product.read')
  @Get('by-variant/:variantId')
  @ApiOperation({
    summary: 'Variant의 채널 등록 현황 조회',
    description: '특정 Variant가 등록된 모든 채널 목록을 조회합니다.',
  })
  @ApiParam({ name: 'variantId', description: 'PIM Variant ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: '채널 등록 현황 조회 성공',
    type: [ChannelListingWithChannelDto],
  })
  async getByVariant(@Param('variantId') variantId: string): Promise<ChannelListingWithChannelDto[]> {
    const listings = await this.channelListingService.getListingsByVariant(variantId);
    return listings.map((listing) => ChannelListingMapper.toWithChannelDto(listing));
  }

  @RequirePermission('catalog.product.read')
  @Get(':id')
  @ApiOperation({
    summary: '채널 매핑 상세 조회',
    description: '특정 채널 매핑의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '매핑 ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: '매핑 조회 성공',
    type: ChannelListingDto,
  })
  @ApiResponse({ status: 404, description: '매핑을 찾을 수 없음' })
  async getById(@Param('id') id: string): Promise<ChannelListingDto> {
    const listing = await this.channelListingService.getListingById(id);
    if (!listing) {
      throw new NotFoundException('Channel listing not found');
    }
    return ChannelListingMapper.toDto(listing);
  }

  @RequirePermission('catalog.channel_listing.write')
  @Put(':id')
  @ApiOperation({
    summary: '채널 매핑 수정',
    description: '기존 채널 매핑의 정보를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '매핑 ID (UUID)' })
  @ApiBody({ type: UpdateChannelListingDto, description: '수정할 매핑 정보' })
  @ApiResponse({
    status: 200,
    description: '매핑 수정 성공',
    type: ChannelListingDto,
  })
  @ApiResponse({ status: 404, description: '매핑을 찾을 수 없음' })
  async update(@Param('id') id: string, @Body() dto: UpdateChannelListingDto): Promise<ChannelListingDto> {
    const updated = await this.channelListingService.updateListing(id, dto);
    if (!updated) {
      throw new NotFoundException('Channel listing not found');
    }
    return ChannelListingMapper.toDto(updated);
  }

  @RequirePermission('catalog.channel_listing.write')
  @Put(':id/deactivate')
  @ApiOperation({
    summary: '채널 매핑 비활성화',
    description: '채널 매핑을 비활성화합니다. (soft delete)',
  })
  @ApiParam({ name: 'id', description: '매핑 ID (UUID)' })
  @ApiResponse({ status: 200, description: '비활성화 성공' })
  async deactivate(@Param('id') id: string): Promise<void> {
    await this.channelListingService.deactivateListing(id);
  }

  @RequirePermission('catalog.channel_listing.write')
  @Put(':id/activate')
  @ApiOperation({
    summary: '채널 매핑 활성화',
    description: '비활성화된 채널 매핑을 다시 활성화합니다.',
  })
  @ApiParam({ name: 'id', description: '매핑 ID (UUID)' })
  @ApiResponse({ status: 200, description: '활성화 성공' })
  async activate(@Param('id') id: string): Promise<void> {
    await this.channelListingService.activateListing(id);
  }

  @RequirePermission('catalog.channel_listing.write')
  @Delete(':id')
  @ApiOperation({
    summary: '채널 매핑 삭제',
    description: '채널 매핑을 완전히 삭제합니다. (hard delete)',
  })
  @ApiParam({ name: 'id', description: '삭제할 매핑 ID (UUID)' })
  @ApiResponse({ status: 200, description: '삭제 성공' })
  async delete(@Param('id') id: string): Promise<void> {
    await this.channelListingService.deleteListing(id);
  }
}
