/**
 * Channel Orders Command Stream (#1016 6번 행)
 *
 * 명령 스트림이다 — «일어난 사실»이 아니라 실행자가 하나인 «요청». core 는 channel-adapter 를
 * 직접 부르지 않는다(channel-adapter 는 외부 세계의 일을 이벤트로 번역해 브로커에 던지는 자리다).
 * 그래서 토픽 이름은 서비스가 아니라 역할로 짓는다 — core 는 «채널 주문을 다룰 줄 아는 누군가»에게
 * 요청할 뿐 그게 누구인지 모른다. 기존 `wallet.commands.v1`(받는 쪽 이름)·`ugc.commands.v1`(보내는 쪽
 * 이름)과 기준이 다른 이유다. 명령 이름은 명령형(`CreateInvoice` 와 같은 꼴).
 *
 * 파티션 키 = `channelOrderPartitionKey` — 같은 주문의 명령(나중의 35번 행 취소 요청 포함)이 순서대로 처리된다.
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

// ===== Zod Schemas =====

const ResyncChannelOrderSchema = z.object({
  salesChannel: z.string().min(1),
  externalOrderId: z.string().min(1),
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
  },
});

export type ChannelOrdersCommandEvents = typeof CHANNEL_ORDERS_COMMAND_STREAM.events;

export function channelOrderPartitionKey(salesChannel: string, externalOrderId: string): string {
  return `${salesChannel}:${externalOrderId}`;
}
