/**
 * Retry Policy Decorators
 *
 * 이벤트 핸들러의 재시도 정책을 지정하는 데코레이터
 */

import { SetMetadata } from '@nestjs/common';
import { RETRY_POLICY_METADATA, DISABLE_DLQ_METADATA, RetryPolicyConfig } from './retry-policy.types';

/**
 * 이벤트 핸들러의 재시도 정책 지정
 *
 * @example
 * @OnEvent('orders.events.v1', 'OrderCreated')
 * @RetryPolicy({ maxRetries: 5, backoff: 'exponential' })
 * async handleOrderCreated(@EventPayload() payload: OrderCreatedPayload) {
 *   // 에러 발생 시 5번까지 재시도
 *   // 실패 시 자동으로 DLQ로 전송
 * }
 */
export const RetryPolicy = (config: RetryPolicyConfig = {}) => SetMetadata(RETRY_POLICY_METADATA, config);

/**
 * DLQ 전송 비활성화
 *
 * 재시도 실패 시 DLQ로 전송하지 않고 버림
 * (중요하지 않은 이벤트에 사용)
 *
 * @example
 * @OnEvent('analytics.events.v1', 'PageView')
 * @DisableDLQ()
 * async handlePageView(@EventPayload() payload: PageViewPayload) {
 *   // 실패해도 DLQ에 보내지 않음
 * }
 */
export const DisableDLQ = () => SetMetadata(DISABLE_DLQ_METADATA, true);
