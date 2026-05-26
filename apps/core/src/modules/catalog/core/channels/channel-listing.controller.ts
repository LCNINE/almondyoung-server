import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { Public } from '@app/authorization';
import { ChannelListingService } from './channel-listing.service';
import {
  CreateChannelListingDto,
  UpdateChannelListingDto,
  ChannelListingDto,
  ChannelListingWithChannelDto,
  LookupChannelListingResponseDto,
} from './dto';
import { ChannelListingMapper } from './mappers';

@ApiTags('Channel Listings')
@Controller('channel-listings')
export class ChannelListingController {
  constructor(private readonly channelListingService: ChannelListingService) {}

  @Get('lookup')
  @Public()
  @ApiOperation({
    summary: '채널 상품 ID로 Variant 조회',
    description:
      '채널에서의 상품 ID를 사용하여 매핑된 PIM Variant를 조회합니다. Channel Adapter에서 주문 처리 시 호출됩니다.',
  })
  @ApiQuery({
    name: 'salesChannelId',
    required: false,
    description: '판매 채널 ID (UUID)',
  })
  @ApiQuery({
    name: 'channelCode',
    required: false,
    description: '채널 코드 (site). salesChannelId 대신 사용 가능 (예: coupang, naver)',
  })
  @ApiQuery({
    name: 'channelItemId',
    required: true,
    description: '채널에서의 상품 ID',
  })
  @ApiResponse({
    status: 200,
    description: '매핑 조회 성공',
    type: LookupChannelListingResponseDto,
  })
  @ApiResponse({
    status: 204,
    description: '매핑이 존재하지 않음 (null 반환)',
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 (salesChannelId 또는 channelCode, channelItemId 필수)' })
  async lookup(
    @Query('salesChannelId') salesChannelId?: string,
    @Query('channelCode') channelCode?: string,
    @Query('channelItemId') channelItemId?: string,
  ): Promise<LookupChannelListingResponseDto | null> {
    if (!channelItemId) {
      throw new BadRequestException('channelItemId is required');
    }

    if (!salesChannelId && !channelCode) {
      throw new BadRequestException('Either salesChannelId or channelCode is required');
    }

    if (salesChannelId) {
      return this.channelListingService.lookupVariant(salesChannelId, channelItemId);
    }
    return this.channelListingService.lookupVariantByChannelCode(channelCode!, channelItemId);
  }

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
