import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ListOrderProgressQueryDto } from './dto/list-order-progress.dto';
import { OrderProgressPageDto, OrderProgressSummaryResponseDto } from './dto/order-progress-response.dto';
import { OrderProgressService } from './order-progress.service';

/** 정체 보드(스펙 2026-10-06). 전역 가드(admin·master)만 — 스펙 D11. */
@ApiTags('Order Progress')
@Controller('order-progress')
export class OrderProgressController {
  constructor(private readonly service: OrderProgressService) {}

  @Get('summary')
  @ApiOperation({ summary: '정체 보드 요약 — 단계별 진행·갇힘·최장 진입 시각' })
  @ApiResponse({ status: 200, type: OrderProgressSummaryResponseDto })
  summary() {
    return this.service.summary();
  }

  @Get('orders')
  @ApiOperation({ summary: '정체 보드 단계별 주문 목록' })
  @ApiResponse({ status: 200, type: OrderProgressPageDto })
  orders(@Query() q: ListOrderProgressQueryDto) {
    return this.service.listOrders({
      stage: q.stage,
      state: q.state,
      stuck: q.stuck,
      channel: q.channel,
      sort: q.sort ?? 'dwell',
      limit: q.limit ?? 50,
      cursor: q.cursor,
    });
  }
}
