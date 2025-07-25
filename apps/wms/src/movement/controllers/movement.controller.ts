import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { MovementService } from '../services/movement.service';
import { InterWarehouseTransferDto } from '../dto/inter-warehouse-transfer.dto';
import { IntraWarehouseMoveDto } from '../dto/intra-warehouse-move.dto';

@ApiTags('Movement')
@Controller('wms/movement')
export class MovementController {
    constructor(private readonly movementService: MovementService) { }

    @Post('transfer/inter-warehouse')
    @ApiOperation({ summary: '창고 간 재고 이동' })
    @ApiResponse({ status: 200, description: '창고 간 이동이 성공적으로 처리되었습니다.' })
    async transferBetweenWarehouses(@Body() transferDto: InterWarehouseTransferDto) {
        return this.movementService.transferBetweenWarehouses(transferDto);
    }

    @Post('transfer/intra-warehouse')
    @ApiOperation({ summary: '창고 내 위치 이동' })
    @ApiResponse({ status: 200, description: '창고 내 이동이 성공적으로 처리되었습니다.' })
    async moveWithinWarehouse(@Body() moveDto: IntraWarehouseMoveDto) {
        return this.movementService.moveWithinWarehouse(moveDto);
    }

    @Get('locations/:locationId/stocks')
    @ApiOperation({ summary: '특정 위치의 재고 조회' })
    @ApiResponse({ status: 200, description: '위치의 재고가 성공적으로 조회되었습니다.' })
    async getStocksByLocation(@Param('locationId') locationId: string) {
        return this.movementService.getStocksByLocation(locationId);
    }

    @Get('warehouses/:warehouseId/location-utilization')
    @ApiOperation({ summary: '창고의 위치 활용도 조회' })
    @ApiResponse({ status: 200, description: '위치 활용도가 성공적으로 조회되었습니다.' })
    async getLocationUtilization(@Param('warehouseId') warehouseId: string) {
        return this.movementService.getLocationUtilization(warehouseId);
    }

    @Get('history')
    @ApiOperation({ summary: '이동 이력 조회' })
    @ApiQuery({ name: 'skuId', required: true, description: 'SKU ID' })
    @ApiQuery({ name: 'warehouseId', required: false, description: '창고 ID' })
    @ApiQuery({ name: 'days', required: false, description: '조회 기간 (일)', example: 7 })
    @ApiResponse({ status: 200, description: '이동 이력이 성공적으로 조회되었습니다.' })
    async getMovementHistory(
        @Query('skuId') skuId: string,
        @Query('warehouseId') warehouseId?: string,
        @Query('days') days?: string
    ) {
        return this.movementService.getMovementHistory(
            skuId,
            warehouseId,
            days ? parseInt(days, 10) : 7
        );
    }
}