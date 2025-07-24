import { Controller, Post, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { OutboundService } from '../services/outbound.service';
import { ProcessOutboundDto } from '../dto/outbound/process-outbound.dto';

@ApiTags('Outbound')
@Controller('wms/outbound')
export class OutboundController {
    constructor(private readonly outboundService: OutboundService) { }

    @Post(':stockId/process')
    @ApiOperation({ summary: '출고 처리' })
    @ApiResponse({ status: 200, description: '출고가 성공적으로 처리되었습니다.' })
    async processOutbound(
        @Param('stockId') stockId: string,
        @Body() outboundDto: ProcessOutboundDto
    ) {
        return this.outboundService.processOutbound(
            stockId,
            outboundDto.quantity,
            outboundDto.reason,
            outboundDto.orderId
        );
    }

    // TODO: 출고리스트 조회

    // TODO: 출고 작업 상태 관리
}