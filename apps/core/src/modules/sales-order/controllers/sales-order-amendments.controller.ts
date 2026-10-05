import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { ListSalesOrderAmendmentsQueryDto } from '../dto/list-sales-order-amendments.dto';
import { CreateSalesOrderAmendmentDto } from '../dto/create-sales-order-amendment.dto';
import { SalesOrderAmendmentResponseDto } from '../dto/sales-order-amendment-response.dto';
import { DismissSalesOrderAmendmentDto } from '../dto/dismiss-sales-order-amendment.dto';
import { ChannelAmendmentActionsService } from '../channel-order-change/channel-amendment-actions.service';
import { SalesOrderAmendmentsService } from '../services/sales-order-amendments.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string } | undefined;

@ApiTags('Sales Order Amendments')
@Controller('sales-order-amendments')
export class SalesOrderAmendmentsController {
  constructor(
    private readonly service: SalesOrderAmendmentsService,
    private readonly channelActions: ChannelAmendmentActionsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a SalesOrderAmendment for a post-acceptance delta' })
  @ApiResponse({ status: 201, description: 'SalesOrderAmendment created', type: SalesOrderAmendmentResponseDto })
  create(@Body() dto: CreateSalesOrderAmendmentDto, @User() user: AuthenticatedUser) {
    return this.service.create(dto, this.getUserId(user));
  }

  @Get()
  @ApiOperation({ summary: '정정 목록 — 반영 대기 변경 화면' })
  list(@Query() query: ListSalesOrderAmendmentsQueryDto) {
    return this.service.list({ status: query.status, origin: query.origin, limit: query.limit ?? 50, cursor: query.cursor });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a SalesOrderAmendment' })
  @ApiParam({ name: 'id', description: 'SalesOrderAmendment ID' })
  @ApiResponse({ status: 200, description: 'SalesOrderAmendment', type: SalesOrderAmendmentResponseDto })
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  @Post(':id/dismiss')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '반영 대기 채널 변경을 무시로 닫는다 (#1016 6번 행)' })
  @ApiParam({ name: 'id', description: 'SalesOrderAmendment ID' })
  dismiss(@Param('id') id: string, @Body() dto: DismissSalesOrderAmendmentDto, @User() user: AuthenticatedUser) {
    return this.channelActions.dismiss(id, { note: dto.note, operatorId: this.getUserId(user) });
  }

  @Post(':id/resync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '반영 대기 채널 변경의 주문을 채널에서 다시 확인하도록 요청한다 (#1016 6번 행)' })
  @ApiParam({ name: 'id', description: 'SalesOrderAmendment ID' })
  resync(@Param('id') id: string) {
    return this.channelActions.requestResync(id);
  }

  private getUserId(user: AuthenticatedUser): string | undefined {
    return user?.id ?? user?.userId ?? user?.sub;
  }
}
