/**
 * Channel Adapter Stream Configuration
 *
 * 채널 어댑터 이벤트 스트림 정의
 */

import { event, stream } from '../types';
import { z } from 'zod';

// ===== Channel Adapter 공통 타입 정의 =====

export type ChannelType = 'naver_smartstore' | 'coupang' | 'medusa';

export type ClaimType = 'CANCEL' | 'RETURN' | 'EXCHANGE';

export interface ClaimInfo {
  claimId: string;
  claimType: ClaimType;
  status?: string;
  reason?: string;
  quantity?: number;
  completedDate?: string;
}

export interface DispatchInfo {
  deliveryMethod: string;
  trackingNumber?: string;
  deliveryCompanyCode?: string;
  promiseDeliveryDate?: string;
  dispatchedAt?: string;
}

export interface BuyerInfo {
  name?: string;
  contact?: string;
  address?: {
    postalCode?: string;
    roadAddress?: string;
    detailAddress?: string;
  };
}

/**
 * 내부 주문 이벤트 데이터 형식
 */
export interface InternalOrderEvent {
  channelType: ChannelType;
  externalOrderId: string;
  externalProductOrderId?: string;
  status: string;
  lastChangedType?: string;
  lastChangedAt?: string;
  paymentDate?: string;
  quantity: number;
  remainQuantity?: number;
  priceAmount: number;
  discountAmount?: number;
  buyer?: BuyerInfo;
  dispatch?: DispatchInfo;
  currentClaim?: ClaimInfo;
  completedClaims?: ClaimInfo[];
  createdAt?: string;
  updatedAt?: string;
  reason?: string;
  claimInfo?: ClaimInfo;
  productName?: string;

  // 설계 문서 반영 - 추가 필드
  optionName?: string; // 상품 옵션명
  productId?: string; // 채널 상품 ID
  internalOrderId?: string; // WMS/내부 시스템 주문 ID (생성 후 부여)
}

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

// ===== Stream Config (타입 안전 버전) =====

export const CHANNEL_ADAPTER_STREAM = stream({
  topic: 'channel-adapter.events.v1',
  partitions: 6,
  aggregateType: 'ChannelAdapter',
  events: {
    OrderSyncCompleted: event('OrderSyncCompleted', OrderSyncCompletedSchema),
    InventorySyncCompleted: event('InventorySyncCompleted', InventorySyncCompletedSchema),
    CommandExecuted: event('CommandExecuted', CommandExecutedSchema),
    SyncFailure: event('SyncFailure', SyncFailureSchema),
    ChannelStatusChanged: event('ChannelStatusChanged', ChannelStatusChangedSchema),
    QueryExecuted: event('QueryExecuted', QueryExecutedSchema),
  },
});

// ===== 타입 추론 =====

export type ChannelAdapterEvents = typeof CHANNEL_ADAPTER_STREAM.events;

