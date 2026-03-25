import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// ═══════════════════════════════════════════════════════════════
// 기본 타입 스키마
// ═══════════════════════════════════════════════════════════════

export const ChannelTypeSchema = z.enum(['naver_smartstore', 'coupang', 'medusa']);

export const DataTypeSchema = z.enum(['orders', 'order_status', 'claims', 'inventory', 'products']);

// ═══════════════════════════════════════════════════════════════
// 요청/응답 스키마
// ═══════════════════════════════════════════════════════════════

// 폴링
export const PollQuerySchema = z.object({
  channel: ChannelTypeSchema,
  type: DataTypeSchema,
});

export const PollResponseSchema = z.object({
  success: z.boolean(),
  channel: ChannelTypeSchema,
  dataType: DataTypeSchema,
  count: z.number(),
  data: z.array(z.any()),
  timestamp: z.string(),
});

// 동기화
export const SyncToChannelPayloadSchema = z.object({
  dataType: DataTypeSchema,
  payload: z.any(),
});

export const SyncResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  timestamp: z.string(),
});

// 명령 실행
export const TrackingInfoSchema = z.object({
  companyCode: z.string(),
  number: z.string(),
});

export const ChannelCommandSchema = z.discriminatedUnion('type', [
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

export const CommandResponseSchema = z.object({
  success: z.boolean(),
  commandType: z.string(),
  result: z.any(),
  message: z.string(),
  timestamp: z.string(),
});

// 교환 요청 조회
export const ExchangeRequestsQuerySchema = z.object({
  dateFrom: z.string(),
  dateTo: z.string(),
  status: z.enum(['RECEIPT', 'PROGRESS', 'SUCCESS', 'REJECT', 'CANCEL']).optional(),
  orderId: z.string().optional(),
  pageSize: z.string().optional(),
});

export const ExchangeRequestsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(z.any()),
  message: z.string(),
  metadata: z.object({
    channel: ChannelTypeSchema,
    queryType: z.literal('exchange.requests'),
    resultCount: z.number(),
    dateRange: z.object({
      from: z.string(),
      to: z.string(),
    }),
    filters: z.object({
      status: z.string().optional(),
      orderId: z.string().optional(),
      pageSize: z.number().optional(),
    }),
  }),
  timestamp: z.string(),
});

// WMS 연동
export const WmsOrderRequestSchema = z.object({
  channel: ChannelTypeSchema,
  orderEvent: z.any(),
});

export const WmsOrderCancelRequestSchema = z.object({
  channel: ChannelTypeSchema,
  orderEvent: z.any(),
  reason: z.string().optional(),
});

export const WmsExchangeRequestSchema = z.object({
  channel: ChannelTypeSchema,
  exchangeEvent: z.any(),
});

export const WmsOrderResponseSchema = z.object({
  success: z.boolean(),
  wmsOrder: z.any(),
  timestamp: z.string(),
});

// NOTE: DLQ 관리 스키마 제거됨 (DlqMonitoringService 제거에 따라)
// - DlqStatusResponseSchema
// - DlqRetryResponseSchema
// - DlqRemoveResponseSchema

// ═══════════════════════════════════════════════════════════════
// DTO 클래스 생성
// ═══════════════════════════════════════════════════════════════

export class PollQueryDto extends createZodDto(PollQuerySchema) {}
export class PollResponseDto extends createZodDto(PollResponseSchema) {}
export class SyncToChannelPayloadDto extends createZodDto(SyncToChannelPayloadSchema) {}
export class SyncResponseDto extends createZodDto(SyncResponseSchema) {}
export class CommandResponseDto extends createZodDto(CommandResponseSchema) {}
export class ExchangeRequestsQueryDto extends createZodDto(ExchangeRequestsQuerySchema) {}
export class ExchangeRequestsResponseDto extends createZodDto(ExchangeRequestsResponseSchema) {}
export class WmsOrderRequestDto extends createZodDto(WmsOrderRequestSchema) {}
export class WmsOrderCancelRequestDto extends createZodDto(WmsOrderCancelRequestSchema) {}
export class WmsExchangeRequestDto extends createZodDto(WmsExchangeRequestSchema) {}
export class WmsOrderResponseDto extends createZodDto(WmsOrderResponseSchema) {}
// NOTE: DLQ DTO 클래스 제거됨 (DlqMonitoringService 제거에 따라)
// - DlqStatusResponseDto
// - DlqRetryResponseDto
// - DlqRemoveResponseDto
