import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public, RequirePermission, User } from '@app/authorization';
import {
  AlmondTemplateCategoryResponseDto,
  ReorderAlmondTemplateCategoriesDto,
  UpsertAlmondTemplateCategoryDto,
} from '../dto/almond-template-category.dto';
import { AlmondTemplateCategoriesService } from '../services/almond-template-categories.service';

@ApiTags('Almond Template Categories')
@Controller()
export class AlmondTemplateCategoriesController {
  constructor(private readonly service: AlmondTemplateCategoriesService) {}

  @Public()
  @Get('almond-template-categories')
  @ApiOperation({
    summary: '랜딩에 보일 디지털템플릿 카테고리',
    description: '숨긴 것·지운 것은 빠진다. 정한 순서대로',
  })
  @ApiResponse({ status: 200, type: [AlmondTemplateCategoryResponseDto] })
  listVisible(): Promise<AlmondTemplateCategoryResponseDto[]> {
    return this.service.listVisible();
  }

  @RequirePermission('marketing.almond_template.read')
  @Get('admin/almond-template-categories')
  @ApiBearerAuth()
  @ApiOperation({ summary: '디지털템플릿 카테고리 전체 (숨김 포함)' })
  @ApiResponse({ status: 200, type: [AlmondTemplateCategoryResponseDto] })
  listForAdmin(): Promise<AlmondTemplateCategoryResponseDto[]> {
    return this.service.listForAdmin();
  }

  @RequirePermission('marketing.almond_template.write')
  @Post('admin/almond-template-categories')
  @ApiBearerAuth()
  @ApiOperation({ summary: '카테고리 추가', description: '맨 뒤에 붙는다' })
  @ApiBody({ type: UpsertAlmondTemplateCategoryDto })
  @ApiResponse({ status: 201, type: AlmondTemplateCategoryResponseDto })
  @ApiResponse({ status: 400 })
  create(
    @Body() dto: UpsertAlmondTemplateCategoryDto,
    @User('userId') userId: string,
  ): Promise<AlmondTemplateCategoryResponseDto> {
    return this.service.create(dto, userId);
  }

  @RequirePermission('marketing.almond_template.write')
  @Put('admin/almond-template-categories/order')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: '카테고리 순서 바꾸기', description: '지금 있는 카테고리 id 를 빠짐없이 순서대로 보낸다' })
  @ApiBody({ type: ReorderAlmondTemplateCategoriesDto })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 400 })
  async reorder(@Body() dto: ReorderAlmondTemplateCategoriesDto, @User('userId') userId: string): Promise<void> {
    await this.service.reorder(dto.ids, userId);
  }

  @RequirePermission('marketing.almond_template.write')
  @Put('admin/almond-template-categories/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '카테고리 수정' })
  @ApiBody({ type: UpsertAlmondTemplateCategoryDto })
  @ApiResponse({ status: 200, type: AlmondTemplateCategoryResponseDto })
  @ApiResponse({ status: 404 })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertAlmondTemplateCategoryDto,
    @User('userId') userId: string,
  ): Promise<AlmondTemplateCategoryResponseDto> {
    return this.service.update(id, dto, userId);
  }

  @RequirePermission('marketing.almond_template.write')
  @Delete('admin/almond-template-categories/:id')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: '카테고리 삭제' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404 })
  async remove(@Param('id', ParseUUIDPipe) id: string, @User('userId') userId: string): Promise<void> {
    await this.service.remove(id, userId);
  }
}
