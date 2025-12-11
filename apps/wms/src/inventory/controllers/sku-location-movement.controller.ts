import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiProperty } from '@nestjs/swagger';
import { SkuLocationMovementService, MovementStatistics, MovementFilters } from '../services/sku-location-movement.service';
import { CreateSkuLocationMovementDto } from '../dto/sku-location-movements/create-sku-location-movement.dto';
import { SkuLocationMovementResponseDto } from '../dto/sku-location-movements/sku-location-movement-response.dto';
import { BulkMoveSkuLocationDto, BulkMoveResultDto } from '../dto/sku-location-movements/bulk-move-sku-location.dto';
import { MoveSkuByIdentifierDto, BulkMoveByIdentifierDto } from '../dto/sku-location-movements/move-sku-by-identifier.dto';
import { Type } from 'class-transformer';
import { IsOptional, IsInt, Min, IsEnum, IsDateString } from 'class-validator';

class MovementQueryDto {
  @ApiProperty({ description: 'Filter by SKU ID', required: false })
  @IsOptional()
  skuId?: string;

  @ApiProperty({ description: 'Filter by from location', required: false })
  @IsOptional()
  fromLocationId?: string;

  @ApiProperty({ description: 'Filter by to location', required: false })
  @IsOptional()
  toLocationId?: string;

