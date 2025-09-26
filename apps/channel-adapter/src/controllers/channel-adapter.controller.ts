import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Delete,
  Logger,
  HttpException,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ChannelType } from '../services/strategies/channel-strategy.factory';
import {
  DataType,
  ChannelCommand,
  ChannelQuery,
  SyncToChannelPayload,
  OrderQuery,
} from '../types';
import { ChannelAdapterService } from '../services/channel-adapter.service';
import { AdapterOrchestrationService } from '../services/adapter-orchestration.service';
import { DlqMonitoringService } from '../services/dlq-monitoring.service';

// ===== ZOD 스키마 정의 =====

// 기본 타입들
const ChannelTypeSchema = z.enum(['naver_smartstore', 'coupang', 'medusa']);
const DataTypeSchema = z.enum([
  'orders',
  'order_status',
  'claims',
  'inventory',
  'products',
]);
const QueryTypeSchema = z.enum(['ordersheet', 'ordersheet-by-orderid']);
const ExchangeStatusSchema = z.enum([
  'RECEIPT',
  'PROGRESS',
  'SUCCESS',
  'REJECT',
  'CANCEL',
]);

// 공통 응답 스키마
const BaseResponseSchema = z.object({
  success: z.boolean(),
  timestamp: z.string(),
});

const ErrorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  statusCode: z.number(),
  timestamp: z.string(),
});

// 헬스체크 응답
const HealthResponseSchema = BaseResponseSchema.extend({
  status: z.literal('healthy'),
  service: z.literal('channel-adapter'),
  version: z.string(),
});

// 폴링 요청/응답
const PollQuerySchema = z.object({
  channel: ChannelTypeSchema,
  type: DataTypeSchema,
});

const PollResponseSchema = BaseResponseSchema.extend({
  channel: ChannelTypeSchema,
  dataType: DataTypeSchema,
  count: z.number(),
  data: z.array(z.any()),
});

// 동기화 응답
const SyncResponseSchema = BaseResponseSchema.extend({
  message: z.string(),
});

