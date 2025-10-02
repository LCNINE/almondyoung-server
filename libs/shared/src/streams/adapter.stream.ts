/**
 * Channel Adapter Stream Configuration
 * 
 * 채널 어댑터 이벤트 스트림 정의
 */

import { StreamConfig, EventType } from '@app/events';
import { z } from 'zod';
import { InternalOrderEvent } from '../channel-adapter.types';

// ===== Payload 타입 정의 =====

export interface OrderSyncCompletedPayload {
  channelType: 'naver_smartstore' | 'coupang' | 'medusa';
  syncType: 'inbound' | 'outbound'; // 수신/송신 동기화 구분
  orderCount: number;
  orders: InternalOrderEvent[];
  syncDurationMs: number;
  errors?: Array<{
    orderId: string;
    message: string;
  }>;
}

export interface InventorySyncCompletedPayload {
  channelType: 'naver_smartstore' | 'coupang' | 'medusa';
  productId: string;
  syncType: 'single' | 'option'; // 단일상품/옵션상품 구분
  stockQuantity: number;
  syncResult: 'success' | 'failed';
  errorMessage?: string;
}

export interface CommandExecutedPayload {
  channelType: 'naver_smartstore' | 'coupang' | 'medusa';
  commandType: string; // 'order.confirm', 'dispatch.confirm', 'cancel.approve' 등
  targetId: string; // 대상 주문/상품 ID
  executionResult: 'success' | 'failed';
  processedCount: number;
  failedCount: number;
  errors?: Array<{
    id: string;
    message: string;
  }>;
  executionDurationMs: number;
}

export interface SyncFailurePayload {
  channelType: 'naver_smartstore' | 'coupang' | 'medusa';
  syncType: 'orders' | 'inventory' | 'products' | 'command';
  failureReason: string;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: string; // ISO 8601
  affectedIds?: string[]; // 실패한 주문/상품 ID들
}

export interface ChannelStatusChangedPayload {
  channelType: 'naver_smartstore' | 'coupang' | 'medusa';
  previousStatus: 'active' | 'inactive' | 'error';
  currentStatus: 'active' | 'inactive' | 'error';
  reason?: string;
  lastSyncAt?: string; // ISO 8601
  errorDetails?: {
    message: string;
    code?: string;
    occurredAt: string;
  };
}

export interface QueryExecutedPayload {
  channelType: 'naver_smartstore' | 'coupang' | 'medusa';
  queryType: string; // 'order.status', 'claim.details', etc.
  resultCount: number;
  executionDurationMs: number;
  success: boolean;
  errorMessage?: string;
}

// ===== Zod 스키마 정의 =====

const ChannelTypeSchema = z.enum(['naver_smartstore', 'coupang', 'medusa']);

const ErrorItemSchema = z.object({
  orderId: z.string(),
  message: z.string(),
});

const CommandErrorSchema = z.object({
  id: z.string(),
  message: z.string(),
});

// InternalOrderEvent는 복잡하므로 간단한 검증만
const InternalOrderEventSchema = z.object({
  channelType: ChannelTypeSchema,
  externalOrderId: z.string(),
  status: z.string(),
  quantity: z.number(),
  priceAmount: z.number(),
}).passthrough(); // 나머지 필드는 통과

const OrderSyncCompletedSchema = z.object({
  channelType: ChannelTypeSchema,
  syncType: z.enum(['inbound', 'outbound']),
  orderCount: z.number().int().nonnegative(),
  orders: z.array(InternalOrderEventSchema),
  syncDurationMs: z.number().nonnegative(),
  errors: z.array(ErrorItemSchema).optional(),
});

const InventorySyncCompletedSchema = z.object({
  channelType: ChannelTypeSchema,
  productId: z.string().min(1),
  syncType: z.enum(['single', 'option']),
  stockQuantity: z.number().int().nonnegative(),
  syncResult: z.enum(['success', 'failed']),
  errorMessage: z.string().optional(),
});

const CommandExecutedSchema = z.object({
  channelType: ChannelTypeSchema,
  commandType: z.string().min(1),
  targetId: z.string().min(1),
  executionResult: z.enum(['success', 'failed']),
  processedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  errors: z.array(CommandErrorSchema).optional(),
  executionDurationMs: z.number().nonnegative(),
});

const SyncFailureSchema = z.object({
  channelType: ChannelTypeSchema,
  syncType: z.enum(['orders', 'inventory', 'products', 'command']),
  failureReason: z.string().min(1),
  retryCount: z.number().int().nonnegative(),
  maxRetries: z.number().int().positive(),
  nextRetryAt: z.string().datetime().optional(),
  affectedIds: z.array(z.string()).optional(),
});

const ChannelStatusChangedSchema = z.object({
  channelType: ChannelTypeSchema,
  previousStatus: z.enum(['active', 'inactive', 'error']),
  currentStatus: z.enum(['active', 'inactive', 'error']),
  reason: z.string().optional(),
  lastSyncAt: z.string().datetime().optional(),
  errorDetails: z.object({
    message: z.string(),
    code: z.string().optional(),
    occurredAt: z.string().datetime(),
  }).optional(),
});

const QueryExecutedSchema = z.object({
  channelType: ChannelTypeSchema,
  queryType: z.string().min(1),
  resultCount: z.number().int().nonnegative(),
  executionDurationMs: z.number().nonnegative(),
  success: z.boolean(),
  errorMessage: z.string().optional(),
});

// ===== Event Types Map =====

export type ChannelAdapterEvents = {
  OrderSyncCompleted: EventType<OrderSyncCompletedPayload>;
  InventorySyncCompleted: EventType<InventorySyncCompletedPayload>;
  CommandExecuted: EventType<CommandExecutedPayload>;
  SyncFailure: EventType<SyncFailurePayload>;
  ChannelStatusChanged: EventType<ChannelStatusChangedPayload>;
  QueryExecuted: EventType<QueryExecutedPayload>;
};

// ===== Stream Config =====

export const CHANNEL_ADAPTER_STREAM: StreamConfig<ChannelAdapterEvents> = {
  topic: {
    topic: 'channel-adapter.events.v1',
    partitions: 6,
  },
  aggregateType: 'ChannelAdapter',
  events: {
    OrderSyncCompleted: {
      messageType: 'OrderSyncCompleted',
      payloadType: {} as OrderSyncCompletedPayload,
      schema: OrderSyncCompletedSchema,
    },
    InventorySyncCompleted: {
      messageType: 'InventorySyncCompleted',
      payloadType: {} as InventorySyncCompletedPayload,
      schema: InventorySyncCompletedSchema,
    },
    CommandExecuted: {
      messageType: 'CommandExecuted',
      payloadType: {} as CommandExecutedPayload,
      schema: CommandExecutedSchema,
    },
    SyncFailure: {
      messageType: 'SyncFailure',
      payloadType: {} as SyncFailurePayload,
      schema: SyncFailureSchema,
    },
    ChannelStatusChanged: {
      messageType: 'ChannelStatusChanged',
      payloadType: {} as ChannelStatusChangedPayload,
      schema: ChannelStatusChangedSchema,
    },
    QueryExecuted: {
      messageType: 'QueryExecuted',
      payloadType: {} as QueryExecutedPayload,
      schema: QueryExecutedSchema,
    },
  },
};

