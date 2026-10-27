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

/**
 * 채널 정산의 환불 방식(#1016 36번 재설계 스펙 §6.1·§6.3). `manual` 은 외부 결제 몫을 PG 대신 wallet «송금 대기»로 남긴다
 * (운영자가 고객 계좌로 보내고 [송금 완료]). 포인트 몫은 둘 다 자동으로 되돌린다.
 */
export const CHANNEL_CANCEL_REFUND_MODES = ['auto', 'manual'] as const;
export type ChannelCancelRefundMode = (typeof CHANNEL_CANCEL_REFUND_MODES)[number];

/** 그 채널 주문의 지금 상태를 다시 가져와 수집 경로(`OrderModified`)로 흘려 달라는 요청. */
export interface ResyncChannelOrderPayload {
  /** 'medusa' | 'naver' … — 문자열로 두고, 지원 여부는 소비자가 판정한다 */
  salesChannel: string;
  externalOrderId: string;
  /** ISO 8601 */
  requestedAt: string;
}

/**
 * 채널에 주문 취소·부분취소를 요청한다 (#1016 35번 행, ADR-0042). core 는 요청 순간 취소를 확정하고 명령을 낸다.
 * 정산이 끝나지 못하면 `ChannelOrderSettlementFailed` 로 돌려받는다(#1016 36번 재설계).
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
  /** 없으면 `auto` — 옛 core(PR 5 전)는 이 칸을 모른다. 같은 requestId 의 재발행은 같은 값을 싣는다 */
  refundMode?: ChannelCancelRefundMode;
  reasonCode?: string;
  requestedBy: 'operator' | 'customer' | 'wallet-refund-approval';
  /** ISO 8601 */
  requestedAt: string;
}

/**
 * 채널에 «반품 도착·검수 결과»를 알려 수령·택배비·환불을 정리하게 한다 (K8 PR6). 성공은 사실로 내지 않는다 —
 * 재수집된 `ChannelReturnSettled` 가 곧 사실이다. 못 끝내면 `ChannelReturnSettlementFailed` 로 돌려받는다.
 */
export interface SettleChannelReturnPayload {
  /** core `customer_returns.id`. 같은 요청의 재전송은 같은 값이다 — Medusa 쪽 멱등 키 */
  requestId: string;
  /** 'medusa' | 'naver' … — 문자열로 두고, 지원 여부는 소비자가 판정한다 */
  salesChannel: string;
  externalOrderId: string;
  returnId: string;
  /** `received`·`dismissed` 는 판매 단위(세트 한 벌이 1). 줄마다 합이 0 보다 커야 한다 */
  items: Array<{ channelOrderItemId: string; received: number; dismissed: number }>;
  /** 없으면 `auto` */
  refundMode?: ChannelCancelRefundMode;
  /**
   * 보류 차감(CS 가 검수 뒤 사유를 적어 환불액에서 더 뺀다, K8 PR6b). 옛 channel-adapter 는 이 칸을 버린다 —
   * 그러면 차감 없이 정산돼 과환불이 된다. 배포 직전 `held` 반품 0 을 확인한다.
   */
  holdDeduction?: { amount: number; memo: string };
  /** 반품 요청이 열린 동안 이미 선환불한 금액(원). 정산에서 상계한다 */
  alreadyRefundedAmount?: number;
  /** 미도착(받지 못함)으로 반품을 닫는 정산이다 */
  closesMissing?: boolean;
  /** ISO 8601 */
  requestedAt: string;
}

/**
 * 반품 요청이 열린 주문에 정산 전에 환불을 먼저 내보낸다 (K8 PR6b). 성공은 `ChannelReturnPrepaid`,
 * 못 하면 `ChannelReturnPrepayFailed` 로 돌려받는다.
 */
export interface PrepayChannelReturnPayload {
  /** core `customer_returns.id` 에서 파생한 멱등 키 — 같은 요청의 재전송은 같은 값이다 */
  requestId: string;
  /** 'medusa' | 'naver' … — 문자열로 두고, 지원 여부는 소비자가 판정한다 */
  salesChannel: string;
  externalOrderId: string;
  returnId: string;
  /** 없으면 소비자가 정한 상한까지. 있으면 1 이상 정수(원) */
  amount?: number;
  refundMode: ChannelCancelRefundMode;
  memo: string;
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
    refundMode: z.enum(CHANNEL_CANCEL_REFUND_MODES).optional(),
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

/** 반품 줄의 수령·폐기 수량. 정산 명령과 `ChannelReturnSettled` 가 같은 모양을 쓴다(orders.stream.ts 가 가져간다). */
export const ReturnSettlementItemSchema = z.object({
  channelOrderItemId: z.string().min(1),
  received: z.number().int().nonnegative(),
  dismissed: z.number().int().nonnegative(),
});

const SettleChannelReturnSchema = z
  .object({
    requestId: z.string().min(1),
    salesChannel: z.string().min(1),
    externalOrderId: z.string().min(1),
    returnId: z.string().min(1),
    items: z.array(ReturnSettlementItemSchema).min(1),
    refundMode: z.enum(CHANNEL_CANCEL_REFUND_MODES).optional(),
    holdDeduction: z.object({ amount: z.number().int().positive(), memo: z.string().min(1).max(500) }).optional(),
    alreadyRefundedAmount: z.number().int().nonnegative().optional(),
    closesMissing: z.boolean().optional(),
    requestedAt: z.string().datetime(),
  })
  .superRefine((payload, context) => {
    payload.items.forEach((item, index) => {
      if (item.received + item.dismissed <= 0) {
        context.addIssue({ code: 'custom', path: ['items', index], message: '수령도 폐기도 없는 줄은 싣지 않는다' });
      }
    });
    const ids = payload.items.map((item) => item.channelOrderItemId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', path: ['items'], message: '같은 줄이 두 번 실렸다' });
    }
  });

const PrepayChannelReturnSchema = z.object({
  requestId: z.string().min(1),
  salesChannel: z.string().min(1),
  externalOrderId: z.string().min(1),
  returnId: z.string().min(1),
  amount: z.number().int().positive().optional(),
  refundMode: z.enum(CHANNEL_CANCEL_REFUND_MODES),
  memo: z.string().min(1).max(500),
  requestedAt: z.string().datetime(),
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
    SettleChannelReturn: event<'SettleChannelReturn', SettleChannelReturnPayload>(
      'SettleChannelReturn',
      SettleChannelReturnSchema,
    ),
    PrepayChannelReturn: event<'PrepayChannelReturn', PrepayChannelReturnPayload>(
      'PrepayChannelReturn',
      PrepayChannelReturnSchema,
    ),
  },
});

export type ChannelOrdersCommandEvents = typeof CHANNEL_ORDERS_COMMAND_STREAM.events;

export function channelOrderPartitionKey(salesChannel: string, externalOrderId: string): string {
  return `${salesChannel}:${externalOrderId}`;
}
