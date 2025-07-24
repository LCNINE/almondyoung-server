// apps/wms/src/reservation/controllers/order-collect.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { OrderCollectService } from '../services/order-collect.service';

@ApiTags('Order Collection')
@Controller('wms/order-collection')
export class OrderCollectController {
    constructor(private readonly orderCollectService: OrderCollectService) { }

    @Get()
    @ApiOperation({ summary: '주문 수집 목록 조회' })
    @ApiResponse({ status: 200, description: '주문 수집 목록을 반환합니다.' })
    getHello(): string {
        return this.orderCollectService.getHello();
    }
}