// ===== 채널 어댑터 이벤트 페이로드 타입들 =====

import { BaseEventPayload, EventDefinition } from '@app/events';
import { InternalOrderEvent } from 'apps/channel-adapter/src/types';

/** 주문 동기화 완료 이벤트 페이로드 */
export interface OrderSyncCompletedPayload extends BaseEventPayload {
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

/** 재고 동기화 완료 이벤트 페이로드 */
export interface InventorySyncCompletedPayload extends BaseEventPayload {
  channelType: 'naver_smartstore' | 'coupang' | 'medusa';
  productId: string;
  syncType: 'single' | 'option'; // 단일상품/옵션상품 구분
  stockQuantity: number;
  syncResult: 'success' | 'failed';
  errorMessage?: string;
}

/** 명령 실행 완료 이벤트 페이로드 */
export interface CommandExecutedPayload extends BaseEventPayload {
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

/** 동기화 실패 알림 이벤트 페이로드 */
export interface SyncFailurePayload extends BaseEventPayload {
  channelType: 'naver_smartstore' | 'coupang' | 'medusa';
  syncType: 'orders' | 'inventory' | 'products' | 'command';
  failureReason: string;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: string; // ISO datetime
  affectedIds?: string[]; // 실패한 주문/상품 ID들
}

/** 채널 상태 변경 이벤트 페이로드 */
export interface ChannelStatusChangedPayload extends BaseEventPayload {
  channelType: 'naver_smartstore' | 'coupang' | 'medusa';
  previousStatus: 'active' | 'inactive' | 'error';
  currentStatus: 'active' | 'inactive' | 'error';
  reason?: string;
  lastSyncAt?: string;
  errorDetails?: {
    message: string;
    code?: string;
    occurredAt: string;
  };
}

// ===== 이벤트 정의 맵 =====

export interface ChannelAdapterEvents extends Record<string, EventDefinition> {
  'order.sync.completed': EventDefinition<OrderSyncCompletedPayload>;
  'inventory.sync.completed': EventDefinition<InventorySyncCompletedPayload>;
  'command.executed': EventDefinition<CommandExecutedPayload>;
  'sync.failure': EventDefinition<SyncFailurePayload>;
  'channel.status.changed': EventDefinition<ChannelStatusChangedPayload>;
}

// 실제 이벤트 토픽과 페이로드를 매핑하는 객체
// 실제 이벤트 토픽과 페이로드를 매핑하는 객체
export const CHANNEL_ADAPTER_EVENTS: ChannelAdapterEvents = {
  'order.sync.completed': {
    topic: 'channel-adapter.order.sync.completed',
    payload: {} as OrderSyncCompletedPayload,
  },
  'inventory.sync.completed': {
    topic: 'channel-adapter.inventory.sync.completed',
    payload: {} as InventorySyncCompletedPayload,
  },
  'command.executed': {
    topic: 'channel-adapter.command.executed',
    payload: {} as CommandExecutedPayload,
  },
  'sync.failure': {
    topic: 'channel-adapter.sync.failure',
    payload: {} as SyncFailurePayload,
  },
  'channel.status.changed': {
    topic: 'channel-adapter.channel.status.changed',
    payload: {} as ChannelStatusChangedPayload,
  },
};
