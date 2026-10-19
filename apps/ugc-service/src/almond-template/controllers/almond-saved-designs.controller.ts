import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StoreRoute, User } from '@app/authorization';
import {
  AlmondSavedDesignDetailResponseDto,
  AlmondSavedDesignSummaryResponseDto,
  AlmondSavedDesignThumbnailResponseDto,
  ListAlmondSavedDesignsQueryDto,
  UpsertAlmondSavedDesignDto,
} from '../dto/almond-saved-design.dto';
import { AlmondSavedDesignsService } from '../services/almond-saved-designs.service';

@ApiTags('Almond Saved Designs (me)')
@ApiBearerAuth()
@Controller('me/almond-saved-designs')
export class AlmondSavedDesignsController {
  constructor(private readonly service: AlmondSavedDesignsService) {}

  @StoreRoute()
  @Get()
  @ApiOperation({ summary: '내 디자인 보관함 목록', description: 'productId·size 로 좁힌다. 최근 저장순' })
  @ApiResponse({ status: 200, type: [AlmondSavedDesignSummaryResponseDto] })
  list(
    @User('userId') userId: string,
    @Query() query: ListAlmondSavedDesignsQueryDto,
  ): Promise<AlmondSavedDesignSummaryResponseDto[]> {
    return this.service.list(userId, query);
  }

  @StoreRoute()
  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '내 디자인 상세 (남의 것은 404)' })
  @ApiResponse({ status: 200, type: AlmondSavedDesignDetailResponseDto })
  @ApiResponse({ status: 404 })
  get(
    @User('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AlmondSavedDesignDetailResponseDto> {
    return this.service.get(userId, id);
  }

  @StoreRoute()
  @Get(':id/thumbnail')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '내 디자인 썸네일 SVG (남의 것은 404)' })
  @ApiResponse({ status: 200, type: AlmondSavedDesignThumbnailResponseDto })
  @ApiResponse({ status: 404 })
  thumbnail(
    @User('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AlmondSavedDesignThumbnailResponseDto> {
    return this.service.getThumbnail(userId, id);
  }

  @StoreRoute()
  @Put()
  @ApiOperation({
    summary: '내 디자인 저장',
    description:
      'id 가 있으면 내 것을 덮어쓰고 없으면 새로 만든다. 1인 50개까지(넘으면 409). 본문 상한은 이 라우트만 20MB',
  })
  @ApiBody({ type: UpsertAlmondSavedDesignDto })
  @ApiResponse({ status: 200, type: AlmondSavedDesignDetailResponseDto })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409 })
  upsert(
    @User('userId') userId: string,
    @Body() dto: UpsertAlmondSavedDesignDto,
  ): Promise<AlmondSavedDesignDetailResponseDto> {
    return this.service.upsert(userId, dto);
  }

  @StoreRoute()
  @Delete(':id')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '내 디자인 삭제' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404 })
  async remove(@User('userId') userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.service.remove(userId, id);
  }
}
