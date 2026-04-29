import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { SalesChannelsService } from './sales-channels.service';
import {
  CreateSalesChannelDto,
  UpdateSalesChannelDto,
  SetChannelActiveDto,
  ValidateChannelConfigDto,
  SalesChannelDto,
  ChannelListResponseDto,
  ChannelValidationResponseDto,
} from './dto';
import { PaginatedResponseDto } from '../../common/dto';
import { ApiOkResponsePaginated } from '../../common/decorators';
import { SalesChannelMapper } from './mappers';

@ApiTags('Sales Channels')
@Controller('channels')
export class SalesChannelsController {
  constructor(private readonly salesChannelsService: SalesChannelsService) {}

  @Post()
  @ApiOperation({
    summary: '판매 채널 생성',
    description: '새로운 판매 채널(온라인 쇼핑몰, 오프라인 매장 등)을 생성합니다.',
  })
  @ApiBody({ type: CreateSalesChannelDto, description: '판매 채널 생성 정보' })
  @ApiResponse({ status: 201, description: '판매 채널 생성 성공', type: SalesChannelDto })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터 (type, name 필수)' })
  async createChannel(@Body() createDto: CreateSalesChannelDto): Promise<SalesChannelDto> {
    const entity = await this.salesChannelsService.createChannel(createDto);
    return SalesChannelMapper.toDto(entity);
  }

  @Get()
  @ApiOperation({
    summary: '판매 채널 목록 조회',
    description: '판매 채널 목록을 필터링 및 페이지네이션과 함께 조회합니다.',
  })
  @ApiQuery({ name: 'isActive', required: false, type: String, description: '활성 상태 필터 (true/false)' })
  @ApiQuery({ name: 'type', required: false, type: String, description: '채널 타입 필터' })
  @ApiQuery({ name: 'search', required: false, type: String, description: '검색 키워드' })
  @ApiQuery({ name: 'page', required: false, type: String, description: '페이지 번호' })
  @ApiQuery({ name: 'limit', required: false, type: String, description: '페이지 당 아이템 수' })
  @ApiOkResponsePaginated(SalesChannelDto, { description: '판매 채널 목록 조회 성공' })
  async getChannels(
    @Query() query: { isActive?: string; type?: string; search?: string; page?: string; limit?: string },
  ): Promise<PaginatedResponseDto<SalesChannelDto>> {
    const filters = {
      isActive: query.isActive ? query.isActive === 'true' : undefined,
      type: query.type,
      search: query.search,
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    };
    const result = await this.salesChannelsService.getChannels(filters);
    return {
      ...result,
      data: SalesChannelMapper.toDtoArray(result.data),
    };
  }

  @Get('active')
  @ApiOperation({
    summary: '활성 판매 채널 조회',
    description: '활성 상태인 판매 채널만 조회합니다.',
  })
  @ApiOkResponsePaginated(SalesChannelDto, { description: '활성 판매 채널 조회 성공' })
  async getActiveChannels(): Promise<PaginatedResponseDto<SalesChannelDto>> {
    const { data, ...pageInfo } = await this.salesChannelsService.getActiveChannels();
    return {
      ...pageInfo,
      data: SalesChannelMapper.toDtoArray(data),
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: '판매 채널 상세 조회',
    description: '특정 판매 채널의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '판매 채널 ID' })
  @ApiResponse({ status: 200, description: '판매 채널 상세 조회 성공', type: SalesChannelDto })
  @ApiResponse({ status: 404, description: '판매 채널을 찾을 수 없음' })
  async getChannelById(@Param('id') id: string): Promise<SalesChannelDto> {
    const channel = await this.salesChannelsService.tryGetChannelById(id);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    return SalesChannelMapper.toDto(channel);
  }

  @Put(':id')
  @ApiOperation({
    summary: '판매 채널 수정',
    description: '기존 판매 채널 정보를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '판매 채널 ID' })
  @ApiBody({ type: UpdateSalesChannelDto, description: '수정할 판매 채널 정보' })
  @ApiResponse({ status: 200, description: '판매 채널 수정 성공', type: SalesChannelDto })
  @ApiResponse({ status: 404, description: '판매 채널을 찾을 수 없음' })
  async updateChannel(@Param('id') id: string, @Body() updateDto: UpdateSalesChannelDto): Promise<SalesChannelDto> {
    const entity = await this.salesChannelsService.updateChannel(id, updateDto);
    return SalesChannelMapper.toDto(entity);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '판매 채널 삭제',
    description: '판매 채널을 삭제합니다.',
  })
  @ApiParam({ name: 'id', description: '삭제할 판매 채널 ID' })
  @ApiResponse({ status: 200, description: '판매 채널 삭제 성공' })
  @ApiResponse({ status: 404, description: '판매 채널을 찾을 수 없음' })
  @ApiResponse({ status: 409, description: '사용 중인 채널로 삭제할 수 없음' })
  async deleteChannel(@Param('id') id: string): Promise<void> {
    await this.salesChannelsService.deleteChannel(id);
  }

  @Put(':id/status')
  @ApiOperation({
    summary: '판매 채널 상태 설정',
    description: '판매 채널의 활성/비활성 상태를 설정합니다.',
  })
  @ApiParam({ name: 'id', description: '판매 채널 ID' })
  @ApiBody({ type: SetChannelActiveDto, description: '상태 설정 데이터' })
  @ApiResponse({ status: 200, description: '판매 채널 상태 설정 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터 (isActive 필수)' })
  @ApiResponse({ status: 404, description: '판매 채널을 찾을 수 없음' })
  async setChannelActive(@Param('id') id: string, @Body() statusDto: SetChannelActiveDto): Promise<void> {
    if (statusDto.isActive === undefined) {
      throw new BadRequestException('isActive is required');
    }
    await this.salesChannelsService.setChannelActive(id, statusDto.isActive);
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '판매 채널 설정 검증',
    description: '판매 채널의 설정 정보가 유효한지 검증합니다.',
  })
  @ApiBody({ type: ValidateChannelConfigDto, description: '검증할 채널 설정 데이터' })
  @ApiResponse({ status: 200, description: '채널 설정 검증 완료', type: ChannelValidationResponseDto })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터 (type 필수)' })
  async validateChannelConfig(@Body() configDto: ValidateChannelConfigDto): Promise<ChannelValidationResponseDto> {
    if (!configDto.site) {
      throw new BadRequestException('Channel site is required');
    }
    return (await this.salesChannelsService.validateChannelConfig(
      configDto.site,
      configDto.config,
    )) as ChannelValidationResponseDto;
  }
}