// 송신 동기화 페이로드
const InternalInventoryDataSchema = z.object({
  productId: z.string(),
  stockQuantity: z.number(),
  isOptionProduct: z.boolean(),
  reservedQuantity: z.number().optional(),
  availableQuantity: z.number().optional(),
  warehouseId: z.string().optional(),
  optionInfo: z
    .object({
      optionCombinations: z
        .array(
          z.object({
            id: z.number(),
            stockQuantity: z.number(),
            price: z.number().optional(),
            usable: z.boolean().optional(),
          }),
        )
        .optional(),
      optionStandards: z
        .array(
          z.object({
            id: z.number(),
            stockQuantity: z.number(),
            usable: z.boolean().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const InternalProductDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  description: z.string(),
  categoryId: z.string().optional(),
  brand: z.string().optional(),
  options: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
        additionalPrice: z.number().optional(),
      }),
    )
    .optional(),
});

const InternalOrderStatusDataSchema = z.object({
  orderId: z.string(),
  status: z.string(),
  updatedAt: z.string(),
  reason: z.string().optional(),
});

const SyncToChannelPayloadSchema = z.discriminatedUnion('dataType', [
  z.object({
    dataType: z.literal('inventory'),
    payload: InternalInventoryDataSchema,
  }),
  z.object({
    dataType: z.literal('products'),
    payload: InternalProductDataSchema,
  }),
  z.object({
    dataType: z.literal('order_status'),
    payload: InternalOrderStatusDataSchema,
  }),
]);

const SyncToChannelResponseSchema = BaseResponseSchema.extend({
  dataType: DataTypeSchema,
  result: z.any(),
  message: z.string(),
});

// 명령 실행 스키마
const TrackingInfoSchema = z.object({
  companyCode: z.string(),
  number: z.string(),
});

const ChannelCommandSchema = z.discriminatedUnion('type', [
  // 주문 관리
  z.object({
    type: z.literal('order.prepare'),
    orderIds: z.array(z.string()),
  }),
  z.object({
    type: z.literal('order.cancel'),
    orderId: z.string(),
    reason: z.string().optional(),
  }),
  // 발송 관리
  z.object({
    type: z.literal('dispatch.ship'),
    orderId: z.string(),
    items: z
      .array(
        z.object({
          orderItemId: z.string(),
          quantity: z.number(),
        }),
      )
      .optional(),
    tracking: TrackingInfoSchema,
    dispatchedAt: z.string().optional(),
  }),
  z.object({
    type: z.literal('dispatch.update_tracking'),
    orderId: z.string(),
    tracking: TrackingInfoSchema,
  }),
  // 교환 관리
  z.object({
    type: z.literal('exchange.confirm_receipt'),
    claimId: z.string(),
  }),
  z.object({
    type: z.literal('exchange.reject'),
    claimId: z.string(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('exchange.upload_invoice'),
    claimId: z.string(),
    tracking: TrackingInfoSchema,
    items: z
      .array(
        z.object({
          itemId: z.string(),
          shipmentBoxId: z.string(),
        }),
      )
      .optional(),
  }),
  // 반품 관리
  z.object({
    type: z.literal('return.approve'),
    claimId: z.string(),
    items: z
      .array(
        z.object({
          orderItemId: z.string(),
          quantity: z.number(),
        }),
      )
      .optional(),
  }),
  z.object({
    type: z.literal('return.hold'),
    claimId: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('return.release_hold'),
    claimId: z.string(),
  }),
]);

const CommandResponseSchema = BaseResponseSchema.extend({
  commandType: z.string(),
  result: z.any(),
  message: z.string(),
});

// 주문 조회 응답
const BuyerInfoSchema = z.object({
  name: z.string().optional(),
  contact: z.string().optional(),
  address: z
    .object({
      postalCode: z.string().optional(),
      roadAddress: z.string().optional(),
      detailAddress: z.string().optional(),
    })
    .optional(),
});

const DispatchInfoSchema = z.object({
  deliveryCompanyCode: z.string().optional(),
  trackingNumber: z.string().optional(),
  dispatchedAt: z.string().optional(),
});

const OrderDataSchema = z.object({
  channelType: ChannelTypeSchema,
  externalOrderId: z.string(),
  externalProductOrderId: z.string().optional(),
  status: z.string(),
  buyer: BuyerInfoSchema.optional(),
  dispatch: DispatchInfoSchema.optional(),
});

const QueryOrdersResponseSchema = BaseResponseSchema.extend({
  data: z.array(OrderDataSchema),
  count: z.number(),
  meta: z.object({
    channel: ChannelTypeSchema,
    queryType: z.string(),
    identifier: z.string(),
    retrievedAt: z.string(),
    source: z.string(),
    implementation: z.string(),
  }),
});

// 교환 요청 조회
const ExchangeRequestsQuerySchema = z.object({
  dateFrom: z.string(),
  dateTo: z.string(),
  status: ExchangeStatusSchema.optional(),
  orderId: z.string().optional(),
  pageSize: z.string().optional(),
});

const InternalExchangeEventSchema = z.object({
  eventId: z.string(),
  eventType: z.enum([
    'exchange_created',
    'exchange_updated',
    'exchange_completed',
    'exchange_rejected',
  ]),
  claimId: z.string(),
  orderId: z.string(),
  channel: ChannelTypeSchema,
  externalClaimId: z.string(),
  externalOrderId: z.string(),
  status: z.enum([
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
    'REJECTED',
    'CANCELLED',
  ]),
  faultType: z.enum([
    'SELLER',
    'CUSTOMER',
    'DELIVERY',
    'PRODUCT_DEFECT',
    'OTHER',
  ]),
  reason: z.string(),
  reasonCode: z.string().optional(),
  exchangeItems: z.array(
    z.object({
      originalItemId: z.string(),
      originalItemName: z.string(),
      targetItemId: z.string().optional(),
      targetItemName: z.string().optional(),
      quantity: z.number(),
      unitPrice: z.number(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ExchangeRequestsResponseSchema = BaseResponseSchema.extend({
  data: z.array(InternalExchangeEventSchema),
  message: z.string(),
  metadata: z.object({
    channel: ChannelTypeSchema,
    queryType: z.literal('exchange.requests'),
    resultCount: z.number(),
    ssotModel: z.literal('InternalExchangeEvent[]'),
    dateRange: z.object({
      from: z.string(),
      to: z.string(),
    }),
    filters: z.object({
      status: ExchangeStatusSchema.optional(),
      orderId: z.string().optional(),
      pageSize: z.number().optional(),
    }),
  }),
});

// WMS 연동 스키마
const WmsOrderEventSchema = z.object({
  channel: ChannelTypeSchema,
  orderEvent: z.any(),
  reason: z.string().optional(),
});

const WmsOrderSchema = z.object({
  id: z.string(),
  // WMS 주문 기본 정보는 실제 WMS 스키마에 따라 확장 필요
});

const WmsOrderResponseSchema = BaseResponseSchema.extend({
  wmsOrder: WmsOrderSchema,
});

// DLQ 관리 스키마
const DlqSummarySchema = z.object({
  totalCount: z.number(),
  criticalCount: z.number(),
  warningCount: z.number().optional(),
  oldestFailedAt: z.string().optional(),
});

const DlqEntrySchema = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.any(),
  failedAt: z.string(),
  retryCount: z.number(),
  lastError: z.string(),
  status: z.string(),
});

const DlqStatusResponseSchema = BaseResponseSchema.extend({
  dlqStatus: z.object({
    summary: z.object({
      totalCount: z.number(),
      criticalCount: z.number(),
      lastHourCount: z.number(),
    }),
    recentEntries: z.array(
      z.object({
        id: z.string(),
        operationType: z.string(),
        errorMessage: z.string(),
        createdAt: z.string(),
        retryCount: z.number(),
      }),
    ),
  }),
});

const DlqRetryResponseSchema = BaseResponseSchema.extend({
  message: z.string(),
  dlqId: z.string(),
});

const DlqRemoveRequestSchema = z.object({
  reason: z.string().optional(),
});

const DlqRemoveResponseSchema = BaseResponseSchema.extend({
  message: z.string(),
  dlqId: z.string(),
  reason: z.string(),
});

// DTO 클래스 생성
export class PollQueryDto extends createZodDto(PollQuerySchema) {}
export class PollResponseDto extends createZodDto(PollResponseSchema) {}
export class SyncResponseDto extends createZodDto(SyncResponseSchema) {}
// SyncToChannelPayloadDto는 discriminated union으로 인해 제외
export class SyncToChannelResponseDto extends createZodDto(
  SyncToChannelResponseSchema,
) {}
// ChannelCommandDto는 discriminated union으로 인해 제외
export class CommandResponseDto extends createZodDto(CommandResponseSchema) {}
export class QueryOrdersResponseDto extends createZodDto(
  QueryOrdersResponseSchema,
) {}
export class ExchangeRequestsQueryDto extends createZodDto(
  ExchangeRequestsQuerySchema,
) {}
export class ExchangeRequestsResponseDto extends createZodDto(
  ExchangeRequestsResponseSchema,
) {}
export class WmsOrderEventDto extends createZodDto(WmsOrderEventSchema) {}
export class WmsOrderResponseDto extends createZodDto(WmsOrderResponseSchema) {}
export class DlqStatusResponseDto extends createZodDto(
  DlqStatusResponseSchema,
) {}
export class DlqRetryResponseDto extends createZodDto(DlqRetryResponseSchema) {}
export class DlqRemoveRequestDto extends createZodDto(DlqRemoveRequestSchema) {}
export class DlqRemoveResponseDto extends createZodDto(
  DlqRemoveResponseSchema,
) {}
export class HealthResponseDto extends createZodDto(HealthResponseSchema) {}
export class ErrorResponseDto extends createZodDto(ErrorResponseSchema) {}

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
    private readonly dlqMonitoringService: DlqMonitoringService,
  ) {}

  @Get('health')
  @ApiOperation({
    summary: '서비스 상태 확인',
    description: '채널 어댑터 서비스의 현재 상태와 버전 정보를 반환합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '서비스가 정상 상태입니다.',
    type: HealthResponseDto,
  })
  getHealth(): HealthResponseDto {
    // 이 엔드포인트는 간단하여 예외 처리보다 즉시 반환이 더 효율적입니다.
    return {
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'channel-adapter',
      version: '1.1.0', // CTO 스타일 적용 버전
    };
  }

  @Get('poll')
  @ApiOperation({
    summary: '채널 데이터 폴링',
    description: `외부 채널에서 지정된 데이터 타입의 최신 정보를 조회합니다.
    
**지원 채널:**
- naver_smartstore: 네이버 스마트스토어
- coupang: 쿠팡
- medusa: 메두사 (내부 시스템)

**지원 데이터 타입:**
- orders: 주문 정보
- order_status: 주문 상태 변경
- claims: 클레임 정보 (취소/반품/교환)
- inventory: 재고 정보
- products: 상품 정보`,
  })
  @ApiQuery({
    name: 'channel',
    enum: ['naver_smartstore', 'coupang', 'medusa'],
    description: '대상 채널 타입',
  })
  @ApiQuery({
    name: 'type',
    enum: ['orders', 'order_status', 'claims', 'inventory', 'products'],
    description: '조회할 데이터 타입',
  })
  @ApiResponse({
    status: 200,
    description: '폴링 성공',
    type: PollResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 파라미터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '내부 서버 오류',
    type: ErrorResponseDto,
  })
  async poll(
    @Query('channel') channel: ChannelType,
    @Query('type') dataType: DataType,
  ): Promise<PollResponseDto> {
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
  @ApiOperation({
    summary: '오케스트레이션을 통한 데이터 동기화',
    description: `지정된 채널에서 특정 데이터 타입을 동기화합니다. 
    오케스트레이션 서비스를 통해 데이터를 폴링하고 내부 이벤트로 발행합니다.
    
**사용 예시:**
- POST /adapter/sync/naver_smartstore/orders
- POST /adapter/sync/coupang/inventory`,
  })
  @ApiResponse({
    status: 201,
    description: '데이터 동기화 작업이 성공적으로 완료되었습니다.',
    type: SyncResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 파라미터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '채널 또는 데이터 타입을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '동기화 처리 중 오류 발생',
    type: ErrorResponseDto,
  })
  async syncData(
    @Param('channel') channel: ChannelType,
    @Param('dataType') dataType: DataType,
  ): Promise<SyncResponseDto> {
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

  @Post('sync-to/:channel')
  @ApiOperation({
    summary: '내부 데이터를 외부 채널로 동기화 (송신)',
    description: `내부 시스템의 데이터를 외부 채널로 전송하여 동기화합니다.
    
**지원하는 데이터 타입:**
- inventory: 재고 정보 동기화
- products: 상품 정보 동기화  
- order_status: 주문 상태 업데이트

**사용 사례:**
- WMS에서 재고가 변경되었을 때 채널에 반영
- PIM에서 상품 정보가 수정되었을 때 채널에 반영
- 내부 시스템에서 주문 상태가 변경되었을 때 채널에 반영`,
  })
  @ApiBody({
    description: '동기화할 데이터 페이로드',
    schema: {
      oneOf: [
        {
          type: 'object',
          properties: {
            dataType: { type: 'string', enum: ['inventory'] },
            payload: { $ref: '#/components/schemas/InternalInventoryData' },
          },
        },
        {
          type: 'object',
          properties: {
            dataType: { type: 'string', enum: ['products'] },
            payload: { $ref: '#/components/schemas/InternalProductData' },
          },
        },
        {
          type: 'object',
          properties: {
            dataType: { type: 'string', enum: ['order_status'] },
            payload: { $ref: '#/components/schemas/InternalOrderStatusData' },
          },
        },
      ],
    },
    examples: {
      inventory: {
        summary: '재고 동기화',
        description: '일반 상품의 재고 수량을 채널에 동기화',
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
        description: '옵션이 있는 상품의 재고 수량을 채널에 동기화',
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
      product: {
        summary: '상품 정보 동기화',
        description: '상품의 기본 정보를 채널에 동기화',
        value: {
          dataType: 'products',
          payload: {
            id: 'PROD_001',
            name: '프리미엄 티셔츠',
            price: 29900,
            description: '고급 면 소재로 제작된 프리미엄 티셔츠',
            categoryId: 'CAT_CLOTHING',
            brand: 'AlmondYoung',
          },
        },
      },
      orderStatus: {
        summary: '주문 상태 동기화',
        description: '주문 상태 변경을 채널에 동기화',
        value: {
          dataType: 'order_status',
          payload: {
            orderId: 'ORDER_123456',
            status: 'SHIPPED',
            updatedAt: '2025-01-15T10:30:00Z',
            reason: '정상 출고 처리',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: '동기화가 성공적으로 완료되었습니다.',
    type: SyncToChannelResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 데이터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '채널을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '동기화 처리 중 오류 발생',
    type: ErrorResponseDto,
  })
  async syncToChannel(
    @Param('channel') channel: ChannelType,
    @Body() payload: SyncToChannelPayload,
  ): Promise<SyncToChannelResponseDto> {
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
  @ApiOperation({
    summary: '채널별 특정 명령 실행 (SSOT 원칙)',
    description: `채널에 무관한 표준 명령을 실행합니다. 모든 채널이 동일한 명령 인터페이스를 사용하며, 각 전략에서 채널별 API로 번역됩니다.

**지원 명령 카테고리:**

🛒 **주문 관리**
- \`order.prepare\`: 주문 준비 확인 (네이버: 발주확인, 쿠팡: 주문승인)
- \`order.cancel\`: 주문 취소

📦 **배송 관리**  
- \`dispatch.ship\`: 발송 처리 및 송장 등록
- \`dispatch.update_tracking\`: 송장 정보 업데이트

🔄 **교환 처리**
- \`exchange.confirm_receipt\`: 교환 상품 입고 확인
- \`exchange.reject\`: 교환 요청 거부  
- \`exchange.upload_invoice\`: 교환 재발송 송장 업로드

↩️ **반품 처리**
- \`return.approve\`: 반품 승인
- \`return.hold\`: 반품 보류
- \`return.release_hold\`: 반품 보류 해제

**SSOT 원칙**: 모든 채널에서 동일한 명령 구조를 사용하여 비즈니스 로직의 일관성을 보장합니다.`,
  })
  @ApiParam({
    name: 'channel',
    type: 'string',
    enum: ['naver_smartstore', 'coupang'],
  })
  @ApiBody({
    description: '실행할 명령 객체',

    schema: {
      oneOf: [
        {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['order.prepare'] },
            orderIds: { type: 'array', items: { type: 'string' } },
          },
        },
        {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['order.cancel'] },
            orderId: { type: 'string' },
            reason: { type: 'string' },
          },
        },
        {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['dispatch.ship'] },
            orderId: { type: 'string' },
            tracking: {
              type: 'object',
              properties: {
                companyCode: { type: 'string' },
                number: { type: 'string' },
              },
            },
          },
        },
        {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['exchange.confirm_receipt'] },
            claimId: { type: 'string' },
          },
        },
        {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['exchange.reject'] },
            claimId: { type: 'string' },
            reason: { type: 'string' },
          },
        },
        {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['exchange.upload_invoice'] },
            claimId: { type: 'string' },
            tracking: {
              type: 'object',
              properties: {
                companyCode: { type: 'string' },
                number: { type: 'string' },
              },
            },
          },
        },
      ],
    },
    examples: {
      orderPrepare: {
        summary: '주문 준비 확인',
        description: '주문을 처리 가능 상태로 변경 (발주확인)',
        value: {
          type: 'order.prepare',
          orderIds: ['ORDER_001', 'ORDER_002'],
        },
      },
      orderCancel: {
        summary: '주문 취소',
        description: '특정 주문을 취소 처리',
        value: {
          type: 'order.cancel',
          orderId: 'ORDER_123456',
          reason: '고객 요청으로 인한 취소',
        },
      },
      dispatchShip: {
        summary: '발송 처리',
        description: '상품을 발송하고 송장 정보를 등록',
        value: {
          type: 'dispatch.ship',
          orderId: 'ORDER_789012',
          tracking: { companyCode: 'CJ', number: '1234567890123' },
          dispatchedAt: '2025-01-15T14:30:00Z',
        },
      },
      exchangeConfirmReceipt: {
        summary: '교환 상품 입고확인',
        description: '고객이 반송한 교환 상품의 입고를 확인',
        value: {
          type: 'exchange.confirm_receipt',
          claimId: 'EXCHANGE_20250115_001',
        },
      },
      exchangeReject: {
        summary: '교환 요청 거부',
        description: '교환 요청을 거부하고 사유를 기록',
        value: {
          type: 'exchange.reject',
          claimId: 'EXCHANGE_20250115_002',
          reason: '상품 품절로 인한 교환 불가',
        },
      },
      exchangeUploadInvoice: {
        summary: '교환 재발송 송장 업로드',
        description: '교환 상품의 재발송 송장 정보를 업로드',
        value: {
          type: 'exchange.upload_invoice',
          claimId: 'EXCHANGE_20250115_003',
          tracking: { companyCode: 'CJ', number: '1234567890123' },
          items: [{ itemId: 'ITEM_001', shipmentBoxId: '12345' }],
        },
      },
      returnApprove: {
        summary: '반품 승인',
        description: '반품 요청을 승인하고 처리 시작',
        value: {
          type: 'return.approve',
          claimId: 'RETURN_20250115_001',
          items: [{ orderItemId: 'ITEM_001', quantity: 1 }],
        },
      },
      returnHold: {
        summary: '반품 보류',
        description: '반품 처리를 일시 중단',
        value: {
          type: 'return.hold',
          claimId: 'RETURN_20250115_002',
          reason: '상품 상태 확인 필요',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '명령이 성공적으로 실행되었습니다.',
    type: CommandResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 명령 데이터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: '권한 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '명령 실행 중 오류 발생',
    type: ErrorResponseDto,
  })
  async executeCommand(
    @Param('channel') channel: ChannelType,
    @Body() cmd: ChannelCommand,
  ): Promise<CommandResponseDto> {
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

**🎯 핵심 기능**
- 단일 식별자로 조회하되 복수 결과 반환 가능
- 채널별 전략 패턴으로 API 차이점 추상화  
- 실시간 최신 데이터 조회 (캐시 없음)

**📋 지원 채널 및 조회 타입**

**쿠팡 (coupang)**
- \`ordersheet\` + shipmentBoxId: 배송번호 기준 발주서 조회
- \`ordersheet-by-orderid\` + orderId: 주문번호 기준 발주서 조회

**네이버 (naver_smartstore)**  
- \`order\` + productOrderId: 상품주문번호 기준 조회
- \`order\` + orderId: 주문번호 기준 조회

**메두사 (medusa)**
- \`order\` + orderId: 주문번호 기준 조회

**💼 주요 사용 사례**

🏠 **배송지 변경 확인**
- 결제 완료 후 고객의 배송지 변경 여부 확인
- 출고 직전 최종 배송 정보 검증

📦 **상품 정보 검증**  
- 출고 전 상품명과 옵션 정보 일치 여부 확인
- 픽킹 리스트와 실제 주문 내용 대조

🚚 **실시간 상태 조회**
- 운송장 번호, 배송 상태 등 최신 정보 확인
- CS 문의 대응을 위한 실시간 주문 상태 파악

**⚠️ 주의사항**
- 각 채널별로 지원하는 queryType이 다를 수 있습니다
- 전략에서 지원하지 않는 queryType 사용 시 400 에러 반환
- 외부 API 호출로 인한 응답 지연 가능성 있음`,
  })
  @ApiResponse({
    status: 200,
    description: '주문 조회 성공',
    type: QueryOrdersResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 파라미터 또는 지원하지 않는 조회 타입',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '채널 API 인증 실패',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '조회 결과 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '외부 API 호출 실패',
    type: ErrorResponseDto,
  })
  async queryOrders(
    @Param('channel') channel: ChannelType,
    @Param('queryType') queryType: 'ordersheet' | 'ordersheet-by-orderid',
    @Param('identifier') identifier: string,
  ): Promise<QueryOrdersResponseDto> {
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
        timestamp: new Date().toISOString(),
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
   * 🔍 교환 요청 목록 조회 (SSOT 원칙 + CQRS 패턴)
   *
   * 모든 채널에서 동일한 인터페이스로 교환 요청을 조회하고,
   * 표준 내부 모델 (InternalExchangeEvent[])로 반환합니다.
   *
   * @example
   * GET /adapter/coupang/query/exchange-requests?dateFrom=2025-01-01T00:00:00&dateTo=2025-01-07T23:59:59&status=RECEIPT
   * GET /adapter/naver_smartstore/query/exchange-requests?dateFrom=2025-01-01T00:00:00&dateTo=2025-01-07T23:59:59
   */
  @Get(':channel/query/exchange-requests')
  @ApiOperation({
    summary: '교환 요청 목록 조회 (SSOT 원칙)',
    description: `모든 채널에서 동일한 인터페이스로 교환 요청을 조회합니다. 
결과는 채널에 무관한 표준 내부 모델 (InternalExchangeEvent[])로 반환됩니다.

**🎯 SSOT (Single Source of Truth) 원칙**
- 모든 채널의 교환 데이터가 InternalExchangeEvent로 표준화
- 채널별 복잡한 구조는 각 전략에서 번역하여 숨김  
- 내부 시스템은 채널을 몰라도 일관된 데이터 사용 가능

**📊 지원 쿼리 파라미터**
- \`dateFrom\`, \`dateTo\`: 조회 기간 (필수, ISO 8601 형식)
- \`status\`: 교환 상태 필터 (선택)
- \`orderId\`: 특정 주문 필터 (선택)  
- \`pageSize\`: 페이지 크기 (선택, 기본값: 10)

**📈 교환 상태 종류**
- \`RECEIPT\`: 교환 접수
- \`PROGRESS\`: 교환 진행 중
- \`SUCCESS\`: 교환 완료
- \`REJECT\`: 교환 거부
- \`CANCEL\`: 교환 취소

**💡 사용 예시**
- 특정 기간의 모든 교환 요청: \`?dateFrom=2025-01-01T00:00:00&dateTo=2025-01-07T23:59:59\`
- 접수 상태만 필터링: \`?dateFrom=...&dateTo=...&status=RECEIPT\`
- 특정 주문의 교환 요청: \`?dateFrom=...&dateTo=...&orderId=12345\``,
  })
  @ApiResponse({
    status: 200,
    description: '표준 내부 교환 이벤트 배열 반환 (InternalExchangeEvent[])',
    type: ExchangeRequestsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 파라미터 (필수 파라미터 누락 또는 잘못된 형식)',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '채널 API 인증 실패',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '교환 요청을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '교환 요청 조회 중 오류 발생',
    type: ErrorResponseDto,
  })
  async queryExchangeRequests(
    @Param('channel') channel: ChannelType,
    @Query() query: ExchangeRequestsQueryDto,
  ): Promise<ExchangeRequestsResponseDto> {
    this.logger.log(`🔍 [${channel}] 교환 요청 목록 조회 API 호출`);

    try {
      if (!query.dateFrom || !query.dateTo) {
        throw new HttpException(
          'dateFrom과 dateTo는 필수 파라미터입니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      const channelQuery: ChannelQuery = {
        type: 'exchange.requests',
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        status: query.status,
        orderId: query.orderId ? parseInt(query.orderId) : undefined,
        sizePerPage: query.pageSize ? parseInt(query.pageSize) : 10,
      };

      const result = await this.channelAdapterService.query(
        channel,
        channelQuery,
      );

      return {
        success: true,
        data: result,
        message: `${channel} 채널에서 ${result.length}건의 교환 요청을 조회했습니다.`,
        metadata: {
          channel,
          queryType: 'exchange.requests',
          resultCount: result.length,
          ssotModel: 'InternalExchangeEvent[]',
          dateRange: { from: query.dateFrom, to: query.dateTo },
          filters: {
            status: query.status,
            orderId: query.orderId,
            pageSize: query.pageSize ? parseInt(query.pageSize) : 10,
          },
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `❌ [${channel}] 교환 요청 목록 조회 실패:`,
        error.message,
      );

      // 🎯 BadRequestException은 그대로 전달 (NestJS가 자동 처리)
      if (error instanceof BadRequestException) {
        throw error; // CoupangApiService에서 이미 완벽하게 처리됨
      }

      if (error.message.includes('not found')) {
        throw new HttpException(
          `${channel} 채널에서 교환 요청을 찾을 수 없습니다.`,
          HttpStatus.NOT_FOUND,
        );
      }

      if (error.message.includes('인증') || error.message.includes('auth')) {
        throw new HttpException(
          `${channel} 채널 API 인증에 실패했습니다.`,
          HttpStatus.UNAUTHORIZED,
        );
      }

      // ⚠️ BadRequestException 이후에만 다른 에러 처리 (중복 방지)
      if (
        error.message.includes('Invalid') ||
        error.message.includes('잘못된')
      ) {
        throw new HttpException(
          `잘못된 요청 파라미터입니다: ${error.message}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      throw new HttpException(
        `${channel} 채널 교환 요청 조회 중 오류가 발생했습니다.`,
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

  // ===== WMS 연동 엔드포인트 (CTO SoT 원칙) =====

  @Post('wms/orders')
  @ApiOperation({
    summary: '채널 주문을 WMS에 전달',
    description: `CTO SoT 원칙에 따라 어댑터가 SoT인 판매채널 주문을 WMS에 동기 요청으로 전달합니다.

**🎯 SoT (Source of Truth) 원칙**
- 채널 어댑터가 판매채널 주문의 신뢰 가능한 출처
- WMS는 어댑터로부터 전달받은 주문 정보를 기준으로 처리
- 채널별 차이점은 어댑터에서 표준화하여 전달

**📋 처리 흐름**
1. 채널에서 주문 발생 → 어댑터가 수집
2. 어댑터가 표준 주문 포맷으로 변환  
3. WMS에 동기 요청으로 주문 생성
4. WMS 주문 ID와 매핑 정보 저장

**💡 사용 사례**
- 신규 주문 발생 시 WMS에 자동 전달
- 결제 완료된 주문의 이행 시작
- 채널별 주문 정보를 WMS 표준 포맷으로 변환`,
  })
  @ApiBody({
    description: '채널 주문 이벤트',
    schema: {
      type: 'object',
      required: ['channel', 'orderEvent'],
      properties: {
        channel: {
          type: 'string',
          enum: ['naver_smartstore', 'coupang', 'medusa'],
        },
        orderEvent: {
          type: 'object',
          description: '채널별 주문 이벤트 데이터',
        },
        reason: {
          type: 'string',
          description: '취소/교환 사유 (선택사항)',
        },
      },
    },
    examples: {
      naverOrder: {
        summary: '네이버 스마트스토어 주문',
        description: '네이버에서 발생한 주문을 WMS에 전달',
        value: {
          channel: 'naver_smartstore',
          orderEvent: {
            channelType: 'naver_smartstore',
            externalOrderId: '2025091550078121',
            externalProductOrderId: '2025091565429621',
            status: 'PAID',
            quantity: 2,
            priceAmount: 59800,
            productName: '프리미엄 티셔츠',
            buyer: {
              name: '김철수',
              contact: '010-1234-5678',
              address: {
                postalCode: '12345',
                roadAddress: '서울시 강남구 테헤란로 123',
                detailAddress: '456호',
              },
            },
          },
        },
      },
      coupangOrder: {
        summary: '쿠팡 주문',
        description: '쿠팡에서 발생한 주문을 WMS에 전달',
        value: {
          channel: 'coupang',
          orderEvent: {
            channelType: 'coupang',
            externalOrderId: '5077495966',
            externalProductOrderId: '16885250726',
            status: 'PAID',
            quantity: 1,
            priceAmount: 29900,
            productName: '베이직 후드티',
            buyer: {
              name: '이영희',
              contact: '050-9876-5432',
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'WMS 주문 생성 성공',
    type: WmsOrderResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 데이터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '주문을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'WMS 연동 실패',
    type: ErrorResponseDto,
  })
  async createOrderInWms(
    @Body() body: { channel: ChannelType; orderEvent: any },
  ): Promise<WmsOrderResponseDto> {
    try {
      const { channel, orderEvent } = body;

      if (!channel || !orderEvent) {
        throw new HttpException(
          '채널(channel)과 주문 이벤트(orderEvent)는 필수입니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(
        `🏭 [${channel}→WMS] 주문 생성 요청: ${orderEvent.externalOrderId}`,
      );

      const wmsOrder = await this.orchestrationService.createOrderInWms(
        channel,
        orderEvent,
      );

      this.logger.log(`✅ [${channel}→WMS] 주문 생성 성공: ${wmsOrder.id}`);

      return {
        success: true,
        wmsOrder,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`❌ [WMS] 주문 생성 실패`, error.stack);

      if (error.message?.includes('not found')) {
        throw new HttpException(
          '주문을 찾을 수 없습니다.',
          HttpStatus.NOT_FOUND,
        );
      }
      if (
        error.message?.includes('already processed') ||
        error.message?.includes('invalid') ||
        error.message?.includes('required')
      ) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }

      throw new HttpException(
        'WMS 주문 생성 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('wms/orders/cancel')
  @ApiOperation({
    summary: '채널 주문 취소를 WMS에 전달',
    description:
      '채널에서 취소 요청이 들어왔을 때 WMS에 취소 요청을 전달합니다.',
  })
  @ApiBody({
    description: '주문 취소 요청',
    schema: {
      type: 'object',
      required: ['channel', 'orderEvent'],
      properties: {
        channel: {
          type: 'string',
          enum: ['naver_smartstore', 'coupang', 'medusa'],
        },
        orderEvent: { type: 'object', description: '주문 취소 이벤트 데이터' },
        reason: { type: 'string', description: '취소 사유 (선택사항)' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'WMS 주문 취소 성공' })
  async cancelOrderInWms(
    @Body() body: { channel: ChannelType; orderEvent: any; reason?: string },
  ) {
    try {
      const { channel, orderEvent, reason } = body;

      this.logger.log(
        `❌ [${channel}→WMS] 주문 취소 요청: ${orderEvent.externalOrderId}`,
      );

      const wmsOrder = await this.orchestrationService.cancelOrderInWms(
        channel,
        orderEvent,
        reason,
      );

      this.logger.log(`✅ [${channel}→WMS] 주문 취소 성공: ${wmsOrder.id}`);

      return {
        success: true,
        wmsOrder,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`❌ [WMS] 주문 취소 실패`, error.stack);

      if (error.message?.includes('not found')) {
        throw new HttpException(
          '취소할 주문을 찾을 수 없습니다.',
          HttpStatus.NOT_FOUND,
        );
      }
      if (
        error.message?.includes('already processed') ||
        error.message?.includes('cannot cancel')
      ) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }

      throw new HttpException(
        'WMS 주문 취소 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('wms/orders/exchange')
  @ApiOperation({
    summary: '채널 교환 요청을 WMS에 전달',
    description:
      'CTO 가이드라인: "교환은 주문 내에서 일어나는 동작입니다". 기존 주문을 수정하는 방식으로 처리합니다.',
  })
  @ApiBody({
    description: '교환 요청',
    schema: {
      type: 'object',
      required: ['channel', 'exchangeEvent'],
      properties: {
        channel: {
          type: 'string',
          enum: ['naver_smartstore', 'coupang', 'medusa'],
        },
        exchangeEvent: {
          type: 'object',
          description: '교환 요청 이벤트 데이터',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'WMS 교환 처리 성공' })
  async processExchangeInWms(
    @Body() body: { channel: ChannelType; exchangeEvent: any },
  ) {
    try {
      const { channel, exchangeEvent } = body;

      this.logger.log(
        `🔄 [${channel}→WMS] 교환 요청: ${exchangeEvent.externalOrderId}`,
      );

      const wmsOrder = await this.orchestrationService.processExchangeInWms(
        channel,
        exchangeEvent,
      );

      this.logger.log(`✅ [${channel}→WMS] 교환 처리 성공: ${wmsOrder.id}`);

      return {
        success: true,
        wmsOrder,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`❌ [WMS] 교환 처리 실패`, error.stack);

      if (error.message?.includes('not found')) {
        throw new HttpException(
          '교환할 주문을 찾을 수 없습니다.',
          HttpStatus.NOT_FOUND,
        );
      }
      if (
        error.message?.includes('invalid exchange') ||
        error.message?.includes('cannot exchange')
      ) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }

      throw new HttpException(
        'WMS 교환 처리 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('wms/dlq/status')
  @ApiOperation({
    summary: 'DLQ 현황 조회',
    description: `WMS 연동 실패로 DLQ(Dead Letter Queue)에 적재된 요청들의 현황을 조회합니다.
    
**📊 제공 정보**
- 전체 실패 건수 및 심각도별 분류
- 최근 실패 항목들의 상세 정보
- 가장 오래된 실패 시각 정보
- 재처리 가능한 항목들의 상태`,
  })
  @ApiResponse({
    status: 200,
    description: 'DLQ 현황 조회 성공',
    type: DlqStatusResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'DLQ 데이터를 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'DLQ 현황 조회 중 오류 발생',
    type: ErrorResponseDto,
  })
  async getDlqStatus(): Promise<DlqStatusResponseDto> {
    try {
      this.logger.log('📊 DLQ 현황 조회 요청');

      // 실제 DlqMonitoringService를 통해 DLQ 현황 조회
      const dlqStatus = await this.dlqMonitoringService.getDlqStatus();

      this.logger.log('✅ DLQ 현황 조회 성공', {
        totalCount: dlqStatus.summary.totalCount,
        criticalCount: dlqStatus.summary.criticalCount,
      });

      return {
        success: true,
        dlqStatus,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('❌ DLQ 현황 조회 실패', error.stack);

      if (error.message?.includes('not found')) {
        throw new HttpException(
          'DLQ 데이터를 찾을 수 없습니다.',
          HttpStatus.NOT_FOUND,
        );
      }

      throw new HttpException(
        'DLQ 현황 조회 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('wms/dlq/:dlqId/retry')
  @ApiOperation({
    summary: 'DLQ 항목 재처리',
    description: `실패한 DLQ 항목을 수동으로 재처리합니다.
    
**🔄 재처리 과정**
1. DLQ에서 해당 항목 조회
2. 원본 요청 데이터로 WMS 연동 재시도
3. 성공 시 DLQ에서 제거, 실패 시 재시도 횟수 증가
4. 처리 결과 반환`,
  })
  @ApiResponse({
    status: 200,
    description: 'DLQ 재처리 성공',
    type: DlqRetryResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'DLQ 항목을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'DLQ 재처리 중 오류 발생',
    type: ErrorResponseDto,
  })
  async retryDlqEntry(
    @Param('dlqId') dlqId: string,
  ): Promise<DlqRetryResponseDto> {
    try {
      this.logger.log(`🔄 DLQ 재처리 요청: ${dlqId}`);

      const success = await this.dlqMonitoringService.retryDlqEntry(dlqId);

      if (success) {
        this.logger.log(`✅ DLQ 재처리 성공: ${dlqId}`);
        return {
          success: true,
          message: 'DLQ 항목이 성공적으로 재처리되었습니다.',
          dlqId,
          timestamp: new Date().toISOString(),
        };
      } else {
        this.logger.warn(`⚠️ DLQ 재처리 실패: ${dlqId}`);
        return {
          success: false,
          message: 'DLQ 항목 재처리에 실패했습니다.',
          dlqId,
          timestamp: new Date().toISOString(),
        };
      }
    } catch (error) {
      this.logger.error(`❌ DLQ 재처리 오류: ${dlqId}`, error.stack);

      if (error.message?.includes('not found')) {
        throw new HttpException(
          'DLQ 항목을 찾을 수 없습니다.',
          HttpStatus.NOT_FOUND,
        );
      }

      throw new HttpException(
        'DLQ 재처리 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('wms/dlq/:dlqId')
  @ApiOperation({
    summary: 'DLQ 항목 수동 제거',
    description: `실패한 DLQ 항목을 수동으로 제거합니다. (관리자 기능)
    
**⚠️ 주의사항**
- 이 작업은 되돌릴 수 없습니다
- 제거된 DLQ 항목은 더 이상 재처리할 수 없습니다
- 관리자만 사용해야 하는 기능입니다
- 제거 사유를 반드시 기록해야 합니다`,
  })
  @ApiBody({
    description: 'DLQ 제거 요청',
    type: DlqRemoveRequestDto,
    examples: {
      withReason: {
        summary: '사유와 함께 제거',
        value: {
          reason: '비즈니스 요구사항 변경으로 인한 제거',
        },
      },
      withoutReason: {
        summary: '기본 사유로 제거',
        value: {},
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'DLQ 항목 제거 성공',
    type: DlqRemoveResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'DLQ 항목을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'DLQ 항목 제거 중 오류 발생',
    type: ErrorResponseDto,
  })
  async removeDlqEntry(
    @Param('dlqId') dlqId: string,
    @Body() body: DlqRemoveRequestDto = {},
  ): Promise<DlqRemoveResponseDto> {
    try {
      const reason = body.reason || '관리자 수동 제거';

      this.logger.log(`🗑️ DLQ 항목 제거 요청: ${dlqId}`, { reason });

      await this.dlqMonitoringService.removeDlqEntry(dlqId, reason);

      this.logger.log(`✅ DLQ 항목 제거 성공: ${dlqId}`);

      return {
        success: true,
        message: 'DLQ 항목이 성공적으로 제거되었습니다.',
        dlqId,
        reason,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`❌ DLQ 항목 제거 오류: ${dlqId}`, error.stack);

      if (error.message?.includes('not found')) {
        throw new HttpException(
          'DLQ 항목을 찾을 수 없습니다.',
          HttpStatus.NOT_FOUND,
        );
      }

      throw new HttpException(
        'DLQ 항목 제거 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
