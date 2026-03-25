import { Controller, Get, Post, Put, Delete, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
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
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getCategories(): Promise<ChannelCategoryListResponseDto> {
    try {
      const entities = await this.channelCategoriesService.findAll();
      const data = ChannelCategoryMapper.toDtoArray(entities);
      return { data };
    } catch (error) {
      throw new HttpException('Failed to get categories', HttpStatus.INTERNAL_SERVER_ERROR);
    }
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
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getCategoryById(@Param('id') id: string): Promise<ChannelCategoryDto> {
    try {
      const category = await this.channelCategoriesService.findById(id);

      if (!category) {
        throw new HttpException('Category not found', HttpStatus.NOT_FOUND);
      }

      return ChannelCategoryMapper.toDto(category);
    } catch (error) {
      if (error.message.includes('not found') || error.status === HttpStatus.NOT_FOUND) {
        throw new HttpException('Category not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException('Failed to get category', HttpStatus.INTERNAL_SERVER_ERROR);
    }
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
  @ApiResponse({ status: 500, description: '서버 오류' })
  async createCategory(@Body() createDto: CreateChannelCategoryDto): Promise<ChannelCategoryDto> {
    try {
      if (!createDto.name) {
        throw new HttpException('Category name is required', HttpStatus.BAD_REQUEST);
      }

      const entity = await this.channelCategoriesService.create(createDto);
      return ChannelCategoryMapper.toDto(entity);
    } catch (error) {
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to create category', HttpStatus.INTERNAL_SERVER_ERROR);
    }
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
  @ApiResponse({ status: 500, description: '서버 오류' })
  async updateCategory(
    @Param('id') id: string,
    @Body() updateDto: UpdateChannelCategoryDto,
  ): Promise<ChannelCategoryDto> {
    try {
      const entity = await this.channelCategoriesService.update(id, updateDto);
      return ChannelCategoryMapper.toDto(entity);
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Category not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Failed to update category', HttpStatus.INTERNAL_SERVER_ERROR);
    }
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
  @ApiResponse({ status: 500, description: '서버 오류' })
  async deleteCategory(@Param('id') id: string): Promise<void> {
    try {
      await this.channelCategoriesService.delete(id);
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Category not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('Cannot delete')) {
        throw new HttpException(error.message, HttpStatus.CONFLICT);
      }
      throw new HttpException('Failed to delete category', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
