/**
 * wallet 아웃박스 회수 회귀 네트 (ADR-0029 §5-1, Task 6-C-3)
 *
 * 여기 있는 단언은 회수가 **조용히 되돌아갈 수 있는 것들**만 고른다:
 *
 *  1. 옛 로컬 테이블에 다시 쓰는 것 — 적재기(`buildOutboxInsertValues`)를 지웠고, 상태 전이가
 *     publisher 를 지나는지 확인한다.
 *  2. 파티션 키 소실 — PAYMENT_STREAM 에 파생 함수가 없어 생략하면 `aggregateId` 로 떨어진다.
 *     인보이스 계열은 `subscriberType:subscriberRef` 로 파티션되므로, 떨어지는 순간 한 구독자의
 *     이벤트가 여러 파티션으로 흩어져 **순서 보장이 사라진다.**
 *  3. 계약 짝 어긋남 — `payment.intent.*` 에 환불 payload 를 싣는 것 같은 실수. 옛
 *     `OutboxAppendInput` 은 `eventType: string` + `payload: Record` 라 전부 통과했다.
 */

import { PAYMENT_STREAM } from '@packages/event-contracts/streams';
import type { PublisherFor } from '@app/events';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import {
  GATEWAY_REFUND_EVENT_NAMES,
  PAYMENT_INTENT_EVENT_NAMES,
  isGatewayRefundAppend,
  isPaymentIntentAppend,
} from './wallet-outbox.types';
import { WALLET_OUTBOX_CONFIG } from './wallet-outbox.config';

type EnqueueCall = [{ eventType: string; aggregateId: string; partitionKey?: string }, unknown];

describe('wallet 아웃박스 회수', () => {
  describe('계열 판별', () => {
    it('두 계열의 이름이 모두 계약에 실재한다', () => {
      // `satisfies` 가 컴파일에서 이미 강제하지만, 계약이 런타임에 무엇을 들고 있는지는
      // 별개 사실이다 — 타입만 맞고 `events` 맵에 없으면 발행이 검증을 건너뛴다.
      for (const name of [...PAYMENT_INTENT_EVENT_NAMES, ...GATEWAY_REFUND_EVENT_NAMES]) {
        expect(PAYMENT_STREAM.events[name]).toBeDefined();
      }
    });

    it('두 계열이 서로 겹치지 않는다', () => {
      // 겹치면 `appendOutboxIfNeeded` 의 첫 분기가 남은 계열을 삼킨다 — payload 타입이 달라
      // 검증에서 터지는데, 그때는 이미 도메인 트랜잭션 안이다.
      const intent = new Set<string>(PAYMENT_INTENT_EVENT_NAMES);
      for (const name of GATEWAY_REFUND_EVENT_NAMES) {
        expect(intent.has(name)).toBe(false);
      }
    });

    it('판별 함수가 계열을 정확히 가른다', () => {
      const intentEvent = {
        eventType: 'payment.intent.captured' as const,
        aggregateId: 'intent-1',
        payload: { intentId: 'intent-1', occurredAt: '2026-08-09T00:00:00.000Z' },
      };
      const refundEvent = {
        eventType: 'gateway.refund.succeeded' as const,
        aggregateId: 'intent-1',
        payload: {
          refundId: 'r-1',
          chargeId: 'c-1',
          intentId: 'intent-1',
          userId: 'u-1',
          status: 'SUCCEEDED',
          amount: 100,
          currency: 'KRW',
          occurredAt: '2026-08-09T00:00:00.000Z',
        },
      };

      expect(isPaymentIntentAppend(intentEvent)).toBe(true);
      expect(isGatewayRefundAppend(intentEvent)).toBe(false);
      expect(isGatewayRefundAppend(refundEvent)).toBe(true);
      expect(isPaymentIntentAppend(refundEvent)).toBe(false);
    });
  });

  describe('상태 전이의 적재', () => {
    function makeService() {
      const enqueue = jest.fn<Promise<void>, EnqueueCall>().mockResolvedValue(undefined);
      const publisher = { enqueue } as unknown as PublisherFor<typeof PAYMENT_STREAM>;
      const service = new StateTransitionService({} as never, publisher);
      // `appendOutboxIfNeeded` 는 private 이지만 이 조각의 관심사 그 자체다. 공개 전이 메서드로
      // 부르려면 행잠금 SQL 을 통째로 mock 해야 하고, 그러면 관찰하려는 것보다 mock 이 커진다.
      const target = service as unknown as {
        appendOutboxIfNeeded(context: unknown, tx: unknown): Promise<void>;
      };
      const append = (context: unknown, tx: unknown): Promise<void> => target.appendOutboxIfNeeded(context, tx);
      return { append, enqueue };
    }

    const TX = { insert: jest.fn() };

    it('파티션 키를 생략하면 aggregateId 로 떨어진다 — 옛 폴백과 같다', async () => {
      const { append, enqueue } = makeService();

      await append(
        {
          outboxEvent: {
            eventType: 'payment.intent.captured',
            aggregateId: 'intent-1',
            payload: { intentId: 'intent-1', occurredAt: '2026-08-09T00:00:00.000Z' },
          },
        },
        TX,
      );

      expect(enqueue.mock.calls[0][0].partitionKey).toBe('intent-1');
    });

    it('구독자 파티션 키를 넘기면 그대로 실린다', async () => {
      // 인보이스/정기결제 계열이 이 경로를 쓴다. 떨어지면 한 구독자의 이벤트가 여러 파티션으로
      // 흩어져 membership 이 보는 순서가 깨진다.
      const { append, enqueue } = makeService();

      await append(
        {
          outboxEvent: {
            eventType: 'payment.intent.failed',
            aggregateId: 'intent-2',
            partitionKey: 'MEMBERSHIP:contract-7',
            payload: { intentId: 'intent-2', occurredAt: '2026-08-09T00:00:00.000Z' },
          },
        },
        TX,
      );

      const [params, tx] = enqueue.mock.calls[0];
      expect(params.partitionKey).toBe('MEMBERSHIP:contract-7');
      // 도메인 전이와 **같은 트랜잭션**에 실려야 한다 — 이 인자가 커넥션으로 바뀌면
      // 트랜잭셔널 아웃박스가 아니라 그냥 두 번의 쓰기가 된다.
      expect(tx).toBe(TX);
    });

    it('outboxEvent 가 없으면 아무것도 적재하지 않는다 (대조군)', async () => {
      const { append, enqueue } = makeService();

      await append({}, TX);

      expect(enqueue).not.toHaveBeenCalled();
    });
  });

  describe('디스패처 설정', () => {
    it('파티션 순서 보장을 켠다', () => {
      // 옛 로컬 디스패처의 acquire 술어에 같은 조건이 있었다. 이 한 줄이 빠지면 재시도 중인
      // 앞 이벤트를 뒤 이벤트가 추월한다 — 증상이 장애 때만 나타나서 늦게 발견된다.
      expect(WALLET_OUTBOX_CONFIG.strictPartitionOrdering).toBe(true);
    });

    it('소진 임계를 10회로 보존한다', () => {
      // 공용 기본값은 5다. 회수의 부수효과로 결제 이벤트의 포기 시점을 절반으로 줄이지 않는다.
      expect(WALLET_OUTBOX_CONFIG.maxRetries).toBe(10);
    });
  });
});
