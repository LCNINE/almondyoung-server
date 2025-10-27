# 채널 어댑터 시스템 리팩토링 명세서

## 📋 목차

1. [개요](#개요)
2. [아키텍처 설계](#아키텍처-설계)
3. [레이어별 상세 명세](#레이어별-상세-명세)
4. [파일 구조](#파일-구조)
5. [마이그레이션 계획](#마이그레이션-계획)
6. [테스트 전략](#테스트-전략)

---

## 개요

### 목적

- AdapterOrchestrationService의 God Object 문제 해결
- Layer Architecture Rules 준수
- 실용적이고 유지보수 가능한 구조 확립

### 핵심 원칙

1. **Controller**: 에러를 HTTP로 매핑, 인증/검증
2. **Service**: 비즈니스 흐름 조합 (조합 필요시), 단순한 건 Manager 위임
3. **Reader/Manager**: 구체적 구현 + 검증 로직
4. **Repository**: DB 접근 (도메인당 1개)

### 제거 사항

- ❌ AdapterOrchestrationService (God Object)
- ❌ "Orchestration" 네이밍 (과장된 표현)
- ❌ 불필요한 트랜잭션 (로깅 테이블)

---

## 아키텍처 설계

### 레이어 구조

```
┌─────────────────────────────────────────┐
│  Controller (Presentation Layer)        │
│  - 에러 → HTTP 변환 (문자열 패턴)        │
│  - 인증, 파라미터 검증                   │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Service (Business Layer)                │
│  - 비즈니스 흐름 조합                     │
│  - throw new Error("명확한 메시지")      │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Implementation Layer                    │
│  ├─ Reader (데이터 조회)                 │
│  └─ Manager (로직 + 검증 + DB)           │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Repository (Data Access Layer)          │
│  - DB 접근 (도메인당 1개)                │
└─────────────────────────────────────────┘
```

### 클래스 다이어그램

```typescript
ChannelAdapterController
  ↓ uses
ChannelAdapterService
  ↓ uses (multiple)
  ├─ ChannelDataReader
  ├─ ChannelSyncManager
  ├─ ChannelCommandManager
  └─ WmsIntegrationManager
      ↓ uses
      ChannelAdapterRepository
```

---

## 레이어별 상세 명세

## 1. Controller Layer

### 책임

- API 엔드포인트 제공
- Service 에러 → HTTP 에러 변환 (문자열 패턴 기반)
- 인증, 검증, 가드, 파이프, 인터셉터

### channel-adapter.controller.ts

```typescript
@Controller('adapter')
export class ChannelAdapterController {
  constructor(
    private readonly service: ChannelAdapterService,
    private readonly dlqService: DlqMonitoringService,
  ) {}

  // ========================================
  // 📥 Inbound 동기화
  // ========================================

  @Get('poll')
  @ApiOperation({ summary: '채널 데이터 폴링' })
  async poll(
    @Query('channel') channel: ChannelType,
    @Query('type') dataType: DataType,
  ) {
    try {
      if (!channel || !dataType) {
        throw new BadRequestException('필수 파라미터 누락');
      }

      const result = await this.service.syncFromChannel(channel, dataType);

      return {
        success: true,
        channel,
        dataType,
        count: result.length,
        data: result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw this.mapErrorToHttp(error);
    }
  }

  @Post('sync/:channel/:dataType')
  @ApiOperation({ summary: '동기화 트리거' })
  async syncData(
    @Param('channel') channel: ChannelType,
    @Param('dataType') dataType: DataType,
  ) {
    try {
      await this.service.syncFromChannel(channel, dataType);

      return {
        success: true,
        message: `${channel} 채널의 ${dataType} 동기화 완료`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw this.mapErrorToHttp(error);
    }
  }

  // ========================================
  // 📤 Outbound 동기화
  // ========================================

  @Post('sync-to/:channel')
  @ApiOperation({ summary: '내부 → 외부 동기화' })
  async syncToChannel(
    @Param('channel') channel: ChannelType,
    @Body() payload: SyncToChannelPayload,
  ) {
    try {
      const result = await this.service.syncToChannel(channel, payload);

      return {
        success: true,
        dataType: payload.dataType,
        result,
        message: `${channel} 채널에 ${payload.dataType} 동기화 완료`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw this.mapErrorToHttp(error);
    }
  }

  // ========================================
  // ⚡ 명령 실행
  // ========================================

  @Post('command/:channel')
  @ApiOperation({ summary: '채널 명령 실행' })
  async executeCommand(
    @Param('channel') channel: ChannelType,
    @Body() command: ChannelCommand,
  ) {
    try {
      const result = await this.service.executeCommand(channel, command);

      return {
        success: true,
        commandType: command.type,
        result,
        message: `${channel} 채널 ${command.type} 명령 실행 완료`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw this.mapErrorToHttp(error);
    }
  }

  // ========================================
  // 🔍 조회
  // ========================================

  @Get(':channel/query/:queryType/:identifier')
  @ApiOperation({ summary: '채널 주문 조회' })
  async queryOrders(
    @Param('channel') channel: ChannelType,
    @Param('queryType') queryType: 'ordersheet' | 'ordersheet-by-orderid',
    @Param('identifier') identifier: string,
  ) {
    try {
      const query: OrderQuery = this.mapQueryTypeToOrderQuery(
        queryType,
        identifier,
      );
      const orders = await this.service.findOrders(channel, query);

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
    } catch (error) {
      throw this.mapErrorToHttp(error);
    }
  }

  @Get(':channel/query/exchange-requests')
  @ApiOperation({ summary: '교환 요청 조회' })
  async queryExchangeRequests(
    @Param('channel') channel: ChannelType,
    @Query() query: ExchangeRequestsQueryDto,
  ) {
    try {
      if (!query.dateFrom || !query.dateTo) {
        throw new BadRequestException('dateFrom과 dateTo는 필수입니다');
      }

      const channelQuery: ChannelQuery = {
        type: 'exchange.requests',
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        status: query.status,
        orderId: query.orderId ? parseInt(query.orderId) : undefined,
        sizePerPage: query.pageSize ? parseInt(query.pageSize) : 10,
      };

      const result = await this.service.executeQuery(channel, channelQuery);

      return {
        success: true,
        data: result,
        message: `${channel} 채널에서 ${result.length}건의 교환 요청 조회`,
        metadata: {
          channel,
          queryType: 'exchange.requests',
          resultCount: result.length,
          dateRange: { from: query.dateFrom, to: query.dateTo },
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw this.mapErrorToHttp(error);
    }
  }

  // ========================================
  // 🏭 WMS 연동
  // ========================================

  @Post('wms/orders')
  @ApiOperation({ summary: '채널 주문 → WMS 전달' })
  async createOrderInWms(
    @Body() body: { channel: ChannelType; orderEvent: any },
  ) {
    try {
      const { channel, orderEvent } = body;

      if (!channel || !orderEvent) {
        throw new BadRequestException('channel과 orderEvent는 필수입니다');
      }

      const wmsOrder = await this.service.forwardToWms(channel, orderEvent);

      return {
        success: true,
        wmsOrder,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw this.mapErrorToHttp(error);
    }
  }

  @Post('wms/orders/cancel')
  @ApiOperation({ summary: '채널 주문 취소 → WMS 전달' })
  async cancelOrderInWms(
    @Body() body: { channel: ChannelType; orderEvent: any; reason?: string },
  ) {
    try {
      const { channel, orderEvent, reason } = body;

      const wmsOrder = await this.service.cancelInWms(
        channel,
        orderEvent,
        reason,
      );

      return {
        success: true,
        wmsOrder,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw this.mapErrorToHttp(error);
    }
  }

  // ========================================
  // 🗑️ DLQ 관리
  // ========================================

  @Get('wms/dlq/status')
  @ApiOperation({ summary: 'DLQ 현황 조회' })
  async getDlqStatus() {
    try {
      const dlqStatus = await this.dlqService.getDlqStatus();

      return {
        success: true,
        dlqStatus,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw this.mapErrorToHttp(error);
    }
  }

  @Post('wms/dlq/:dlqId/retry')
  @ApiOperation({ summary: 'DLQ 재처리' })
  async retryDlqEntry(@Param('dlqId') dlqId: string) {
    try {
      const success = await this.dlqService.retryDlqEntry(dlqId);

      return {
        success,
        message: success ? 'DLQ 재처리 성공' : 'DLQ 재처리 실패',
        dlqId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw this.mapErrorToHttp(error);
    }
  }

  @Delete('wms/dlq/:dlqId')
  @ApiOperation({ summary: 'DLQ 수동 제거' })
  async removeDlqEntry(
    @Param('dlqId') dlqId: string,
    @Body() body: { reason?: string } = {},
  ) {
    try {
      const reason = body.reason || '관리자 수동 제거';
      await this.dlqService.removeDlqEntry(dlqId, reason);

      return {
        success: true,
        message: 'DLQ 제거 성공',
        dlqId,
        reason,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw this.mapErrorToHttp(error);
    }
  }

  // ========================================
  // 🛠️ Helper Methods
  // ========================================

  /**
   * 에러를 HTTP 예외로 변환 (문자열 패턴 기반)
   */
  private mapErrorToHttp(error: any): HttpException {
    const message = error.message?.toLowerCase() || '';

    // 404: not found
    if (message.includes('not found')) {
      return new NotFoundException(error.message);
    }

    // 400: already processed, exceeds, required, invalid, failed
    if (
      message.includes('already processed') ||
      message.includes('exceeds') ||
      message.includes('required') ||
      message.includes('invalid') ||
      message.includes('failed')
    ) {
      return new BadRequestException(error.message);
    }

    // 401: 인증
    if (message.includes('인증') || message.includes('auth')) {
      return new UnauthorizedException(error.message);
    }

    // 500: 그 외
    return new InternalServerErrorException('처리 중 오류 발생');
  }

  /**
   * queryType → OrderQuery 변환
   */
  private mapQueryTypeToOrderQuery(
    queryType: 'ordersheet' | 'ordersheet-by-orderid',
    identifier: string,
  ): OrderQuery {
    switch (queryType) {
      case 'ordersheet':
        return { by: 'channelShipmentId', id: identifier };
      case 'ordersheet-by-orderid':
        return { by: 'channelOrderId', id: identifier };
      default:
        throw new Error(`지원하지 않는 queryType: ${queryType}`);
    }
  }

  @Get('health')
  @ApiOperation({ summary: '서비스 상태 확인' })
  getHealth() {
    return {
      success: true,
      status: 'healthy',
      service: 'channel-adapter',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
    };
  }
}
```

---

## 2. Service Layer

### 책임

- 비즈니스 흐름 조합 (필요시)
- 단순한 경우 Manager 위임
- `throw new Error("명확한 메시지")` 사용

### channel-adapter.service.ts

```typescript
@Injectable()
export class ChannelAdapterService {
  constructor(
    private readonly channelReader: ChannelDataReader,
    private readonly syncManager: ChannelSyncManager,
    private readonly commandManager: ChannelCommandManager,
    private readonly wmsManager: WmsIntegrationManager,
  ) {}

  // ========================================
  // 📥 Inbound 동기화
  // ========================================

  /**
   * 채널에서 데이터 동기화 (조합)
   *
   * 흐름: 조회 → 처리 → 완료
   */
  async syncFromChannel(
    channel: ChannelType,
    dataType: DataType,
  ): Promise<InternalOrderEvent[]> {
    // 1. 채널에서 데이터 가져오기
    const events = await this.channelReader.fetchFromChannel(channel, dataType);

    // 2. 동기화 처리 (검증 + 저장 + 이벤트)
    await this.syncManager.processInboundSync(events, channel, dataType);

    return events;
  }

  /**
   * 웹훅 이벤트 처리 (위임)
   */
  async handleIncoming(
    channel: ChannelType,
    payload: any,
  ): Promise<InternalOrderEvent[]> {
    return await this.channelReader.processWebhook(channel, payload);
  }

  // ========================================
  // 📤 Outbound 동기화
  // ========================================

  /**
   * 내부 → 외부 동기화 (조합)
   *
   * 흐름: 전송 → 로깅
   */
  async syncToChannel(
    channel: ChannelType,
    payload: SyncToChannelPayload,
  ): Promise<SyncResult> {
    // 1. 채널에 데이터 전송
    const result = await this.channelReader.sendToChannel(channel, payload);

    // 2. 동기화 로그
    await this.syncManager.logOutboundSync(channel, payload, result);

    return result;
  }

  /**
   * 전체 채널 동기화 (위임)
   */
  async syncAllChannels(dataType: DataType) {
    return await this.syncManager.syncAllChannels(dataType);
  }

  // ========================================
  // ⚡ 명령 실행
  // ========================================

  /**
   * 채널 명령 실행 (위임)
   *
   * 단순한 흐름이므로 Manager에 위임
   */
  async executeCommand(
    channel: ChannelType,
    command: ChannelCommand,
  ): Promise<SyncResult> {
    return await this.commandManager.execute(channel, command);
  }

  /**
   * 전체 채널 명령 실행 (위임)
   */
  async executeOnAllChannels(command: ChannelCommand) {
    return await this.commandManager.executeOnAllChannels(command);
  }

  // ========================================
  // 🔍 조회
  // ========================================

  /**
   * 주문 조회 (위임)
   */
  async findOrders(
    channel: ChannelType,
    query: OrderQuery,
  ): Promise<InternalOrderEvent[]> {
    return await this.channelReader.findOrders(channel, query);
  }

  /**
   * 채널 쿼리 실행 (위임)
   */
  async executeQuery(channel: ChannelType, query: ChannelQuery): Promise<any> {
    return await this.channelReader.executeQuery(channel, query);
  }

  // ========================================
  // 🏭 WMS 연동
  // ========================================

  /**
   * WMS 주문 생성 (위임)
   */
  async forwardToWms(channel: ChannelType, orderEvent: InternalOrderEvent) {
    return await this.wmsManager.createOrder(channel, orderEvent);
  }

  /**
   * WMS 주문 취소 (위임)
   */
  async cancelInWms(
    channel: ChannelType,
    orderEvent: InternalOrderEvent,
    reason?: string,
  ) {
    return await this.wmsManager.cancelOrder(channel, orderEvent, reason);
  }

  /**
   * WMS 교환 처리 (위임)
   */
  async processExchangeInWms(
    channel: ChannelType,
    exchangeEvent: InternalOrderEvent,
  ) {
    return await this.wmsManager.processExchange(channel, exchangeEvent);
  }
}
```

---

## 3. Implementation Layer

### 3.1 Reader - 데이터 조회

#### channel-data.reader.ts

```typescript
@Injectable()
export class ChannelDataReader {
  private readonly logger = new Logger(ChannelDataReader.name);

  constructor(private readonly adapterFactory: ChannelAdapterFactory) {}

  /**
   * 채널에서 원시 데이터 가져오기
   */
  async fetchFromChannel(
    channel: ChannelType,
    dataType: DataType,
  ): Promise<InternalOrderEvent[]> {
    this.logger.log(`📡 [${channel}] ${dataType} 데이터 조회 시작`);

    const adapter = this.adapterFactory.getAdapter(channel);
    const events = await adapter.syncFromChannel(dataType);

    this.logger.log(`✅ [${channel}] ${events.length}건 조회 완료`);
    return events;
  }

  /**
   * 웹훅 이벤트 처리
   */
  async processWebhook(
    channel: ChannelType,
    payload: any,
  ): Promise<InternalOrderEvent[]> {
    this.logger.log(`📨 [${channel}] 웹훅 이벤트 수신`);

    const adapter = this.adapterFactory.getAdapter(channel);
    const events = await adapter.processIncomingEvent(payload);

    this.logger.log(`✅ [${channel}] ${events.length}건 처리 완료`);
    return events;
  }

  /**
   * 채널에 데이터 전송
   */
  async sendToChannel(
    channel: ChannelType,
    payload: SyncToChannelPayload,
  ): Promise<SyncResult> {
    this.logger.log(`📤 [${channel}] ${payload.dataType} 전송 시작`);

    const adapter = this.adapterFactory.getAdapter(channel);
    const result = await adapter.syncToChannel(payload);

    this.logger.log(
      `${result.success ? '✅' : '❌'} [${channel}] ${payload.dataType} 전송 ${result.success ? '성공' : '실패'}`,
    );
    return result;
  }

  /**
   * 주문 조회
   */
  async findOrders(
    channel: ChannelType,
    query: OrderQuery,
  ): Promise<InternalOrderEvent[]> {
    this.logger.log(`🔍 [${channel}] 주문 조회: ${query.by} = ${query.id}`);

    const adapter = this.adapterFactory.getAdapter(channel);
    const orders = await adapter.findOrders(query);

    this.logger.log(`✅ [${channel}] ${orders.length}건 조회 완료`);
    return orders;
  }

  /**
   * 채널 쿼리 실행
   */
  async executeQuery(channel: ChannelType, query: ChannelQuery): Promise<any> {
    this.logger.log(`🔍 [${channel}] 쿼리 실행: ${query.type}`);

    const adapter = this.adapterFactory.getAdapter(channel);
    const result = await adapter.executeQuery(query);

    this.logger.log(`✅ [${channel}] 쿼리 실행 완료`);
    return result;
  }
}
```

### 3.2 Manager - 비즈니스 로직 + 검증 + DB

#### channel-sync.manager.ts

```typescript
@Injectable()
export class ChannelSyncManager {
  private readonly logger = new Logger(ChannelSyncManager.name);

  constructor(
    private readonly repo: ChannelAdapterRepository,
    private readonly eventPublisher: StreamPublisher<ChannelAdapterEvents>,
  ) {}

  /**
   * Inbound 동기화 처리
   *
   * 책임: 검증 + DB 저장 + 이벤트 발행
   */
  async processInboundSync(
    events: InternalOrderEvent[],
    channel: ChannelType,
    dataType: DataType,
  ): Promise<void> {
    // 1️⃣ 검증 (Manager 책임!)
    if (!events || events.length === 0) {
      throw new Error('No events to process');
    }

    this.logger.log(`💾 [${channel}] ${events.length}건 저장 시작`);

    // 2️⃣ DB 저장 (트랜잭션 없음 - 로깅 테이블)
    await this.repo.saveSyncHistory({
      channel,
      dataType,
      totalCount: events.length,
      status: 'success',
    });

    await this.repo.saveEventLogs(events, channel);

    // 3️⃣ 이벤트 발행
    await this.eventPublisher.publishEvent({
      eventType: 'SyncCompleted',
      aggregateId: `${channel}-sync`,
      payload: {
        channel,
        dataType,
        eventCount: events.length,
        syncedAt: new Date(),
      },
    });

    this.logger.log(`✅ [${channel}] ${events.length}건 동기화 완료`);
  }

  /**
   * Outbound 동기화 로깅
   */
  async logOutboundSync(
    channel: ChannelType,
    payload: SyncToChannelPayload,
    result: SyncResult,
  ): Promise<void> {
    await this.repo.saveSyncHistory({
      channel,
      dataType: payload.dataType,
      totalCount: 1,
      status: result.success ? 'success' : 'failed',
    });

    if (payload.dataType === 'inventory' && result.success) {
      await this.eventPublisher.publishEvent({
        eventType: 'InventorySyncCompleted',
        aggregateId: `${channel}-inventory`,
        payload: {
          channelType: channel,
          productId: payload.payload.productId,
          stockQuantity: payload.payload.stockQuantity,
        },
      });
    }

    this.logger.log(
      `${result.success ? '✅' : '❌'} [${channel}] ${payload.dataType} 동기화 로그 기록`,
    );
  }

  /**
   * 전체 채널 동기화
   */
  async syncAllChannels(dataType: DataType): Promise
    Array<{
      channel: ChannelType;
      events: InternalOrderEvent[];
      success: boolean;
      error?: string;
    }>
  > {
    const channels: ChannelType[] = ['naver_smartstore', 'coupang'];
    const results: Array<any> = [];

    this.logger.log(`🌐 전체 채널 ${dataType} 동기화 시작`);

    for (const channel of channels) {
      try {
        // 여기서는 Reader를 직접 호출하지 않고
        // Service를 통해 호출해야 하지만,
        // Manager 레벨에서는 Adapter Factory 사용
        const adapter = this.adapterFactory.getAdapter(channel);
        const events = await adapter.syncFromChannel(dataType);

        await this.processInboundSync(events, channel, dataType);

        results.push({ channel, events, success: true });
      } catch (error) {
        this.logger.error(`❌ [${channel}] 동기화 실패:`, error.message);
        results.push({
          channel,
          events: [],
          success: false,
          error: error.message,
        });
      }
    }

    const totalEvents = results.reduce((sum, r) => sum + r.events.length, 0);
    const successCount = results.filter((r) => r.success).length;

    this.logger.log(
      `🎯 전체 채널 동기화 완료: ${successCount}/${channels.length}개, 총 ${totalEvents}건`,
    );

    return results;
  }
}
```

#### channel-command.manager.ts

```typescript
@Injectable()
export class ChannelCommandManager {
  private readonly logger = new Logger(ChannelCommandManager.name);

  constructor(
    private readonly adapterFactory: ChannelAdapterFactory,
    private readonly eventPublisher: StreamPublisher<ChannelAdapterEvents>,
  ) {}

  /**
   * 명령 실행
   *
   * 책임: 검증 + 실행 + 이벤트 발행
   */
  async execute(
    channel: ChannelType,
    command: ChannelCommand,
  ): Promise<SyncResult> {
    const startTime = Date.now();

    // 1️⃣ 검증 (Manager 책임!)
    this.validateCommand(command);

    // 로깅용 컨텍스트
    const logContext: any = {};
    if ('orderId' in command) logContext.orderId = command.orderId;
    if ('orderIds' in command) logContext.orderIds = command.orderIds;
    if ('claimId' in command) logContext.claimId = command.claimId;

    this.logger.log(`⚡ [${channel}] 명령 실행: ${command.type}`, logContext);

    // 2️⃣ 명령 실행
    const adapter = this.adapterFactory.getAdapter(channel);
    const result = await adapter.executeCommand(command);

    const duration = Date.now() - startTime;

    // 3️⃣ 이벤트 발행
    const targetId = this.extractTargetId(command);

    await this.eventPublisher.publishEvent({
      eventType: 'CommandExecuted',
      aggregateId: `${channel}-${targetId}`,
      payload: {
        channelType: channel,
        commandType: command.type,
        targetId,
        executionResult: result.success ? 'success' : 'failed',
        processedCount: result.processedCount || 0,
        failedCount: result.failedCount || 0,
        executionDurationMs: duration,
      },
    });

    if (result.success) {
      this.logger.log(`✅ [${channel}] 명령 실행 성공: ${command.type} (${duration}ms)`);
    } else {
      this.logger.warn(
        `⚠️ [${channel}] 명령 실행 실패: ${command.type} (${duration}ms)`,
        { errors: result.errors },
      );
    }

    return result;
  }

  /**
   * 전체 채널 명령 실행
   */
  async executeOnAllChannels(command: ChannelCommand): Promise
    Array<{
      channel: ChannelType;
      result: SyncResult;
      success: boolean;
      error?: string;
    }>
  > {
    const channels: ChannelType[] = ['naver_smartstore', 'coupang'];
    const results: Array<any> = [];

    this.logger.log(`🌐 전체 채널 명령 실행: ${command.type}`);

    for (const channel of channels) {
      try {
        const result = await this.execute(channel, command);
        results.push({ channel, result, success: result.success });
      } catch (error) {
        this.logger.error(`❌ [${channel}] 명령 실행 실패:`, error.message);
        results.push({
          channel,
          result: { success: false, errors: [{ message: error.message }] },
          success: false,
          error: error.message,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    this.logger.log(
      `🎯 전체 채널 명령 실행 완료: ${successCount}/${channels.length}개 성공`,
    );

    return results;
  }

  /**
   * 명령 검증 (Private)
   */
  private validateCommand(command: ChannelCommand): void {
    switch (command.type) {
      case 'dispatch.ship':
        if (!command.tracking) {
          throw new Error('Tracking information required');
        }
        if (!command.tracking.companyCode || !command.tracking.number) {
          throw new Error('Tracking company code and number required');
        }
        break;

      case 'order.prepare':
        if (!command.orderIds || command.orderIds.length === 0) {
          throw new Error('Order IDs required');
        }
        break;

      case 'order.cancel':
        if (!command.orderId) {
          throw new Error('Order ID required');
        }
        break;

      case 'exchange.confirm_receipt':
      case 'exchange.reject':
      case 'exchange.upload_invoice':
        if (!command.claimId) {
          throw new Error('Claim ID required');
        }
        break;

      case 'return.approve':
      case 'return.hold':
      case 'return.release_hold':
        if (!command.claimId) {
          throw new Error('Claim ID required');
        }
        break;

      default:
        // 다른 명령은 adapter에서 검증
        break;
    }
  }

  /**
   * 명령에서 대상 ID 추출 (Private)
   */
  private extractTargetId(command: ChannelCommand): string {
    if ('orderId' in command) return command.orderId;
    if ('orderIds' in command && command.orderIds?.length)
      return command.orderIds[0];
    if ('claimId' in command) return command.claimId;
    return 'unknown';
  }
}
```

#### wms-integration.manager.ts

```typescript
@Injectable()
export class WmsIntegrationManager {
  private readonly logger = new Logger(WmsIntegrationManager.name);

  constructor(
    private readonly adapterFactory: ChannelAdapterFactory,
    private readonly repo: ChannelAdapterRepository,
  ) {}

  /**
   * WMS 주문 생성
   *
   * 책임: 검증 + WMS 전달 + 매핑 저장
   */
  async createOrder(
    channel: ChannelType,
    orderEvent: InternalOrderEvent,
  ): Promise<any> {
    const operationId = `CREATE_ORDER_WMS:${channel}:${orderEvent.externalOrderId}`;

    // 1️⃣ 검증 (Manager 책임!)
    this.validateOrderEvent(orderEvent);

    this.logger.log(
      `🏭 [${channel}→WMS] 주문 생성: ${orderEvent.externalOrderId}`,
      { operationId },
    );

    // 2️⃣ WMS에 주문 생성
    const adapter = this.adapterFactory.getAdapter(channel);
    const wmsOrder = await adapter.createOrderInWms(orderEvent);

    // 3️⃣ 매핑 저장
    await this.repo.saveWmsMapping({
      salesChannel: channel,
      channelOrderId: orderEvent.externalOrderId,
      wmsOrderId: wmsOrder.id,
    });

    // 4️⃣ 이벤트 로그
    await this.repo.logWmsEvent({
      channel,
      type: 'order_created_in_wms',
      channelOrderId: orderEvent.externalOrderId,
      wmsOrderId: wmsOrder.id,
    });

    this.logger.log(`✅ [${channel}→WMS] 주문 생성 성공: ${wmsOrder.id}`);

    return wmsOrder;
  }

  /**
   * WMS 주문 취소
   */
  async cancelOrder(
    channel: ChannelType,
    orderEvent: InternalOrderEvent,
    reason?: string,
  ): Promise<any> {
    // 검증
    this.validateOrderEvent(orderEvent);

    this.logger.log(
      `❌ [${channel}→WMS] 주문 취소: ${orderEvent.externalOrderId}`,
      { reason },
    );

    // WMS 취소 실행
    const adapter = this.adapterFactory.getAdapter(channel);
    const wmsOrder = await adapter.cancelOrderInWms(orderEvent, reason);

    // 이벤트 로그
    await this.repo.logWmsEvent({
      channel,
      type: 'order_cancelled_in_wms',
      channelOrderId: orderEvent.externalOrderId,
      wmsOrderId: wmsOrder.id,
      reason,
    });

    this.logger.log(`✅ [${channel}→WMS] 주문 취소 성공: ${wmsOrder.id}`);

    return wmsOrder;
  }

  /**
   * WMS 교환 처리
   */
  async processExchange(
    channel: ChannelType,
    exchangeEvent: InternalOrderEvent,
  ): Promise<any> {
    // 검증
    this.validateOrderEvent(exchangeEvent);

    this.logger.log(
      `🔄 [${channel}→WMS] 교환 처리: ${exchangeEvent.externalOrderId}`,
    );

    // WMS 교환 실행
    const adapter = this.adapterFactory.getAdapter(channel);
    const wmsOrder = await adapter.processExchangeInWms(exchangeEvent);

    // 이벤트 로그
    await this.repo.logWmsEvent({
      channel,
      type: 'exchange_processed_in_wms',
      channelOrderId: exchangeEvent.externalOrderId,
      wmsOrderId: wmsOrder.id,
      claimId: exchangeEvent.claimInfo?.claimId,
    });

    this.logger.log(`✅ [${channel}→WMS] 교환 처리 성공: ${wmsOrder.id}`);

    return wmsOrder;
  }

  /**
   * 주문 이벤트 검증 (Private)
   */
  private validateOrderEvent(orderEvent: InternalOrderEvent): void {
    if (!orderEvent.externalOrderId) {
      throw new Error('Order ID required');
    }

    if (!orderEvent.buyer?.name) {
      throw new Error('Buyer name required');
    }

    // 추가 검증...
  }
}
```

---

## 4. Repository Layer

### channel-adapter.repository.ts

```typescript
@Injectable()
export class ChannelAdapterRepository {
  private readonly logger = new Logger(ChannelAdapterRepository.name);

  constructor(private readonly db: DbService<typeof channelAdapterSchema>) {}

  // ========================================
  // Sync History
  // ========================================

  async saveSyncHistory(data: {
    channel: string;
    dataType: string;
    totalCount: number;
    status: string;
  }): Promise<void> {
    await this.db.db.insert(channelAdapterSchema.syncHistories).values({
      channelId: data.channel,
      syncType: data.dataType,
      totalCount: data.totalCount,
      successCount: data.status === 'success' ? data.totalCount : 0,
      failedCount: data.status === 'failed' ? data.totalCount : 0,
      status: data.status,
      startedAt: new Date(),
      completedAt: new Date(),
    });

    this.logger.debug(
      `📊 동기화 히스토리 저장: ${data.channel}/${data.dataType}`,
    );
  }

  async findSyncHistoriesByChannel(channel: string, limit = 10) {
    return await this.db.db
      .select()
      .from(channelAdapterSchema.syncHistories)
      .where(eq(channelAdapterSchema.syncHistories.channelId, channel))
      .orderBy(desc(channelAdapterSchema.syncHistories.createdAt))
      .limit(limit);
  }

  // ========================================
  // Event Logs
  // ========================================

  async saveEventLogs(
    events: InternalOrderEvent[],
    channel: string,
  ): Promise<void> {
    if (events.length === 0) return;

    const eventLogs = events.map((event) => ({
      channelId: channel,
      eventType: 'order_received',
      externalOrderId: event.externalOrderId,
      externalClaimId: event.claimInfo?.claimId || null,
      rawData: event,
      transformedData: event,
      status: 'processed',
      processedAt: new Date(),
    }));

    await this.db.db.insert(channelAdapterSchema.eventLogs).values(eventLogs);

    this.logger.debug(`📝 이벤트 로그 저장: ${events.length}건`);
  }

  async findEventsByOrderId(orderId: string, channel?: string): Promise<any[]> {
    let query = this.db.db
      .select()
      .from(channelAdapterSchema.eventLogs)
      .where(eq(channelAdapterSchema.eventLogs.externalOrderId, orderId));

    if (channel) {
      query = query.where(
        eq(channelAdapterSchema.eventLogs.channelId, channel),
      );
    }

    return await query.orderBy(desc(channelAdapterSchema.eventLogs.createdAt));
  }

  // ========================================
  // WMS Mapping
  // ========================================

  async saveWmsMapping(data: {
    salesChannel: string;
    channelOrderId: string;
    wmsOrderId: string;
  }): Promise<void> {
    await this.db.db.insert(channelAdapterSchema.wmsOrderMappings).values({
      salesChannel: data.salesChannel,
      channelOrderId: data.channelOrderId,
      wmsOrderId: data.wmsOrderId,
    });

    this.logger.debug(
      `🔗 WMS 매핑 저장: ${data.salesChannel}/${data.channelOrderId} → ${data.wmsOrderId}`,
    );
  }

  async findWmsMappingByChannelOrder(
    salesChannel: string,
    channelOrderId: string,
  ): Promise<any | null> {
    const result = await this.db.db
      .select()
      .from(channelAdapterSchema.wmsOrderMappings)
      .where(
        and(
          eq(channelAdapterSchema.wmsOrderMappings.salesChannel, salesChannel),
          eq(
            channelAdapterSchema.wmsOrderMappings.channelOrderId,
            channelOrderId,
          ),
        ),
      )
      .limit(1);

    return result[0] || null;
  }

  async findWmsMappingByWmsOrderId(wmsOrderId: string): Promise<any | null> {
    const result = await this.db.db
      .select()
      .from(channelAdapterSchema.wmsOrderMappings)
      .where(eq(channelAdapterSchema.wmsOrderMappings.wmsOrderId, wmsOrderId))
      .limit(1);

    return result[0] || null;
  }

  // ========================================
  // WMS Event Logging
  // ========================================

  async logWmsEvent(data: {
    channel: string;
    type: string;
    channelOrderId: string;
    wmsOrderId: string;
    claimId?: string;
    reason?: string;
  }): Promise<void> {
    await this.db.db.insert(channelAdapterSchema.eventLogs).values({
      channelId: data.channel,
      eventType: data.type,
      externalOrderId: data.channelOrderId,
      externalClaimId: data.claimId || null,
      rawData: {
        wmsOrderId: data.wmsOrderId,
        reason: data.reason,
      },
      status: 'processed',
      processedAt: new Date(),
    });

    this.logger.debug(`📝 WMS 이벤트 로그: ${data.type}`);
  }
}
```

---

## 파일 구조

```
apps/channel-adapter/
├── src/
│   ├── controllers/
│   │   └── channel-adapter.controller.ts     (Presentation Layer)
│   │
│   ├── services/
│   │   ├── channel-adapter.service.ts        (Business Layer)
│   │   │
│   │   ├── channel-data.reader.ts            (Implementation - Reader)
│   │   ├── channel-sync.manager.ts           (Implementation - Manager)
│   │   ├── channel-command.manager.ts        (Implementation - Manager)
│   │   ├── wms-integration.manager.ts        (Implementation - Manager)
│   │   │
│   │   ├── channel-adapter.repository.ts     (Data Access Layer)
│   │   │
│   │   ├── sync-status.service.ts            (기존 유지)
│   │   ├── dlq-monitoring.service.ts         (기존 유지)
│   │   │
│   │   └── adapters/
│   │       ├── channel-adapter.factory.ts
│   │       ├── channel-adapter.interface.ts
│   │       ├── naver/
│   │       ├── coupang/
│   │       └── medusa/
│   │
│   ├── types/
│   │   ├── index.ts
│   │   └── ...
│   │
│   └── schema/
│       └── index.ts
│
└── test/
    ├── channel-adapter.service.spec.ts
    ├── channel-sync.manager.spec.ts
    ├── channel-command.manager.spec.ts
    └── wms-integration.manager.spec.ts
```

---

## 마이그레이션 계획

### Phase 1: Implementation Layer 생성 (1일)

**목표**: Reader/Manager 클래스 생성

#### 1.1 Reader 생성

```bash
# 새 파일 생성
touch apps/channel-adapter/src/services/channel-data.reader.ts
```

```typescript
// channel-data.reader.ts 작성
// - fetchFromChannel()
// - processWebhook()
// - sendToChannel()
// - findOrders()
// - executeQuery()
```

#### 1.2 Manager 생성

```bash
# 새 파일 생성
touch apps/channel-adapter/src/services/channel-sync.manager.ts
touch apps/channel-adapter/src/services/channel-command.manager.ts
touch apps/channel-adapter/src/services/wms-integration.manager.ts
```

각 Manager 작성:

- `ChannelSyncManager`: 동기화 로직
- `ChannelCommandManager`: 명령 실행 로직
- `WmsIntegrationManager`: WMS 연동 로직

#### 1.3 Repository 정리

```typescript
// channel-adapter.repository.ts
// - 도메인별 메서드 그룹핑
// - 주석으로 구분
```

---

### Phase 2: Service 리팩토링 (반나절)

**목표**: Service에서 Reader/Manager 조합

```typescript
// Before
async syncFromChannel(channel, dataType) {
  return await this.orchestration.pollAndPublish(channel, dataType);
}

// After
async syncFromChannel(channel, dataType) {
  const events = await this.channelReader.fetchFromChannel(channel, dataType);
  await this.syncManager.processInboundSync(events, channel, dataType);
  return events;
}
```

**작업 순서:**

1. Service에 Reader/Manager 의존성 추가
2. 각 메서드를 Reader/Manager 조합으로 변경
3. 컴파일 에러 해결

---

### Phase 3: Orchestration 제거 (반나절)

**목표**: AdapterOrchestrationService 삭제

```bash
# 1. 사용처 확인
grep -r "AdapterOrchestrationService" apps/channel-adapter/src

# 2. 모든 참조 제거 확인

# 3. 파일 삭제
rm apps/channel-adapter/src/services/adapter-orchestration.service.ts
```

---

### Phase 4: Controller 개선 (반나절)

**목표**: 에러 매핑 강화

```typescript
// mapErrorToHttp() 메서드 추가
private mapErrorToHttp(error: any): HttpException {
  const message = error.message?.toLowerCase() || '';

  if (message.includes('not found')) {
    return new NotFoundException(error.message);
  }
  // ... 패턴 추가
}

// 모든 엔드포인트에 적용
try {
  // ...
} catch (error) {
  throw this.mapErrorToHttp(error);
}
```

---

### Phase 5: 테스트 (1일)

**목표**: 기존 동작 검증

#### 5.1 단위 테스트

```typescript
// channel-data.reader.spec.ts
describe('ChannelDataReader', () => {
  it('should fetch from channel', async () => {
    // ...
  });
});

// channel-sync.manager.spec.ts
describe('ChannelSyncManager', () => {
  it('should process inbound sync', async () => {
    // ...
  });
});
```

#### 5.2 통합 테스트

```typescript
// channel-adapter.service.spec.ts
describe('ChannelAdapterService', () => {
  it('should sync from channel', async () => {
    // Service → Reader → Manager 흐름 테스트
  });
});
```

#### 5.3 E2E 테스트

```bash
# 기존 API 동작 확인
npm run test:e2e
```

---

## 테스트 전략

### 1. 단위 테스트

#### Reader 테스트

```typescript
describe('ChannelDataReader', () => {
  let reader: ChannelDataReader;
  let mockFactory: jest.Mocked<ChannelAdapterFactory>;

  beforeEach(() => {
    mockFactory = {
      getAdapter: jest.fn(),
    } as any;

    reader = new ChannelDataReader(mockFactory);
  });

  it('should fetch from channel', async () => {
    const mockAdapter = {
      syncFromChannel: jest
        .fn()
        .mockResolvedValue([{ externalOrderId: 'ORDER_001' }]),
    };
    mockFactory.getAdapter.mockReturnValue(mockAdapter as any);

    const result = await reader.fetchFromChannel('coupang', 'orders');

    expect(result).toHaveLength(1);
    expect(mockFactory.getAdapter).toHaveBeenCalledWith('coupang');
    expect(mockAdapter.syncFromChannel).toHaveBeenCalledWith('orders');
  });
});
```

#### Manager 테스트

```typescript
describe('ChannelSyncManager', () => {
  let manager: ChannelSyncManager;
  let mockRepo: jest.Mocked<ChannelAdapterRepository>;
  let mockPublisher: jest.Mocked<StreamPublisher>;

  beforeEach(() => {
    mockRepo = {
      saveSyncHistory: jest.fn(),
      saveEventLogs: jest.fn(),
    } as any;

    mockPublisher = {
      publishEvent: jest.fn(),
    } as any;

    manager = new ChannelSyncManager(mockRepo, mockPublisher);
  });

  it('should process inbound sync', async () => {
    const events = [{ externalOrderId: 'ORDER_001' }] as any;

    await manager.processInboundSync(events, 'coupang', 'orders');

    expect(mockRepo.saveSyncHistory).toHaveBeenCalledWith({
      channel: 'coupang',
      dataType: 'orders',
      totalCount: 1,
      status: 'success',
    });
    expect(mockRepo.saveEventLogs).toHaveBeenCalledWith(events, 'coupang');
    expect(mockPublisher.publishEvent).toHaveBeenCalled();
  });

  it('should throw error if no events', async () => {
    await expect(
      manager.processInboundSync([], 'coupang', 'orders'),
    ).rejects.toThrow('No events to process');
  });
});
```

### 2. 통합 테스트

```typescript
describe('ChannelAdapterService Integration', () => {
  let service: ChannelAdapterService;
  let reader: ChannelDataReader;
  let manager: ChannelSyncManager;

  beforeEach(() => {
    // 실제 의존성 주입
    reader = new ChannelDataReader(adapterFactory);
    manager = new ChannelSyncManager(repo, publisher);
    service = new ChannelAdapterService(reader, manager, ...);
  });

  it('should sync from channel end-to-end', async () => {
    const result = await service.syncFromChannel('coupang', 'orders');

    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    // DB 확인
    // 이벤트 발행 확인
  });
});
```

### 3. E2E 테스트

```typescript
describe('Channel Adapter API (E2E)', () => {
  it('GET /adapter/poll should return synced data', async () => {
    return request(app.getHttpServer())
      .get('/adapter/poll')
      .query({ channel: 'coupang', type: 'orders' })
      .expect(200)
      .expect((res) => {
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
      });
  });

  it('POST /adapter/command/:channel should execute command', async () => {
    return request(app.getHttpServer())
      .post('/adapter/command/coupang')
      .send({
        type: 'order.prepare',
        orderIds: ['ORDER_001'],
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.success).toBe(true);
      });
  });
});
```

---

## 체크리스트

### Layer Architecture Rules 준수

- [ ] Controller는 Service 에러를 HTTP로 변환
- [ ] Controller에서 문자열 패턴 기반 에러 매핑
- [ ] Service는 `throw new Error("명확한 메시지")` 사용
- [ ] Service는 비즈니스 흐름 조합 (조합 필요시)
- [ ] Manager에 검증 로직 포함
- [ ] Manager에 비즈니스 로직 + DB 접근
- [ ] Reader는 데이터 조회만
- [ ] Repository는 도메인당 1개

### 코드 품질

- [ ] 각 클래스가 단일 책임
- [ ] 메서드명이 역할을 명확히 표현
- [ ] 불필요한 트랜잭션 제거
- [ ] 주석으로 메서드 그룹핑
- [ ] 로깅 일관성 유지

### 테스트

- [ ] Reader 단위 테스트
- [ ] Manager 단위 테스트
- [ ] Service 통합 테스트
- [ ] Controller E2E 테스트
- [ ] 기존 API 동작 확인

---

## 예상 효과

### 1. 가독성 향상

- Service 코드만 봐도 비즈니스 흐름 이해
- 명확한 네이밍으로 역할 파악 용이

### 2. 유지보수성 향상

- 단일 책임으로 변경 영향 최소화
- 테스트 작성 용이

### 3. 확장성 향상

- 새 채널 추가 시 Adapter만 구현
- 새 기능 추가 시 Manager만 추가

### 4. 팀 생산성 향상

- 신규 개발자 온보딩 시간 단축
- 코드 리뷰 시간 단축

---

## 마무리

이 명세서는 **Layer Architecture Rules를 준수**하면서 **실용적인 구조**를 제안합니다.

핵심은:

1. Controller: 에러 매핑
2. Service: 조합 (필요시)
3. Reader/Manager: 구체적 구현
4. Repository: DB 접근

**"지금은 단순하게, 필요하면 확장"** 원칙으로 접근합니다.
