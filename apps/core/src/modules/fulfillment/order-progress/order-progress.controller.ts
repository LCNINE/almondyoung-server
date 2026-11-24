import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ListOrderProgressQueryDto } from './dto/list-order-progress.dto';
import { OrderCsContextDto } from './dto/order-cs.dto';
import { OrderProgressPageDto, OrderProgressSummaryResponseDto } from './dto/order-progress-response.dto';
import { OrderProgressService } from './order-progress.service';
import { RequirePermission, PiiResponse, OPEN_WITH_RECIPIENT } from '@app/authorization';

/** 정체 보드(스펙 2026-10-06). 전역 가드(admin·master)만 — 스펙 D11. */
@ApiTags('Order Progress')
@Controller('order-progress')
export class OrderProgressController {
  constructor(private readonly service: OrderProgressService) {}

  @RequirePermission('fulfillment.order.read')
  @Get('summary')
  @ApiOperation({ summary: '정체 보드 요약 — 단계별 진행·갇힘·최장 진입 시각' })
  @ApiResponse({ status: 200, type: OrderProgressSummaryResponseDto })
  summary() {
    return this.service.summary();
  }

  @PiiResponse({
    fields: {
      'items[].customerName': 'name',
      'items[].cs.customerPhone': 'phone',
      'items[].cs.recipientName': 'name',
      'items[].cs.recipientPhone': 'phone',
    },
    subjects: [
      { path: 'items[].salesOrderId', type: 'sales_order' },
    ],
    rawWithByField: {
      'items[].customerName': OPEN_WITH_RECIPIENT,
      'items[].cs.customerPhone': OPEN_WITH_RECIPIENT,
      'items[].cs.recipientName': OPEN_WITH_RECIPIENT,
      'items[].cs.recipientPhone': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.order.read')
  @Get('orders')
  @ApiOperation({ summary: '정체 보드 단계별 주문 목록' })
  @ApiResponse({ status: 200, type: OrderProgressPageDto })
  orders(@Query() q: ListOrderProgressQueryDto) {
    return this.service.listOrders({
      stage: q.stage,
      state: q.state,
      stuck: q.stuck,
      followUpDue: q.followUpDue,
      channel: q.channel,
      sort: q.sort ?? 'dwell',
      limit: q.limit ?? 50,
      cursor: q.cursor,
    });
  }

  @RequirePermission('fulfillment.order.read')
  @Get('orders/:salesOrderId/cs-context')
  @ApiOperation({ summary: '주문의 상자·송장과 같은 고객의 다른 주문 — 정체 보드 CS 상세' })
  @ApiResponse({ status: 200, type: OrderCsContextDto })
  csContext(@Param('salesOrderId', ParseUUIDPipe) salesOrderId: string) {
    return this.service.csContext(salesOrderId);
  }
}
