import { Controller, Get, Post, Body, Query, Param, Delete, BadRequestException, UsePipes } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import { ChannelType } from '../adapters/channel-adapter.factory';
import { DataType, ChannelCommand, ChannelQuery, SyncToChannelPayload, OrderQuery } from '../types';
import { ChannelAdapterService } from '../services/channel-adapter.service';
import {
  PollResponseDto,
  SyncResponseDto,
  CommandResponseDto,
  ExchangeRequestsQueryDto,
  ExchangeRequestsResponseDto,
  SyncToChannelPayloadSchema,
} from '../zods/controller/adapter.zod';

@ApiTags('Channel Adapter')
@Controller('adapter')
@UsePipes(ZodValidationPipe)
export class ChannelAdapterController {
  constructor(private readonly channelAdapterService: ChannelAdapterService) {}

  // ═══════════════════════════════════════════════════════════════
  // 기본 API
  // ═══════════════════════════════════════════════════════════════

  @Get('health')
  @ApiOperation({ summary: '서비스 상태 확인' })
  @ApiResponse({ status: 200, description: '서비스 정상' })
  getHealth() {
    return {
      success: true,
      status: 'healthy',
      service: 'channel-adapter',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 데이터 동기화 API
  // ═══════════════════════════════════════════════════════════════

  @Get('poll')
  @ApiOperation({ summary: '채널 데이터 폴링' })
  @ApiQuery({
    name: 'channel',
    enum: ['naver_smartstore', 'coupang'],
    description: 'Medusa 주문 수집은 내부 OrderPollerOrchestrator 경로를 사용합니다.',
  })
  @ApiQuery({
    name: 'type',
    enum: ['orders', 'order_status', 'claims', 'inventory', 'products'],
  })
  @ApiResponse({ status: 200, description: '폴링 성공', type: PollResponseDto })
  async poll(@Query('channel') channel: ChannelType, @Query('type') dataType: DataType): Promise<PollResponseDto> {
    this.ensureLegacyAdapterChannel(channel);

    const result = await this.channelAdapterService.poll(channel, dataType);
    return {
      success: true,
      channel,
      dataType,
      count: result?.length || 0,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('sync/:channel/:dataType')
  @ApiOperation({ summary: '데이터 동기화' })
  @ApiParam({ name: 'channel', enum: ['naver_smartstore', 'coupang'] })
  @ApiResponse({
    status: 201,
    description: '동기화 완료',
    type: SyncResponseDto,
  })
  async syncData(
    @Param('channel') channel: ChannelType,
    @Param('dataType') dataType: DataType,
  ): Promise<SyncResponseDto> {
    this.ensureLegacyAdapterChannel(channel);

    await this.channelAdapterService.poll(channel, dataType);
    return {
      success: true,
      message: `${channel} 채널의 ${dataType} 데이터 동기화 완료`,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('sync-to/:channel')
  @ApiOperation({ summary: '내부 데이터를 외부 채널로 동기화' })
  @ApiParam({ name: 'channel', enum: ['naver_smartstore', 'coupang'] })
  @ApiResponse({
    status: 201,
    description: '동기화 완료',
    type: SyncResponseDto,
  })
  async syncToChannel(
    @Param('channel') channel: ChannelType,
    @Body(new ZodValidationPipe(SyncToChannelPayloadSchema))
    payload: SyncToChannelPayload,
  ): Promise<SyncResponseDto> {
    this.ensureLegacyAdapterChannel(channel);

    await this.channelAdapterService.syncToChannel(channel, payload);
    return {
      success: true,
      message: `${channel} 채널에 ${payload.dataType} 데이터 동기화 완료`,
      timestamp: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 명령 실행 API
  // ═══════════════════════════════════════════════════════════════

  @Post('command/:channel')
  @ApiOperation({ summary: '채널별 명령 실행' })
  @ApiParam({ name: 'channel', enum: ['naver_smartstore', 'coupang'] })
  @ApiResponse({
    status: 200,
    description: '명령 실행 완료',
    type: CommandResponseDto,
  })
  async executeCommand(
    @Param('channel') channel: ChannelType,
    @Body() cmd: ChannelCommand,
  ): Promise<CommandResponseDto> {
    this.ensureLegacyAdapterChannel(channel);

    const result = await this.channelAdapterService.command(channel, cmd);
    return {
      success: true,
      commandType: cmd.type,
      result,
      message: `${channel} 채널에 ${cmd.type} 명령 실행 완료`,
      timestamp: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 조회 API
  // ═══════════════════════════════════════════════════════════════

  @Get(':channel/query/:queryType/:identifier')
  @ApiOperation({ summary: '채널별 주문 조회' })
  @ApiParam({ name: 'channel', enum: ['naver_smartstore', 'coupang'] })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async queryOrders(
    @Param('channel') channel: ChannelType,
    @Param('queryType') queryType: 'ordersheet' | 'ordersheet-by-orderid',
    @Param('identifier') identifier: string,
  ) {
    this.ensureLegacyAdapterChannel(channel);

    const query: OrderQuery = this.mapQueryTypeToOrderQuery(queryType, identifier);
    const orders = await this.channelAdapterService.findOrders(channel, query);

    return {
      success: true,
      data: orders,
      count: orders.length,
      meta: {
        channel,
        queryType,
        identifier,
        retrievedAt: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Get(':channel/query/exchange-requests')
  @ApiOperation({ summary: '교환 요청 목록 조회' })
  @ApiParam({ name: 'channel', enum: ['naver_smartstore', 'coupang'] })
  @ApiQuery({ name: 'dateFrom', required: true })
  @ApiQuery({ name: 'dateTo', required: true })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'orderId', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: ExchangeRequestsResponseDto,
  })
  async queryExchangeRequests(
    @Param('channel') channel: ChannelType,
    @Query() query: ExchangeRequestsQueryDto,
  ): Promise<ExchangeRequestsResponseDto> {
    this.ensureLegacyAdapterChannel(channel);

    const { dateFrom, dateTo, status, orderId, pageSize } = query;
    if (!dateFrom || !dateTo) {
      throw new BadRequestException('dateFrom과 dateTo는 필수입니다');
    }

    const channelQuery: ChannelQuery = {
      type: 'exchange.requests',
      dateFrom,
      dateTo,
      status: status as any,
      orderId: orderId ? parseInt(orderId) : undefined,
      sizePerPage: pageSize ? parseInt(pageSize) : 10,
    };

    const result = await this.channelAdapterService.query(channel, channelQuery);

    return {
      success: true,
      data: result,
      message: `${channel} 채널에서 ${result.length}건의 교환 요청 조회`,
      metadata: {
        channel,
        queryType: 'exchange.requests',
        resultCount: result.length,
        dateRange: { from: dateFrom, to: dateTo },
        filters: {
          status,
          orderId,
          pageSize: pageSize ? parseInt(pageSize) : 10,
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // DLQ 관리 API (제거됨)
  // ═══════════════════════════════════════════════════════════════
  // NOTE: DlqMonitoringService 및 관련 REST API 제거됨
  // - GET /adapter/wms/dlq/status (DLQ 현황 조회)
  // - POST /adapter/wms/dlq/:dlqId/retry (DLQ 재처리)
  // - DELETE /adapter/wms/dlq/:dlqId (DLQ 수동 제거)
  //
  // 이유: 메모리 기반 MVP 코드로 실제 DLQ 저장/재처리 기능 없었음
  // DLQ가 필요하다면 @app/events 모듈의 DLQHandler 사용 권장

  // ═══════════════════════════════════════════════════════════════
  // Helper Methods
  // ═══════════════════════════════════════════════════════════════

  private mapQueryTypeToOrderQuery(queryType: 'ordersheet' | 'ordersheet-by-orderid', identifier: string): OrderQuery {
    switch (queryType) {
      case 'ordersheet':
        return { by: 'channelShipmentId', id: identifier };
      case 'ordersheet-by-orderid':
        return { by: 'channelOrderId', id: identifier };
      default:
        throw new BadRequestException(`지원하지 않는 queryType: ${queryType}`);
    }
  }

  private ensureLegacyAdapterChannel(channel: ChannelType): void {
    if (channel === 'medusa') {
      throw new BadRequestException(
        'Medusa 주문 수집은 내부 OrderPollerOrchestrator 경로를 사용합니다. /adapter REST 경로는 naver_smartstore, coupang 어댑터만 지원합니다.',
      );
    }
  }
}
