import { Controller, Post, Get, Put, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PurchaseOrderService } from '../services/purchase-order.service';

@ApiTags('Purchase Orders')
@Controller('wms/purchase-orders')
export class PurchaseOrderController {
    constructor(private readonly purchaseOrderService: PurchaseOrderService) { }

    // TODO: 발주 생성


    // TODO: 발주 관리


    // TODO: 발주 조회


    // TODO: 발주 상태 업데이트

}