  @ApiProperty({ description: 'Start date (ISO 8601)', required: false })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({ description: 'End date (ISO 8601)', required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({ description: 'Filter by status', required: false })
  @IsOptional()
  status?: string;

  @ApiProperty({ description: 'Page limit', required: false, default: 50, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;

  @ApiProperty({ description: 'Page offset', required: false, default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

@ApiTags('SKU Location Movements')
@Controller('inventory/location-movements')
export class SkuLocationMovementController {
  constructor(
    private readonly skuLocationMovementService: SkuLocationMovementService
  ) { }

  // DEPRECATED: 이동예정 기능을 추가해야 할 때 깨울 예정

  //   @Post()
  //   @HttpCode(HttpStatus.CREATED)
  //   @ApiOperation({
  //     summary: 'SKU 위치 이동 기록 (Record SKU location movement)',
  //     description: 'Record a movement of SKU from one location to another',
  //   })
  //   @ApiResponse({
  //     status: 201,
  //     description: 'Movement recorded successfully',
  //     type: SkuLocationMovementResponseDto,
  //   })
  //   @ApiResponse({ status: 400, description: 'Invalid input data' })
  //   @ApiResponse({ status: 404, description: 'SKU or location not found' })
  //   async recordMovement(
  //     @Body() dto: CreateSkuLocationMovementDto
  //   ): Promise<SkuLocationMovementResponseDto> {
  //     return this.skuLocationMovementService.recordMovement(dto);
  //   }

  //   @Post('bulk')
  //   @HttpCode(HttpStatus.OK)
  //   @ApiOperation({
  //     summary: '다중 SKU 위치 이동 기록 (Bulk record SKU location movements)',
  //     description: 'Record multiple SKU location movements in a single transaction. Partial success is allowed.',
  //   })
  //   @ApiResponse({
  //     status: 200,
  //     description: 'Bulk movements processed',
  //     schema: {
  //       type: 'object',
  //       properties: {
  //         total: { type: 'number', example: 10 },
  //         successCount: { type: 'number', example: 8 },
  //         failCount: { type: 'number', example: 2 },
  //         success: { type: 'boolean', example: true },
  //         results: {
  //           type: 'array',
  //           items: {
  //             type: 'object',
  //             properties: {
  //               success: { type: 'boolean' },
  //               skuId: { type: 'string' },
  //               movementId: { type: 'string' },
  //               error: { type: 'string' },
  //             },
  //           },
  //         },
  //       },
  //     },
  //   })
  //   @ApiResponse({ status: 400, description: 'Invalid input data' })
  //   async bulkRecordMovements(
  //     @Body() dto: BulkMoveSkuLocationDto
  //   ): Promise<BulkMoveResultDto> {
  //     return this.skuLocationMovementService.bulkRecordMovements(dto);
  //   }

  //   @Post('by-identifier')
  //   @HttpCode(HttpStatus.CREATED)
  //   @ApiOperation({
  //     summary: 'SKU 식별자로 위치 이동 기록 (Move SKU by identifier - UUID or barcode)',
  //     description: 'Record SKU location movement using SKU identifier (UUID or barcode). SKU is resolved automatically.',
  //   })
  //   @ApiResponse({
  //     status: 201,
  //     description: 'Movement recorded successfully',
  //     type: SkuLocationMovementResponseDto,
  //   })
  //   @ApiResponse({ status: 400, description: 'Invalid input data' })
  //   @ApiResponse({ status: 404, description: 'SKU not found' })
  //   async moveSkuByIdentifier(
  //     @Body() dto: MoveSkuByIdentifierDto
  //   ): Promise<SkuLocationMovementResponseDto> {
  //     return this.skuLocationMovementService.moveSkuByIdentifier(dto);
  //   }

  //   @Post('bulk-by-identifier')
  //   @HttpCode(HttpStatus.OK)
  //   @ApiOperation({
  //     summary: '식별자로 다중 SKU 위치 이동 (Bulk move SKUs by identifier)',
  //     description: 'Record multiple SKU location movements using identifiers (UUID or barcode). Each SKU is resolved automatically.',
  //   })
  //   @ApiResponse({
  //     status: 200,
  //     description: 'Bulk movements processed',
  //     schema: {
  //       type: 'object',
  //       properties: {
  //         total: { type: 'number', example: 10 },
  //         successCount: { type: 'number', example: 8 },
  //         failCount: { type: 'number', example: 2 },
  //         success: { type: 'boolean', example: true },
  //         results: {
  //           type: 'array',
  //           items: {
  //             type: 'object',
  //             properties: {
  //               success: { type: 'boolean' },
  //               skuId: { type: 'string' },
  //               movementId: { type: 'string' },
  //               error: { type: 'string' },
  //             },
  //           },
  //         },
  //       },
  //     },
  //   })
  //   @ApiResponse({ status: 400, description: 'Invalid input data' })
  //   async bulkMoveByIdentifier(
  //     @Body() dto: BulkMoveByIdentifierDto
  //   ): Promise<BulkMoveResultDto> {
  //     return this.skuLocationMovementService.bulkMoveByIdentifier(dto);
  //   }

  //   @Get()
  //   @ApiOperation({
  //     summary: '위치 이동 내역 조회 (Get movements with filters)',
  //     description: 'Get location movements with various filters',
  //   })
  //   @ApiResponse({
  //     status: 200,
  //     description: 'Movements retrieved successfully',
  //     schema: {
  //       type: 'object',
  //       properties: {
  //         movements: { type: 'array', items: { $ref: '#/components/schemas/SkuLocationMovementResponseDto' } },
  //         total: { type: 'number', example: 100 },
  //       },
  //     },
  //   })
  //   async getMovements(
  //     @Query() query: MovementQueryDto
  //   ): Promise<{
  //     movements: SkuLocationMovementResponseDto[];
  //     total: number;
  //   }> {
  //     const filters: MovementFilters = {
  //       skuId: query.skuId,
  //       fromLocationId: query.fromLocationId,
  //       toLocationId: query.toLocationId,
  //       startDate: query.startDate ? new Date(query.startDate) : undefined,
  //       endDate: query.endDate ? new Date(query.endDate) : undefined,
  //       status: query.status,
  //       limit: query.limit,
  //       offset: query.offset,
  //     };

  //     return this.skuLocationMovementService.getMovementsByFilters(filters);
  //   }

  //   @Get('recent')
  //   @ApiOperation({
  //     summary: '최근 이동 내역 (Get recent movements)',
  //     description: 'Get most recent location movements',
  //   })
  //   @ApiQuery({ name: 'limit', required: false, default: 20, description: 'Number of movements to return' })
  //   @ApiResponse({
  //     status: 200,
  //     description: 'Recent movements retrieved successfully',
  //     type: [SkuLocationMovementResponseDto],
  //   })
  //   async getRecentMovements(
  //     @Query('limit') limit?: number
  //   ): Promise<SkuLocationMovementResponseDto[]> {
  //     return this.skuLocationMovementService.getRecentMovements(limit ?? 20);
  //   }

  //   @Get('statistics')
  //   @ApiOperation({
  //     summary: '이동 통계 (Get movement statistics)',
  //     description: 'Get statistics about location movements',
  //   })
  //   @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO 8601)' })
  //   @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO 8601)' })
  //   @ApiResponse({
  //     status: 200,
  //     description: 'Statistics retrieved successfully',
  //     schema: {
  //       type: 'object',
  //       properties: {
  //         totalMovements: { type: 'number' },
  //         mostMovedSkus: {
  //           type: 'array',
  //           items: {
  //             type: 'object',
  //             properties: {
  //               skuId: { type: 'string' },
  //               skuName: { type: 'string' },
  //               movementCount: { type: 'number' },
  //             },
  //           },
  //         },
  //         mostActiveLocations: {
  //           type: 'array',
  //           items: {
  //             type: 'object',
  //             properties: {
  //               locationId: { type: 'string' },
  //               locationCode: { type: 'string' },
  //               movementCount: { type: 'number' },
  //               direction: { type: 'string', enum: ['from', 'to'] },
  //             },
  //           },
  //         },
  //       },
  //     },
  //   })
  //   async getStatistics(
  //     @Query('startDate') startDate?: string,
  //     @Query('endDate') endDate?: string
  //   ): Promise<MovementStatistics> {
  //     return this.skuLocationMovementService.getMovementStatistics(
  //       startDate ? new Date(startDate) : undefined,
  //       endDate ? new Date(endDate) : undefined
  //     );
  //   }

  //   @Get(':id')
  //   @ApiOperation({
  //     summary: '이동 상세 조회 (Get movement by ID)',
  //     description: 'Get a specific movement by ID',
  //   })
  //   @ApiParam({ name: 'id', description: 'Movement ID' })
  //   @ApiResponse({
  //     status: 200,
  //     description: 'Movement retrieved successfully',
  //     type: SkuLocationMovementResponseDto,
  //   })
  //   @ApiResponse({ status: 404, description: 'Movement not found' })
  //   async getMovementById(
  //     @Param('id') id: string
  //   ): Promise<SkuLocationMovementResponseDto> {
  //     return this.skuLocationMovementService.getMovementById(id);
  //   }
  // }

  // @ApiTags('SKU Location Movements')
  // @Controller('inventory/skus')
  // export class SkuMovementHistoryController {
  //   constructor(
  //     private readonly skuLocationMovementService: SkuLocationMovementService
  //   ) { }

  //   @Get(':skuId/location-movements')
  //   @ApiOperation({
  //     summary: 'SKU 위치 이동 이력 (Get movement history for SKU)',
  //     description: 'Get all location movements for a specific SKU',
  //   })
  //   @ApiParam({ name: 'skuId', description: 'SKU ID' })
  //   @ApiQuery({ name: 'limit', required: false, default: 50 })
  //   @ApiQuery({ name: 'offset', required: false, default: 0 })
  //   @ApiResponse({
  //     status: 200,
  //     description: 'Movement history retrieved successfully',
  //     schema: {
  //       type: 'object',
  //       properties: {
  //         movements: { type: 'array', items: { $ref: '#/components/schemas/SkuLocationMovementResponseDto' } },
  //         total: { type: 'number' },
  //       },
  //     },
  //   })
  //   async getSkuMovementHistory(
  //     @Param('skuId') skuId: string,
  //     @Query('limit') limit?: number,
  //     @Query('offset') offset?: number
  //   ): Promise<{
  //     movements: SkuLocationMovementResponseDto[];
  //     total: number;
  //   }> {
  //     return this.skuLocationMovementService.getMovementHistory(
  //       skuId,
  //       limit ?? 50,
  //       offset ?? 0
  //     );
  //   }
  // }

  // @ApiTags('Location Movement History')
  // @Controller('inventory/locations')
  // export class LocationMovementHistoryController {
  //   constructor(
  //     private readonly skuLocationMovementService: SkuLocationMovementService
  //   ) { }

  //   @Get(':locationId/movements')
  //   @ApiOperation({
  //     summary: '위치별 이동 내역 (Get movements for location)',
  //     description: 'Get all movements related to a specific location',
  //   })
  //   @ApiParam({ name: 'locationId', description: 'Location ID' })
  //   @ApiQuery({
  //     name: 'direction',
  //     required: false,
  //     enum: ['from', 'to', 'both'],
  //     default: 'both',
  //     description: 'Movement direction filter',
  //   })
  //   @ApiQuery({ name: 'limit', required: false, default: 50 })
  //   @ApiQuery({ name: 'offset', required: false, default: 0 })
  //   @ApiResponse({
  //     status: 200,
  //     description: 'Location movements retrieved successfully',
  //     schema: {
  //       type: 'object',
  //       properties: {
  //         movements: { type: 'array', items: { $ref: '#/components/schemas/SkuLocationMovementResponseDto' } },
  //         total: { type: 'number' },
  //       },
  //     },
  //   })
  //   async getLocationMovements(
  //     @Param('locationId') locationId: string,
  //     @Query('direction') direction?: 'from' | 'to' | 'both',
  //     @Query('limit') limit?: number,
  //     @Query('offset') offset?: number
  //   ): Promise<{
  //     movements: SkuLocationMovementResponseDto[];
  //     total: number;
  //   }> {
  //     return this.skuLocationMovementService.getMovementsByLocation(
  //       locationId,
  //       direction ?? 'both',
  //       limit ?? 50,
  //       offset ?? 0
  //     );
  //   }
}

