import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { ChannelType } from '../services/strategies/channel-strategy.factory';
import {
  DataType,
  ChannelCommand,
  SyncToChannelPayload,
  OrderQuery,
} from '../types';
import { ChannelAdapterService } from '../services/channel-adapter.service';
import { AdapterOrchestrationService } from '../services/adapter-orchestration.service';

/**
 * 채널 어댑터 HTTP API 컨트롤러 (CTO 스타일 적용)
 *
 * 각 채널의 데이터 동기화 및 명령 실행을 위한 REST API 제공.
 * 컨트롤러 계층에서 명시적인 try-catch를 통해 HTTP 응답과 에러를 직접 제어합니다.
 *
 * @author CTO Team
 * @since 2025-09-18
 */
@ApiTags('adapter')
@Controller('adapter')
export class ChannelAdapterController {
  private readonly logger = new Logger(ChannelAdapterController.name);

  constructor(
    private readonly channelAdapterService: ChannelAdapterService,
    private readonly orchestrationService: AdapterOrchestrationService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: '서비스 상태 확인' })
  @ApiResponse({ status: 200, description: '서비스가 정상 상태입니다.' })
  getHealth() {
    // 이 엔드포인트는 간단하여 예외 처리보다 즉시 반환이 더 효율적입니다.
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'channel-adapter',
      version: '1.1.0', // CTO 스타일 적용 버전
    };
  }

  @Get('poll')
  @ApiOperation({ summary: '채널 데이터 폴링' })
  @ApiQuery({ name: 'channel', enum: ['naver_smartstore', 'coupang'] })
  @ApiQuery({ name: 'type', enum: ['orders', 'products'] })
  @ApiResponse({ status: 200, description: '폴링 성공' })
  async poll(
    @Query('channel') channel: ChannelType,
    @Query('type') dataType: DataType,
  ) {
    try {
      if (!channel || !dataType) {
        throw new HttpException(
          '채널(channel)과 타입(type)은 필수 파라미터입니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`📥 폴링 요청: ${channel}/${dataType}`);
      const result = await this.channelAdapterService.poll(channel, dataType);
      this.logger.log(
        `✅ 폴링 완료: ${channel}/${dataType} - ${result?.length || 0}건`,
      );

      return {
        success: true,
        channel,
        dataType,
        count: result?.length || 0,
        data: result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`❌ 폴링 실패: ${channel}/${dataType}`, error.stack);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        '데이터 폴링 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('sync/:channel/:dataType')
  @ApiOperation({ summary: '오케스트레이션을 통한 데이터 동기화' })
  @ApiResponse({
    status: 201,
    description: '데이터 동기화 작업이 성공적으로 시작되었습니다.',
  })
  async syncData(
    @Param('channel') channel: ChannelType,
    @Param('dataType') dataType: DataType,
  ) {
    try {
      if (!channel || !dataType) {
        throw new HttpException(
          '채널과 데이터 타입은 필수입니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`🔄 동기화 요청: ${channel}/${dataType}`);
      await this.orchestrationService.pollAndPublish(channel, dataType);
      this.logger.log(`✅ 동기화 완료: ${channel}/${dataType}`);

      return {
        success: true,
        message: `${channel} 채널의 ${dataType} 데이터 동기화가 완료되었습니다.`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`❌ 동기화 실패: ${channel}/${dataType}`, error.stack);
      if (error instanceof HttpException) throw error;
      // 서비스에서 발생한 특정 비즈니스 예외를 여기서 HTTP 예외로 변환할 수 있습니다.
      if (error.message.includes('찾을 수 없습니다')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        '데이터 동기화 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('webhook/:channel')
  @ApiOperation({ summary: '외부 채널 웹훅 수신' })
  @ApiResponse({
    status: 201,
    description: '웹훅 처리가 성공적으로 완료되었습니다.',
  })
  async handleWebhook(
    @Param('channel') channel: ChannelType,
    @Body() payload: any,
  ) {
    try {
      this.logger.log(`🔔 웹훅 수신: ${channel}`);
      await this.channelAdapterService.incoming(channel, payload);
      this.logger.log(`✅ 웹훅 처리 완료: ${channel}`);

      return {
        success: true,
        message: `${channel} 채널의 웹훅이 성공적으로 처리되었습니다.`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`❌ 웹훅 처리 실패: ${channel}`, error.stack);
      if (error instanceof HttpException) throw error;
      if (error.message.includes('유효하지 않은')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        '웹훅 처리 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('sync-to/:channel')
  @ApiOperation({ summary: '내부 데이터를 외부 채널로 동기화 (송신)' })
  @ApiBody({
    description: '동기화할 데이터 페이로드',
    examples: {
      inventory: {
        summary: '재고 동기화',
        value: {
          dataType: 'inventory',
          payload: {
            productId: '12345',
            stockQuantity: 100,
            isOptionProduct: false,
          },
        },
      },
      optionInventory: {
        summary: '옵션 상품 재고 동기화',
        value: {
          dataType: 'inventory',
          payload: {
            productId: '67890',
            stockQuantity: 50,
            isOptionProduct: true,
            optionInfo: {
              optionCombinations: [{ id: 1001, stockQuantity: 25 }],
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: '동기화가 성공적으로 완료되었습니다.',
  })
  async syncToChannel(
    @Param('channel') channel: ChannelType,
    @Body() payload: SyncToChannelPayload,
  ) {
    try {
      if (!payload || !payload.dataType || !payload.payload) {
        throw new HttpException(
          '동기화할 데이터 페이로드가 올바르지 않습니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`📤 송신 동기화 요청: ${channel}/${payload.dataType}`);
      const result = await this.channelAdapterService.syncToChannel(
        channel,
        payload,
      );
      this.logger.log(`✅ 송신 동기화 완료: ${channel}/${payload.dataType}`);

      return {
        success: true,
        dataType: payload.dataType,
        result,
        message: `${channel} 채널에 ${payload.dataType} 데이터가 성공적으로 동기화되었습니다.`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `❌ 송신 동기화 실패: ${channel}/${payload?.dataType}`,
        error.stack,
      );
      if (error instanceof HttpException) throw error;
      if (error.message.includes('찾을 수 없습니다')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        '송신 동기화 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('command/:channel')
  @ApiOperation({ summary: '채널별 특정 명령 실행' })
  @ApiBody({ type: Object })
  @ApiResponse({
    status: 200,
    description: '명령이 성공적으로 실행되었습니다.',
  })
  async executeCommand(
    @Param('channel') channel: ChannelType,
    @Body() cmd: ChannelCommand,
  ) {
    try {
      if (!cmd || !cmd.type) {
        throw new HttpException(
          '실행할 명령(command) 정보가 올바르지 않습니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`⚡ 명령 실행 요청: ${channel}/${cmd.type}`);
      const result = await this.channelAdapterService.command(channel, cmd);
      this.logger.log(`✅ 명령 실행 완료: ${channel}/${cmd.type}`);

      return {
        success: true,
        commandType: cmd.type,
        result,
        message: `${channel} 채널에 ${cmd.type} 명령이 성공적으로 실행되었습니다.`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `❌ 명령 실행 실패: ${channel}/${cmd?.type}`,
        error.stack,
      );
      if (error instanceof HttpException) throw error;
      if (error.message.includes('권한이 없습니다')) {
        throw new HttpException(error.message, HttpStatus.FORBIDDEN);
      }
      throw new HttpException(
        '명령 실행 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 🔍 채널별 주문 조회 (전략 패턴 적용)
   *
   * 식별자 하나로 조회하지만, 결과는 여러 건일 수 있습니다:
   * - 쿠팡 orderId: 하나의 주문에 여러 발주서가 있을 수 있음
   * - 네이버 orderId: 여러 상품 주문이 포함될 수 있음
   *
   * 주요 사용 사례:
   * - 🚚 출고 직전 최신 배송지 확인
   * - 📞 CS 문의 시 실시간 주문 상태 조회
   * - 🛠️ 데이터 불일치 해결을 위한 원본 데이터 확인
   *
   * @param channel 채널 타입 (coupang, naver_smartstore 등)
   * @param queryType 조회 타입 (ordersheet, ordersheet-by-orderid 등)
   * @param identifier 조회 식별자 (shipmentBoxId, orderId 등)
   * @returns 조회된 주문 정보 배열 (0~N건)
   */
  @Get(':channel/query/:queryType/:identifier')
  @ApiOperation({
    summary: '채널별 주문 조회 (전략 패턴)',
    description: `식별자 하나로 조회하되, 결과는 여러 건일 수 있습니다. 전략 패턴을 통해 각 채널별 특화된 조회를 수행합니다.

**지원 채널 및 조회 타입:**
- **쿠팡 (coupang)**: 
  - \`ordersheet\` + shipmentBoxId: 배송번호 기준 발주서 조회
  - \`ordersheet-by-orderid\` + orderId: 주문번호 기준 발주서 조회
- **네이버 (naver_smartstore)**: 
  - \`order\` + productOrderId: 상품주문번호 기준 조회
- **기타 채널**: 각 전략에서 구현된 조회 타입

**쿠팡 사용 사례:**
- 🏠 **배송지 변경 확인**: 결제 완료 후 고객 배송지 변경 여부 확인
- 📦 **상품 정보 검증**: 출고 전 상품명과 옵션 정보 일치 여부 확인
- 🚚 **실시간 상태 조회**: 운송장 번호, 배송 상태 등 최신 정보

**주의사항:**
- 각 채널별로 지원하는 queryType이 다를 수 있습니다
- 전략에서 지원하지 않는 queryType 사용 시 400 에러가 반환됩니다`,
  })
  @ApiResponse({
    status: 200,
    description: '쿠팡 발주서 단건 조회 성공',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            channelType: { type: 'string', example: 'coupang' },
            externalOrderId: { type: 'string', example: '5077495966' },
            externalProductOrderId: { type: 'string', example: '16885250726' },
            status: { type: 'string', example: 'PAID' },
            buyer: {
              type: 'object',
              properties: {
                name: { type: 'string', example: '김철수' },
                contact: { type: 'string', example: '050-1234-5678' },
                address: {
                  type: 'object',
                  properties: {
                    postalCode: { type: 'string', example: '12345' },
                    roadAddress: {
                      type: 'string',
                      example: '서울시 강남구 테헤란로 123',
                    },
                    detailAddress: { type: 'string', example: '456호' },
                  },
                },
              },
            },
            dispatch: {
              type: 'object',
              properties: {
                deliveryCompanyCode: { type: 'string', example: 'CJ대한통운' },
                trackingNumber: { type: 'string', example: '123456789012' },
                dispatchedAt: {
                  type: 'string',
                  example: '2023-01-01T15:00:00+09:00',
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 파라미터' })
  @ApiResponse({ status: 404, description: '발주서를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '쿠팡 API 호출 실패' })
  async queryOrders(
    @Param('channel') channel: ChannelType,
    @Param('queryType') queryType: 'ordersheet' | 'ordersheet-by-orderid',
    @Param('identifier') identifier: string,
  ) {
    try {
      this.logger.log(
        `🔍 [${channel}] ${queryType} 주문 조회 요청: ${identifier}`,
      );

      // queryType을 표준 OrderQuery로 변환
      const query: OrderQuery = this.mapQueryTypeToOrderQuery(
        queryType,
        identifier,
      );

      // 오케스트레이션 서비스를 통해 전략 패턴으로 주문 조회 수행
      const orders = await this.orchestrationService.findOrders(channel, query);

      this.logger.log(
        `✅ [${channel}] ${queryType} 주문 조회 성공: ${identifier} → ${orders.length}건 조회됨`,
      );

      return {
        success: true,
        data: orders,
        count: orders.length,
        meta: {
          channel,
          queryType,
          identifier,
          retrievedAt: new Date().toISOString(),
          source: `${channel}_${queryType}_query`,
          implementation: this.getChannelImplementationInfo(channel),
        },
      };
    } catch (error) {
      this.logger.error(
        `❌ [${channel}] ${queryType} 주문 조회 실패 (${identifier}):`,
        error.message,
      );

      // CTO 스타일: 에러 메시지 패턴 기반 HTTP 응답 변환
      if (
        error.message.includes('not found') ||
        error.message.includes('찾을 수 없')
      ) {
        throw new HttpException(
          `${queryType} 조회 결과가 없습니다: ${identifier}`,
          HttpStatus.NOT_FOUND,
        );
      }

      if (
        error.message.includes('지원하지 않는') ||
        error.message.includes('invalid') ||
        error.message.includes('잘못된')
      ) {
        throw new HttpException(
          `${channel} 채널에서 지원하지 않는 조회 타입이거나 잘못된 식별자입니다: ${queryType}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      if (error.message.includes('인증') || error.message.includes('auth')) {
        throw new HttpException(
          `${channel} 채널 API 인증에 실패했습니다.`,
          HttpStatus.UNAUTHORIZED,
        );
      }

      // 기타 모든 오류는 500으로 처리
      throw new HttpException(
        `${channel} 채널 ${queryType} 조회 중 오류가 발생했습니다.`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 🔄 queryType을 표준 OrderQuery 객체로 변환
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

  /**
   * 📋 채널별 구현 방식 정보 제공
   */
  private getChannelImplementationInfo(channel: ChannelType): string {
    switch (channel) {
      case 'coupang':
        return 'Direct API calls (shipmentBoxId, orderId)';
      case 'naver_smartstore':
        return 'API composition (orderId → productOrderIds → getOrderDetails)';
      case 'medusa':
        return 'Direct API calls (orderId)';
      default:
        return 'Standard findOrders implementation';
    }
  }
}
