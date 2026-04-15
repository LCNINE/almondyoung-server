import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { BannersService } from './banners.service';
import { CreateBannerDto, UpdateBannerDto, BannerResponseDto } from './dto';

@ApiTags('Banners')
@Controller('banners')
export class BannersController {
  constructor(private readonly bannersService: BannersService) {}

  @Post()
  @ApiOperation({
    summary: '배너 생성',
    description: '배너 그룹에 새로운 배너를 추가합니다.',
  })
  @ApiBody({ type: CreateBannerDto })
  @ApiResponse({
    status: 201,
    description: '배너 생성 성공',
    type: BannerResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 404, description: '배너 그룹을 찾을 수 없음' })
  async createBanner(@Body() dto: CreateBannerDto): Promise<BannerResponseDto> {
    try {
      return await this.bannersService.createBanner(dto);
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(`Failed to create banner: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('by-group/:bannerGroupId')
  @ApiOperation({
    summary: '배너 그룹의 배너 목록 조회',
    description: '특정 배너 그룹에 속한 배너 목록을 조회합니다.',
  })
  @ApiParam({ name: 'bannerGroupId', description: '배너 그룹 ID' })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    type: Boolean,
    description: '비활성화된 배너도 포함할지 여부 (기본: false)',
  })
  @ApiResponse({
    status: 200,
    description: '배너 목록 조회 성공',
    type: [BannerResponseDto],
  })
  async listBannersByGroupId(
    @Param('bannerGroupId') bannerGroupId: string,
    @Query('includeInactive') includeInactive?: boolean,
  ): Promise<BannerResponseDto[]> {
    try {
      return await this.bannersService.listBannersByGroupId(bannerGroupId, includeInactive === true);
    } catch (error) {
      throw new HttpException(`Failed to list banners: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':id')
  @ApiOperation({
    summary: '배너 상세 조회',
    description: 'ID로 배너 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '배너 ID' })
  @ApiResponse({
    status: 200,
    description: '배너 조회 성공',
    type: BannerResponseDto,
  })
  @ApiResponse({ status: 404, description: '배너를 찾을 수 없음' })
  async getBannerById(@Param('id') id: string): Promise<BannerResponseDto> {
    try {
      return await this.bannersService.getBannerById(id);
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(`Failed to get banner: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put(':id')
  @ApiOperation({
    summary: '배너 수정',
    description: '배너 정보를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '배너 ID' })
  @ApiBody({ type: UpdateBannerDto })
  @ApiResponse({
    status: 200,
    description: '배너 수정 성공',
    type: BannerResponseDto,
  })
  @ApiResponse({ status: 404, description: '배너를 찾을 수 없음' })
  async updateBanner(@Param('id') id: string, @Body() dto: UpdateBannerDto): Promise<BannerResponseDto> {
    try {
      return await this.bannersService.updateBanner(id, dto);
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(`Failed to update banner: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':id')
  @ApiOperation({
    summary: '배너 삭제 (Soft Delete)',
    description: '배너를 soft delete 합니다.',
  })
  @ApiParam({ name: 'id', description: '배너 ID' })
  @ApiQuery({ name: 'deletedBy', required: false, description: '삭제자 ID' })
  @ApiResponse({ status: 200, description: '배너 삭제 성공' })
  @ApiResponse({ status: 404, description: '배너를 찾을 수 없음' })
  async deleteBanner(@Param('id') id: string, @Query('deletedBy') deletedBy?: string): Promise<{ message: string }> {
    try {
      await this.bannersService.deleteBanner(id, deletedBy);
      return { message: 'Banner deleted successfully' };
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(`Failed to delete banner: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
