import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { BannersService } from './banners.service';
import {
  CreateBannerGroupDto,
  UpdateBannerGroupDto,
  BannerGroupResponseDto,
  BannerGroupWithBannersResponseDto,
} from './dto';

@ApiTags('Banner Groups')
@Controller('banner-groups')
export class BannerGroupsController {
  constructor(private readonly bannersService: BannersService) {}

  @Post()
  @ApiOperation({
    summary: '배너 그룹 생성',
    description: '새로운 배너 그룹을 생성합니다.',
  })
  @ApiBody({ type: CreateBannerGroupDto })
  @ApiResponse({ status: 201, description: '배너 그룹 생성 성공', type: BannerGroupResponseDto })
  @ApiResponse({ status: 409, description: '중복된 코드' })
  async createBannerGroup(@Body() dto: CreateBannerGroupDto): Promise<BannerGroupResponseDto> {
    return this.bannersService.createBannerGroup(dto);
  }

  @Get()
  @ApiOperation({
    summary: '배너 그룹 목록 조회',
    description: '배너 그룹 목록을 조회합니다. 카테고리로 필터링 가능합니다.',
  })
  @ApiQuery({ name: 'category', required: false, description: '배너 그룹 카테고리' })
  @ApiResponse({ status: 200, description: '배너 그룹 목록 조회 성공', type: [BannerGroupResponseDto] })
  async listBannerGroups(@Query('category') category?: string): Promise<BannerGroupResponseDto[]> {
    return this.bannersService.listBannerGroups(category);
  }

  @Get('by-code/:code')
  @ApiOperation({
    summary: '배너 그룹 조회 (코드)',
    description: '코드로 배너 그룹과 활성화된 배너 목록을 조회합니다. 프론트엔드에서 사용됩니다.',
  })
  @ApiParam({ name: 'code', description: '배너 그룹 코드', example: 'AY2312' })
  @ApiResponse({ status: 200, description: '배너 그룹 조회 성공', type: BannerGroupWithBannersResponseDto })
  @ApiResponse({ status: 404, description: '배너 그룹을 찾을 수 없음' })
  async getBannerGroupByCode(@Param('code') code: string): Promise<BannerGroupWithBannersResponseDto> {
    return this.bannersService.getBannerGroupByCode(code);
  }

  @Get(':id')
  @ApiOperation({
    summary: '배너 그룹 상세 조회 (ID)',
    description: 'ID로 배너 그룹을 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '배너 그룹 ID' })
  @ApiResponse({ status: 200, description: '배너 그룹 조회 성공', type: BannerGroupResponseDto })
  @ApiResponse({ status: 404, description: '배너 그룹을 찾을 수 없음' })
  async getBannerGroupById(@Param('id') id: string): Promise<BannerGroupResponseDto> {
    return this.bannersService.getBannerGroupById(id);
  }

  @Put(':id')
  @ApiOperation({
    summary: '배너 그룹 수정',
    description: '배너 그룹 정보를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '배너 그룹 ID' })
  @ApiBody({ type: UpdateBannerGroupDto })
  @ApiResponse({ status: 200, description: '배너 그룹 수정 성공', type: BannerGroupResponseDto })
  @ApiResponse({ status: 404, description: '배너 그룹을 찾을 수 없음' })
  async updateBannerGroup(@Param('id') id: string, @Body() dto: UpdateBannerGroupDto): Promise<BannerGroupResponseDto> {
    return this.bannersService.updateBannerGroup(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '배너 그룹 삭제 (Soft Delete)',
    description: '배너 그룹과 포함된 모든 배너를 soft delete 합니다.',
  })
  @ApiParam({ name: 'id', description: '배너 그룹 ID' })
  @ApiQuery({ name: 'deletedBy', required: false, description: '삭제자 ID' })
  @ApiResponse({ status: 200, description: '배너 그룹 삭제 성공' })
  @ApiResponse({ status: 404, description: '배너 그룹을 찾을 수 없음' })
  async deleteBannerGroup(
    @Param('id') id: string,
    @Query('deletedBy') deletedBy?: string,
  ): Promise<{ message: string }> {
    await this.bannersService.deleteBannerGroup(id, deletedBy);
    return { message: 'Banner group deleted successfully' };
  }
}
