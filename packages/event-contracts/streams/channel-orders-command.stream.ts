/**
 * Channel Orders Command Stream (#1016 6번 행)
 *
 * 명령 스트림이다 — «일어난 사실»이 아니라 실행자가 하나인 «요청». core 는 channel-adapter 를
 * 직접 부르지 않는다(channel-adapter 는 외부 세계의 일을 이벤트로 번역해 브로커에 던지는 자리다).
 * 그래서 토픽 이름은 서비스가 아니라 역할로 짓는다 — core 는 «채널 주문을 다룰 줄 아는 누군가»에게
 * 요청할 뿐 그게 누구인지 모른다. 기존 `wallet.commands.v1`(받는 쪽 이름)·`ugc.commands.v1`(보내는 쪽
 * 이름)과 기준이 다른 이유다. 명령 이름은 명령형(`CreateInvoice` 와 같은 꼴).
 *
 * 파티션 키 = `channelOrderPartitionKey` — 같은 주문의 명령(35번 행 취소 요청 포함)이 순서대로 처리된다.
 */

import { event, stream } from '../types';
import { z } from 'zod';

// ===== Command Payloads =====

/** 그 채널 주문의 지금 상태를 다시 가져와 수집 경로(`OrderModified`)로 흘려 달라는 요청. */
export interface ResyncChannelOrderPayload {
  /** 'medusa' | 'naver' … — 문자열로 두고, 지원 여부는 소비자가 판정한다 */
  salesChannel: string;
  externalOrderId: string;
  /** ISO 8601 */
  requestedAt: string;
}

/**
 * 채널에 주문 취소·부분취소를 요청한다 (#1016 35번 행, ADR-0042). core 는 요청을 기록·보류한 뒤 이 명령을 내고,
 * 확정은 재수집된 `OrderCancelled`/`OrderModified` 로, 거절은 `ChannelOrderCancelRejected` 로 돌려받는다.
 * 환불은 채널이 한다 — core 도 channel-adapter 도 wallet 을 부르지 않는다.
 */
export interface CancelChannelOrderPayload {
  /** core `sales_order_amendments.id`. 같은 요청의 재전송은 같은 값이다 — 채널 쪽 멱등 키 */
  requestId: string;
  /** 'medusa' | 'naver' … — 문자열로 두고, 지원 여부는 소비자가 판정한다 */
  salesChannel: string;
  externalOrderId: string;
  scope: 'full' | 'partial';
  /** partial 일 때만. `quantity` 는 «취소할» 수량이다(남길 수량이 아니다) */
  lines?: Array<{ channelOrderItemId: string; quantity: number }>;
  /**
   * partial 일 때만. 이번 취소 품목에 이미 다른 경로(wallet 관리자 환불 등)로 돌려준 금액(원) — 채널이 그만큼 상계하고
   * 나머지만 환불한다(#1016 37번, ADR-0043). 없으면 채널이 «품목에 연결 안 된 외부 환불»을 보고 거절할 수 있다.
   */
  alreadyRefundedAmount?: number;
  reasonCode?: string;
  requestedBy: 'operator' | 'customer' | 'wallet-refund-approval';
  /** ISO 8601 */
  requestedAt: string;
}

// ===== Zod Schemas =====

const ResyncChannelOrderSchema = z.object({
  salesChannel: z.string().min(1),
  externalOrderId: z.string().min(1),
  requestedAt: z.string().datetime(),
});

const CancelChannelOrderSchema = z
  .object({
    requestId: z.string().min(1),
    salesChannel: z.string().min(1),
    externalOrderId: z.string().min(1),
    scope: z.enum(['full', 'partial']),
    lines: z
      .array(z.object({ channelOrderItemId: z.string().min(1), quantity: z.number().int().positive() }))
      .optional(),
    alreadyRefundedAmount: z.number().int().nonnegative().optional(),
    reasonCode: z.string().min(1).optional(),
    requestedBy: z.enum(['operator', 'customer', 'wallet-refund-approval']),
    requestedAt: z.string().datetime(),
  })
  .superRefine((payload, context) => {
    if (payload.scope === 'partial' && (payload.lines === undefined || payload.lines.length === 0)) {
      context.addIssue({ code: 'custom', path: ['lines'], message: '부분취소는 취소할 줄이 필요하다' });
    }
    if (payload.scope === 'full' && payload.lines !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['lines'],
        message: '전체취소는 줄을 싣지 않는다 — 실으면 어느 쪽이 정본인지 갈린다',
      });
    }
    if (payload.scope === 'full' && payload.alreadyRefundedAmount !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['alreadyRefundedAmount'],
        message: '전체취소는 상계하지 않는다 — 캡처 − 환불을 돌려준다',
      });
    }
    const ids = (payload.lines ?? []).map((line) => line.channelOrderItemId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', path: ['lines'], message: '같은 줄이 두 번 실렸다' });
    }
  });

// ===== Stream Config =====

export const CHANNEL_ORDERS_COMMAND_STREAM = stream({
  topic: 'channel-orders.commands.v1',
  partitions: 3,
  aggregateType: 'ChannelOrder',
  events: {
    ResyncChannelOrder: event<'ResyncChannelOrder', ResyncChannelOrderPayload>(
      'ResyncChannelOrder',
      ResyncChannelOrderSchema,
    ),
    CancelChannelOrder: event<'CancelChannelOrder', CancelChannelOrderPayload>(
      'CancelChannelOrder',
      CancelChannelOrderSchema,
    ),
  },
});

export type ChannelOrdersCommandEvents = typeof CHANNEL_ORDERS_COMMAND_STREAM.events;

export function channelOrderPartitionKey(salesChannel: string, externalOrderId: string): string {
  return `${salesChannel}:${externalOrderId}`;
}
