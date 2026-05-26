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
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { ChannelProductsService } from './channel-products.service';
import {
  CreateChannelProductDto,
  UpdateChannelProductDto,
  OverrideProductNameDto,
  SetChannelProductActiveDto,
  ChannelProductDto,
  ChannelProductWithChannelDto,
  ChannelProductWithMasterDto,
  ChannelProductListResponseDto,
  MergedChannelProductDto,
} from './dto';
import { PaginatedResponseDto } from '../../common/dto';
import { ApiOkResponsePaginated } from '../../common/decorators';
import { ChannelProductMapper } from './mappers';

@ApiTags('Channel Products')
@Controller('channel-products')
export class ChannelProductsController {
  constructor(private readonly channelProductsService: ChannelProductsService) {}

  @Post()
  @ApiOperation({
    summary: '채널별 제품 생성',
    description: '특정 판매 채널에서 사용할 제품 정보를 생성합니다.',
  })
  @ApiBody({
    type: CreateChannelProductDto,
    description: '채널별 제품 생성 정보',
  })
  @ApiResponse({
    status: 201,
    description: '채널별 제품 생성 성공',
    type: ChannelProductDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터 (masterId, channelId 필수)' })
  @ApiResponse({ status: 404, description: '제품 마스터 또는 판매 채널을 찾을 수 없음' })
  @ApiResponse({ status: 409, description: '이미 존재하는 채널 제품' })
  async createChannelProduct(@Body() createDto: CreateChannelProductDto): Promise<ChannelProductDto> {
    const entity = await this.channelProductsService.createChannelProduct(createDto);
    return ChannelProductMapper.toDto(entity);
  }

  @Get('masters/:masterId')
  @ApiOperation({
    summary: '마스터별 채널 제품 조회',
    description: '특정 제품 마스터의 모든 채널별 제품들을 조회합니다.',
  })
  @ApiParam({ name: 'masterId', description: '제품 마스터 ID' })
  @ApiResponse({
    status: 200,
    description: '마스터별 채널 제품 조회 성공',
    type: [ChannelProductWithChannelDto],
  })
  async getChannelProductsByMaster(@Param('masterId') masterId: string): Promise<ChannelProductWithChannelDto[]> {
    const channelProducts = await this.channelProductsService.getChannelProductsByMaster(masterId);
    return channelProducts.map((item) => ChannelProductMapper.toWithChannelDto(item));
  }

  @Get('channels/:channelId')
  @ApiOperation({
    summary: '채널별 제품 조회',
    description: '특정 판매 채널의 모든 제품들을 조회합니다.',
  })
  @ApiParam({ name: 'channelId', description: '판매 채널 ID' })
  @ApiQuery({ name: 'isActive', required: false, type: String, description: '활성 상태 필터 (true/false)' })
  @ApiQuery({ name: 'search', required: false, type: String, description: '검색 키워드' })
  @ApiQuery({ name: 'page', required: false, type: String, description: '페이지 번호' })
  @ApiQuery({ name: 'limit', required: false, type: String, description: '페이지 당 아이템 수' })
  @ApiOkResponsePaginated(ChannelProductWithMasterDto, { description: '채널별 제품 조회 성공' })
  async getChannelProductsByChannel(
    @Param('channelId') channelId: string,
    @Query() query: { isActive?: string; search?: string; page?: string; limit?: string },
  ): Promise<PaginatedResponseDto<ChannelProductWithMasterDto>> {
    const filters = {
      isActive: query.isActive ? query.isActive === 'true' : undefined,
      search: query.search,
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    };
    return this.channelProductsService.getChannelProductsByChannel(channelId, filters);
  }

  @Get(':id')
  @ApiOperation({
    summary: '채널 제품 상세 조회',
    description: '특정 채널 제품의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '채널 제품 ID' })
  @ApiResponse({ status: 200, description: '채널 제품 상세 조회 성공', type: ChannelProductDto })
  @ApiResponse({ status: 404, description: '채널 제품을 찾을 수 없음' })
  async getChannelProduct(@Param('id') id: string): Promise<ChannelProductDto> {
    const channelProduct = await this.channelProductsService.getChannelProduct(id);
    if (!channelProduct) {
      throw new NotFoundException('Channel product not found');
    }
    return ChannelProductMapper.toDto(channelProduct);
  }

  @Put(':id')
  @ApiOperation({
    summary: '채널 제품 수정',
    description: '기존 채널 제품 정보를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '채널 제품 ID' })
  @ApiBody({ type: UpdateChannelProductDto, description: '수정할 채널 제품 정보' })
  @ApiResponse({ status: 200, description: '채널 제품 수정 성공', type: ChannelProductDto })
  @ApiResponse({ status: 404, description: '채널 제품을 찾을 수 없음' })
  async updateChannelProduct(
    @Param('id') id: string,
    @Body() updateDto: UpdateChannelProductDto,
  ): Promise<ChannelProductDto> {
    const channelProduct = await this.channelProductsService.updateChannelProduct(id, updateDto);
    return ChannelProductMapper.toDto(channelProduct);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '채널 제품 삭제',
    description: '채널 제품을 삭제합니다.',
  })
  @ApiParam({ name: 'id', description: '삭제할 채널 제품 ID' })
  @ApiResponse({ status: 200, description: '채널 제품 삭제 성공' })
  @ApiResponse({ status: 404, description: '채널 제품을 찾을 수 없음' })
  async deleteChannelProduct(@Param('id') id: string): Promise<void> {
    await this.channelProductsService.deleteChannelProduct(id);
  }

  @Get('masters/:masterId/channels/:channelId/merged')
  @ApiOperation({
    summary: '병합된 채널 제품 조회',
    description: '제품 마스터와 채널별 설정이 병합된 제품 정보를 조회합니다.',
  })
  @ApiParam({ name: 'masterId', description: '제품 마스터 ID' })
  @ApiParam({ name: 'channelId', description: '판매 채널 ID' })
  @ApiResponse({ status: 200, description: '병합된 채널 제품 조회 성공', type: MergedChannelProductDto })
  @ApiResponse({ status: 404, description: '채널 제품을 찾을 수 없음' })
  async getMergedChannelProduct(
    @Param('masterId') masterId: string,
    @Param('channelId') channelId: string,
  ): Promise<MergedChannelProductDto> {
    const mergedProduct = await this.channelProductsService.getMergedChannelProduct(masterId, channelId);
    if (!mergedProduct) {
      throw new NotFoundException('Channel product not found');
    }
    return mergedProduct;
  }

  @Put(':id/name')
  @ApiOperation({ summary: '제품명 덮어쓰기', description: '채널별 제품의 이름을 덮어쓰기합니다.' })
  @ApiParam({ name: 'id', description: '채널 제품 ID' })
  @ApiBody({ type: OverrideProductNameDto, description: '새로운 제품명' })
  @ApiResponse({ status: 200, description: '제품명 덮어쓰기 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터 (name 필수)' })
  @ApiResponse({ status: 404, description: '채널 제품을 찾을 수 없음' })
  async overrideProductName(@Param('id') id: string, @Body() nameDto: OverrideProductNameDto): Promise<void> {
    if (!nameDto.name) {
      throw new BadRequestException('Product name is required');
    }
    await this.channelProductsService.overrideProductName(id, nameDto.name);
  }

  @Put(':id/status')
  @ApiOperation({ summary: '채널 제품 상태 설정', description: '채널 제품의 활성/비활성 상태를 설정합니다.' })
  @ApiParam({ name: 'id', description: '채널 제품 ID' })
  @ApiBody({ type: SetChannelProductActiveDto, description: '상태 설정 데이터' })
  @ApiResponse({ status: 200, description: '채널 제품 상태 설정 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터 (isActive 필수)' })
  @ApiResponse({ status: 404, description: '채널 제품을 찾을 수 없음' })
  async setChannelProductActive(@Param('id') id: string, @Body() statusDto: SetChannelProductActiveDto): Promise<void> {
    if (statusDto.isActive === undefined) {
      throw new BadRequestException('isActive is required');
    }
    await this.channelProductsService.setChannelProductActive(id, statusDto.isActive);
  }
}
