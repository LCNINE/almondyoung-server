import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
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

    // TODO: 이동 작업 생성


    // TODO: 이동 진행 상황 조회
}