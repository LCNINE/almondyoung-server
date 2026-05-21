import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { DigitalAssetService } from '../services/digital-asset.service';
import {
  CreateDigitalAssetDto,
  UpdateDigitalAssetDto,
  CreateFileVersionDto,
  DigitalAssetResponseDto,
  DigitalAssetListResponseDto,
  DigitalAssetFileVersionDto,
} from '../dto';

@ApiTags('Library / Digital Assets')
@Controller('digital-assets')
export class DigitalAssetController {
  constructor(private readonly service: DigitalAssetService) {}

  @Post()
  @ApiOperation({ summary: '디지털 자산 등록' })
  @ApiResponse({ status: 201, type: DigitalAssetResponseDto })
  async create(@Body() dto: CreateDigitalAssetDto, @Req() req: any): Promise<DigitalAssetResponseDto> {
    return this.service.createAsset(dto, req.user?.id);
  }

  @Get()
  @ApiOperation({ summary: '디지털 자산 목록' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, type: DigitalAssetListResponseDto })
  async list(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<DigitalAssetListResponseDto> {
    return this.service.listAssets({
      q,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '디지털 자산 상세' })
  @ApiResponse({ status: 200, type: DigitalAssetResponseDto })
  async get(@Param('id') id: string): Promise<DigitalAssetResponseDto> {
    return this.service.getAsset(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '디지털 자산 메타데이터 수정' })
  @ApiResponse({ status: 200, type: DigitalAssetResponseDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDigitalAssetDto,
    @Req() req: any,
  ): Promise<DigitalAssetResponseDto> {
    return this.service.updateAsset(id, dto, req.user?.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '디지털 자산 삭제 (soft delete)' })
  async remove(@Param('id') id: string, @Req() req: any): Promise<void> {
    await this.service.deleteAsset(id, req.user?.id);
  }

  @Get(':id/file-versions')
  @ApiOperation({ summary: '디지털 자산 파일 버전 이력' })
  @ApiResponse({ status: 200, type: DigitalAssetFileVersionDto, isArray: true })
  async listFileVersions(@Param('id') id: string): Promise<DigitalAssetFileVersionDto[]> {
    return this.service.listFileVersions(id);
  }

  @Post(':id/file-versions')
  @ApiOperation({ summary: '디지털 자산 파일 새 버전 등록 (= 파일 교체)' })
  @ApiResponse({ status: 201, type: DigitalAssetFileVersionDto })
  async addFileVersion(
    @Param('id') id: string,
    @Body() dto: CreateFileVersionDto,
    @Req() req: any,
  ): Promise<DigitalAssetFileVersionDto> {
    return this.service.addFileVersion(id, dto, req.user?.id);
  }
}
