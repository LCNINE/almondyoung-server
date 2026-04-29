import { Controller, Get, Post, Put, Delete, Body, Param, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { ChannelCategoriesService } from './channel-categories.service';
import {
  CreateChannelCategoryDto,
  UpdateChannelCategoryDto,
  ChannelCategoryDto,
  ChannelCategoryListResponseDto,
} from './dto/channel-categories';
import { ChannelCategoryMapper } from './mappers';

@ApiTags('Channel Categories')
@Controller('channels/categories')
export class ChannelCategoriesController {
  constructor(private readonly channelCategoriesService: ChannelCategoriesService) {}

  @Get()
  @ApiOperation({
    summary: '판매처 분류 목록 조회',
    description: '전체 판매처 분류 목록을 조회합니다. 각 분류별로 속한 채널 수도 함께 반환됩니다.',
  })
  @ApiResponse({
    status: 200,
    description: '판매처 분류 목록 조회 성공',
    type: ChannelCategoryListResponseDto,
  })
  async getCategories(): Promise<ChannelCategoryListResponseDto> {
    const entities = await this.channelCategoriesService.findAll();
    const data = ChannelCategoryMapper.toDtoArray(entities);
    return { data };
  }

  @Get(':id')
  @ApiOperation({
    summary: '판매처 분류 상세 조회',
    description: '특정 판매처 분류의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '분류 ID' })
  @ApiResponse({
    status: 200,
    description: '판매처 분류 조회 성공',
    type: ChannelCategoryDto,
  })
  @ApiResponse({ status: 404, description: '분류를 찾을 수 없음' })
  async getCategoryById(@Param('id') id: string): Promise<ChannelCategoryDto> {
    const category = await this.channelCategoriesService.findById(id);
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return ChannelCategoryMapper.toDto(category);
  }

  @Post()
  @ApiOperation({
    summary: '판매처 분류 생성',
    description: '새로운 판매처 분류를 생성합니다.',
  })
  @ApiBody({ type: CreateChannelCategoryDto, description: '판매처 분류 생성 정보' })
  @ApiResponse({
    status: 201,
    description: '판매처 분류 생성 성공',
    type: ChannelCategoryDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  async createCategory(@Body() createDto: CreateChannelCategoryDto): Promise<ChannelCategoryDto> {
    const entity = await this.channelCategoriesService.create(createDto);
    return ChannelCategoryMapper.toDto(entity);
  }

  @Put(':id')
  @ApiOperation({
    summary: '판매처 분류 수정',
    description: '기존 판매처 분류 정보를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '분류 ID' })
  @ApiBody({
    type: UpdateChannelCategoryDto,
    description: '수정할 판매처 분류 정보',
  })
  @ApiResponse({
    status: 200,
    description: '판매처 분류 수정 성공',
    type: ChannelCategoryDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '분류를 찾을 수 없음' })
  async updateCategory(
    @Param('id') id: string,
    @Body() updateDto: UpdateChannelCategoryDto,
  ): Promise<ChannelCategoryDto> {
    const entity = await this.channelCategoriesService.update(id, updateDto);
    return ChannelCategoryMapper.toDto(entity);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '판매처 분류 삭제',
    description: '판매처 분류를 삭제합니다. 연결된 채널이 있으면 삭제할 수 없습니다.',
  })
  @ApiParam({ name: 'id', description: '삭제할 분류 ID' })
  @ApiResponse({ status: 200, description: '판매처 분류 삭제 성공' })
  @ApiResponse({ status: 404, description: '분류를 찾을 수 없음' })
  @ApiResponse({ status: 409, description: '연결된 채널이 있어 삭제할 수 없음' })
  async deleteCategory(@Param('id') id: string): Promise<void> {
    await this.channelCategoriesService.delete(id);
  }
}
