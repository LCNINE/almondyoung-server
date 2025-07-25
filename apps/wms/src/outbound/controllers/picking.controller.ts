import { Controller, Get, Post, Put, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PickingService } from '../services/picking.service';

@ApiTags('Picking')
@Controller('wms/picking')
export class PickingController {
    constructor(private readonly pickingService: PickingService) { }

    // TODO: 피킹리스트 조회 

    // TODO: 피킹 진행 상황 

    // TODO: 피킹 완료

}