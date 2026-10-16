import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import {
  ConfirmPrintTestDto,
  ListPrintOrdersQueryDto,
  ResolvePrintCancelDto,
  RetryPrintOrderDto,
} from '../dto/admin-print-orders.dto';
import { PRINT_ORDER_PAGE_SIZE } from '../services/print-order.reader';
import { PrintOrdersService, type PrintOrderActor } from '../services/print-orders.service';

@ApiTags('Admin - Print Orders')
@Controller('admin/print-orders')
export class AdminPrintOrdersController {
  constructor(private readonly service: PrintOrdersService) {}

  @Get('summary')
  @ApiOperation({ summary: '와우프레스 발주 탭별 처리할 건수' })
  summary() {
    return this.service.summary();
  }

  @Get()
  @ApiOperation({ summary: '와우프레스 발주 목록' })
  list(@Query() query: ListPrintOrdersQueryDto) {
    return this.service.list({
      tab: query.tab ?? 'all',
      q: query.q ?? '',
      page: query.page ?? 1,
      pageSize: query.pageSize ?? PRINT_ORDER_PAGE_SIZE,
    });
  }

  @Get('by-line/:lineId')
  @ApiOperation({ summary: '판매주문 라인의 와우프레스 발주' })
  @ApiParam({ name: 'lineId', description: '판매주문 라인 ID' })
  byLine(@Param('lineId', ParseUUIDPipe) lineId: string) {
    return this.service.byLine(lineId);
  }

  @Get('by-design/:almondDesignId')
  @ApiOperation({ summary: '아몬드템플릿 시안의 와우프레스 발주 (최신 순)' })
  @ApiParam({ name: 'almondDesignId', description: '아몬드템플릿 시안 ID' })
  byDesign(@Param('almondDesignId', ParseUUIDPipe) almondDesignId: string) {
    return this.service.byDesign(almondDesignId);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @ApiOperation({ summary: '발주 실패·미지원 건 재전송' })
  retry(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RetryPrintOrderDto, @User() admin: PrintOrderActor) {
    return this.service.retry(id, admin, dto.confirmNoWowpressOrder === true);
  }

  @Post(':id/confirm-test')
  @HttpCode(200)
  @ApiOperation({ summary: '테스트 건 전화 확인 완료' })
  confirmTest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmPrintTestDto,
    @User() admin: PrintOrderActor,
  ) {
    return this.service.confirmTest(id, admin, dto.note);
  }

  @Post(':id/resolve-cancel')
  @HttpCode(200)
  @ApiOperation({ summary: '취소 거절·결과 미상 건 마무리' })
  resolveCancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolvePrintCancelDto,
    @User() admin: PrintOrderActor,
  ) {
    return this.service.resolveCancel(id, dto.outcome, admin);
  }
}
